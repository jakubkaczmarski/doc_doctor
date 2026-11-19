// Package i18n translates the server's user-facing messages.
//
// English text is the key: call sites stay readable, and a message without a
// translation falls back to English instead of showing a raw identifier.
package i18n

import (
	"fmt"
	"net/http"
	"strings"
)

// Lang returns the interface language the client asked for ("pl" or "en").
// The web app sends X-Lang; Accept-Language covers everything else.
func Lang(r *http.Request) string {
	for _, h := range []string{r.Header.Get("X-Lang"), r.Header.Get("Accept-Language")} {
		h = strings.ToLower(strings.TrimSpace(h))
		if strings.HasPrefix(h, "pl") {
			return "pl"
		}
		if h != "" {
			return "en"
		}
	}
	return "en"
}

// T returns the message in the given language, formatted with args when present.
func T(lang, en string, args ...any) string {
	format := en
	if lang == "pl" {
		if pl, ok := polish[en]; ok {
			format = pl
		}
	}
	if len(args) == 0 {
		return format
	}
	return fmt.Sprintf(format, args...)
}

var polish = map[string]string{
	// general
	"not found":         "Nie znaleziono.",
	"internal error":    "Coś poszło nie tak po naszej stronie. Spróbuj ponownie.",
	"invalid JSON body": "Nieprawidłowe żądanie.",
	"not signed in":     "Zaloguj się, aby kontynuować.",
	"no such page":      "Nie ma takiej strony.",

	// accounts
	"Enter a valid email address.":               "Podaj poprawny adres e-mail.",
	"Enter your business name.":                  "Podaj nazwę firmy.",
	"Password must be 8 to 72 characters.":       "Hasło musi mieć od 8 do 72 znaków.",
	"An account with this email already exists.": "Konto z tym adresem e-mail już istnieje.",
	"Wrong email or password.":                   "Nieprawidłowy e-mail lub hasło.",
	"Business info is limited to %d characters.": "Informacje o firmie mogą mieć najwyżej %d znaków.",

	// uploads and scans
	"expected a multipart upload":                                                         "Nie udało się odebrać plików. Spróbuj ponownie.",
	"upload interrupted":                                                                  "Przesyłanie zostało przerwane. Spróbuj ponownie.",
	"Only photos can be joined into one scan.":                                            "W jeden skan można połączyć tylko zdjęcia.",
	"A scan can have at most %d pages.":                                                   "Skan może mieć najwyżej %d stron.",
	"A page photo is too large or the upload was interrupted.":                            "Zdjęcie strony jest za duże albo przesyłanie zostało przerwane.",
	"No pages were uploaded.":                                                             "Nie przesłano żadnej strony.",
	"Could not assemble the scan. Is the OCR worker running?":                             "Nie udało się złożyć skanu. Spróbuj ponownie za chwilę.",
	"Unsupported file type. Upload a PDF or an image (JPG, PNG, HEIC, TIFF, WebP).":       "Tego rodzaju pliku nie obsługujemy. Dodaj PDF albo zdjęcie (JPG, PNG, HEIC, TIFF, WebP).",
	"Upload failed while saving the file.":                                                "Nie udało się zapisać pliku.",
	"File is larger than %d MB.":                                                          "Plik jest większy niż %d MB.",
	"File is empty.":                                                                      "Plik jest pusty.",
	"Could not render this page. Is the OCR worker running?":                              "Nie udało się wyświetlić tej strony. Spróbuj ponownie za chwilę.",
	"This document is still being processed.":                                             "Ten dokument jest jeszcze odczytywany.",
	"Claude vision needs a Claude API key. Set ANTHROPIC_API_KEY and restart the server.": "Dokładniejsze odczytywanie nie jest jeszcze włączone.",
	"ocr must be local, claude or auto":                                                   "Nieprawidłowe żądanie.",
	"Scan %s":                                                                             "Skan %s",

	// questions
	"Type a question first.": "Najpierw wpisz pytanie.",
	"Asking questions needs a Claude API key. Set ANTHROPIC_API_KEY in .env and restart the server.": "Zadawanie pytań nie jest jeszcze włączone.",
	"Searching for “%s”":                      "Szukam: „%s”",
	"Reading “%s”":                            "Czytam: „%s”",
	"Listing documents":                       "Przeglądam listę dokumentów",
	"Adding up totals":                        "Sumuję kwoty",
	"Claude declined to answer this question": "Asystent odmówił odpowiedzi na to pytanie.",
	"the answer was cut off at the length limit; try a narrower question": "Odpowiedź była za długa i została ucięta. Zadaj węższe pytanie.",
	"Claude API rejected the credentials (check ANTHROPIC_API_KEY)":       "Usługa odpowiedzi odrzuciła dane dostępowe. Skontaktuj się z osobą, która konfigurowała Doc Doctor.",
	"Claude API rate limit reached, try again shortly":                    "Za dużo pytań naraz. Spróbuj ponownie za chwilę.",
	"Claude API is temporarily unavailable":                               "Usługa odpowiedzi jest chwilowo niedostępna. Spróbuj ponownie za chwilę.",
}
