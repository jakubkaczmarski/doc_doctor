// Package store is the Postgres data layer. Every document query takes an org ID.
package store

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrations embed.FS

var ErrNotFound = errors.New("not found")

type Store struct{ DB *pgxpool.Pool }

func Open(ctx context.Context, url string) (*Store, error) {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("connect to postgres: %w", err)
	}
	s := &Store{DB: pool}
	return s, s.migrate(ctx)
}

func (s *Store) migrate(ctx context.Context) error {
	if _, err := s.DB.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`); err != nil {
		return err
	}
	entries, err := migrations.ReadDir("migrations")
	if err != nil {
		return err
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		names = append(names, e.Name())
	}
	sort.Strings(names)
	for _, name := range names {
		var done bool
		if err := s.DB.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE name=$1)`, name).Scan(&done); err != nil {
			return err
		}
		if done {
			continue
		}
		sql, _ := migrations.ReadFile("migrations/" + name)
		tx, err := s.DB.Begin(ctx)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, string(sql)); err != nil {
			tx.Rollback(ctx)
			return fmt.Errorf("migration %s: %w", name, err)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO schema_migrations (name) VALUES ($1)`, name); err != nil {
			tx.Rollback(ctx)
			return err
		}
		if err := tx.Commit(ctx); err != nil {
			return err
		}
	}
	return nil
}

// ---------- users & sessions ----------

type User struct {
	ID      int64  `json:"id"`
	OrgID   int64  `json:"org_id"`
	Email   string `json:"email"`
	OrgName string `json:"org_name"`
	hash    string
}

func (u User) PasswordHash() string { return u.hash }

func (s *Store) CreateOrgAndUser(ctx context.Context, orgName, email, hash string) (User, error) {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return User{}, err
	}
	defer tx.Rollback(ctx)
	u := User{Email: email, OrgName: orgName}
	if err := tx.QueryRow(ctx, `INSERT INTO orgs (name) VALUES ($1) RETURNING id`, orgName).Scan(&u.OrgID); err != nil {
		return User{}, err
	}
	if err := tx.QueryRow(ctx, `INSERT INTO users (org_id, email, password_hash) VALUES ($1,$2,$3) RETURNING id`, u.OrgID, email, hash).Scan(&u.ID); err != nil {
		return User{}, err
	}
	return u, tx.Commit(ctx)
}

func (s *Store) UserByEmail(ctx context.Context, email string) (User, error) {
	var u User
	err := s.DB.QueryRow(ctx, `SELECT u.id, u.org_id, u.email, o.name, u.password_hash FROM users u JOIN orgs o ON o.id=u.org_id WHERE u.email=$1`, email).
		Scan(&u.ID, &u.OrgID, &u.Email, &u.OrgName, &u.hash)
	if errors.Is(err, pgx.ErrNoRows) {
		return u, ErrNotFound
	}
	return u, err
}

func (s *Store) CreateSession(ctx context.Context, tokenHash []byte, userID int64, ttl time.Duration) error {
	_, err := s.DB.Exec(ctx, `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1,$2,$3)`, tokenHash, userID, time.Now().Add(ttl))
	return err
}

func (s *Store) UserBySession(ctx context.Context, tokenHash []byte) (User, error) {
	var u User
	err := s.DB.QueryRow(ctx, `SELECT u.id, u.org_id, u.email, o.name FROM sessions s JOIN users u ON u.id=s.user_id JOIN orgs o ON o.id=u.org_id WHERE s.token_hash=$1 AND s.expires_at > now()`, tokenHash).
		Scan(&u.ID, &u.OrgID, &u.Email, &u.OrgName)
	if errors.Is(err, pgx.ErrNoRows) {
		return u, ErrNotFound
	}
	return u, err
}

// CreateLoginLink stores a one-time sign-in token for a user.
func (s *Store) CreateLoginLink(ctx context.Context, tokenHash []byte, userID int64, ttl time.Duration) error {
	// Old links are swept here so the table never grows.
	if _, err := s.DB.Exec(ctx, `DELETE FROM login_links WHERE expires_at < now()`); err != nil {
		return err
	}
	_, err := s.DB.Exec(ctx, `INSERT INTO login_links (token_hash, user_id, expires_at) VALUES ($1,$2,$3)`, tokenHash, userID, time.Now().Add(ttl))
	return err
}

// RedeemLoginLink consumes a one-time token and returns the user it signs in.
func (s *Store) RedeemLoginLink(ctx context.Context, tokenHash []byte) (int64, error) {
	var userID int64
	err := s.DB.QueryRow(ctx, `DELETE FROM login_links WHERE token_hash=$1 AND expires_at > now() RETURNING user_id`, tokenHash).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrNotFound
	}
	return userID, err
}

func (s *Store) DeleteSession(ctx context.Context, tokenHash []byte) error {
	_, err := s.DB.Exec(ctx, `DELETE FROM sessions WHERE token_hash=$1`, tokenHash)
	return err
}

// OrgProfile returns the business info the owner wrote for the assistant.
func (s *Store) OrgProfile(ctx context.Context, orgID int64) (string, error) {
	var profile string
	err := s.DB.QueryRow(ctx, `SELECT profile FROM orgs WHERE id=$1`, orgID).Scan(&profile)
	return profile, err
}

// OrgContext describes the archive owner for document classification.
func (s *Store) OrgContext(ctx context.Context, orgID int64) (string, error) {
	var name, profile string
	if err := s.DB.QueryRow(ctx, `SELECT name, profile FROM orgs WHERE id=$1`, orgID).Scan(&name, &profile); err != nil {
		return "", err
	}
	if strings.TrimSpace(profile) == "" {
		return "Archive owner: " + name, nil
	}
	return "Archive owner: " + name + "\n" + strings.TrimSpace(profile), nil
}

func (s *Store) SetOrgProfile(ctx context.Context, orgID int64, profile string) error {
	_, err := s.DB.Exec(ctx, `UPDATE orgs SET profile=$2 WHERE id=$1`, orgID, profile)
	return err
}

// ---------- documents ----------

type Field struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

type Document struct {
	ID            int64      `json:"id"`
	OrgID         int64      `json:"-"`
	Filename      string     `json:"filename"`
	Mime          string     `json:"mime"`
	SizeBytes     int64      `json:"size_bytes"`
	SHA256        string     `json:"-"`
	StorageKey    string     `json:"-"`
	Status        string     `json:"status"`
	Stage         string     `json:"stage"`
	Error         string     `json:"error"`
	Notice        string     `json:"notice"`
	OCRRequest    string     `json:"ocr_request"`
	OCREngine     string     `json:"ocr_engine"`
	OCRConfidence *float32   `json:"ocr_confidence"`
	PageCount     int        `json:"page_count"`
	DocType       string     `json:"doc_type"`
	Category      string     `json:"category"`
	Subject       string     `json:"subject"`
	Title         string     `json:"title"`
	Summary       string     `json:"summary"`
	Language      string     `json:"language"`
	DocDate       *string    `json:"doc_date"`
	Counterparty  string     `json:"counterparty"`
	TotalAmount   *float64   `json:"total_amount"`
	Currency      string     `json:"currency"`
	Tags          []string   `json:"tags"`
	Fields        []Field    `json:"fields"`
	CreatedAt     time.Time  `json:"created_at"`
	ProcessedAt   *time.Time `json:"processed_at"`
	// UserSet lists fields the user set by hand; UserNote is their description.
	UserSet  []string `json:"user_set"`
	UserNote string   `json:"user_note"`
	// TypeSure is false when automatic detection was not confident about the type.
	TypeSure bool `json:"type_sure"`
}

const docCols = `id, org_id, filename, mime, size_bytes, sha256, storage_key, status, stage, error, notice,
	ocr_request, ocr_engine, ocr_confidence, page_count, doc_type, category, subject, title, summary, language,
	to_char(doc_date, 'YYYY-MM-DD'), counterparty, total_amount::float8, currency, tags, fields, created_at, processed_at,
	user_set, user_note, type_sure`

func scanDoc(row pgx.Row) (Document, error) {
	var d Document
	err := row.Scan(&d.ID, &d.OrgID, &d.Filename, &d.Mime, &d.SizeBytes, &d.SHA256, &d.StorageKey, &d.Status, &d.Stage, &d.Error, &d.Notice,
		&d.OCRRequest, &d.OCREngine, &d.OCRConfidence, &d.PageCount, &d.DocType, &d.Category, &d.Subject, &d.Title, &d.Summary, &d.Language,
		&d.DocDate, &d.Counterparty, &d.TotalAmount, &d.Currency, &d.Tags, &d.Fields, &d.CreatedAt, &d.ProcessedAt,
		&d.UserSet, &d.UserNote, &d.TypeSure)
	if errors.Is(err, pgx.ErrNoRows) {
		return d, ErrNotFound
	}
	if d.Tags == nil {
		d.Tags = []string{}
	}
	if d.Fields == nil {
		d.Fields = []Field{}
	}
	if d.UserSet == nil {
		d.UserSet = []string{}
	}
	return d, err
}

// InsertDocument stores a new upload. If the same file (by hash) already exists for the
// org, the existing row is returned with created=false.
func (s *Store) InsertDocument(ctx context.Context, d Document) (doc Document, created bool, err error) {
	// Anything the uploader said about the document is recorded as set by hand.
	userSet := []string{}
	if d.DocType == "" {
		d.DocType = "unknown"
	} else {
		userSet = append(userSet, "doc_type")
	}
	if d.Category != "" {
		userSet = append(userSet, "category")
	}
	doc, err = scanDoc(s.DB.QueryRow(ctx, `INSERT INTO documents (org_id, filename, mime, size_bytes, sha256, storage_key, ocr_request, title,
			doc_type, category, user_note, user_set)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$2,$8,$9,$10,$11) ON CONFLICT (org_id, sha256) DO NOTHING RETURNING `+docCols,
		d.OrgID, d.Filename, d.Mime, d.SizeBytes, d.SHA256, d.StorageKey, d.OCRRequest, d.DocType, d.Category, d.UserNote, userSet))
	if err == nil {
		return doc, true, nil
	}
	if !errors.Is(err, ErrNotFound) {
		return doc, false, err
	}
	doc, err = scanDoc(s.DB.QueryRow(ctx, `SELECT `+docCols+` FROM documents WHERE org_id=$1 AND sha256=$2`, d.OrgID, d.SHA256))
	return doc, false, err
}

func (s *Store) GetDocument(ctx context.Context, orgID, id int64) (Document, error) {
	return scanDoc(s.DB.QueryRow(ctx, `SELECT `+docCols+` FROM documents WHERE org_id=$1 AND id=$2`, orgID, id))
}

func (s *Store) DeleteDocument(ctx context.Context, orgID, id int64) (Document, error) {
	return scanDoc(s.DB.QueryRow(ctx, `DELETE FROM documents WHERE org_id=$1 AND id=$2 RETURNING `+docCols, orgID, id))
}

// DocFilter narrows document listings and aggregates. Zero values mean "no filter".
type DocFilter struct {
	Text         string // matches title, filename, counterparty, summary, tags
	DocType      string
	Category     string
	Counterparty string
	DateFrom     string // YYYY-MM-DD
	DateTo       string
	Status       string
	Limit        int
}

func (f DocFilter) where(orgID int64) (string, []any) {
	conds := []string{"org_id = $1"}
	args := []any{orgID}
	add := func(cond string, v any) {
		args = append(args, v)
		conds = append(conds, strings.ReplaceAll(cond, "?", fmt.Sprintf("$%d", len(args))))
	}
	if f.Text != "" {
		add(`(unaccent(title) ILIKE unaccent(?) OR unaccent(filename) ILIKE unaccent(?) OR unaccent(counterparty) ILIKE unaccent(?) OR unaccent(summary) ILIKE unaccent(?) OR unaccent(subject) ILIKE unaccent(?) OR unaccent(user_note) ILIKE unaccent(?) OR category ILIKE ? OR unaccent(array_to_string(tags, ' ')) ILIKE unaccent(?))`, "%"+f.Text+"%")
	}
	if f.DocType != "" {
		add(`doc_type = ?`, f.DocType)
	}
	if f.Category != "" {
		add(`category = ?`, f.Category)
	}
	if f.Counterparty != "" {
		add(`unaccent(counterparty) ILIKE unaccent(?)`, "%"+f.Counterparty+"%")
	}
	if f.DateFrom != "" {
		add(`doc_date >= ?::date`, f.DateFrom)
	}
	if f.DateTo != "" {
		add(`doc_date <= ?::date`, f.DateTo)
	}
	if f.Status != "" {
		add(`status = ?`, f.Status)
	}
	return strings.Join(conds, " AND "), args
}

func (s *Store) ListDocuments(ctx context.Context, orgID int64, f DocFilter) ([]Document, error) {
	where, args := f.where(orgID)
	limit := f.Limit
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	rows, err := s.DB.Query(ctx, `SELECT `+docCols+` FROM documents WHERE `+where+fmt.Sprintf(` ORDER BY created_at DESC, id DESC LIMIT %d`, limit), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Document{}
	for rows.Next() {
		d, err := scanDoc(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

type AggRow struct {
	Group    string   `json:"group"`
	Currency string   `json:"currency"`
	Count    int      `json:"count"`
	Total    *float64 `json:"total_amount"`
}

// Aggregate sums total_amount and counts documents grouped by one dimension.
// Amounts are never summed across currencies.
func (s *Store) Aggregate(ctx context.Context, orgID int64, groupBy string, f DocFilter) ([]AggRow, error) {
	expr := map[string]string{
		"counterparty": "counterparty",
		"doc_type":     "doc_type",
		"category":     "category",
		"month":        "coalesce(to_char(doc_date, 'YYYY-MM'), 'undated')",
		"year":         "coalesce(to_char(doc_date, 'YYYY'), 'undated')",
		"none":         "'all'",
	}[groupBy]
	if expr == "" {
		return nil, fmt.Errorf("group_by must be one of counterparty, doc_type, category, month, year, none")
	}
	where, args := f.where(orgID)
	rows, err := s.DB.Query(ctx, `SELECT `+expr+` AS g, currency, count(*), sum(total_amount)::float8
		FROM documents WHERE `+where+` AND status='ready' GROUP BY g, currency ORDER BY sum(total_amount) DESC NULLS LAST, count(*) DESC LIMIT 200`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AggRow{}
	for rows.Next() {
		var r AggRow
		if err := rows.Scan(&r.Group, &r.Currency, &r.Count, &r.Total); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

type Stats struct {
	Documents  int `json:"documents"`
	Pages      int `json:"pages"`
	Processing int `json:"processing"`
	Failed     int `json:"failed"`
}

func (s *Store) Stats(ctx context.Context, orgID int64) (Stats, error) {
	var st Stats
	err := s.DB.QueryRow(ctx, `SELECT count(*), coalesce(sum(page_count),0),
		count(*) FILTER (WHERE status IN ('queued','processing')), count(*) FILTER (WHERE status='failed')
		FROM documents WHERE org_id=$1`, orgID).Scan(&st.Documents, &st.Pages, &st.Processing, &st.Failed)
	return st, err
}

// ---------- pipeline ----------

// ClaimNextDocument atomically takes one queued document for processing.
func (s *Store) ClaimNextDocument(ctx context.Context) (Document, error) {
	return scanDoc(s.DB.QueryRow(ctx, `UPDATE documents SET status='processing', stage='ocr', error='', notice='', updated_at=now()
		WHERE id = (SELECT id FROM documents WHERE status='queued' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
		RETURNING `+docCols))
}

// RequeueStuck returns documents left in 'processing' by a crashed run to the queue.
func (s *Store) RequeueStuck(ctx context.Context) error {
	_, err := s.DB.Exec(ctx, `UPDATE documents SET status='queued', stage='' WHERE status='processing'`)
	return err
}

func (s *Store) Requeue(ctx context.Context, orgID, id int64, ocrRequest string) error {
	tag, err := s.DB.Exec(ctx, `UPDATE documents SET status='queued', stage='', error='', notice='', ocr_request=$3, updated_at=now()
		WHERE org_id=$1 AND id=$2 AND status IN ('ready','failed')`, orgID, id, ocrRequest)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

func (s *Store) SetStage(ctx context.Context, id int64, stage string) error {
	_, err := s.DB.Exec(ctx, `UPDATE documents SET stage=$2, updated_at=now() WHERE id=$1`, id, stage)
	return err
}

func (s *Store) FailDocument(ctx context.Context, id int64, msg string) error {
	_, err := s.DB.Exec(ctx, `UPDATE documents SET status='failed', stage='', error=$2, updated_at=now() WHERE id=$1`, id, msg)
	return err
}

type Page struct {
	PageNo     int      `json:"page_no"`
	Text       string   `json:"text"`
	Confidence *float32 `json:"confidence"`
	Engine     string   `json:"engine"`
}

// ReplacePages swaps a document's OCR text and records which engine produced it.
func (s *Store) ReplacePages(ctx context.Context, d Document, pages []Page, engine string, confidence *float32) error {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `DELETE FROM pages WHERE document_id=$1`, d.ID); err != nil {
		return err
	}
	for _, p := range pages {
		if _, err := tx.Exec(ctx, `INSERT INTO pages (document_id, org_id, page_no, text, confidence, engine, tsv)
			VALUES ($1,$2,$3,$4,$5,$6, to_tsvector('simple', unaccent($4)))`, d.ID, d.OrgID, p.PageNo, p.Text, p.Confidence, p.Engine); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE documents SET ocr_engine=$2, ocr_confidence=$3, page_count=$4, updated_at=now() WHERE id=$1`,
		d.ID, engine, confidence, len(pages)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// Analysis is the metadata extracted from a document's text.
type Analysis struct {
	DocType string `json:"doc_type"`
	// TypeConfidence is "high" or "low"; low makes the interface ask the user.
	TypeConfidence string   `json:"type_confidence"`
	Category       string   `json:"category"`
	Subject        string   `json:"subject"`
	Title          string   `json:"title"`
	Summary        string   `json:"summary"`
	Language       string   `json:"language"`
	DocDate        string   `json:"doc_date"`     // YYYY-MM-DD or ""
	Counterparty   string   `json:"counterparty"` // or ""
	TotalAmount    *float64 `json:"total_amount"`
	Currency       string   `json:"currency"`
	Tags           []string `json:"tags"`
	Fields         []Field  `json:"fields"`
}

func (s *Store) FinishDocument(ctx context.Context, id int64, a *Analysis, notice string) error {
	if a == nil {
		_, err := s.DB.Exec(ctx, `UPDATE documents SET status='ready', stage='', notice=$2, processed_at=now(), updated_at=now() WHERE id=$1`, id, notice)
		return err
	}
	var date *string
	if _, err := time.Parse("2006-01-02", a.DocDate); err == nil {
		date = &a.DocDate
	}
	if a.Tags == nil {
		a.Tags = []string{}
	}
	if a.Fields == nil {
		a.Fields = []Field{}
	}
	// Fields the user set by hand win over detection, including on a re-read.
	_, err := s.DB.Exec(ctx, `UPDATE documents SET status='ready', stage='', notice=$2, processed_at=now(), updated_at=now(),
		doc_type  = CASE WHEN 'doc_type' = ANY(user_set) THEN doc_type ELSE $3 END,
		type_sure = CASE WHEN 'doc_type' = ANY(user_set) THEN true ELSE $15 END,
		category  = CASE WHEN 'category' = ANY(user_set) THEN category ELSE $13 END,
		title     = CASE WHEN 'title' = ANY(user_set) THEN title WHEN $4='' THEN filename ELSE $4 END,
		subject   = CASE WHEN 'subject' = ANY(user_set) THEN subject ELSE $14 END,
		summary=$5, language=$6, doc_date=$7::date,
		counterparty=$8, total_amount=$9, currency=$10, tags=$11, fields=$12 WHERE id=$1`,
		id, notice, a.DocType, a.Title, a.Summary, a.Language, date, a.Counterparty, a.TotalAmount, strings.ToUpper(a.Currency), a.Tags, a.Fields, a.Category, a.Subject,
		a.TypeConfidence != "low")
	return err
}

// DocTypes and Categories are the values a document can be filed under.
var (
	DocTypes   = []string{"invoice", "receipt", "contract", "letter", "form", "report", "statement", "order", "delivery_note", "payslip", "certificate", "other"}
	Categories = []string{"purchases", "sales", "premises", "banking", "taxes", "payroll_hr", "insurance", "legal", "vehicles", "it_telecom", "administration", "other"}
)

// Correction is a change the user makes to how a document is filed. Nil fields are left alone.
type Correction struct {
	DocType  *string `json:"doc_type"`
	Category *string `json:"category"`
	Title    *string `json:"title"`
	Subject  *string `json:"subject"`
	Note     *string `json:"note"`
}

// Correct applies the user's own classification and marks those fields as set by hand.
func (s *Store) Correct(ctx context.Context, orgID, id int64, c Correction) (Document, error) {
	sets, args := []string{"updated_at=now()"}, []any{orgID, id}
	locked := []string{}
	set := func(col string, v *string, lock bool) {
		if v == nil {
			return
		}
		args = append(args, strings.TrimSpace(*v))
		sets = append(sets, fmt.Sprintf("%s=$%d", col, len(args)))
		if lock {
			locked = append(locked, col)
		}
	}
	set("doc_type", c.DocType, true)
	set("category", c.Category, true)
	set("title", c.Title, true)
	set("subject", c.Subject, true)
	set("user_note", c.Note, false)
	if len(locked) > 0 {
		// One assignment for the whole list: SQL allows a column to be set only once.
		args = append(args, locked)
		sets = append(sets, fmt.Sprintf("user_set = ARRAY(SELECT DISTINCT x FROM unnest(user_set || $%d::text[]) AS x ORDER BY x)", len(args)))
	}
	if c.DocType != nil {
		// The type is now known for certain, so the "guessed" note no longer applies.
		sets = append(sets, "type_sure=true", "notice=trim(regexp_replace(' '||notice||' ', ' guessed ', ' '))")
	}
	return scanDoc(s.DB.QueryRow(ctx, `UPDATE documents SET `+strings.Join(sets, ", ")+` WHERE org_id=$1 AND id=$2 RETURNING `+docCols, args...))
}

// FilingExamples describes how the user has filed documents by hand, most recent first.
// They are shown to the model so that similar documents are detected correctly next time.
func (s *Store) FilingExamples(ctx context.Context, orgID int64, limit int) ([]string, error) {
	rows, err := s.DB.Query(ctx, `SELECT title, counterparty, doc_type, category, user_note FROM documents
		WHERE org_id=$1 AND status='ready' AND ('doc_type' = ANY(user_set) OR 'category' = ANY(user_set))
		ORDER BY updated_at DESC LIMIT $2`, orgID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var title, party, docType, category, note string
		if err := rows.Scan(&title, &party, &docType, &category, &note); err != nil {
			return nil, err
		}
		line := fmt.Sprintf("- %q", title)
		if party != "" {
			line += " from/with " + party
		}
		line += fmt.Sprintf(" -> type %s, area %s", docType, category)
		if note != "" {
			line += fmt.Sprintf(" (owner's note: %q)", note)
		}
		out = append(out, line)
	}
	return out, rows.Err()
}

func (s *Store) GetPages(ctx context.Context, orgID, docID int64, from, to int) ([]Page, error) {
	if to <= 0 {
		to = 1 << 30
	}
	rows, err := s.DB.Query(ctx, `SELECT page_no, text, confidence, engine FROM pages WHERE org_id=$1 AND document_id=$2 AND page_no BETWEEN $3 AND $4 ORDER BY page_no`, orgID, docID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Page{}
	for rows.Next() {
		var p Page
		if err := rows.Scan(&p.PageNo, &p.Text, &p.Confidence, &p.Engine); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ---------- search ----------

type Hit struct {
	DocID        int64   `json:"doc_id"`
	Page         int     `json:"page"`
	Title        string  `json:"title"`
	DocType      string  `json:"doc_type"`
	DocDate      *string `json:"doc_date"`
	Counterparty string  `json:"counterparty"`
	Snippet      string  `json:"snippet"`
	Rank         float32 `json:"rank"`
}

// BuildTSQuery turns free text into an OR-of-prefixes tsquery ("fakt:* | vat:*").
// Prefix matching keeps recall reasonable for inflected languages without a stemmer.
func BuildTSQuery(q string) string {
	words := strings.FieldsFunc(q, func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) })
	seen := map[string]bool{}
	var terms []string
	for _, w := range words {
		w = strings.ToLower(w)
		if len([]rune(w)) < 2 || seen[w] {
			continue
		}
		seen[w] = true
		terms = append(terms, w+":*")
		if len(terms) == 24 {
			break
		}
	}
	return strings.Join(terms, " | ")
}

// SearchPages runs full-text search over OCR text, best pages first.
func (s *Store) SearchPages(ctx context.Context, orgID int64, query, docType string, docID int64, limit int) ([]Hit, error) {
	tsq := BuildTSQuery(query)
	if tsq == "" {
		return []Hit{}, nil
	}
	if limit <= 0 || limit > 30 {
		limit = 10
	}
	rows, err := s.DB.Query(ctx, `
		WITH q AS (SELECT to_tsquery('simple', unaccent($2)) AS tsq)
		SELECT d.id, p.page_no, d.title, d.doc_type, to_char(d.doc_date,'YYYY-MM-DD'), d.counterparty,
		       ts_headline('simple', p.text, q.tsq, 'MaxFragments=2, MaxWords=40, MinWords=12, StartSel=**, StopSel=**, FragmentDelimiter= … '),
		       ts_rank_cd(p.tsv, q.tsq) AS rank
		FROM pages p JOIN documents d ON d.id = p.document_id, q
		WHERE p.org_id = $1 AND d.status = 'ready' AND p.tsv @@ q.tsq
		  AND ($3 = '' OR d.doc_type = $3) AND ($4 = 0 OR d.id = $4)
		ORDER BY rank DESC, d.id DESC, p.page_no LIMIT $5`, orgID, tsq, docType, docID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Hit{}
	for rows.Next() {
		var h Hit
		if err := rows.Scan(&h.DocID, &h.Page, &h.Title, &h.DocType, &h.DocDate, &h.Counterparty, &h.Snippet, &h.Rank); err != nil {
			return nil, err
		}
		out = append(out, h)
	}
	return out, rows.Err()
}

// ---------- conversations ----------

type Source struct {
	// Quote is the passage the answer relies on, copied from the page. Empty when the
	// citation named only a page.
	Quote string `json:"quote,omitempty"`
	// Unconfirmed is set when the answer quoted words that are not on the cited page.
	Unconfirmed bool   `json:"unconfirmed,omitempty"`
	DocID       int64  `json:"doc_id"`
	Page        int    `json:"page"`
	Title       string `json:"title"`
}

type Message struct {
	ID      int64    `json:"id"`
	Role    string   `json:"role"`
	Content string   `json:"content"`
	Sources []Source `json:"sources"`
	// Figures in an assistant answer that were not found in what it read.
	Unverified []string  `json:"unverified"`
	CreatedAt  time.Time `json:"created_at"`
}

type Conversation struct {
	ID        int64     `json:"id"`
	Title     string    `json:"title"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (s *Store) CreateConversation(ctx context.Context, orgID, userID int64, title string) (Conversation, error) {
	c := Conversation{Title: title}
	err := s.DB.QueryRow(ctx, `INSERT INTO conversations (org_id, user_id, title) VALUES ($1,$2,$3) RETURNING id, updated_at`, orgID, userID, title).Scan(&c.ID, &c.UpdatedAt)
	return c, err
}

func (s *Store) ListConversations(ctx context.Context, orgID, userID int64) ([]Conversation, error) {
	rows, err := s.DB.Query(ctx, `SELECT id, title, updated_at FROM conversations WHERE org_id=$1 AND user_id=$2 ORDER BY updated_at DESC LIMIT 100`, orgID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Conversation{}
	for rows.Next() {
		var c Conversation
		if err := rows.Scan(&c.ID, &c.Title, &c.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) ConversationOwned(ctx context.Context, orgID, userID, id int64) error {
	var ok bool
	if err := s.DB.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM conversations WHERE id=$3 AND org_id=$1 AND user_id=$2)`, orgID, userID, id).Scan(&ok); err != nil {
		return err
	}
	if !ok {
		return ErrNotFound
	}
	return nil
}

func (s *Store) DeleteConversation(ctx context.Context, orgID, userID, id int64) error {
	_, err := s.DB.Exec(ctx, `DELETE FROM conversations WHERE id=$3 AND org_id=$1 AND user_id=$2`, orgID, userID, id)
	return err
}

func (s *Store) AddMessage(ctx context.Context, convID int64, role, content string, sources []Source, unverified []string) error {
	if sources == nil {
		sources = []Source{}
	}
	if unverified == nil {
		unverified = []string{}
	}
	if _, err := s.DB.Exec(ctx, `INSERT INTO messages (conversation_id, role, content, sources, unverified) VALUES ($1,$2,$3,$4,$5)`, convID, role, content, sources, unverified); err != nil {
		return err
	}
	_, err := s.DB.Exec(ctx, `UPDATE conversations SET updated_at=now() WHERE id=$1`, convID)
	return err
}

func (s *Store) ListMessages(ctx context.Context, convID int64) ([]Message, error) {
	rows, err := s.DB.Query(ctx, `SELECT id, role, content, sources, unverified, created_at FROM messages WHERE conversation_id=$1 ORDER BY id`, convID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Message{}
	for rows.Next() {
		var m Message
		if err := rows.Scan(&m.ID, &m.Role, &m.Content, &m.Sources, &m.Unverified, &m.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}
