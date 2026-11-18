// Package config loads runtime settings from the environment (and an optional .env file).
package config

import (
	"bufio"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Addr        string
	DatabaseURL string
	DataDir     string
	WebDir      string

	// OCR
	OCRWorkerURL     string
	OCRMode          string  // "local" | "claude" | "auto"
	OCRMinConfidence float64 // in auto mode, escalate to Claude below this mean confidence
	OCRMaxWeakRatio  float64 // ... or when more than this share of the text is in unsure lines

	// Claude
	Model         string
	ClaudeEnabled bool

	CookieSecure bool
}

func Load() Config {
	loadDotEnv(".env")
	loadDotEnv("../.env")

	c := Config{
		Addr:             env("ADDR", ":8080"),
		DatabaseURL:      env("DATABASE_URL", "postgres://localhost:5432/docdoctor?sslmode=disable"),
		DataDir:          env("DATA_DIR", "./data"),
		WebDir:           env("WEB_DIR", "../web/dist"),
		OCRWorkerURL:     strings.TrimRight(env("OCR_WORKER_URL", "http://127.0.0.1:8001"), "/"),
		OCRMode:          strings.ToLower(env("OCR_MODE", "auto")),
		OCRMinConfidence: envFloat("OCR_MIN_CONFIDENCE", 0.85),
		OCRMaxWeakRatio:  envFloat("OCR_MAX_WEAK_RATIO", 0.05),
		Model:            env("CLAUDE_MODEL", "claude-opus-5-5"),
		CookieSecure:     env("COOKIE_SECURE", "") == "1",
	}
	c.ClaudeEnabled = os.Getenv("ANTHROPIC_API_KEY") != "" || os.Getenv("ANTHROPIC_AUTH_TOKEN") != ""
	switch c.OCRMode {
	case "local", "claude", "auto":
	default:
		c.OCRMode = "auto"
	}
	return c
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envFloat(key string, def float64) float64 {
	if v, err := strconv.ParseFloat(os.Getenv(key), 64); err == nil {
		return v
	}
	return def
}

// loadDotEnv sets variables from a KEY=VALUE file without overriding the real environment.
func loadDotEnv(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		k = strings.TrimSpace(k)
		v = strings.Trim(strings.TrimSpace(v), `"'`)
		if _, set := os.LookupEnv(k); !set && v != "" {
			os.Setenv(k, v)
		}
	}
}
