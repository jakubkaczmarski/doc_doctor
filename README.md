# Doc Doctor

Turn a business's paper documents into an archive it can search and ask questions of.

1. **Upload** scans or phone photos (PDF, JPG, PNG, HEIC, TIFF, WebP).
2. **OCR** runs locally first. Weak scans can be re-read with Claude vision.
3. **Filing**: each document gets a type, title, summary, date, counterparty, total
   and key fields, stored in Postgres next to the page text.
4. **Ask**: Claude answers questions using search and lookup tools scoped to the
   organisation, and cites the page behind each fact.

## Layout

| Path          | What                                                                       |
| ------------- | -------------------------------------------------------------------------- |
| `backend/`    | Go API: auth, uploads, ingest queue, search, chat (SSE)                    |
| `ocr-worker/` | Python service: local OCR (RapidOCR / PaddleOCR models on ONNX), PDF text layer, page previews |
| `web/`        | React + TypeScript + Tailwind + shadcn/ui                                  |

```
upload ─► documents (queued) ─► ingest worker ─► ocr-worker ──► pages (text + tsvector)
                                     │               └ low confidence? ─► Claude vision
                                     └─► Claude: metadata extraction ─► documents (ready)

question ─► chat agent (Claude + tools: search_pages, read_document,
            list_documents, aggregate_documents) ─► streamed answer with [doc:page] citations
```

## Run it locally

Needs Go, Node, Postgres and [uv](https://docs.astral.sh/uv/). On macOS:
`brew install go node postgresql@17 uv && brew services start postgresql@17`.

```bash
cp .env.example .env      # add ANTHROPIC_API_KEY to enable extraction and Q&A
make db                   # once
make ocr                  # terminal 1
make api                  # terminal 2
make web                  # terminal 3, then open http://localhost:5173
```

For a production-style run, `make build` and start `backend/server` from `backend/`;
it serves the built web app on `:8080`. The OCR worker downloads its models
(about 100 MB) on first use.

## OCR modes

`OCR_MODE` in `.env`, and "Re-read with Claude vision" per document in the UI.

- `local`: documents never leave the machine for OCR.
- `auto` (default): local first; if mean confidence is under `OCR_MIN_CONFIDENCE`
  or more than `OCR_MAX_WEAK_RATIO` of the text sits in unsure lines, the document is
  re-read with Claude vision (only when a key is configured).
- `claude`: always Claude vision.

Note that metadata extraction and Q&A send document text to the Claude API in every
mode. Without a key the app is OCR + search only.

The local recogniser defaults to the multilingual PP-OCRv6 model, which handles
Latin-script languages including Polish diacritics. For other scripts set `OCR_LANG`
on the worker (`cyrillic`, `eslav`, `arabic`, `korean`, `el`, ...). `OCR_DET=mobile`
trades some recall on dense tables for about 4x speed.

## How retrieval works

Pages are the unit of search and citation. Search is Postgres full-text
(`simple` config, accents removed, OR over keyword prefixes), so no stemmer is needed
and inflected languages still match on stems. Claude writes the search queries, can
retry with other terms, and reads full pages before answering. Questions about totals
go through `aggregate_documents`, which sums the extracted amounts in SQL across the
whole archive rather than over a handful of search hits.

## Not built yet

- Team members and roles (the schema is per-organisation; sign-up creates one user per org).
- Semantic (embedding) search. `pgvector` plus an embedding model would slot in beside the
  full-text index if keyword recall turns out to be the limit.
- Object storage (uploads live under `DATA_DIR`), rate limiting, password reset, audit log.
- Table structure from local OCR: columns are kept as tab-separated text, not cells.
