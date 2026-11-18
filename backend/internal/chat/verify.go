package chat

import (
	"regexp"
	"strings"
)

// Grounding checks that do not depend on the model following instructions.
//
// The model is told to answer only from the archive, but an instruction is not a
// guarantee. After each answer we check two things mechanically:
//   - every [doc:page] citation points at a page a tool actually returned this turn;
//   - every figure in the answer appears in the material the model was shown.
// Anything that fails is surfaced to the user rather than silently trusted.

// A number as people write it: digit groups joined by a single space, dot or comma
// ("2 628,51", "1,167.00", "14.10.2026", "676-248" is two numbers).
var numberRe = regexp.MustCompile(`\d+(?:[ \x{00a0}\x{202f}.,]\d+)*`)
var digitRunRe = regexp.MustCompile(`\d+`)
var decimalsRe = regexp.MustCompile(`[.,]\d{2}$`)

func digitsOnly(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// numberIndex holds every figure found in the source material, in forms that make
// "6 450,00 zł" and "6450 PLN" compare equal.
type numberIndex struct {
	whole map[string]bool // separators removed: "262851"
	runs  map[string]bool // individual digit groups: "2", "628", "51"
}

func newNumberIndex() *numberIndex {
	return &numberIndex{whole: map[string]bool{}, runs: map[string]bool{}}
}

func (n *numberIndex) add(text string) {
	for _, m := range numberRe.FindAllString(text, -1) {
		n.whole[digitsOnly(m)] = true
		if decimalsRe.MatchString(m) { // also index the amount without its decimals
			n.whole[digitsOnly(m[:len(m)-3])] = true
		}
		for _, run := range digitRunRe.FindAllString(m, -1) {
			n.runs[run] = true
		}
	}
}

func (n *numberIndex) has(figure string) bool {
	d := digitsOnly(figure)
	if n.whole[d] || n.whole[d+"00"] {
		return true
	}
	if decimalsRe.MatchString(figure) && n.whole[digitsOnly(figure[:len(figure)-3])] && strings.HasSuffix(d, "00") {
		return true
	}
	// A date or reference written differently ("14 October 2026" vs "14.10.2026"):
	// accept when every significant digit group occurs in the sources.
	runs := digitRunRe.FindAllString(figure, -1)
	if len(runs) < 2 {
		// A lone year or reference number. Groups of four or more digits cannot be a
		// fragment of a thousands-grouped amount, so matching one on its own is safe.
		return len(d) >= 4 && n.runs[d]
	}
	for _, run := range runs {
		if len(run) >= 3 && !n.runs[run] {
			return false
		}
	}
	// Grouped thousands ("2 628") must match as a whole number, not group by group.
	return !looksLikeGroupedAmount(runs)
}

func looksLikeGroupedAmount(runs []string) bool {
	if len(runs[0]) > 3 {
		return false
	}
	groups := 0
	for _, run := range runs[1:] {
		if len(run) == 3 {
			groups++
		}
	}
	return groups > 0
}

// unverifiedFigures lists figures in the answer that do not occur in the sources.
// Numbers under three digits are skipped: they are counts and ordinals ("2 invoices",
// "6 months") that carry little risk and would produce noise.
func unverifiedFigures(answer string, idx *numberIndex) []string {
	answer = citeRe.ReplaceAllString(answer, " ")
	seen := map[string]bool{}
	out := []string{}
	for _, m := range numberRe.FindAllString(answer, -1) {
		if len(digitsOnly(m)) < 3 || seen[m] || idx.has(m) {
			continue
		}
		seen[m] = true
		out = append(out, m)
	}
	return out
}
