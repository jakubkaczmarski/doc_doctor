package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"docdoctor/internal/chat"
	"docdoctor/internal/config"
	"docdoctor/internal/httpapi"
	"docdoctor/internal/ingest"
	"docdoctor/internal/llm"
	"docdoctor/internal/ocr"
	"docdoctor/internal/store"
)

func main() {
	cfg := config.Load()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	st, err := store.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer st.DB.Close()

	pipeline := &ingest.Pipeline{Cfg: cfg, Store: st, Local: ocr.NewLocal(cfg.OCRWorkerURL)}
	srv := &httpapi.Server{Cfg: cfg, Store: st, Pipeline: pipeline}
	if cfg.ClaudeEnabled {
		client := llm.New(cfg.Model)
		pipeline.Claude = client
		srv.Agent = &chat.Agent{LLM: client, Store: st}
		log.Printf("Claude enabled (model %s), OCR mode %q", cfg.Model, cfg.OCRMode)
	} else {
		log.Printf("Claude disabled: no ANTHROPIC_API_KEY. Local OCR and search work; extraction, vision OCR and Q&A are off.")
	}

	// Two ingest workers: OCR is CPU-bound in the worker process, Claude calls are I/O-bound.
	for i := 0; i < 2; i++ {
		go pipeline.Run(ctx)
	}

	server := &http.Server{Addr: cfg.Addr, Handler: srv.Handler(), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Shutdown(shutdown)
	}()
	log.Printf("listening on %s", cfg.Addr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
