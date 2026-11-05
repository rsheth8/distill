# Part 3 — Explanation features

Distill now reads only research papers (Parts 1–2). This part adds the help that makes a
paper understandable to someone outside academia: an overview, a trust check, a guide to
each section with its jargon, a glossary, a reading-level switch, and ask-the-paper.
Figures (caption explainer and vision model) are Part 4.

## Decisions

| Topic | Decision |
|---|---|
| When AI runs | Overview + trust run once when a paper opens. A section's guide runs after ~8 s in that section, or at once on tap. |
| Trust check | Facts read from the paper object, plus the AI's summary of study type/size and the paper's own stated limits. No outside lookups. |
| Reading level | Three levels — `simple`, `everyday` (default), `close` — one global setting every AI task follows. |
| Jargon | Terms come back with each section guide; dotted underline in the paper with a hover/focus card, plus a Glossary tab. |
| Ask scope | Answers from the paper, citing sections; general knowledge only on a line labelled "Background"; "the paper doesn't say" otherwise. |
| Layout | Panel tabs Read · Ask · Glossary; Settings via the header ⚙; level switch in the header. |
| Output format | Labelled plain text (`LABEL:` lines, `TERMS:` block) parsed leniently; streams like today's summaries. |
| Explain this page | Removed; the overview replaces it. |

## Constraints

- Default model is Groq `llama-3.1-8b-instant` on a free tier with tight per-minute
  token limits; a full paper is 15–20k tokens. Every task sends excerpts, never the
  whole paper (overview ≤ ~7,000 chars of paper text, guide ≤ 6,000, ask ≤ 5,000).
- Paper-help calls for a tab run one at a time (a per-tab promise chain) so the
  overview and a guide never hit the rate limit together.
- Paper text and AI output are untrusted. Everything is inserted with `textContent`
  or as text nodes — never `innerHTML` — in the panel, the page and the reader.

## The paper object

One new field: `date: string` — `citation_publication_date`, else `citation_date`, else
`citation_online_date` (first 10 chars); `''` when unknown and for PDFs. For arXiv the
trust facts derive year and month from the arXiv ID in the DOI (`2310.06825` → Oct 2023).

## AI tasks

All prompts live in `extension/utils/prompts.js` (copied to `backend/lib/prompts.js`).

**Reading level.** `context.level` ∈ `simple | everyday | close` (missing/unknown →
`everyday`) swaps one sentence of the shared persona, for every task including the
existing ones:

- `simple` — short sentences, no technical terms at all, everyday comparisons.
- `everyday` — today's wording: everyday words, explain any term you must use.
- `close` — keep the field's key terms, define each the first time.

**`overview`** — input `excerpt` (from `distillPaperExcerpt`), context `title`, `level`.
Output labels, one short paragraph each, `LIMITS:` as `- ` lines:

```
ASKED: …   DID: …   FOUND: …   WHY: …   STUDY: …   LIMITS: - … - …
```

**`section_guide`** — input `sectionText`, context `title`, `section {heading, kind}`,
`level`. Output: 2–5 plain sentences, then

```
TERMS:
term — short definition
```

At most 12 terms; terms are words or phrases that appear verbatim in the section.

**`ask`** — input `question`, `excerpts` (`[{heading, text}]` from
`distillPickSections`), context `title`, `abstract` (≤ 800 chars), `thread` (last 3
`{q, a}`), `level`. Output: the answer, then optional `BACKGROUND:` line, then
`FROM:` line listing section headings used. If the excerpts don't cover it, the answer
says the paper doesn't say.

**Removed:** `explain_page` (prompt, background flow, cache, offline-queue branch,
panel section and export buttons, `explain_page` keyboard command, backend cost entry,
API doc row).

| Task | Backend cost | Max tokens (balanced / ultra-lean) |
|---|---|---|
| `overview` | 12 | 420 / 300 |
| `section_guide` | 10 | 380 / 260 |
| `ask` | 10 | 320 / 220 |

Each new task is added to: `TASK_COSTS`, `TASK_MODEL_ROUTER` and `AI_TUNING` in
`backend/server.js`; `AI_TUNING` in `background.js`; the task table in `docs/api.md`.

## Components

**`extension/utils/paperHelp.js`** (pure, unit tested; loaded by the background and the
panel):

- `distillPaperExcerpt(paper, maxChars = 7000)` — abstract (≤ 1,500) then the first
  ~1,200 chars of the first intro, methods, results and discussion sections (falls back
  to the first sections when kinds are missing), each prefixed with its heading.
- `distillTrustFacts(paper)` → `[{ text, href? }]`: "Preprint — not yet peer-reviewed" /
  "Journal article" / "Publication status unknown" (PDF without a preprint signal);
  date; "N authors"; DOI link to `https://doi.org/<doi>`.
- `distillParseLabelled(text, labels)` → `{ lead, LABEL: text, … }`: `lead` is the text
  before the first label (the guide body, the ask answer), then each label present so
  far; tolerant of case, bold markers and missing labels; safe on partial streams.
- `distillParseTerms(block)` → `[{ term, definition }]` from `term — definition` /
  `term - definition` / `term: definition` lines; drops terms over 60 chars; max 12.
- `distillPickSections(paper, question, maxChars = 5000)` → `[{ heading, text }]`:
  paragraphs scored by question-word overlap (lowercase, ≥ 3 letters, small stopword
  list, heading match bonus), best first until the budget, returned in paper order
  grouped by section.
- `distillFindSection(paper, heading)` → `{ heading, kind, text }` by cleaned,
  case-insensitive heading; `Abstract` maps to `paper.abstract`; otherwise `null`.

**`extension/utils/termMarks.js`** (DOM, happy-dom tested; content script):
`distillMarkTerms(elements, terms)` wraps the first whole-word, case-insensitive
occurrence of each term per element in `<span class="distill-term" tabindex="0"
data-term>` using text nodes; skips `a, code, pre, math, script, style` and existing
marks. `distillUnmarkTerms(root)` removes them (used on level change).

**`extension/paperFeatures.js`** (background; `importScripts`):

- `runOverview(tabId)`, `runSectionGuide(tabId, heading)`, `runAsk(tabId, question)`
  — build context/input from tab state, call the existing `streamTask`, store results,
  stream to the panel.
- Dwell timer per tab: on a new section from `ACTIVE_PARAGRAPH`, wait 8 s; if still in
  that section and no guide for (section, level), run it.
- Tab state gains `overview {level, text}`, `guides {[heading]: {level, text, terms}}`,
  `glossary [{term, definition, section}]` (first definition wins, max 150),
  `askThread [{q, a}]` (max 20). Saved in the session snapshot and the URL-keyed page
  state (`pageStore.js`) with size caps, so returning to a paper restores them.
- Level: `chrome.storage.local.readingLevel`; on change, re-run the overview for the
  active paper tab and tell content scripts to clear underlines.

**Content script** — on `SHOW_TERMS {heading, terms}` marks the elements of that section
(between its `h2` and the next `h2`); a single floating card shows the definition on
hover/focus; `SCROLL_TO_TERM {term}` scrolls to the first mark; `CLEAR_TERMS` unmarks.

**Panel** — `extension/sidepanelPaper.js` (loaded after `sidepanel.js`; `sidepanel.js`
forwards port messages it doesn't handle): Read/Ask/Glossary tabs, header level
`<select>`, overview card, trust card, "You're in" guide card, Ask view, Glossary view.

## Messages

| Direction | Type | Payload |
|---|---|---|
| bg → panel | `PAPER_HELP_START` | `{kind: 'overview'|'guide'|'ask', key}` |
| bg → panel | `PAPER_HELP_CHUNK` | `{kind, key, chunk}` |
| bg → panel | `PAPER_HELP_DONE` | `{kind, key, text}` |
| bg → panel | `PAPER_HELP_ERROR` | `{kind, key, message}` |
| bg → panel | `PAPER_HELP_STATE` | `{overview, trustFacts, section, guides, glossary, askThread}` (on detect/restore) |
| bg → panel | `SECTION_CHANGED` | `{heading, hasGuide}` |
| panel → bg | `GUIDE_SECTION` | `{tabId, heading}` |
| panel → bg | `ASK_PAPER` | `{tabId, question}` |
| panel → bg | `RETRY_OVERVIEW` | `{tabId}` |
| bg → content | `SHOW_TERMS` / `CLEAR_TERMS` / `SCROLL_TO_TERM` | see above |

`key` is the section heading for guides and the question index for asks. The panel
parses the streamed text with `distillParseLabelled` on every chunk, so cards fill in
as text arrives; label names never show.

## Panel

- **Header:** level switch (Simple / Everyday / Closer to the paper) beside ⚙. Tabs
  Read · Ask · Glossary replace Read · Settings.
- **Read:** Overview (The question · What they did · What they found · Why it matters) →
  How much to trust it (fact tags, "Study:", "Limits" bullets, fixed line "A single study
  rarely settles a question.") → You're in: [section] (guide, or "Guide this section"
  button; "N new terms" opens Glossary) → existing now-tip, summary, check-ins,
  highlights, pinned analyses. The Explain action button is removed.
- **Ask:** thread, question box, three starter questions when empty ("What's the main
  takeaway?", "Who could this affect?", "How sure are the authors?"); each answer shows
  "Background:" and "From:" lines when present.
- **Glossary:** terms A–Z with definition and section; click scrolls the paper to the
  term.

## Errors

- No key / backend down / rate limit: the existing `streamTask` error codes, shown in
  the card that asked (`PAPER_HELP_ERROR`) with a Retry button that re-sends the request.
- Missing labels: the card shows what parsed; an overview with no labels at all shows
  the raw text as one paragraph.
- Section not found in the paper object (subsections, figures list): the guide card says
  "No guide for this part" and offers none.
- No terms parsed: guide shows without underlines.

## Testing

- `tests/unit/paperHelp.test.mjs` — excerpt budget and section choice; trust facts
  (preprint, journal, PDF, arXiv date from DOI, missing date); labelled parsing (all
  labels, missing labels, partial stream, bold/case variants); term parsing (dash
  variants, caps); section picking (relevance, budget, paper order); find section.
- `tests/unit/prompts.test.mjs` — new tasks; each level changes the persona; unknown
  level falls back; `explain_page` gone.
- `tests/front/termMarks.dom.test.mjs` — wraps first occurrence per element, whole
  words only, skips links/code, idempotent, unmark restores text.
- `tests/unit/pageStore` — new fields round-trip with caps.
- Smoke: scan `paperFeatures.js` with `background.js` for tasks and panel types, and
  `sidepanelPaper.js` with `sidepanel.js` for cases.
- Real Chrome (Playwright, extension loaded): stub `streamTask` with canned labelled
  output on an arXiv HTML paper and the PDF reader; check cards, streaming, underlines,
  hover card, glossary click, level change, ask flow, restore after reload.

## Build order

Each phase ends with tests passing and a commit.

1. Foundation — reading level in prompts + header switch; Read/Ask/Glossary tabs;
   remove `explain_page`.
2. Overview + trust card — `paperHelp` excerpt/trust/parsing, `date` field, `overview` task.
3. Section guide + jargon — dwell timer, `section_guide`, term marks, glossary.
4. Ask the paper — `distillPickSections`, `ask` task, Ask view.
5. Persistence, docs (README, api.md, store listing features), full Chrome check.

## Out of scope

Figures (Part 4); outside lookups (retractions, citations); embeddings for ask;
glossary search; per-answer rewrite buttons.
