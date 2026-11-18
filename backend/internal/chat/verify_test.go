package chat

import (
	"reflect"
	"testing"
)

func TestUnverifiedFigures(t *testing.T) {
	idx := newNumberIndex()
	idx.add(`Do zapłaty: 2 628,51 zł. Czynsz 6 450,00 zł netto. Data wystawienia: 14.10.2026. NIP: 676-248-11-93. do dnia 28 lutego 2030 r. {"total_amount":3194.31}`)

	cases := []struct {
		answer string
		want   []string
	}{
		{"The total is 2,628.51 zł [1:1].", []string{}},
		{"The total is 2628.51 PLN.", []string{}},
		{"Rent is 6 450 zł per month, or 6450.00.", []string{}},
		{"Issued on 14 October 2026; lease ends 28 February 2030.", []string{}},
		{"Both invoices add up to 3 194,31 zł.", []string{}},
		{"Tax ID 676-248-11-93.", []string{}},
		{"See page [12345:678] for details.", []string{}},
		{"The total is 2 682,51 zł.", []string{"2 682,51"}},
		{"Rent is 7 450 zł and the deposit is 19 350 zł.", []string{"7 450", "19 350"}},
		{"The lease ends in 2031.", []string{"2031"}},
		{"That is 77 400 zł a year.", []string{"77 400"}},
		{"There are 2 invoices and 6 months of notice.", []string{}},
	}
	for _, c := range cases {
		if got := unverifiedFigures(c.answer, idx); !reflect.DeepEqual(got, c.want) {
			t.Errorf("%q: got %v, want %v", c.answer, got, c.want)
		}
	}
}
