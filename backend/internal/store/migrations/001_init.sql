CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE TABLE orgs (
    id         bigserial PRIMARY KEY,
    name       text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id            bigserial PRIMARY KEY,
    org_id        bigint NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    email         text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
    token_hash bytea PRIMARY KEY,
    user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL
);

-- One row per uploaded file. Every query is scoped by org_id.
CREATE TABLE documents (
    id             bigserial PRIMARY KEY,
    org_id         bigint NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    filename       text NOT NULL,
    mime           text NOT NULL,
    size_bytes     bigint NOT NULL,
    sha256         text NOT NULL,
    storage_key    text NOT NULL,

    -- pipeline state
    status         text NOT NULL DEFAULT 'queued',   -- queued | processing | ready | failed
    stage          text NOT NULL DEFAULT '',         -- ocr | analyzing
    error          text NOT NULL DEFAULT '',
    notice         text NOT NULL DEFAULT '',         -- non-fatal note, e.g. analysis skipped
    ocr_request    text NOT NULL DEFAULT '',         -- per-document override: '' | local | claude | auto
    ocr_engine     text NOT NULL DEFAULT '',
    ocr_confidence real,
    page_count     int NOT NULL DEFAULT 0,

    -- extracted metadata
    doc_type       text NOT NULL DEFAULT 'unknown',  -- invoice | receipt | contract | letter | form | report | other | unknown
    title          text NOT NULL DEFAULT '',
    summary        text NOT NULL DEFAULT '',
    language       text NOT NULL DEFAULT '',
    doc_date       date,
    counterparty   text NOT NULL DEFAULT '',
    total_amount   numeric(18,2),
    currency       text NOT NULL DEFAULT '',
    tags           text[] NOT NULL DEFAULT '{}',
    fields         jsonb NOT NULL DEFAULT '[]',      -- [{name, value}] type-specific fields

    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    processed_at   timestamptz,
    UNIQUE (org_id, sha256)
);
CREATE INDEX documents_org_created ON documents (org_id, created_at DESC);
CREATE INDEX documents_queue ON documents (id) WHERE status = 'queued';

-- OCR text, one row per page: the unit of retrieval and citation.
CREATE TABLE pages (
    id          bigserial PRIMARY KEY,
    document_id bigint NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    org_id      bigint NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    page_no     int NOT NULL,
    text        text NOT NULL,
    confidence  real,
    engine      text NOT NULL DEFAULT '',
    tsv         tsvector NOT NULL,
    UNIQUE (document_id, page_no)
);
CREATE INDEX pages_tsv ON pages USING gin (tsv);
CREATE INDEX pages_org ON pages (org_id);

CREATE TABLE conversations (
    id         bigserial PRIMARY KEY,
    org_id     bigint NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE messages (
    id              bigserial PRIMARY KEY,
    conversation_id bigint NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            text NOT NULL,                  -- user | assistant
    content         text NOT NULL,
    sources         jsonb NOT NULL DEFAULT '[]',    -- [{doc_id, page, title}]
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_conv ON messages (conversation_id, id);
