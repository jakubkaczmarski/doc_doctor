# Run each of these in its own terminal for development.

.PHONY: db ocr api web build seed samples

db:        ## create the local database (once)
	createdb docdoctor || true

ocr:       ## local OCR worker on :8001
	cd ocr-worker && uv run uvicorn app:app --port 8001

api:       ## Go API on :8080 (also serves web/dist if built)
	cd backend && go run ./cmd/server

web:       ## Vite dev server on :5173, proxies /api to :8080
	cd web && npm run dev

build:     ## production build: web bundle + single Go binary
	cd web && npm ci && npm run build
	cd backend && go build -o server ./cmd/server

seed:      ## create a local demo account (see scripts/dev-seed.sh)
	./scripts/dev-seed.sh

samples:   ## generate three synthetic Polish scans into ./samples for a demo
	mkdir -p samples && cd ocr-worker && uv run python ../scripts/make_samples.py ../samples
