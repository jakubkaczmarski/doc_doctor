// Package ocr talks to the local OCR worker (ocr-worker/), which runs entirely on this machine.
package ocr

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"time"

	"docdoctor/internal/store"
)

type Local struct {
	URL  string
	HTTP *http.Client
}

func NewLocal(url string) *Local {
	return &Local{URL: url, HTTP: &http.Client{Timeout: 15 * time.Minute}}
}

type Result struct {
	Pages      []store.Page
	Engine     string  // e.g. "rapidocr", "pdf-text", or "mixed"
	Confidence float32 // mean over pages, weighted by text length
	WeakRatio  float32 // share of the text in lines the recogniser was unsure about
}

func (l *Local) post(ctx context.Context, path, filename string, data []byte) (*http.Response, error) {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	part, err := w.CreateFormFile("file", filename)
	if err != nil {
		return nil, err
	}
	part.Write(data)
	w.Close()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, l.URL+path, &buf)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", w.FormDataContentType())
	resp, err := l.HTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("local OCR worker unreachable at %s: %w", l.URL, err)
	}
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2000))
		resp.Body.Close()
		return nil, fmt.Errorf("local OCR worker returned %d: %s", resp.StatusCode, body)
	}
	return resp, nil
}

// OCR sends a PDF or image to the worker and returns per-page text with confidence.
func (l *Local) OCR(ctx context.Context, filename string, data []byte) (*Result, error) {
	resp, err := l.post(ctx, "/ocr", filename, data)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var out struct {
		Engine     string  `json:"engine"`
		Confidence float32 `json:"confidence"`
		WeakRatio  float32 `json:"weak_ratio"`
		Pages      []struct {
			PageNo     int     `json:"page_no"`
			Text       string  `json:"text"`
			Confidence float32 `json:"confidence"`
			Engine     string  `json:"engine"`
		} `json:"pages"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("decode OCR worker response: %w", err)
	}
	res := &Result{Engine: out.Engine, Confidence: out.Confidence, WeakRatio: out.WeakRatio}
	for _, p := range out.Pages {
		conf := p.Confidence
		res.Pages = append(res.Pages, store.Page{PageNo: p.PageNo, Text: p.Text, Confidence: &conf, Engine: p.Engine})
	}
	return res, nil
}

// ToJPEG converts an image the Claude API does not accept (HEIC, TIFF, BMP) to JPEG.
func (l *Local) ToJPEG(ctx context.Context, filename string, data []byte) ([]byte, error) {
	resp, err := l.post(ctx, "/convert", filename, data)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	return io.ReadAll(resp.Body)
}

// Preview renders one page of a PDF or image as a JPEG for the document viewer.
func (l *Local) Preview(ctx context.Context, filename string, data []byte, page int) ([]byte, error) {
	resp, err := l.post(ctx, fmt.Sprintf("/preview?page=%d", page), filename, data)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	return io.ReadAll(resp.Body)
}

// Healthy reports whether the worker is up.
func (l *Local) Healthy(ctx context.Context) bool {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, l.URL+"/health", nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}
