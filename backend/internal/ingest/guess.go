package ingest

import (
	"strings"

	"docdoctor/internal/store"
)

// Keyword-based classification, used when Claude is not configured or its extraction
// call fails. It only looks for tell-tale words (Polish, English, German), so it is a
// rough sort into type and business area, not a reading of the document. Claude's
// result replaces it whenever one is available.

type rule struct {
	label string
	words []string
}

var typeRules = []rule{
	{"invoice", []string{"faktura", "invoice", "rechnung", "fv/", "do zaplaty", "nabywca", "sprzedawca", "amount due", "razem netto"}},
	{"receipt", []string{"paragon", "receipt", "kassenbon", "quittung", "pokwitowanie", "sprzedaz opodatkowana", "reszta", "gotowka"}},
	{"contract", []string{"umowa", "contract", "agreement", "vertrag", "zwanym dalej", "zwana dalej", "aneks", "hereinafter", "strony ustalaja", "wypowiedzeni"}},
	{"letter", []string{"szanowni panstwo", "szanowny panie", "szanowna pani", "dear ", "sehr geehrte", "z powazaniem", "kind regards", "sincerely", "wezwanie", "w odpowiedzi na"}},
	{"form", []string{"formularz", "wniosek", "deklaracja", "oswiadczenie", "application form", "antrag", "wypelnic", "pit-", "cit-", "vat-7"}},
	{"report", []string{"raport", "sprawozdanie", "report", "zestawienie", "bilans", "protokol", "bericht", "rachunek zyskow"}},
}

var categoryRules = []rule{
	{"premises", []string{"najem", "najmu", "czynsz", "lokal", "wynajmujacy", "lease", "tenant", "landlord", "miete", "energia elektryczna", "gaz ziemny", "woda i scieki", "media"}},
	{"taxes", []string{"urzad skarbowy", "podatek dochodowy", "podatku", "jpk", "pit-", "cit-", "vat-7", "zus", "tax office", "finanzamt", "skladki"}},
	{"banking", []string{"wyciag", "kredyt", "pozyczk", "leasing", "bank statement", "loan", "odsetki", "kontoauszug"}},
	{"payroll_hr", []string{"umowa o prace", "wynagrodzeni", "pracownik", "urlop", "payroll", "salary", "employee", "swiadectwo pracy", "lista plac"}},
	{"insurance", []string{"polisa", "ubezpiecz", "insurance", "versicherung", "skladka ubezpieczeniowa"}},
	{"legal", []string{"sad rejonowy", "sad okregowy", "pozew", "pelnomocnictw", "court", "krs", "notariusz", "akt notarialny", "komornik"}},
	{"vehicles", []string{"pojazd", "samochod", "nr rejestracyjny", "vehicle", "paliwo", "przeglad techniczny", "dowod rejestracyjny"}},
	{"it_telecom", []string{"licencj", "oprogramowani", "hosting", "domena", "internet", "abonament", "software", "subscription", "telefon"}},
}

var folder = strings.NewReplacer(
	"ą", "a", "ć", "c", "ę", "e", "ł", "l", "ń", "n", "ó", "o", "ś", "s", "ź", "z", "ż", "z",
	"ä", "a", "ö", "o", "ü", "u", "ß", "ss", "é", "e", "è", "e", "\n", " ", "\t", " ",
)

func score(text, head string, r rule) int {
	n := 0
	for _, w := range r.words {
		n += strings.Count(text, w)
		n += 3 * strings.Count(head, w) // the top of the first page usually names the document
	}
	return n
}

func best(text, head string, rules []rule, min int) string {
	label, top := "", min-1
	for _, r := range rules {
		if s := score(text, head, r); s > top {
			label, top = r.label, s
		}
	}
	return label
}

// guess returns a partial analysis (type and business area only), or nil when the text
// gives no clear signal.
func guess(text string) *store.Analysis {
	folded := folder.Replace(strings.ToLower(text))
	head := folded
	if len(head) > 500 {
		head = head[:500]
	}
	docType := best(folded, head, typeRules, 3)
	if docType == "" {
		return nil
	}
	category := best(folded, head, categoryRules, 2)
	if category == "" {
		category = "other"
		if docType == "invoice" || docType == "receipt" {
			category = "purchases"
		}
	}
	return &store.Analysis{DocType: docType, Category: category}
}
