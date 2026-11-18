// Package httpapi exposes the JSON API and serves the built web app.
package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/mail"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"golang.org/x/crypto/bcrypt"

	"docdoctor/internal/chat"
	"docdoctor/internal/config"
	"docdoctor/internal/ingest"
	"docdoctor/internal/store"
)

const (
	cookieName    = "dd_session"
	sessionTTL    = 30 * 24 * time.Hour
	maxUploadSize = 50 << 20 // per file
)

type Server struct {
	Cfg      config.Config
	Store    *store.Store
	Pipeline *ingest.Pipeline
	Agent    *chat.Agent // nil when Claude is not configured
}

type ctxKey struct{}

func userFrom(r *http.Request) store.User { return r.Context().Value(ctxKey{}).(store.User) }

func (s *Server) Handler() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Recoverer)
	r.Use(middleware.Logger)

	r.Route("/api", func(r chi.Router) {
		r.Post("/auth/register", s.register)
		r.Post("/auth/login", s.login)
		r.Post("/auth/logout", s.logout)

		r.Group(func(r chi.Router) {
			r.Use(s.requireUser)
			r.Get("/me", s.me)
			r.Get("/stats", s.stats)
			r.Get("/documents", s.listDocuments)
			r.Post("/documents", s.upload)
			r.Get("/documents/{id}", s.getDocument)
			r.Get("/documents/{id}/file", s.getFile)
			r.Get("/documents/{id}/pages/{page}/image", s.getPageImage)
			r.Delete("/documents/{id}", s.deleteDocument)
			r.Post("/documents/{id}/reprocess", s.reprocess)
			r.Get("/search", s.search)
			r.Get("/conversations", s.listConversations)
			r.Get("/conversations/{id}", s.getConversation)
			r.Delete("/conversations/{id}", s.deleteConversation)
			r.Post("/chat", s.chat)
		})
	})

	r.NotFound(s.spa)
	return r
}

// spa serves the built frontend and falls back to index.html for client-side routes.
func (s *Server) spa(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	path := filepath.Join(s.Cfg.WebDir, filepath.Clean("/"+r.URL.Path))
	if st, err := os.Stat(path); err == nil && !st.IsDir() {
		http.ServeFile(w, r, path)
		return
	}
	index := filepath.Join(s.Cfg.WebDir, "index.html")
	if _, err := os.Stat(index); err != nil {
		http.Error(w, "Web app is not built. Run `npm run dev` in web/ (development) or `npm run build` (production).", http.StatusNotFound)
		return
	}
	// The entry page must always be revalidated so a new build is picked up; the
	// hashed asset files it points to can be cached freely.
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeFile(w, r, index)
}

// ---------- helpers ----------

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func (s *Server) fail(w http.ResponseWriter, err error) {
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	log.Printf("api error: %v", err)
	writeErr(w, http.StatusInternalServerError, "internal error")
}

func readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid JSON body")
		return false
	}
	return true
}

func idParam(r *http.Request) int64 {
	id, _ := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	return id
}

// ---------- auth ----------

func hashToken(token string) []byte {
	h := sha256.Sum256([]byte(token))
	return h[:]
}

func (s *Server) startSession(w http.ResponseWriter, r *http.Request, u store.User) error {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return err
	}
	token := hex.EncodeToString(raw)
	if err := s.Store.CreateSession(r.Context(), hashToken(token), u.ID, sessionTTL); err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{
		Name: cookieName, Value: token, Path: "/", HttpOnly: true, Secure: s.Cfg.CookieSecure,
		SameSite: http.SameSiteStrictMode, MaxAge: int(sessionTTL.Seconds()),
	})
	return nil
}

func (s *Server) requireUser(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(cookieName)
		if err != nil {
			writeErr(w, http.StatusUnauthorized, "not signed in")
			return
		}
		u, err := s.Store.UserBySession(r.Context(), hashToken(c.Value))
		if err != nil {
			writeErr(w, http.StatusUnauthorized, "not signed in")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, u)))
	})
}

func (s *Server) register(w http.ResponseWriter, r *http.Request) {
	var in struct{ OrgName, Email, Password string }
	if !readJSON(w, r, &struct {
		OrgName  *string `json:"org_name"`
		Email    *string `json:"email"`
		Password *string `json:"password"`
	}{&in.OrgName, &in.Email, &in.Password}) {
		return
	}
	in.Email = strings.ToLower(strings.TrimSpace(in.Email))
	in.OrgName = strings.TrimSpace(in.OrgName)
	if _, err := mail.ParseAddress(in.Email); err != nil {
		writeErr(w, http.StatusBadRequest, "Enter a valid email address.")
		return
	}
	if in.OrgName == "" {
		writeErr(w, http.StatusBadRequest, "Enter your business name.")
		return
	}
	if len(in.Password) < 8 || len(in.Password) > 72 {
		writeErr(w, http.StatusBadRequest, "Password must be 8 to 72 characters.")
		return
	}
	if _, err := s.Store.UserByEmail(r.Context(), in.Email); err == nil {
		writeErr(w, http.StatusConflict, "An account with this email already exists.")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost)
	if err != nil {
		s.fail(w, err)
		return
	}
	u, err := s.Store.CreateOrgAndUser(r.Context(), in.OrgName, in.Email, string(hash))
	if err != nil {
		s.fail(w, err)
		return
	}
	if err := s.startSession(w, r, u); err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, u)
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	u, err := s.Store.UserByEmail(r.Context(), strings.ToLower(strings.TrimSpace(in.Email)))
	if err != nil || bcrypt.CompareHashAndPassword([]byte(u.PasswordHash()), []byte(in.Password)) != nil {
		writeErr(w, http.StatusUnauthorized, "Wrong email or password.")
		return
	}
	if err := s.startSession(w, r, u); err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, u)
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(cookieName); err == nil {
		s.Store.DeleteSession(r.Context(), hashToken(c.Value))
	}
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: "", Path: "/", MaxAge: -1, HttpOnly: true})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"user": userFrom(r),
		"capabilities": map[string]any{
			"claude":    s.Agent != nil,
			"local_ocr": s.Pipeline.Local.Healthy(r.Context()),
			"ocr_mode":  s.Cfg.OCRMode,
			"model":     s.Cfg.Model,
		},
	})
}

// ---------- documents ----------

var allowedTypes = map[string]string{ // extension -> mime
	".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
	".webp": "image/webp", ".gif": "image/gif", ".tif": "image/tiff", ".tiff": "image/tiff",
	".bmp": "image/bmp", ".heic": "image/heic", ".heif": "image/heif",
}

func (s *Server) stats(w http.ResponseWriter, r *http.Request) {
	st, err := s.Store.Stats(r.Context(), userFrom(r).OrgID)
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (s *Server) listDocuments(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	docs, err := s.Store.ListDocuments(r.Context(), userFrom(r).OrgID, store.DocFilter{
		Text: strings.TrimSpace(q.Get("q")), DocType: q.Get("type"), Status: q.Get("status"),
	})
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"documents": docs})
}

type uploadResult struct {
	Filename  string          `json:"filename"`
	Document  *store.Document `json:"document,omitempty"`
	Duplicate bool            `json:"duplicate,omitempty"`
	Error     string          `json:"error,omitempty"`
}

// upload accepts one or more files in the "files" multipart field and queues them.
func (s *Server) upload(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	mr, err := r.MultipartReader()
	if err != nil {
		writeErr(w, http.StatusBadRequest, "expected a multipart upload")
		return
	}
	ocrRequest := ""
	results := []uploadResult{}
	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			writeErr(w, http.StatusBadRequest, "upload interrupted")
			return
		}
		if part.FormName() == "ocr" {
			b, _ := io.ReadAll(io.LimitReader(part, 16))
			if v := string(b); v == "local" || v == "claude" || v == "auto" {
				ocrRequest = v
			}
			continue
		}
		if part.FormName() != "files" || part.FileName() == "" {
			continue
		}
		name := filepath.Base(part.FileName())
		res := uploadResult{Filename: name}
		doc, created, err := s.saveUpload(r.Context(), u, name, part, ocrRequest)
		switch {
		case err != nil:
			res.Error = err.Error()
		default:
			res.Document, res.Duplicate = &doc, !created
		}
		results = append(results, res)
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

func (s *Server) saveUpload(ctx context.Context, u store.User, name string, src io.Reader, ocrRequest string) (store.Document, bool, error) {
	ext := strings.ToLower(filepath.Ext(name))
	mime, ok := allowedTypes[ext]
	if !ok {
		return store.Document{}, false, errors.New("Unsupported file type. Upload a PDF or an image (JPG, PNG, HEIC, TIFF, WebP).")
	}
	dir := filepath.Join(s.Cfg.DataDir, "uploads", strconv.FormatInt(u.OrgID, 10))
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return store.Document{}, false, err
	}
	tmp, err := os.CreateTemp(dir, "upload-*")
	if err != nil {
		return store.Document{}, false, err
	}
	defer os.Remove(tmp.Name())
	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(tmp, h), io.LimitReader(src, maxUploadSize+1))
	tmp.Close()
	if err != nil {
		return store.Document{}, false, errors.New("Upload failed while saving the file.")
	}
	if n > maxUploadSize {
		return store.Document{}, false, fmt.Errorf("File is larger than %d MB.", maxUploadSize>>20)
	}
	if n == 0 {
		return store.Document{}, false, errors.New("File is empty.")
	}
	sum := hex.EncodeToString(h.Sum(nil))
	key := fmt.Sprintf("%d/%s%s", u.OrgID, sum, ext)
	final := s.Pipeline.Path(key)
	if _, err := os.Stat(final); err != nil {
		if err := os.Rename(tmp.Name(), final); err != nil {
			return store.Document{}, false, err
		}
	}
	return s.Store.InsertDocument(ctx, store.Document{
		OrgID: u.OrgID, Filename: name, Mime: mime, SizeBytes: n, SHA256: sum, StorageKey: key, OCRRequest: ocrRequest,
	})
}

func (s *Server) getDocument(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	doc, err := s.Store.GetDocument(r.Context(), u.OrgID, idParam(r))
	if err != nil {
		s.fail(w, err)
		return
	}
	pages, err := s.Store.GetPages(r.Context(), u.OrgID, doc.ID, 1, 0)
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"document": doc, "pages": pages})
}

func (s *Server) getFile(w http.ResponseWriter, r *http.Request) {
	doc, err := s.Store.GetDocument(r.Context(), userFrom(r).OrgID, idParam(r))
	if err != nil {
		s.fail(w, err)
		return
	}
	w.Header().Set("Content-Type", doc.Mime)
	w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=%q", doc.Filename))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeFile(w, r, s.Pipeline.Path(doc.StorageKey))
}

// getPageImage serves a JPEG rendering of one page, rendered on first request and cached.
func (s *Server) getPageImage(w http.ResponseWriter, r *http.Request) {
	doc, err := s.Store.GetDocument(r.Context(), userFrom(r).OrgID, idParam(r))
	if err != nil {
		s.fail(w, err)
		return
	}
	page, _ := strconv.Atoi(chi.URLParam(r, "page"))
	if page < 1 || (doc.PageCount > 0 && page > doc.PageCount) {
		writeErr(w, http.StatusNotFound, "no such page")
		return
	}
	cache := s.previewPath(doc, page)
	if _, err := os.Stat(cache); err != nil {
		data, err := os.ReadFile(s.Pipeline.Path(doc.StorageKey))
		if err != nil {
			s.fail(w, err)
			return
		}
		img, err := s.Pipeline.Local.Preview(r.Context(), doc.Filename, data, page)
		if err != nil {
			log.Printf("preview: %v", err)
			writeErr(w, http.StatusBadGateway, "Could not render this page. Is the OCR worker running?")
			return
		}
		os.MkdirAll(filepath.Dir(cache), 0o750)
		if err := os.WriteFile(cache, img, 0o640); err != nil {
			s.fail(w, err)
			return
		}
	}
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "private, max-age=86400")
	http.ServeFile(w, r, cache)
}

func (s *Server) previewPath(doc store.Document, page int) string {
	return filepath.Join(s.Cfg.DataDir, "previews", strconv.FormatInt(doc.OrgID, 10), fmt.Sprintf("%d-%d.jpg", doc.ID, page))
}

func (s *Server) deleteDocument(w http.ResponseWriter, r *http.Request) {
	doc, err := s.Store.DeleteDocument(r.Context(), userFrom(r).OrgID, idParam(r))
	if err != nil {
		s.fail(w, err)
		return
	}
	os.Remove(s.Pipeline.Path(doc.StorageKey))
	if previews, _ := filepath.Glob(filepath.Join(s.Cfg.DataDir, "previews", strconv.FormatInt(doc.OrgID, 10), fmt.Sprintf("%d-*.jpg", doc.ID))); previews != nil {
		for _, p := range previews {
			os.Remove(p)
		}
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) reprocess(w http.ResponseWriter, r *http.Request) {
	var in struct {
		OCR string `json:"ocr"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	switch in.OCR {
	case "local", "auto":
	case "claude":
		if s.Agent == nil {
			writeErr(w, http.StatusBadRequest, "Claude vision needs a Claude API key. Set ANTHROPIC_API_KEY and restart the server.")
			return
		}
	default:
		writeErr(w, http.StatusBadRequest, "ocr must be local, claude or auto")
		return
	}
	if err := s.Store.Requeue(r.Context(), userFrom(r).OrgID, idParam(r), in.OCR); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, http.StatusConflict, "This document is still being processed.")
			return
		}
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) search(w http.ResponseWriter, r *http.Request) {
	hits, err := s.Store.SearchPages(r.Context(), userFrom(r).OrgID, r.URL.Query().Get("q"), r.URL.Query().Get("type"), 0, 20)
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"hits": hits})
}

// ---------- chat ----------

func (s *Server) listConversations(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	convs, err := s.Store.ListConversations(r.Context(), u.OrgID, u.ID)
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"conversations": convs})
}

func (s *Server) getConversation(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	if err := s.Store.ConversationOwned(r.Context(), u.OrgID, u.ID, idParam(r)); err != nil {
		s.fail(w, err)
		return
	}
	msgs, err := s.Store.ListMessages(r.Context(), idParam(r))
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"messages": msgs})
}

func (s *Server) deleteConversation(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	if err := s.Store.DeleteConversation(r.Context(), u.OrgID, u.ID, idParam(r)); err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// chat streams an answer as server-sent events: conversation, text, tool, sources, error, done.
func (s *Server) chat(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	var in struct {
		ConversationID int64  `json:"conversation_id"`
		Message        string `json:"message"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	in.Message = strings.TrimSpace(in.Message)
	if in.Message == "" {
		writeErr(w, http.StatusBadRequest, "Type a question first.")
		return
	}
	if s.Agent == nil {
		writeErr(w, http.StatusServiceUnavailable, "Asking questions needs a Claude API key. Set ANTHROPIC_API_KEY in .env and restart the server.")
		return
	}
	ctx := r.Context()

	var history []store.Message
	if in.ConversationID == 0 {
		title := in.Message
		if rs := []rune(title); len(rs) > 80 {
			title = string(rs[:80]) + "…"
		}
		conv, err := s.Store.CreateConversation(ctx, u.OrgID, u.ID, title)
		if err != nil {
			s.fail(w, err)
			return
		}
		in.ConversationID = conv.ID
	} else {
		if err := s.Store.ConversationOwned(ctx, u.OrgID, u.ID, in.ConversationID); err != nil {
			s.fail(w, err)
			return
		}
		var err error
		if history, err = s.Store.ListMessages(ctx, in.ConversationID); err != nil {
			s.fail(w, err)
			return
		}
	}
	if err := s.Store.AddMessage(ctx, in.ConversationID, "user", in.Message, nil); err != nil {
		s.fail(w, err)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	flusher, _ := w.(http.Flusher)
	send := func(v any) {
		b, _ := json.Marshal(v)
		fmt.Fprintf(w, "data: %s\n\n", b)
		if flusher != nil {
			flusher.Flush()
		}
	}
	send(map[string]any{"type": "conversation", "conversation_id": in.ConversationID})

	answer, sources, err := s.Agent.Answer(ctx, u.OrgID, u.OrgName, history, in.Message, func(e chat.Event) { send(e) })
	// Persist with a context that survives the client disconnecting mid-stream.
	save := context.WithoutCancel(ctx)
	if err != nil {
		log.Printf("chat: %v", err)
		if answer != "" {
			s.Store.AddMessage(save, in.ConversationID, "assistant", answer, sources)
		} else {
			// Keep roles alternating so the next turn's history is valid.
			s.Store.AddMessage(save, in.ConversationID, "assistant", "(No answer: "+err.Error()+")", nil)
		}
		send(chat.Event{Type: "error", Text: err.Error()})
		return
	}
	if answer == "" {
		answer = "(No answer was produced.)"
	}
	if err := s.Store.AddMessage(save, in.ConversationID, "assistant", answer, sources); err != nil {
		log.Printf("chat: save answer: %v", err)
	}
	send(chat.Event{Type: "sources", Sources: sources})
	send(chat.Event{Type: "done"})
}
