# Part 1 — Paper intake

Distill is narrowing to research papers only (general articles are removed in Part 2).
This part turns any paper — HTML or PDF — into one structured object that every
later feature (overview, section guide, jargon, trust check, reading level, ask,
figures) reads from.

## Roadmap context

1. **Paper intake** (this doc)
2. Refocus on papers: remove general-article paths, rework panel/onboarding/prompts
3. Explanation features: overview, section guide, jargon + glossary, trust check, reading level, ask-the-paper
4. Figures: image extraction + vision-capable models, with fallback

## The paper object

```js
{
  title: string,
  authors: string[],
  doi: string,            // '' if unknown
  source: 'arxiv' | 'pmc' | 'biorxiv' | 'generic' | 'pdf',
  isPreprint: boolean,    // arXiv, bioRxiv, medRxiv => true
  pdfUrl: string,         // from citation_pdf_url, '' if none
  abstract: string,
  sections: [{ heading: string, kind: 'intro'|'methods'|'results'|'discussion'|'other', text: string }],
  figures: [{ caption: string }]
}
```

`kind` is inferred from the heading text (e.g. "Materials and Methods" → methods,
"Conclusion" → discussion). References/acknowledgements sections are dropped.

## HTML intake (content script)

- **Detection:** a page is a paper if it has a `citation_title` meta tag
  (Highwire/Google Scholar tags, present on nearly all journal and preprint sites),
  or is a known paper host with matching markup.
- **Site extractors:** arXiv HTML (LaTeXML markup), PubMed Central, bioRxiv/medRxiv.
- **Generic extractor:** meta tags for title/authors/DOI/PDF URL + heading-based
  section splitting of the main content.
- **arXiv abstract pages:** offer to open the HTML version when one exists.

Lives in `extension/utils/paperExtractor.js`, replacing `articleExtractor.js`.
Functions take a `Document` argument so they're testable under happy-dom.

## PDF intake

- Chrome's PDF viewer can't be scripted, so on a PDF tab the panel offers
  **Open in Distill**, opening `extension/reader.html?src=<url>`.
- `reader.html` renders with a vendored, version-pinned pdf.js build
  (MV3 forbids remote code).
- Text → paper object: merge text items into lines, detect two-column layout,
  strip running headers/footers/line numbers, detect headings by font size and
  numbering (`2. Methods`, `II. RESULTS`).
- Auto-opening every PDF is out of scope (possible later setting).

## Wiring

Content script / reader page send `PAPER_DETECTED { paper, pageUrl }`. Until Part 3
replaces the old features, the background also derives today's `articleText`
from the paper so existing summaries keep working.

## Constraints

- Groq free tier has tight per-minute token limits; a full paper is often 15–20k
  tokens. Part 3 must send abstract + relevant sections, not whole papers —
  which is why sections carry `kind`.
- Paywalled papers: we only read what the user can see.

## Testing

- Unit tests per extractor against saved HTML fixtures (happy-dom).
- Unit tests for PDF line/column grouping on synthetic text items.
- ~10 real paper URLs added to `scripts/eval/` matrix.

## Build order

1. Paper object + meta detection + arXiv extractor
2. PMC + bioRxiv extractors
3. Wire `PAPER_DETECTED`
4. Vendor pdf.js + `reader.html` rendering
5. PDF text → sections
6. Open in Distill on PDF tabs + arXiv HTML redirect
