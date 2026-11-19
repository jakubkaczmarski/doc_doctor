// Package httpapi exposes the JSON API and serves the built web app.
package httpapi

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
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
	"docdoctor/internal/i18n"
	"docdoctor/internal/ingest"
	"docdoctor/internal/ocr"
	"docdoctor/internal/store"
)

const (
	cookieName    = "dd_session"
	sessionTTL    = 30 * 24 * time.Hour
	maxUploadSize = 50 << 20 // per file
	maxScanPages  = 40       // photos that can be joined into one scanned document
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
		r.Get("/auth/link/{token}", s.redeemPhoneLink)

		r.Group(func(r chi.Router) {
			r.Use(s.requireUser)
			r.Get("/me", s.me)
			r.Post("/auth/phone-link", s.createPhoneLink)
			r.Get("/stats", s.stats)
			r.Get("/org", s.getOrg)
			r.Put("/org", s.putOrg)
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
		writeErr(w, r, http.StatusNotFound, "not found")
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

func writeErr(w http.ResponseWriter, r *http.Request, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": i18n.T(i18n.Lang(r), msg)})
}

func (s *Server) fail(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, r, http.StatusNotFound, "not found")
		return
	}
	log.Printf("api error: %v", err)
	writeErr(w, r, http.StatusInternalServerError, "internal error")
}

func readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		writeErr(w, r, http.StatusBadRequest, "invalid JSON body")
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
			writeErr(w, r, http.StatusUnauthorized, "not signed in")
			return
		}
		u, err := s.Store.UserBySession(r.Context(), hashToken(c.Value))
		if err != nil {
			writeErr(w, r, http.StatusUnauthorized, "not signed in")
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
		writeErr(w, r, http.StatusBadRequest, "Enter a valid email address.")
		return
	}
	if in.OrgName == "" {
		writeErr(w, r, http.StatusBadRequest, "Enter your business name.")
		return
	}
	if len(in.Password) < 8 || len(in.Password) > 72 {
		writeErr(w, r, http.StatusBadRequest, "Password must be 8 to 72 characters.")
		return
	}
	if _, err := s.Store.UserByEmail(r.Context(), in.Email); err == nil {
		writeErr(w, r, http.StatusConflict, "An account with this email already exists.")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	u, err := s.Store.CreateOrgAndUser(r.Context(), in.OrgName, in.Email, string(hash))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	if err := s.startSession(w, r, u); err != nil {
		s.fail(w, r, err)
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
		writeErr(w, r, http.StatusUnauthorized, "Wrong email or password.")
		return
	}
	if err := s.startSession(w, r, u); err != nil {
		s.fail(w, r, err)
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

const phoneLinkTTL = 10 * time.Minute

// createPhoneLink issues a one-time link that signs another device in as this user.
// The desktop shows it as a QR code so a phone can start scanning without a password.
func (s *Server) createPhoneLink(w http.ResponseWriter, r *http.Request) {
	raw := make([]byte, 24)
	if _, err := rand.Read(raw); err != nil {
		s.fail(w, r, err)
		return
	}
	token := hex.EncodeToString(raw)
	if err := s.Store.CreateLoginLink(r.Context(), hashToken(token), userFrom(r).ID, phoneLinkTTL); err != nil {
		s.fail(w, r, err)
		return
	}
	urls := []string{}
	for _, base := range s.lanURLs() {
		urls = append(urls, base+"/api/auth/link/"+token)
	}
	writeJSON(w, http.StatusOK, map[string]any{"urls": urls, "minutes": int(phoneLinkTTL.Minutes())})
}

// redeemPhoneLink signs the visiting device in and sends it to the Scan screen.
func (s *Server) redeemPhoneLink(w http.ResponseWriter, r *http.Request) {
	userID, err := s.Store.RedeemLoginLink(r.Context(), hashToken(chi.URLParam(r, "token")))
	if err != nil {
		http.Redirect(w, r, "/sign-in?link=expired", http.StatusSeeOther)
		return
	}
	if err := s.startSession(w, r, store.User{ID: userID}); err != nil {
		s.fail(w, r, err)
		return
	}
	w.Header().Set("Referrer-Policy", "no-referrer")
	http.Redirect(w, r, "/scan", http.StatusSeeOther)
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"user": userFrom(r),
		"capabilities": map[string]any{
			"claude":    s.Agent != nil,
			"local_ocr": s.Pipeline.Local.Healthy(r.Context()),
			"ocr_mode":  s.Cfg.OCRMode,
			"model":     s.Cfg.Model,
			"lan_urls":  s.lanURLs(),
		},
	})
}

// ---------- business info ----------

const maxProfileChars = 8000

func (s *Server) getOrg(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	profile, err := s.Store.OrgProfile(r.Context(), u.OrgID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"name": u.OrgName, "profile": profile, "max_chars": maxProfileChars})
}

func (s *Server) putOrg(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Profile string `json:"profile"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	in.Profile = strings.TrimSpace(in.Profile)
	if len([]rune(in.Profile)) > maxProfileChars {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": i18n.T(i18n.Lang(r), "Business info is limited to %d characters.", maxProfileChars)})
		return
	}
	if err := s.Store.SetOrgProfile(r.Context(), userFrom(r).OrgID, in.Profile); err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"profile": in.Profile})
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
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (s *Server) listDocuments(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	docs, err := s.Store.ListDocuments(r.Context(), userFrom(r).OrgID, store.DocFilter{
		Text: strings.TrimSpace(q.Get("q")), DocType: q.Get("type"), Category: q.Get("category"), Status: q.Get("status"),
	})
	if err != nil {
		s.fail(w, r, err)
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
//
// With the field combine=1 (sent before the files), the files are treated as photos of
// consecutive pages and stored as a single PDF document, named by the optional "name"
// field. This is what the phone Scan screen uses.
func (s *Server) upload(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	mr, err := r.MultipartReader()
	if err != nil {
		writeErr(w, r, http.StatusBadRequest, "expected a multipart upload")
		return
	}
	ocrRequest := ""
	combine, scanName := false, ""
	var scanPages []ocr.File
	results := []uploadResult{}
	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			writeErr(w, r, http.StatusBadRequest, "upload interrupted")
			return
		}
		if part.FormName() == "ocr" {
			b, _ := io.ReadAll(io.LimitReader(part, 16))
			if v := string(b); v == "local" || v == "claude" || v == "auto" {
				ocrRequest = v
			}
			continue
		}
		if part.FormName() == "combine" {
			b, _ := io.ReadAll(io.LimitReader(part, 8))
			combine = string(b) == "1"
			continue
		}
		if part.FormName() == "name" {
			b, _ := io.ReadAll(io.LimitReader(part, 200))
			scanName = strings.TrimSpace(string(b))
			continue
		}
		if part.FormName() != "files" || part.FileName() == "" {
			continue
		}
		name := filepath.Base(part.FileName())
		if combine {
			if mime := allowedTypes[strings.ToLower(filepath.Ext(name))]; !strings.HasPrefix(mime, "image/") {
				writeErr(w, r, http.StatusBadRequest, "Only photos can be joined into one scan.")
				return
			}
			if len(scanPages) == maxScanPages {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": i18n.T(i18n.Lang(r), "A scan can have at most %d pages.", maxScanPages)})
				return
			}
			data, err := io.ReadAll(io.LimitReader(part, maxUploadSize+1))
			if err != nil || len(data) > maxUploadSize {
				writeErr(w, r, http.StatusBadRequest, "A page photo is too large or the upload was interrupted.")
				return
			}
			scanPages = append(scanPages, ocr.File{Name: name, Data: data})
			continue
		}
		res := uploadResult{Filename: name}
		doc, created, err := s.saveUpload(r.Context(), u, name, part, ocrRequest)
		switch {
		case err != nil:
			log.Printf("upload %s: %v", name, err)
			res.Error = describe(i18n.Lang(r), err)
		default:
			res.Document, res.Duplicate = &doc, !created
		}
		results = append(results, res)
	}
	if combine {
		if len(scanPages) == 0 {
			writeErr(w, r, http.StatusBadRequest, "No pages were uploaded.")
			return
		}
		pdf, err := s.Pipeline.Local.Combine(r.Context(), scanPages)
		if err != nil {
			log.Printf("combine scan: %v", err)
			writeErr(w, r, http.StatusBadGateway, "Could not assemble the scan. Is the OCR worker running?")
			return
		}
		name := safeScanName(i18n.Lang(r), scanName)
		res := uploadResult{Filename: name}
		if doc, created, err := s.saveUpload(r.Context(), u, name, bytes.NewReader(pdf), ocrRequest); err != nil {
			log.Printf("upload %s: %v", name, err)
			res.Error = describe(i18n.Lang(r), err)
		} else {
			res.Document, res.Duplicate = &doc, !created
		}
		results = append(results, res)
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

// safeScanName turns a user-supplied scan title into a PDF file name.
func safeScanName(lang, name string) string {
	name = strings.Map(func(r rune) rune {
		if r == '/' || r == '\\' || r < 32 {
			return ' '
		}
		return r
	}, name)
	name = strings.TrimSpace(strings.TrimSuffix(name, ".pdf"))
	if name == "" {
		name = i18n.T(lang, "Scan %s", time.Now().Format("2006-01-02 15.04"))
	}
	return name + ".pdf"
}

// lanURLs lists addresses other devices on the local network can use to reach this server.
func (s *Server) lanURLs() []string {
	_, port, err := net.SplitHostPort(s.Cfg.Addr)
	if err != nil {
		return nil
	}
	addrs, _ := net.InterfaceAddrs()
	urls := []string{}
	for _, a := range addrs {
		ipnet, ok := a.(*net.IPNet)
		if !ok || ipnet.IP.IsLoopback() || ipnet.IP.To4() == nil || !ipnet.IP.IsPrivate() {
			continue
		}
		urls = append(urls, "http://"+net.JoinHostPort(ipnet.IP.String(), port))
	}
	return urls
}

// uploadError is a per-file problem the user can act on; Args fill the message's
// placeholders after translation.
type uploadError struct {
	Msg  string
	Args []any
}

func (e uploadError) Error() string { return fmt.Sprintf(e.Msg, e.Args...) }

func describe(lang string, err error) string {
	var ue uploadError
	if errors.As(err, &ue) {
		return i18n.T(lang, ue.Msg, ue.Args...)
	}
	return i18n.T(lang, "internal error")
}

func (s *Server) saveUpload(ctx context.Context, u store.User, name string, src io.Reader, ocrRequest string) (store.Document, bool, error) {
	ext := strings.ToLower(filepath.Ext(name))
	mime, ok := allowedTypes[ext]
	if !ok {
		return store.Document{}, false, uploadError{Msg: "Unsupported file type. Upload a PDF or an image (JPG, PNG, HEIC, TIFF, WebP)."}
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
		return store.Document{}, false, uploadError{Msg: "Upload failed while saving the file."}
	}
	if n > maxUploadSize {
		return store.Document{}, false, uploadError{Msg: "File is larger than %d MB.", Args: []any{maxUploadSize >> 20}}
	}
	if n == 0 {
		return store.Document{}, false, uploadError{Msg: "File is empty."}
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
		s.fail(w, r, err)
		return
	}
	pages, err := s.Store.GetPages(r.Context(), u.OrgID, doc.ID, 1, 0)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"document": doc, "pages": pages})
}

func (s *Server) getFile(w http.ResponseWriter, r *http.Request) {
	doc, err := s.Store.GetDocument(r.Context(), userFrom(r).OrgID, idParam(r))
	if err != nil {
		s.fail(w, r, err)
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
		s.fail(w, r, err)
		return
	}
	page, _ := strconv.Atoi(chi.URLParam(r, "page"))
	if page < 1 || (doc.PageCount > 0 && page > doc.PageCount) {
		writeErr(w, r, http.StatusNotFound, "no such page")
		return
	}
	cache := s.previewPath(doc, page)
	if _, err := os.Stat(cache); err != nil {
		data, err := os.ReadFile(s.Pipeline.Path(doc.StorageKey))
		if err != nil {
			s.fail(w, r, err)
			return
		}
		img, err := s.Pipeline.Local.Preview(r.Context(), doc.Filename, data, page)
		if err != nil {
			log.Printf("preview: %v", err)
			writeErr(w, r, http.StatusBadGateway, "Could not render this page. Is the OCR worker running?")
			return
		}
		os.MkdirAll(filepath.Dir(cache), 0o750)
		if err := os.WriteFile(cache, img, 0o640); err != nil {
			s.fail(w, r, err)
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
		s.fail(w, r, err)
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
			writeErr(w, r, http.StatusBadRequest, "Claude vision needs a Claude API key. Set ANTHROPIC_API_KEY and restart the server.")
			return
		}
	default:
		writeErr(w, r, http.StatusBadRequest, "ocr must be local, claude or auto")
		return
	}
	if err := s.Store.Requeue(r.Context(), userFrom(r).OrgID, idParam(r), in.OCR); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeErr(w, r, http.StatusConflict, "This document is still being processed.")
			return
		}
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) search(w http.ResponseWriter, r *http.Request) {
	hits, err := s.Store.SearchPages(r.Context(), userFrom(r).OrgID, r.URL.Query().Get("q"), r.URL.Query().Get("type"), 0, 20)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"hits": hits})
}

// ---------- chat ----------

func (s *Server) listConversations(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	convs, err := s.Store.ListConversations(r.Context(), u.OrgID, u.ID)
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"conversations": convs})
}

func (s *Server) getConversation(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	if err := s.Store.ConversationOwned(r.Context(), u.OrgID, u.ID, idParam(r)); err != nil {
		s.fail(w, r, err)
		return
	}
	msgs, err := s.Store.ListMessages(r.Context(), idParam(r))
	if err != nil {
		s.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"messages": msgs})
}

func (s *Server) deleteConversation(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r)
	if err := s.Store.DeleteConversation(r.Context(), u.OrgID, u.ID, idParam(r)); err != nil {
		s.fail(w, r, err)
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
		writeErr(w, r, http.StatusBadRequest, "Type a question first.")
		return
	}
	if s.Agent == nil {
		writeErr(w, r, http.StatusServiceUnavailable, "Asking questions needs a Claude API key. Set ANTHROPIC_API_KEY in .env and restart the server.")
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
			s.fail(w, r, err)
			return
		}
		in.ConversationID = conv.ID
	} else {
		if err := s.Store.ConversationOwned(ctx, u.OrgID, u.ID, in.ConversationID); err != nil {
			s.fail(w, r, err)
			return
		}
		var err error
		if history, err = s.Store.ListMessages(ctx, in.ConversationID); err != nil {
			s.fail(w, r, err)
			return
		}
	}
	if err := s.Store.AddMessage(ctx, in.ConversationID, "user", in.Message, nil, nil); err != nil {
		s.fail(w, r, err)
		return
	}

	// Read before the stream starts so a database error can still be a normal HTTP error.
	profile, err := s.Store.OrgProfile(ctx, u.OrgID)
	if err != nil {
		s.fail(w, r, err)
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

	lang := i18n.Lang(r)
	res, err := s.Agent.Answer(ctx, lang, u.OrgID, u.OrgName, profile, history, in.Message, func(e chat.Event) { send(e) })
	// Persist with a context that survives the client disconnecting mid-stream.
	save := context.WithoutCancel(ctx)
	if err != nil {
		log.Printf("chat: %v", err)
		if res.Answer != "" {
			s.Store.AddMessage(save, in.ConversationID, "assistant", res.Answer, nil, nil)
		} else {
			// Keep roles alternating so the next turn's history is valid.
			s.Store.AddMessage(save, in.ConversationID, "assistant", "(No answer: "+err.Error()+")", nil, nil)
		}
		send(chat.Event{Type: "error", Text: i18n.T(lang, err.Error())})
		return
	}
	if res.Answer == "" {
		res.Answer = "(No answer was produced.)"
	}
	if err := s.Store.AddMessage(save, in.ConversationID, "assistant", res.Answer, res.Sources, res.Unverified); err != nil {
		log.Printf("chat: save answer: %v", err)
	}
	send(chat.Event{Type: "sources", Sources: res.Sources, Unverified: res.Unverified})
	send(chat.Event{Type: "done"})
}
