package ingest

import "testing"

func TestGuess(t *testing.T) {
	cases := []struct{ text, docType, category string }{
		{"FAKTURA VAT nr FV/2026/10/0417\nSprzedawca: Hurtownia Papiernicza\nNabywca: Biuro\nDo zapłaty: 2 628,51 zł", "invoice", "purchases"},
		{"UMOWA NAJMU LOKALU UŻYTKOWEGO\nzwaną dalej Wynajmującym\n§ 2. Czynsz\n§ 4. Wypowiedzenie", "contract", "premises"},
		{"PARAGON FISKALNY\nSprzedaż opodatkowana A\nGotówka 50,00\nReszta 3,20\nPaliwo PB95", "receipt", "vehicles"},
		{"Urząd Skarbowy w Gdyni\nSzanowni Państwo,\nw odpowiedzi na pismo dotyczące podatku dochodowego\nZ poważaniem", "letter", "taxes"},
		{"Invoice 1042\nAmount due: 300 EUR\nSoftware subscription, annual licence", "invoice", "it_telecom"},
	}
	for _, c := range cases {
		g := guess(c.text)
		if g == nil || g.DocType != c.docType || g.Category != c.category {
			t.Errorf("%.30q: got %+v, want %s/%s", c.text, g, c.docType, c.category)
		}
	}
	if g := guess("lorem ipsum dolor sit amet 12345"); g != nil {
		t.Errorf("unclear text should not be classified, got %+v", g)
	}
}
