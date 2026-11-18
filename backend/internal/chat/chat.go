// Package chat answers questions about an organisation's documents. Claude is given
// search and lookup tools scoped to one org and cites pages as [doc_id:page].
package chat

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/anthropics/anthropic-sdk-go/v2"

	"docdoctor/internal/llm"
	"docdoctor/internal/store"
)

type Agent struct {
	LLM   *llm.Client
	Store *store.Store
}

// Event is one server-sent event for the chat UI.
type Event struct {
	Type    string         `json:"type"` // text | tool | sources | error | done
	Text    string         `json:"text,omitempty"`
	Sources []store.Source `json:"sources,omitempty"`
}

const systemPrompt = `You are the document assistant for a business. The company has scanned its paper documents (invoices, receipts, contracts, letters, forms) into an archive, and the people asking you questions are its owners and staff. They rely on your answers to make decisions, so every factual claim has to come from the archive.

How to work:
- Look things up with the tools before answering; you have no knowledge of this company beyond what the tools return. Search first, then read the relevant pages in full when a snippet is not enough to answer confidently.
- search_pages matches keyword prefixes, not meaning. Pass several likely keywords and word stems in the language the documents are written in (which may differ from the question's language), and retry with synonyms or different stems when the first search comes back thin.
- For questions about amounts, counts or trends across many documents (spend per vendor, invoices per month), use aggregate_documents or list_documents. They read structured fields extracted from every document, so they cover the whole archive, where search only shows the top matches.
- The text comes from OCR and can contain recognition errors. If a figure looks garbled or two documents disagree, say so instead of guessing.

How to answer:
- Reply in the language of the question. Lead with the answer, then the supporting detail.
- Cite the page behind each fact with a marker of the form [doc_id:page], for example [42:3], placed right after the sentence it supports. Use the ids and page numbers exactly as the tools returned them. Facts taken from list_documents or aggregate_documents have no page; cite the document as [doc_id:1] when you name a specific one.
- If the archive does not contain the answer, say what you searched for and that nothing was found. Do not fill gaps from general knowledge without labelling it as such.
- Keep amounts in their original currency and never add up different currencies.`

func tool(name, desc string, props map[string]any, required ...string) anthropic.BetaToolUnionParam {
	return anthropic.BetaToolUnionParam{OfTool: &anthropic.BetaToolParam{
		Name:        name,
		Description: anthropic.String(desc),
		InputSchema: anthropic.BetaToolInputSchemaParam{Properties: props, Required: required},
	}}
}

func strDesc(d string) map[string]any { return map[string]any{"type": "string", "description": d} }
func intDesc(d string) map[string]any { return map[string]any{"type": "integer", "description": d} }

var docTypeProp = map[string]any{"type": "string", "enum": []string{"invoice", "receipt", "contract", "letter", "form", "report", "other", "unknown"}}

var filterProps = map[string]any{
	"text":         strDesc("Substring matched against title, file name, counterparty, summary and tags."),
	"doc_type":     docTypeProp,
	"counterparty": strDesc("Substring of the counterparty name (vendor, other contract party, sender)."),
	"date_from":    strDesc("Earliest document date, YYYY-MM-DD."),
	"date_to":      strDesc("Latest document date, YYYY-MM-DD."),
}

func withProps(extra map[string]any) map[string]any {
	out := map[string]any{}
	for k, v := range filterProps {
		out[k] = v
	}
	for k, v := range extra {
		out[k] = v
	}
	return out
}

var tools = []anthropic.BetaToolUnionParam{
	tool("search_pages",
		"Full-text search over the OCR text of every page in the archive. Returns the best-matching pages with a snippet, the document id and the page number. Matching is an OR over keyword prefixes with accents ignored, so 'umow' matches 'umowa' and 'umowy'. Use it to find where something is mentioned.",
		map[string]any{
			"query":       strDesc("Keywords or word stems separated by spaces, in the documents' language."),
			"doc_type":    docTypeProp,
			"document_id": intDesc("Restrict the search to one document."),
			"limit":       intDesc("Maximum pages to return (default 10, max 30)."),
		}, "query"),
	tool("read_document",
		"Read the full OCR text of a document, or a range of its pages, together with its extracted metadata and fields. Use it after search_pages when you need the exact wording or surrounding context.",
		map[string]any{
			"document_id": intDesc("Document id from search_pages or list_documents."),
			"from_page":   intDesc("First page to read (default 1)."),
			"to_page":     intDesc("Last page to read (default: last page)."),
		}, "document_id"),
	tool("list_documents",
		"List documents with their extracted metadata: id, type, title, date, counterparty, total amount, currency, tags and summary. Covers the whole archive and supports filters. Use it to enumerate documents of a kind or period.",
		withProps(map[string]any{"limit": intDesc("Maximum documents to return (default 50, max 200).")})),
	tool("aggregate_documents",
		"Count documents and sum their total amounts, grouped by one dimension, with the same filters as list_documents. Totals are computed in the database over every matching document and are reported per currency. Use it for spend per vendor, volume per month and similar questions.",
		withProps(map[string]any{"group_by": map[string]any{"type": "string", "enum": []string{"counterparty", "doc_type", "month", "year", "none"}}}), "group_by"),
}

const maxToolChars = 60_000

type run struct {
	a     *Agent
	orgID int64
	seen  map[int64]string // doc id -> title, for every document a tool returned
}

func (r *run) exec(ctx context.Context, name string, raw json.RawMessage) (result string, label string, err error) {
	var in struct {
		Query        string `json:"query"`
		DocType      string `json:"doc_type"`
		DocumentID   int64  `json:"document_id"`
		Limit        int    `json:"limit"`
		FromPage     int    `json:"from_page"`
		ToPage       int    `json:"to_page"`
		Text         string `json:"text"`
		Counterparty string `json:"counterparty"`
		DateFrom     string `json:"date_from"`
		DateTo       string `json:"date_to"`
		GroupBy      string `json:"group_by"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", "", fmt.Errorf("invalid tool input: %w", err)
	}
	for _, d := range []string{in.DateFrom, in.DateTo} {
		if d != "" {
			if _, err := time.Parse("2006-01-02", d); err != nil {
				return "", "", fmt.Errorf("dates must be YYYY-MM-DD, got %q", d)
			}
		}
	}
	filter := store.DocFilter{Text: in.Text, DocType: in.DocType, Counterparty: in.Counterparty, DateFrom: in.DateFrom, DateTo: in.DateTo, Status: "ready"}

	switch name {
	case "search_pages":
		if strings.TrimSpace(in.Query) == "" {
			return "", "", errors.New("query is required")
		}
		hits, err := r.a.Store.SearchPages(ctx, r.orgID, in.Query, in.DocType, in.DocumentID, in.Limit)
		if err != nil {
			return "", "", err
		}
		for _, h := range hits {
			r.seen[h.DocID] = h.Title
		}
		return toJSON(map[string]any{"hits": hits}), "Searching for “" + in.Query + "”", nil

	case "read_document":
		doc, err := r.a.Store.GetDocument(ctx, r.orgID, in.DocumentID)
		if err != nil {
			return "", "", fmt.Errorf("document %d not found", in.DocumentID)
		}
		r.seen[doc.ID] = doc.Title
		if in.FromPage < 1 {
			in.FromPage = 1
		}
		pages, err := r.a.Store.GetPages(ctx, r.orgID, doc.ID, in.FromPage, in.ToPage)
		if err != nil {
			return "", "", err
		}
		var b strings.Builder
		out := map[string]any{"document": doc}
		for i, p := range pages {
			if b.Len()+len(p.Text) > maxToolChars && i > 0 {
				out["truncated"] = fmt.Sprintf("Stopped before page %d to keep the result small. Call read_document again with from_page=%d to continue.", p.PageNo, p.PageNo)
				break
			}
			fmt.Fprintf(&b, "=== page %d ===\n%s\n\n", p.PageNo, p.Text)
		}
		out["text"] = b.String()
		return toJSON(out), "Reading “" + doc.Title + "”", nil

	case "list_documents":
		filter.Limit = in.Limit
		if filter.Limit <= 0 {
			filter.Limit = 50
		}
		docs, err := r.a.Store.ListDocuments(ctx, r.orgID, filter)
		if err != nil {
			return "", "", err
		}
		rows := make([]map[string]any, 0, len(docs))
		for _, d := range docs {
			r.seen[d.ID] = d.Title
			rows = append(rows, map[string]any{
				"id": d.ID, "doc_type": d.DocType, "title": d.Title, "doc_date": d.DocDate, "counterparty": d.Counterparty,
				"total_amount": d.TotalAmount, "currency": d.Currency, "tags": d.Tags, "pages": d.PageCount, "summary": d.Summary,
			})
		}
		return toJSON(map[string]any{"count": len(rows), "documents": rows}), "Listing documents", nil

	case "aggregate_documents":
		rows, err := r.a.Store.Aggregate(ctx, r.orgID, in.GroupBy, filter)
		if err != nil {
			return "", "", err
		}
		return toJSON(map[string]any{"group_by": in.GroupBy, "rows": rows}), "Adding up totals by " + in.GroupBy, nil
	}
	return "", "", fmt.Errorf("unknown tool %q", name)
}

func toJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

var citeRe = regexp.MustCompile(`\[(\d+):(\d+)\]`)

// Answer runs one user turn. history holds the earlier turns as plain text. Text is
// streamed through emit; the full answer and the sources it cites are returned.
func (a *Agent) Answer(ctx context.Context, orgID int64, orgName string, history []store.Message, question string, emit func(Event)) (string, []store.Source, error) {
	var msgs []anthropic.BetaMessageParam
	for _, m := range history {
		block := anthropic.NewBetaTextBlock(m.Content)
		if m.Role == "assistant" {
			msgs = append(msgs, anthropic.BetaMessageParam{OfAssistant: &anthropic.BetaAssistantMessageParam{
				Content: []anthropic.BetaContentBlockParamUnion{block},
			}})
		} else {
			msgs = append(msgs, anthropic.NewBetaUserMessage(block))
		}
	}
	msgs = append(msgs, anthropic.NewBetaUserMessage(anthropic.NewBetaTextBlock(question)))

	r := &run{a: a, orgID: orgID, seen: map[int64]string{}}
	params := a.LLM.Base(32000, anthropic.BetaOutputConfigEffortMedium)
	params.Tools = tools
	params.System = []anthropic.BetaTextBlockParam{
		{Text: systemPrompt, CacheControl: anthropic.NewBetaCacheControlEphemeralParam()},
		{Text: fmt.Sprintf("Company: %s. Today's date: %s.", orgName, time.Now().Format("2006-01-02"))},
	}

	var answer strings.Builder
	for iter := 0; iter < 16; iter++ {
		params.Messages = msgs
		stream := a.LLM.API.Beta.Messages.NewStreaming(ctx, params)
		msg := anthropic.BetaMessage{}
		for stream.Next() {
			ev := stream.Current()
			if err := msg.Accumulate(ev); err != nil {
				return answer.String(), nil, err
			}
			if delta, ok := ev.AsAny().(anthropic.BetaRawContentBlockDeltaEvent); ok {
				if td, ok := delta.Delta.AsAny().(anthropic.BetaTextDelta); ok && td.Text != "" {
					answer.WriteString(td.Text)
					emit(Event{Type: "text", Text: td.Text})
				}
			}
		}
		if err := stream.Err(); err != nil {
			return answer.String(), nil, llm.DescribeError(err)
		}

		switch msg.StopReason {
		case anthropic.BetaStopReasonRefusal:
			return answer.String(), nil, errors.New("Claude declined to answer this question")
		case anthropic.BetaStopReasonMaxTokens:
			return answer.String(), nil, errors.New("the answer was cut off at the length limit; try a narrower question")
		}

		msgs = append(msgs, msg.ToParam())
		if msg.StopReason == anthropic.BetaStopReasonPauseTurn {
			continue
		}
		if msg.StopReason != anthropic.BetaStopReasonToolUse {
			break
		}

		// Run every requested tool and return all results in a single user message.
		var results []anthropic.BetaContentBlockParamUnion
		for _, block := range msg.Content {
			tu, ok := block.AsAny().(anthropic.BetaToolUseBlock)
			if !ok {
				continue
			}
			out, label, err := r.exec(ctx, tu.Name, json.RawMessage(tu.JSON.Input.Raw()))
			if err != nil {
				results = append(results, anthropic.NewBetaToolResultBlock(tu.ID, "Error: "+err.Error(), true))
				continue
			}
			emit(Event{Type: "tool", Text: label})
			results = append(results, anthropic.NewBetaToolResultBlock(tu.ID, out, false))
		}
		if answer.Len() > 0 && !strings.HasSuffix(answer.String(), "\n\n") {
			answer.WriteString("\n\n")
			emit(Event{Type: "text", Text: "\n\n"})
		}
		msgs = append(msgs, anthropic.NewBetaUserMessage(results...))
	}

	// Keep only citations that point at documents the tools actually returned.
	var sources []store.Source
	dedup := map[string]bool{}
	for _, m := range citeRe.FindAllStringSubmatch(answer.String(), -1) {
		id, _ := strconv.ParseInt(m[1], 10, 64)
		page, _ := strconv.Atoi(m[2])
		title, ok := r.seen[id]
		if !ok || dedup[m[0]] {
			continue
		}
		dedup[m[0]] = true
		sources = append(sources, store.Source{DocID: id, Page: page, Title: title})
	}
	return strings.TrimSpace(answer.String()), sources, nil
}
