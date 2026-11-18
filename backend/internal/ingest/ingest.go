// Package ingest runs the background pipeline: OCR -> store pages -> extract metadata.
package ingest

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"docdoctor/internal/config"
	"docdoctor/internal/llm"
	"docdoctor/internal/ocr"
	"docdoctor/internal/store"
)

type Pipeline struct {
	Cfg    config.Config
	Store  *store.Store
	Local  *ocr.Local
	Claude *llm.Client // nil when no API credentials are configured
}

// Path returns where an uploaded file lives on disk.
func (p *Pipeline) Path(storageKey string) string {
	return filepath.Join(p.Cfg.DataDir, "uploads", filepath.FromSlash(storageKey))
}

// Run polls the queue until ctx is cancelled. Safe to run several workers.
func (p *Pipeline) Run(ctx context.Context) {
	if err := p.Store.RequeueStuck(ctx); err != nil {
		log.Printf("ingest: requeue stuck documents: %v", err)
	}
	for {
		doc, err := p.Store.ClaimNextDocument(ctx)
		switch {
		case err == nil:
			p.process(ctx, doc)
			continue
		case !errors.Is(err, store.ErrNotFound) && ctx.Err() == nil:
			log.Printf("ingest: claim: %v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(1500 * time.Millisecond):
		}
	}
}

func (p *Pipeline) process(ctx context.Context, doc store.Document) {
	start := time.Now()
	if err := p.run(ctx, doc); err != nil {
		log.Printf("ingest: document %d (%s) failed: %v", doc.ID, doc.Filename, err)
		if ferr := p.Store.FailDocument(context.WithoutCancel(ctx), doc.ID, err.Error()); ferr != nil {
			log.Printf("ingest: mark failed: %v", ferr)
		}
		return
	}
	log.Printf("ingest: document %d (%s) ready in %s", doc.ID, doc.Filename, time.Since(start).Round(time.Millisecond))
}

func (p *Pipeline) run(ctx context.Context, doc store.Document) error {
	data, err := os.ReadFile(p.Path(doc.StorageKey))
	if err != nil {
		return fmt.Errorf("read upload: %w", err)
	}

	mode := doc.OCRRequest
	if mode == "" {
		mode = p.Cfg.OCRMode
	}

	pages, engine, conf, notice, err := p.ocr(ctx, doc, data, mode)
	if err != nil {
		return err
	}
	if err := p.Store.ReplacePages(ctx, doc, pages, engine, conf); err != nil {
		return fmt.Errorf("store pages: %w", err)
	}

	var full strings.Builder
	for _, pg := range pages {
		fmt.Fprintf(&full, "--- page %d ---\n%s\n\n", pg.PageNo, pg.Text)
	}
	if strings.TrimSpace(joinText(pages)) == "" {
		return p.Store.FinishDocument(ctx, doc.ID, nil, appendNote(notice, "We could not find any text in this file. If it is a photo, try again in better light."))
	}
	if p.Claude == nil {
		return p.finishWithGuess(ctx, doc, full.String(), appendNote(notice, "This document can be searched. Summaries and key details are not switched on yet."))
	}

	p.Store.SetStage(ctx, doc.ID, "analyzing")
	company, err := p.Store.OrgContext(ctx, doc.OrgID)
	if err != nil {
		return fmt.Errorf("load company info: %w", err)
	}
	analysis, err := p.Claude.Analyze(ctx, company, doc.Filename, full.String())
	if err != nil {
		// The text is already searchable; keep the document usable. The technical reason
		// goes to the server log, the user sees a plain-language note.
		log.Printf("ingest: document %d: metadata extraction failed: %v", doc.ID, err)
		return p.finishWithGuess(ctx, doc, full.String(), appendNote(notice, "This document can be searched, but its summary and key details could not be created. Use Read again to retry."))
	}
	return p.Store.FinishDocument(ctx, doc.ID, analysis, notice)
}

// finishWithGuess files a document using the keyword classifier instead of Claude.
func (p *Pipeline) finishWithGuess(ctx context.Context, doc store.Document, text, notice string) error {
	g := guess(text)
	if g == nil {
		return p.Store.FinishDocument(ctx, doc.ID, nil, notice)
	}
	return p.Store.FinishDocument(ctx, doc.ID, g, appendNote(notice, "Its type was worked out from keywords, so check that it looks right."))
}

// ocr picks the engine: local first, Claude vision when requested or (in auto mode) when
// the local result is missing or low-confidence.
func (p *Pipeline) ocr(ctx context.Context, doc store.Document, data []byte, mode string) (pages []store.Page, engine string, conf *float32, notice string, err error) {
	if mode == "claude" {
		if p.Claude == nil {
			return nil, "", nil, "", errors.New("Claude vision OCR was requested but no Claude API key is configured (set ANTHROPIC_API_KEY)")
		}
		pages, err = p.claudeOCR(ctx, doc, data)
		return pages, "claude-vision", nil, "", err
	}

	res, lerr := p.Local.OCR(ctx, doc.Filename, data)
	canEscalate := mode == "auto" && p.Claude != nil
	weak := lerr == nil && (res.Confidence < float32(p.Cfg.OCRMinConfidence) ||
		res.WeakRatio > float32(p.Cfg.OCRMaxWeakRatio) ||
		strings.TrimSpace(joinText(res.Pages)) == "")

	if lerr != nil && !canEscalate {
		return nil, "", nil, "", lerr
	}
	if lerr == nil && (!weak || !canEscalate) {
		if weak && mode == "auto" {
			notice = "Parts of this scan were hard to read. Check the text against the picture, or scan it again in better light."
		}
		c := res.Confidence
		return res.Pages, res.Engine, &c, notice, nil
	}

	// Escalate to Claude vision.
	cpages, cerr := p.claudeOCR(ctx, doc, data)
	if cerr != nil {
		if lerr != nil {
			return nil, "", nil, "", fmt.Errorf("local OCR failed (%v) and Claude vision failed (%v)", lerr, cerr)
		}
		log.Printf("ingest: document %d: Claude vision retry failed: %v", doc.ID, cerr)
		c := res.Confidence
		return res.Pages, res.Engine, &c, "Parts of this scan were hard to read. Check the text against the picture, or scan it again in better light.", nil
	}
	if lerr != nil {
		notice = ""
	} else {
		notice = "The first read was unclear, so this scan was read a second time more carefully."
	}
	return cpages, "claude-vision", nil, notice, nil
}

func (p *Pipeline) claudeOCR(ctx context.Context, doc store.Document, data []byte) ([]store.Page, error) {
	mime := doc.Mime
	switch mime {
	case "application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp":
	default:
		// HEIC/TIFF/BMP: convert locally first, the API only takes the formats above.
		jpeg, err := p.Local.ToJPEG(ctx, doc.Filename, data)
		if err != nil {
			return nil, fmt.Errorf("convert %s for Claude vision: %w", mime, err)
		}
		data, mime = jpeg, "image/jpeg"
	}
	return p.Claude.OCR(ctx, data, mime)
}

func joinText(pages []store.Page) string {
	var b strings.Builder
	for _, p := range pages {
		b.WriteString(p.Text)
		b.WriteByte('\n')
	}
	return b.String()
}

func appendNote(a, b string) string {
	if a == "" {
		return b
	}
	return a + " " + b
}
