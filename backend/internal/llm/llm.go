// Package llm wraps the Claude calls used outside of chat: vision OCR and metadata extraction.
package llm

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"

	"github.com/anthropics/anthropic-sdk-go/v2"

	"docdoctor/internal/store"
)

type Client struct {
	API       anthropic.Client
	Model     string
	Fallbacks bool
}

func New(model string) *Client {
	return &Client{
		API:   anthropic.NewClient(), // reads ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN
		Model: model,
		// Server-side refusal fallbacks: a request declined by a safety classifier is
		// re-served by a fallback model in the same call. Set CLAUDE_FALLBACKS=0 to disable.
		Fallbacks: os.Getenv("CLAUDE_FALLBACKS") != "0",
	}
}

// Base returns request params with the model and shared options filled in.
func (c *Client) Base(maxTokens int64, effort anthropic.BetaOutputConfigEffort) anthropic.BetaMessageNewParams {
	p := anthropic.BetaMessageNewParams{
		Model:        c.Model,
		MaxTokens:    maxTokens,
		OutputConfig: anthropic.BetaOutputConfigParam{Effort: effort},
	}
	if c.Fallbacks {
		p.Betas = []anthropic.AnthropicBeta{anthropic.AnthropicBetaServerSideFallback2026_07_01}
		p.Fallbacks = anthropic.BetaFallbacksParamOfDefault()
	}
	return p
}

// stream runs a request with streaming (long outputs would hit HTTP timeouts otherwise)
// and returns the accumulated message.
func (c *Client) stream(ctx context.Context, p anthropic.BetaMessageNewParams) (*anthropic.BetaMessage, error) {
	s := c.API.Beta.Messages.NewStreaming(ctx, p)
	msg := anthropic.BetaMessage{}
	for s.Next() {
		if err := msg.Accumulate(s.Current()); err != nil {
			return nil, err
		}
	}
	if err := s.Err(); err != nil {
		return nil, DescribeError(err)
	}
	switch msg.StopReason {
	case anthropic.BetaStopReasonRefusal:
		return nil, errors.New("Claude declined to process this content")
	case anthropic.BetaStopReasonMaxTokens:
		return nil, errors.New("output was cut off at the token limit")
	}
	return &msg, nil
}

func text(msg *anthropic.BetaMessage) string {
	var b strings.Builder
	for _, block := range msg.Content {
		if t, ok := block.AsAny().(anthropic.BetaTextBlock); ok {
			b.WriteString(t.Text)
		}
	}
	return b.String()
}

// DescribeError turns SDK errors into short messages that are safe to show in the UI.
func DescribeError(err error) error {
	var apiErr *anthropic.Error
	if errors.As(err, &apiErr) {
		switch apiErr.StatusCode {
		case 401, 403:
			return errors.New("Claude API rejected the credentials (check ANTHROPIC_API_KEY)")
		case 429:
			return errors.New("Claude API rate limit reached, try again shortly")
		case 529, 500, 502, 503:
			return errors.New("Claude API is temporarily unavailable")
		default:
			return fmt.Errorf("Claude API error %d: %s", apiErr.StatusCode, apiErr.Error())
		}
	}
	return err
}

// ---------- vision OCR ----------

const ocrPrompt = `Transcribe this scanned business document exactly as written.

Rules:
- Start every page with a line of the form "=== PAGE n ===" (n starts at 1). A single image is page 1.
- Keep the original language, spelling, numbers and reading order. Do not translate, summarise or correct.
- Render tables as Markdown tables so rows and columns stay aligned.
- Include handwriting, stamps and form field values; write [illegible] where text cannot be read.
- Output only the transcription, with no commentary before or after.`

var pageMarker = regexp.MustCompile(`(?m)^=== PAGE (\d+) ===\s*$`)

// OCR transcribes a PDF or image with Claude vision and returns one entry per page.
func (c *Client) OCR(ctx context.Context, data []byte, mime string) ([]store.Page, error) {
	b64 := base64.StdEncoding.EncodeToString(data)
	var file anthropic.BetaContentBlockParamUnion
	switch mime {
	case "application/pdf":
		file = anthropic.NewBetaDocumentBlock(anthropic.BetaBase64PDFSourceParam{Data: b64})
	case "image/jpeg", "image/png", "image/gif", "image/webp":
		file = anthropic.NewBetaImageBlock(anthropic.BetaBase64ImageSourceParam{
			Data: b64, MediaType: anthropic.BetaBase64ImageSourceMediaType(mime),
		})
	default:
		return nil, fmt.Errorf("Claude vision cannot read %s files", mime)
	}

	p := c.Base(64000, anthropic.BetaOutputConfigEffortLow)
	p.Messages = []anthropic.BetaMessageParam{
		anthropic.NewBetaUserMessage(file, anthropic.NewBetaTextBlock(ocrPrompt)),
	}
	msg, err := c.stream(ctx, p)
	if err != nil {
		return nil, err
	}
	return SplitPages(text(msg), "claude-vision"), nil
}

// SplitPages splits a transcription on "=== PAGE n ===" markers.
func SplitPages(out, engine string) []store.Page {
	locs := pageMarker.FindAllStringSubmatchIndex(out, -1)
	if len(locs) == 0 {
		return []store.Page{{PageNo: 1, Text: strings.TrimSpace(out), Engine: engine}}
	}
	var pages []store.Page
	for i, loc := range locs {
		end := len(out)
		if i+1 < len(locs) {
			end = locs[i+1][0]
		}
		n, _ := strconv.Atoi(out[loc[2]:loc[3]])
		if n != len(pages)+1 {
			n = len(pages) + 1 // keep numbering dense even if the model mislabels a page
		}
		pages = append(pages, store.Page{PageNo: n, Text: strings.TrimSpace(out[loc[1]:end]), Engine: engine})
	}
	return pages
}

// ---------- metadata extraction ----------

// MaxAnalyzeChars bounds the text sent for metadata extraction. Classification, parties,
// dates and totals are found near the start and end of a document, so for very long
// documents the middle is elided (and the model is told so).
const MaxAnalyzeChars = 300_000

const analyzePrompt = `You are indexing a scanned business document for a company's document archive.
The OCR text is below; it may contain recognition errors. Extract the metadata.

Guidance:
- doc_type: what kind of document it is. Pick the most specific that fits:
  invoice (a bill for goods or services, including pro forma and correction invoices),
  receipt (proof of a payment already made: till receipt, payment confirmation),
  contract (an agreement between parties, including annexes and amendments),
  letter (correspondence: a notice, reminder, demand, reply or cover letter),
  form (a filled-in form, application or declaration, including tax returns),
  report (a report, summary, minutes or financial statement),
  statement (a bank or account statement, or a list of transactions),
  order (a purchase order, quote, offer or order confirmation),
  delivery_note (a delivery or goods-received note, waybill),
  payslip (a payslip or payroll list),
  certificate (a certificate, licence, permit, registration extract or policy document),
  other (only when none of the above fits).
- type_confidence: "high" when the document clearly is that type, for example it names itself or has the unmistakable layout. "low" when the text is too short, too garbled or too ambiguous to be sure, when two types fit about equally, or when you chose "other". The archive owner is asked to confirm documents marked low, so be honest rather than optimistic: a wrong type filed with confidence is worse than a question.
- category: the area of the business it relates to. purchases (things the company buys: supplier invoices, receipts, orders), sales (things it sells: its own invoices, customer orders, quotes), premises (rent, lease, utilities, building matters), banking (accounts, loans, statements, leasing), taxes (tax office, VAT, social insurance filings and correspondence), payroll_hr (employment contracts, payslips, leave, staff matters), insurance, legal (disputes, court, powers of attorney, company registry), vehicles, it_telecom (software, hardware, phone, internet), administration (permits, official notices, general office paperwork), or other. Use the company context to tell purchases from sales: an invoice issued by the company is sales, one addressed to it is purchases.
- subject: one short phrase, in the document's language, saying what it is about, specific enough to tell it from similar documents (e.g. "Najem biura, ul. Świętojańska 4" or "Paper and toner, October order"). No more than about 8 words.
- title: a short specific title a person would recognise in a list, in the document's language (e.g. "Invoice FV/2026/031 – Acme Sp. z o.o.").
- summary: 2-4 sentences covering what the document is, who it involves and anything that matters (amounts, deadlines, obligations).
- language: ISO 639-1 code of the main language.
- doc_date: the document's own date (issue or signing date) as YYYY-MM-DD, or "" if absent.
- counterparty: the other party from the archive owner's point of view (the vendor on an invoice or receipt, the other signatory on a contract, the sender of a letter). Use the name as written, or "" if unclear.
- total_amount and currency: the gross total payable for invoices and receipts, or the main contract value if one is stated; otherwise null and "". currency is an ISO 4217 code.
- The company section may list how the owner filed earlier documents by hand. Treat those as the house rules: when this document is the same kind of thing from the same party, file it the same way, even if you would have chosen differently.
- The company section may also include what the owner said about this very document. Their description tells you what it is; use it for the type, area, title and subject unless the text plainly contradicts it.
- tags: 2-6 lowercase topical keywords.
- fields: other facts worth looking up later as name/value pairs, e.g. invoice number, tax IDs, net amount, VAT amount, due date, payment terms, bank account, contract term, notice period, governing law, reference numbers. Use values exactly as written in the document. Only include what is actually present.`

var analysisSchema = json.RawMessage(`{
  "type": "object",
  "additionalProperties": false,
  "required": ["doc_type","type_confidence","category","subject","title","summary","language","doc_date","counterparty","total_amount","currency","tags","fields"],
  "properties": {
    "doc_type": {"type": "string", "enum": ["invoice","receipt","contract","letter","form","report","statement","order","delivery_note","payslip","certificate","other"]},
    "type_confidence": {"type": "string", "enum": ["high","low"]},
    "category": {"type": "string", "enum": ["purchases","sales","premises","banking","taxes","payroll_hr","insurance","legal","vehicles","it_telecom","administration","other"]},
    "subject": {"type": "string"},
    "title": {"type": "string"},
    "summary": {"type": "string"},
    "language": {"type": "string"},
    "doc_date": {"type": "string"},
    "counterparty": {"type": "string"},
    "total_amount": {"type": ["number","null"]},
    "currency": {"type": "string"},
    "tags": {"type": "array", "items": {"type": "string"}},
    "fields": {"type": "array", "items": {
      "type": "object", "additionalProperties": false, "required": ["name","value"],
      "properties": {"name": {"type": "string"}, "value": {"type": "string"}}
    }}
  }
}`)

// Analyze extracts archive metadata from OCR text using structured output.
//
// company is the archive owner's name and profile, so the model can tell which party
// "we" are (who the counterparty is, and whether an invoice is a purchase or a sale).
// It may also carry how the owner filed earlier documents and what they said about
// this one; the prompt tells the model how much weight those get.
func (c *Client) Analyze(ctx context.Context, company, filename, fullText string) (*store.Analysis, error) {
	body := fullText
	if r := []rune(body); len(r) > MaxAnalyzeChars {
		half := MaxAnalyzeChars / 2
		body = string(r[:half]) + "\n\n[... middle of a long document omitted ...]\n\n" + string(r[len(r)-half:])
	}
	p := c.Base(16000, anthropic.BetaOutputConfigEffortLow)
	p.OutputConfig.Format = anthropic.BetaJSONOutputFormatParam{Schema: analysisSchema}
	p.Messages = []anthropic.BetaMessageParam{
		anthropic.NewBetaUserMessage(anthropic.NewBetaTextBlock(
			analyzePrompt + "\n\n<company>\n" + company + "\n</company>\n\nFile name: " + filename + "\n\n<document>\n" + body + "\n</document>")),
	}
	msg, err := c.stream(ctx, p)
	if err != nil {
		return nil, err
	}
	var a store.Analysis
	if err := json.Unmarshal([]byte(text(msg)), &a); err != nil {
		return nil, fmt.Errorf("could not parse extraction result: %w", err)
	}
	return &a, nil
}
