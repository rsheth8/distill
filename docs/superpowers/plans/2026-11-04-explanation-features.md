# Explanation Features (Part 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Help readers outside academia understand a research paper. Add an automatic overview and trust check, a guide to each section (with its jargon underlined in the page and collected in a glossary), a reading-level switch, and ask-the-paper. All of it replaces "Explain this page".

**Architecture:** Prompts for three new AI tasks (`overview`, `section_guide`, `ask`) live in the shared `utils/prompts.js`. Pure helpers in `utils/paperHelp.js` pick excerpts, build trust facts and parse the labelled output. `paperFeatures.js` runs in the service worker: it queues one paper-help call per tab at a time, streams results to the panel, and stores them in tab state. The content script underlines terms through `utils/termMarks.js`. `sidepanelPaper.js` draws the cards and the Ask and Glossary tabs.

**Tech Stack:**
- Chrome MV3 extension in plain JS (classic scripts, `importScripts`, no bundler).
- Vitest: a node project for unit tests, a happy-dom project for `tests/front`.
- Express backend (`backend/server.js`).
- Playwright-core for the real-Chrome check.

**Spec:** `docs/superpowers/specs/2026-11-04-explanation-features-design.md`

## Global Constraints

**Untrusted text**
- Paper text and AI output are untrusted. Insert them only with `textContent` or text nodes, never `innerHTML`, in the panel, the page and the reader.

**Excerpts and calls**
- Every task sends excerpts, never the whole paper. Limits: overview ≤ 7,000 chars of paper text, guide ≤ 6,000, ask ≤ 5,000.
- Paper-help calls for a tab run one at a time, through a per-tab promise chain.
- Default model: Groq `llama-3.1-8b-instant`, on a free tier with tight per-minute token limits.

**Reading level**
- Levels are `simple | everyday | close`. Missing or unknown means `everyday`.
- Stored in `chrome.storage.local.readingLevel`. Every AI task follows it.

**Prompts**
- Edit only `extension/utils/prompts.js`, then run `npm run sync:prompts`. A test asserts the backend copy is identical.

**Registering a new task.** Add it to all of these:
- `TASK_COSTS`, `TASK_MODEL_ROUTER` and `AI_TUNING` in `backend/server.js`
- `AI_TUNING` in `extension/background.js`
- the task table in `docs/api.md`

`npm run smoke` fails if the lists drift apart.

**Task values:**

| Task | Backend cost | Max tokens, balanced | Max tokens, ultra-lean |
|---|---|---|---|
| `overview` | 12 | 420 | 300 |
| `section_guide` | 10 | 380 | 260 |
| `ask` | 10 | 320 | 220 |

**Labelled output:** `LABEL:` lines and a `TERMS:` block, parsed leniently. The panel never shows label names.

**Fixed panel copy:**
- Tabs: "Read", "Ask", "Glossary".
- Level options: "Simple", "Everyday", "Closer to the paper".
- Trust card line: "A single study rarely settles a question."
- Starter questions: "What's the main takeaway?", "Who could this affect?", "How sure are the authors?"

**Gates**
- `npm test` (lint, smoke and coverage) passes at the end of every task.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## File structure

| File | Status | Responsibility |
|---|---|---|
| `extension/utils/prompts.js` (+ `backend/lib/prompts.js` copy) | modify | Level-aware persona; `overview`, `section_guide`, `ask` prompts; `explain_page` removed |
| `extension/utils/paperHelp.js` | create | Pure helpers: excerpt, trust facts, labelled/terms parsing, glossary merge, section find/pick |
| `extension/utils/termMarks.js` | create | DOM: wrap/unwrap jargon terms with text nodes |
| `extension/paperFeatures.js` | create | Service worker: queue, overview/guide/ask runners, dwell timer, level change, panel state |
| `extension/sidepanelPaper.js` | create | Panel: level switch, overview/trust/guide cards, Ask view, Glossary view |
| `extension/background.js` | modify | importScripts, level into every prompt, port messages, hooks on detect/section/clear, persistence fields, explain removal |
| `extension/content.js` | modify | SHOW_TERMS / CLEAR_TERMS / SCROLL_TO_TERM, hover card, styles |
| `extension/sidepanel.html` / `.js` / `.css` | modify | Tabs, header select, new views/cards, forward port messages, explain removal |
| `extension/utils/paperExtractor.js` | modify | `date` field |
| `extension/utils/pdfPaper.js` | modify | `date: ''` |
| `extension/utils/pageStore.js` | modify | Persist overview/guides/glossary/askThread; drop explainCache |
| `extension/manifest.json`, `extension/reader.html` | modify | Load termMarks.js; drop `explain_page` command |
| `extension/utils/aiResultCache.js`, `extension/utils/exportClip.js` | modify | Drop explain-only helpers |
| `backend/server.js` | modify | Task tables |
| `scripts/smoke.mjs` | modify | Scan the two new files |
| `eslint.config.mjs`, `package.json` | modify | Lint scope + globals |
| `docs/api.md`, `README.md`, `docs/STORE_LISTING.md`, `scripts/eval/quality-cost-eval.md` | modify | Task table, feature copy |
| Tests: `tests/unit/paperHelp.test.mjs` (new), `tests/front/termMarks.dom.test.mjs` (new), `tests/unit/prompts.test.mjs`, `tests/unit/pageStore.test.mjs`, `tests/front/paperExtractor.dom.test.mjs`, `tests/unit/aiResultCache.test.mjs`, `tests/unit/exportClip.test.mjs` | create/modify | |

Run all commands from the repository root (the worktree).

---

# Phase 1 — Foundation

### Task 1: Reading level in every prompt

**Files:**
- Modify: `extension/utils/prompts.js:5-8` (persona), `:40` (`sys`)
- Modify: `backend/lib/prompts.js` (via `npm run sync:prompts`)
- Modify: `extension/background.js` (`streamTask` ~line 2138; new `readingLevel()` next to `getAiMode`)
- Test: `tests/unit/prompts.test.mjs`

**Interfaces:**
- Produces: `context.level` accepted by every task in `distillBuildPrompt`.
- Produces: `async function readingLevel()` in `background.js`. It returns `'simple'|'everyday'|'close'`.
- Produces: `streamTask` adds `level` to every task's context.

- [ ] **Step 1: Write the failing test.** Add to `tests/unit/prompts.test.mjs`, inside the `describe`:

```js
  it('reading level swaps one sentence of the persona', () => {
    const sys = level => distillBuildPrompt('now', { level }, { paragraph: 'p' }).system;
    expect(sys('simple')).toMatch(/no technical terms at all/);
    expect(sys('close')).toMatch(/define each one the first time/);
    expect(sys('everyday')).toMatch(/explain it in a few words/);
    expect(sys(undefined)).toBe(sys('everyday'));
    expect(sys('nonsense')).toBe(sys('everyday'));
    for (const level of ['simple', 'everyday', 'close']) expect(sys(level)).toMatch(/never invent findings/);
  });
```

- [ ] **Step 2: Run it and confirm it fails.**

Run: `npx vitest run tests/unit/prompts.test.mjs`
Expected: FAIL. The `simple` system prompt has no "no technical terms at all".

- [ ] **Step 3: Implement.** In `extension/utils/prompts.js`, replace the `DISTILL_PROMPT_PERSONA` constant with:

```js
const DISTILL_LEVEL_STYLE = {
  simple: 'Use short sentences and no technical terms at all; compare ideas to everyday things.',
  everyday: 'Use everyday words. If you must use a technical term, explain it in a few words.',
  close: "Keep the field's key terms, and define each one the first time you use it."
};

function distillPersona(level) {
  return 'You help someone with no academic background read a research paper. ' +
    (DISTILL_LEVEL_STYLE[level] || DISTILL_LEVEL_STYLE.everyday) +
    ' Stick to what the paper says; never invent findings, numbers or claims.';
}
```

Then, in `distillBuildPrompt`, change the `sys` line:

```js
  const sys = extra => `${distillPersona(c.level)} ${extra}`;
```

Run: `npm run sync:prompts`

- [ ] **Step 4: Pass the level from the extension.** In `extension/background.js`, add this next to `getAiMode`:

```js
async function readingLevel() {
  const { readingLevel: level } = await chrome.storage.local.get('readingLevel');
  return ['simple', 'everyday', 'close'].includes(level) ? level : 'everyday';
}
```

In `streamTask`, put this as the first line of the function body, before the `lastAiRetryByTab` block:

```js
  context = { ...context, level: await readingLevel() };
```

The retry closure reads the same `context` variable, so retries keep the level.

- [ ] **Step 5: Run the tests and confirm they pass.**

Run: `npx vitest run tests/unit/prompts.test.mjs`
Expected: PASS, including "backend copy matches".

- [ ] **Step 6: Commit.**

```bash
git add extension/utils/prompts.js backend/lib/prompts.js extension/background.js tests/unit/prompts.test.mjs
git commit -m "feat: reading level (simple/everyday/close) in every prompt

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Remove "Explain this page"

The overview replaces it. Delete each piece below. Then search: `grep -rn "explain_page\|EXPLAIN_\|explainCache\|ExplainContentHash\|ExplainExport\|explainBtn\|explainSection\|MAX_PAGE_EXPLAIN" extension backend tests docs scripts eslint.config.mjs`. It must come back empty, apart from `docs/superpowers/` and the `schedulePauseToExplain` now-tip function. That function is a different feature. Keep it.

**Files:**
- Modify: `extension/utils/prompts.js` (the `case 'explain_page'` block, lines ~105-110), then `npm run sync:prompts`
- Modify: `extension/background.js`:
  - the command handler at ~111 (`if (command === 'explain_page')`)
  - `AI_TUNING` `explain_page` keys at ~238 and ~249
  - `explainCache` in `tabSnapshotPayload` (~465) and in `snapshotToState`
  - the `explainCache` lines in `persistHistorySnapshot`
  - port `case 'EXPLAIN_PAGE'` at ~975
  - the whole "Explain this page" section (`runExplainStream`, `replayCachedExplain`, `explainPage`) at ~1691-1780
  - the offline-queue `explain_page` branch at ~1915
  - `MAX_PAGE_EXPLAIN_CHARS`
  - the `cacheFirst` handling in `streamTask` (only `explain_page` used it)
- Modify: `extension/sidepanel.html`:
  - `#explainBtnMain` (~200)
  - `#explainSection` (~273 to its closing `</section>`)
  - the shortcut hint at ~472: change it to "defaults are Alt+Shift+R (reader), F (focus), and A (analyze)"
- Modify: `extension/sidepanel.js`:
  - the explain consts at ~268-289
  - `explainPageKey` at ~73
  - the "Explain this page" section at ~872-1013
  - every `case 'EXPLAIN_*'` in `handleMessage`
  - every `explainBtnMain`/`explainRefreshBtn`/`exportExplain*` listener
- Modify: `extension/sidepanel.css` (rules that only target `.explain-section` / `#explain*`)
- Modify: `extension/manifest.json:72-78` (the `explain_page` command)
- Modify: `extension/utils/aiResultCache.js` (`distillExplainContentHash`)
- Modify: `extension/utils/exportClip.js` (`distillBuildExplainExportMarkdown`, `distillBuildExplainExportPlain`)
- Modify: `extension/utils/pageStore.js` (`DISTILL_CAP_EXPLAIN_CHARS`, `explainCache` in all three functions)
- Modify: `backend/server.js`: `explain_page` in `TASK_COSTS` (169), `TASK_MODEL_ROUTER` (179), `AI_TUNING` (210, 221)
- Modify: `docs/api.md:298` (row), `scripts/eval/quality-cost-eval.md` (explain rows)
- Modify: `eslint.config.mjs` (`distillBuildExplainExportMarkdown`, `distillBuildExplainExportPlain`, `distillExplainContentHash` globals)
- Test: `tests/unit/prompts.test.mjs`, `tests/unit/aiResultCache.test.mjs:28`, `tests/unit/exportClip.test.mjs:18,29`, `tests/unit/pageStore.test.mjs:61,73,80,85-99`

**Interfaces:**
- Produces: `streamTask` builds `content: blocks.map(text => ({ type: 'text', text }))`, with no cache_control.

- [ ] **Step 1: Update the tests first.**
  - `tests/unit/prompts.test.mjs`: delete the `explain_page` line from `tasks`. Add this test:

```js
  it('explain_page is gone (the overview replaces it)', () => {
    expect(() => distillBuildPrompt('explain_page', {}, { pageText: 'x' })).toThrow(/explain_page/);
  });
```

  - `tests/unit/aiResultCache.test.mjs`: delete the `distillExplainContentHash` describe/it, from around line 28, and its import.
  - `tests/unit/exportClip.test.mjs`: delete the two explain export tests at lines 18 and 29, and their imports.
  - `tests/unit/pageStore.test.mjs`:
    - In the "caps" test, delete the `explainCache:` input line and the `expect(p.explainCache.text.length)` line.
    - In "tolerates empty state", delete `expect(p.explainCache).toBeNull()`.
    - In the round-trip test, delete the `explainCache` input and its `expect`, and rename the test to `'restores summary, units, quiz, highlights'`.
    - Delete any remaining `explainCache` assertions (lines 85-99).

- [ ] **Step 2: Run the tests and confirm they fail.**

Run: `npx vitest run tests/unit`
Expected: FAIL on "explain_page is gone".

- [ ] **Step 3: Delete the code** listed under **Files** above. In `streamTask`, the prompt lines become:

```js
  const { system: systemPrompt, blocks } = distillBuildPrompt(task, context, input);
  const messages = [{ role: 'user', content: blocks.map(text => ({ type: 'text', text })) }];
```

Then run `npm run sync:prompts`.

- [ ] **Step 4: Run the grep from the top of this task.** Expected: no hits outside `docs/superpowers/` and `schedulePauseToExplain`.

- [ ] **Step 5: Run the full gate.**

Run: `npm test`
Expected: PASS. Smoke shows that TASK_COSTS and AI_TUNING still match.

- [ ] **Step 6: Commit.**

```bash
git add -A extension backend tests docs/api.md scripts eslint.config.mjs
git commit -m "refactor: remove Explain this page (the paper overview replaces it)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Read · Ask · Glossary tabs and the level switch

**Files:**
- Modify: `extension/sidepanel.html:76-82` (header and nav), the end of `#viewRead` (add the Ask/Glossary views), the script tags at ~485-491
- Modify: `extension/sidepanel.js:113` (drop `tabSettingsBtn`), `:317-325` (`setPanel`), `:523-527` (tab listeners)
- Create: `extension/sidepanelPaper.js`
- Modify: `extension/sidepanel.css` (append)
- Modify: `eslint.config.mjs`, `package.json` (`lint` script)

**Interfaces:**
- Produces: `setPanel(name)` with `name ∈ 'read'|'ask'|'glossary'|'settings'`.
- Produces: the global `paperView = { level, state, section, streams }` in `sidepanelPaper.js`. Later panel tasks extend it.
- Produces: `#levelSelect`, `#viewAsk`, `#viewGlossary`, `#tabAskBtn`, `#tabGlossaryBtn`.

- [ ] **Step 1: HTML.** In `extension/sidepanel.html`, put this just before `<button id="settingsBtn"`:

```html
      <select id="levelSelect" class="level-select" aria-label="Reading level" title="How plain the explanations are">
        <option value="simple">Simple</option>
        <option value="everyday" selected>Everyday</option>
        <option value="close">Closer to the paper</option>
      </select>
```

Replace the `<nav class="tab-bar">` block with:

```html
    <nav class="tab-bar" role="tablist" aria-label="Distill sections">
      <button id="tabReadBtn" class="tab-btn tab-btn-active" type="button" role="tab" aria-selected="true">Read</button>
      <button id="tabAskBtn" class="tab-btn" type="button" role="tab" aria-selected="false">Ask</button>
      <button id="tabGlossaryBtn" class="tab-btn" type="button" role="tab" aria-selected="false">Glossary</button>
    </nav>
```

Put this just before `<div id="viewSettings"`:

```html
    <div id="viewAsk" class="panel-view hidden">
      <section class="section">
        <div id="askThread" class="ask-thread" aria-live="polite"></div>
        <div id="askStarters" class="ask-starters">
          <button type="button" class="ask-starter">What's the main takeaway?</button>
          <button type="button" class="ask-starter">Who could this affect?</button>
          <button type="button" class="ask-starter">How sure are the authors?</button>
        </div>
        <form id="askForm" class="ask-form">
          <textarea id="askInput" rows="2" maxlength="500" placeholder="Ask about this paper…" aria-label="Your question"></textarea>
          <button type="submit" class="ask-submit">Ask</button>
        </form>
        <p><span id="askStatus" class="status-badge"></span> <button id="askRetryBtn" type="button" class="paper-link-btn hidden">Retry</button></p>
      </section>
    </div>

    <div id="viewGlossary" class="panel-view hidden">
      <section class="section">
        <p id="glossaryEmpty" class="hint">Terms show up here as Distill guides you through each section.</p>
        <dl id="glossaryList" class="glossary-list"></dl>
      </section>
    </div>
```

After `<script src="sidepanel.js"></script>`, add:

```html
  <script src="utils/paperHelp.js"></script>
  <script src="sidepanelPaper.js"></script>
```

`utils/paperHelp.js` arrives in Task 5. Until then, create it as an empty file with a `'use strict';` header so the page loads.

- [ ] **Step 2: Tab switching.** In `extension/sidepanel.js`:
  - Delete the `tabSettingsBtn` const at line 113 and its listener at 524-527.
  - Replace `setPanel` (317-323) with the code below.
  - Replace `tabReadBtn?.addEventListener('click', () => setPanel('read'));` with the loop below.

```js
function setPanel(panel) {
  const views = { read: viewRead, ask: $('viewAsk'), glossary: $('viewGlossary'), settings: viewSettings };
  const tabs = { read: tabReadBtn, ask: $('tabAskBtn'), glossary: $('tabGlossaryBtn') };
  for (const [name, view] of Object.entries(views)) view?.classList.toggle('hidden', name !== panel);
  for (const [name, btn] of Object.entries(tabs)) {
    btn?.classList.toggle('tab-btn-active', name === panel);
    btn?.setAttribute('aria-selected', String(name === panel));
  }
}
```

```js
for (const name of ['read', 'ask', 'glossary']) {
  $(`tab${name[0].toUpperCase()}${name.slice(1)}Btn`)?.addEventListener('click', () => setPanel(name));
}
```

The `settingsBtn` (⚙) handler stays as it is. It toggles between `'settings'` and `'read'`.

- [ ] **Step 3: Level switch.** Create `extension/sidepanelPaper.js`:

```js
// Paper help in the side panel: reading level, overview, trust, section guide, Ask, Glossary.
// Loaded after sidepanel.js and uses its globals ($, port, currentTabId, show, hide, setStatus, setPanel).
// AI output and paper text are untrusted: everything goes in with textContent.

const DISTILL_LEVELS = ['simple', 'everyday', 'close'];
// state: last PAPER_HELP_STATE; section: heading the reader is in; streams: text arriving per "kind:key".
const paperView = { level: 'everyday', state: null, section: '', streams: {} };

const levelSelect = $('levelSelect');
chrome.storage.local.get('readingLevel').then(({ readingLevel }) => {
  if (DISTILL_LEVELS.includes(readingLevel)) paperView.level = levelSelect.value = readingLevel;
});
levelSelect.addEventListener('change', () => {
  paperView.level = levelSelect.value;
  chrome.storage.local.set({ readingLevel: paperView.level });
});
```

- [ ] **Step 4: CSS.** Append to `extension/sidepanel.css`:

```css
.level-select { font: inherit; font-size: 12px; padding: 2px 4px; border-radius: 6px; border: 1px solid var(--border, #ccc); background: transparent; color: inherit; max-width: 9.5em; }
.paper-link-btn { background: none; border: 0; padding: 0; color: var(--accent, #3b5bdb); font: inherit; font-size: 12px; cursor: pointer; text-decoration: underline; }
.ask-thread { display: flex; flex-direction: column; gap: 12px; }
.ask-q { font-weight: 600; margin: 0 0 4px; }
.ask-a { margin: 0; white-space: pre-wrap; }
.ask-meta { margin: 4px 0 0; font-size: 11px; color: var(--text-muted); }
.ask-starters { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
.ask-starter { font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--border, #ccc); background: transparent; color: inherit; cursor: pointer; }
.ask-form { display: flex; gap: 6px; margin-top: 8px; }
.ask-form textarea { flex: 1; font: inherit; resize: vertical; }
.ask-submit { font: inherit; padding: 4px 12px; cursor: pointer; }
.glossary-list dt { margin-top: 10px; font-weight: 600; }
.glossary-list dd { margin: 2px 0 0; }
.glossary-section { color: var(--text-muted); font-size: 11px; }
.overview-label { font-size: 12px; margin: 10px 0 2px; color: var(--text-muted); }
.fact-tags { list-style: none; padding: 0; margin: 0 0 8px; display: flex; flex-wrap: wrap; gap: 6px; }
.fact-tags li { font-size: 11px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--border, #ccc); }
```

Use the variable names `sidepanel.css` already defines; check with `grep -n "^  --" extension/sidepanel.css`. Swap `--border`/`--accent` for the real names if they differ.

- [ ] **Step 5: Lint scope.**
  - In `package.json` `lint`, add `extension/sidepanelPaper.js extension/utils/paperHelp.js` after `extension/sidepanel.js`.
  - In `eslint.config.mjs`, add this block after the background/sidepanel block:

```js
  {
    files: ['extension/sidepanelPaper.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...extGlobals,
        $: 'readonly', port: 'readonly', currentTabId: 'readonly', show: 'readonly', hide: 'readonly',
        setStatus: 'readonly', setPanel: 'readonly',
        distillParseLabelled: 'readonly', distillParseTerms: 'readonly'
      }
    },
    rules: { 'no-unused-vars': 'off' }
  },
```

  - Add `'extension/utils/paperHelp.js'` to the `files` array of the utils block, the one that lists `prompts.js`.

- [ ] **Step 6: Run the gate, then check by hand.**

Run: `npm test`
Expected: PASS.

Load the unpacked extension in Chrome and open the panel. Check that:
- Read, Ask and Glossary switch views;
- ⚙ opens Settings and closes it again;
- the level choice survives closing and reopening the panel.

- [ ] **Step 7: Commit.**

```bash
git add extension/sidepanel.html extension/sidepanel.js extension/sidepanel.css extension/sidepanelPaper.js extension/utils/paperHelp.js eslint.config.mjs package.json
git commit -m "feat: Read/Ask/Glossary tabs and a reading-level switch in the panel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

# Phase 2 — Overview and trust card

### Task 4: `date` on the paper object

**Files:**
- Modify: `extension/utils/paperExtractor.js:53-64` (`distillPaperMeta`), `:99-109` (arXiv return)
- Modify: `extension/utils/pdfPaper.js:276-288` (return)
- Test: `tests/front/paperExtractor.dom.test.mjs`, `tests/unit/pdfPaper.test.mjs`

**Interfaces:**
- Produces: `paper.date: string`. It holds the first 10 chars of `citation_publication_date` || `citation_date` || `citation_online_date`, or `''`. arXiv and PDF papers always have `''`; arXiv dates come from the DOI in Task 5.

- [ ] **Step 1: Write the failing tests.** Add to `tests/front/paperExtractor.dom.test.mjs`:

```js
describe('paper date', () => {
  const page = meta => parse(`<html><head><meta name="citation_title" content="T">${meta}</head>
    <body><article><h2>Introduction</h2><p>${'word '.repeat(80)}</p></article></body></html>`);
  it('reads citation_publication_date, then citation_date, then citation_online_date', () => {
    expect(distillExtractPaper(page('<meta name="citation_publication_date" content="2021/03/04 extra">'), 'https://journal.test/a').date).toBe('2021/03/04');
    expect(distillExtractPaper(page('<meta name="citation_date" content="2020-01-02">'), 'https://journal.test/a').date).toBe('2020-01-02');
    expect(distillExtractPaper(page('<meta name="citation_online_date" content="2019">'), 'https://journal.test/a').date).toBe('2019');
  });
  it('is empty when unknown', () => {
    expect(distillExtractPaper(page(''), 'https://journal.test/a').date).toBe('');
  });
});
```

The test page must be one `distillExtractPaper` accepts as a paper. If it returns `null`, copy the smallest journal fixture already in the file and add the meta tags to it.

In `tests/unit/pdfPaper.test.mjs`, add `expect(paper.date).toBe('')` to the first test that builds a paper.

- [ ] **Step 2: Run the tests and confirm they fail.**

Run: `npx vitest run tests/front/paperExtractor.dom.test.mjs tests/unit/pdfPaper.test.mjs`
Expected: FAIL, because `date` is `undefined`.

- [ ] **Step 3: Implement.**
  - In `distillPaperMeta`'s return, add: `date: (one('citation_publication_date') || one('citation_date') || one('citation_online_date')).slice(0, 10),`
  - In the arXiv return (`distillExtractArxiv`), add: `date: '',`
  - In the `pdfPaper.js` return, add: `date: '',`

- [ ] **Step 4: Run the tests and confirm they pass.** Same command. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add extension/utils/paperExtractor.js extension/utils/pdfPaper.js tests/front/paperExtractor.dom.test.mjs tests/unit/pdfPaper.test.mjs
git commit -m "feat: publication date on the paper object

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `paperHelp.js`: excerpt, trust facts, labelled parsing

**Files:**
- Modify: `extension/utils/paperHelp.js` (the empty file from Task 3)
- Test: create `tests/unit/paperHelp.test.mjs`

**Interfaces:**
- Produces: `distillPaperExcerpt(paper, maxChars = 7000) → string`
- Produces: `distillTrustFacts(paper) → Array<{ text: string, href?: string }>`
- Produces: `distillParseLabelled(text, labels: string[]) → { lead: string, [LABEL]: string }`. Labels come back in upper case; missing labels are absent.

- [ ] **Step 1: Write the failing tests.** Create `tests/unit/paperHelp.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const help = require('../../extension/utils/paperHelp.js');

const paper = (over = {}) => ({
  title: 'T', authors: ['A', 'B', 'C'], doi: '10.1000/x', source: 'nature', isPreprint: false, date: '2021-03-04',
  abstract: 'ABS '.repeat(10).trim(),
  sections: [
    { heading: 'Introduction', kind: 'intro', text: 'INTRO '.repeat(400) },
    { heading: 'Related work', kind: '', text: 'REL' },
    { heading: 'Methods', kind: 'methods', text: 'METH' },
    { heading: 'Results', kind: 'results', text: 'RES' },
    { heading: 'Discussion', kind: 'discussion', text: 'DISC' }
  ],
  figures: [],
  ...over
});

describe('distillPaperExcerpt', () => {
  it('abstract then the first intro/methods/results/discussion, headed, within budget', () => {
    const x = help.distillPaperExcerpt(paper());
    expect(x.startsWith('Abstract\nABS')).toBe(true);
    for (const h of ['Introduction', 'Methods\nMETH', 'Results\nRES', 'Discussion\nDISC']) expect(x).toContain(h);
    expect(x).not.toContain('Related work');
    expect(x.length).toBeLessThanOrEqual(7000);
    expect(x.indexOf('Methods')).toBeLessThan(x.indexOf('Results'));
  });
  it('caps each section at 1,200 chars and the whole at maxChars', () => {
    expect(help.distillPaperExcerpt(paper()).match(/INTRO/g).length).toBeLessThanOrEqual(200);
    expect(help.distillPaperExcerpt(paper(), 500).length).toBe(500);
  });
  it('falls back to the first sections when kinds are missing', () => {
    const p = paper({ sections: [{ heading: 'One', kind: '', text: '1' }, { heading: 'Two', kind: '', text: '2' }] });
    expect(help.distillPaperExcerpt(p)).toContain('One\n1');
    expect(help.distillPaperExcerpt(p)).toContain('Two\n2');
  });
  it('survives an empty paper', () => {
    expect(help.distillPaperExcerpt({})).toBe('');
  });
});

describe('distillTrustFacts', () => {
  const texts = p => help.distillTrustFacts(p).map(f => f.text);
  it('journal article with date, authors and a DOI link', () => {
    const facts = help.distillTrustFacts(paper());
    expect(texts(paper())).toEqual(['Journal article', 'Mar 2021', '3 authors', 'DOI 10.1000/x']);
    expect(facts[3].href).toBe('https://doi.org/10.1000/x');
  });
  it('preprint, arXiv date from the DOI, one author', () => {
    const p = paper({ isPreprint: true, source: 'arxiv', doi: '10.48550/arXiv.2310.06825', date: '', authors: ['A'] });
    expect(texts(p)).toEqual(['Preprint — not yet peer-reviewed', 'Oct 2023', '1 author', 'DOI 10.48550/arXiv.2310.06825']);
  });
  it('PDF without a preprint signal, year-only date, no authors or DOI', () => {
    expect(texts(paper({ source: 'pdf', date: '2019', authors: [], doi: '' }))).toEqual(['Publication status unknown', '2019']);
  });
  it('missing or bad date is left out', () => {
    expect(texts(paper({ date: '' }))).not.toContain('');
    expect(texts(paper({ date: 'soon' })).length).toBe(3);
  });
});

describe('distillParseLabelled', () => {
  const L = ['ASKED', 'DID', 'FOUND', 'WHY', 'STUDY', 'LIMITS'];
  it('splits every label and keeps the text before the first as lead', () => {
    const r = help.distillParseLabelled('Intro line\nASKED: q\nDID: d\nFOUND: f\nWHY: w\nSTUDY: s\nLIMITS:\n- one\n- two', L);
    expect(r).toEqual({ lead: 'Intro line', ASKED: 'q', DID: 'd', FOUND: 'f', WHY: 'w', STUDY: 's', LIMITS: '- one\n- two' });
  });
  it('tolerates case, bold markers and missing labels', () => {
    const r = help.distillParseLabelled('**Asked:** q\n**FOUND**: f', L);
    expect(r.ASKED).toBe('q');
    expect(r.FOUND).toBe('f');
    expect('DID' in r).toBe(false);
  });
  it('is safe on a partial stream', () => {
    expect(help.distillParseLabelled('ASKED: half a sen', L)).toEqual({ lead: '', ASKED: 'half a sen' });
    expect(help.distillParseLabelled('', L)).toEqual({ lead: '' });
  });
  it('only matches labels at the start of a line', () => {
    expect(help.distillParseLabelled('They found: nothing', ['FOUND'])).toEqual({ lead: 'They found: nothing' });
  });
  it('lead is the whole text when no label appears', () => {
    expect(help.distillParseLabelled('Just a guide.\nTwo lines.', ['TERMS']).lead).toBe('Just a guide.\nTwo lines.');
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail.**

Run: `npx vitest run tests/unit/paperHelp.test.mjs`
Expected: FAIL with `help.distillPaperExcerpt is not a function`.

- [ ] **Step 3: Implement.** Replace `extension/utils/paperHelp.js` with:

```js
'use strict';

// Pure helpers for paper help (overview, trust card, section guides, ask). No DOM, no chrome.*.
// Loaded by the service worker (importScripts) and the side panel (<script>).

const DISTILL_EXCERPT_KINDS = ['intro', 'methods', 'results', 'discussion'];
const DISTILL_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Abstract plus the opening of the first intro/methods/results/discussion, each under its heading. */
function distillPaperExcerpt(paper, maxChars = 7000) {
  const p = paper || {};
  const sections = Array.isArray(p.sections) ? p.sections : [];
  let picked = DISTILL_EXCERPT_KINDS.map(kind => sections.find(s => s.kind === kind)).filter(Boolean);
  if (picked.length < 2) picked = sections.slice(0, 4);
  const parts = [];
  if (p.abstract) parts.push(`Abstract\n${p.abstract.slice(0, 1500)}`);
  for (const s of picked) parts.push(`${s.heading}\n${String(s.text || '').slice(0, 1200)}`);
  return parts.join('\n\n').slice(0, maxChars);
}

/** "Oct 2023" from an arXiv DOI, else from paper.date ("2021-03-04", "2021/03", "2019"); '' if unknown. */
function distillPaperDate(p) {
  const arxiv = /arXiv\.(\d{2})(\d{2})\./i.exec(p.doi || '');
  if (arxiv && DISTILL_MONTHS[Number(arxiv[2]) - 1]) return `${DISTILL_MONTHS[Number(arxiv[2]) - 1]} 20${arxiv[1]}`;
  const d = /^(\d{4})(?:[-/](\d{2}))?/.exec(p.date || '');
  if (!d) return '';
  const month = d[2] && DISTILL_MONTHS[Number(d[2]) - 1];
  return month ? `${month} ${d[1]}` : d[1];
}

/** Facts read straight from the paper object, for the trust card. */
function distillTrustFacts(paper) {
  const p = paper || {};
  const facts = [];
  if (p.isPreprint) facts.push({ text: 'Preprint — not yet peer-reviewed' });
  else if (p.source === 'pdf') facts.push({ text: 'Publication status unknown' });
  else facts.push({ text: 'Journal article' });
  const date = distillPaperDate(p);
  if (date) facts.push({ text: date });
  const n = Array.isArray(p.authors) ? p.authors.length : 0;
  if (n) facts.push({ text: n === 1 ? '1 author' : `${n} authors` });
  if (p.doi) facts.push({ text: `DOI ${p.doi}`, href: `https://doi.org/${encodeURI(p.doi)}` });
  return facts;
}

/**
 * Split "LABEL: text" output. `lead` is whatever comes before the first label.
 * Labels must start a line; case, **bold** and missing labels are fine; safe on a half-streamed reply.
 */
function distillParseLabelled(text, labels) {
  const src = String(text || '');
  const re = new RegExp(`^[ \\t*#_]*(${labels.join('|')})[ \\t*_]*:[ \\t*_]*`, 'gim');
  const hits = [];
  for (let m = re.exec(src); m; m = re.exec(src)) hits.push({ label: m[1].toUpperCase(), start: m.index, end: re.lastIndex });
  const out = { lead: src.slice(0, hits.length ? hits[0].start : src.length).trim() };
  hits.forEach((h, k) => {
    if (!(h.label in out)) out[h.label] = src.slice(h.end, k + 1 < hits.length ? hits[k + 1].start : src.length).trim();
  });
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { distillPaperExcerpt, distillTrustFacts, distillParseLabelled };
}
```

- [ ] **Step 4: Run the tests and confirm they pass.**

Run: `npx vitest run tests/unit/paperHelp.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add extension/utils/paperHelp.js tests/unit/paperHelp.test.mjs
git commit -m "feat: paper excerpt, trust facts and labelled-output parsing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The `overview` task

**Files:**
- Modify: `extension/utils/prompts.js` (new case before `default:`), then `npm run sync:prompts`
- Modify: `backend/server.js:162-180` (`TASK_COSTS`, `TASK_MODEL_ROUTER`), `:202-224` (`AI_TUNING`)
- Modify: `extension/background.js:230-252` (`AI_TUNING`)
- Modify: `docs/api.md:290-298` (task table)
- Test: `tests/unit/prompts.test.mjs`

**Interfaces:**
- Produces: `distillBuildPrompt('overview', { title, level }, { excerpt })`. It asks for `ASKED/DID/FOUND/WHY/STUDY/LIMITS` labels.

- [ ] **Step 1: Write the failing test.** In `tests/unit/prompts.test.mjs`, add this to the `tasks` table:

```js
    overview: [{ title: 'T' }, { excerpt: 'EXC' }, ['T', 'EXC', 'ASKED:', 'DID:', 'FOUND:', 'WHY:', 'STUDY:', 'LIMITS:']],
```

Add this test as well:

```js
  it('overview trims the excerpt to 7,000 chars', () => {
    expect(text(distillBuildPrompt('overview', {}, { excerpt: 'x'.repeat(20000) })).length).toBeLessThan(8000);
  });
```

- [ ] **Step 2: Run the test and confirm it fails.**

Run: `npx vitest run tests/unit/prompts.test.mjs`
Expected: FAIL with "No prompt for task 'overview'".

- [ ] **Step 3: Implement the prompt.** Add this case to `distillBuildPrompt`, before `default:`:

```js
    case 'overview':
      return out(sys('Give them a plain overview of the whole paper.'), [
        `Paper title: ${title}`,
        `From the paper:\n\n${distillPromptClamp(i.excerpt, 7000)}`,
        'Answer with exactly these labels, each starting its own line, each followed by one short paragraph:\n' +
          'ASKED: the question the paper asks\n' +
          'DID: what the researchers did\n' +
          'FOUND: what they found\n' +
          'WHY: why it might matter to an ordinary person\n' +
          'STUDY: the kind of study and its size (people, samples or data), if the paper says\n' +
          'LIMITS: the limits the authors themselves mention, one per line starting with "- "; "- Not stated" if none\n' +
          'No other text. No markdown.'
      ]);
```

Run: `npm run sync:prompts`

- [ ] **Step 4: Register the task.**
  - `backend/server.js` `TASK_COSTS`: add `overview: 12`.
  - `TASK_MODEL_ROUTER`: add `overview: { primary: 'claude-haiku-4-5', fallback: 'claude-haiku-4-5' }`.
  - Both `AI_TUNING` tables: add `overview: 420` (balanced) and `overview: 300` (ultra-lean).
  - `extension/background.js` `AI_TUNING`: add the same two values.
  - `docs/api.md` task table: add the row `` | `overview` | 12 | `title`, `level` | `excerpt` | ``, and add `level` to the context column of every other row.

Smoke will fail ("TASK_COSTS key(s) unused") until Task 7 calls the task. Run only vitest for now.

- [ ] **Step 5: Run the test and confirm it passes.**

Run: `npx vitest run tests/unit/prompts.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit together with Task 7.** Don't commit yet: smoke is red until the task has a caller.

---

### Task 7: Run the overview in the service worker

**Files:**
- Create: `extension/paperFeatures.js`
- Modify: `extension/background.js`:
  - line 3 (`importScripts`)
  - the `PAPER_DETECTED` handler (~1084-1160)
  - `restoreState` (~2079)
  - `clearTab` (~412)
  - port switch (~975)
- Modify: `scripts/smoke.mjs` (source reads near the bottom)
- Modify: `eslint.config.mjs`, `package.json`

**Interfaces:**
- Consumes: `distillPaperExcerpt`, `distillTrustFacts` (Task 5).
- Consumes from `background.js`: `streamTask`, `toPanel`, `tabState`, `schedulePersistTab`, `readingLevel`.
- Produces: `queuePaperHelp(tabId, job)`, `streamPaperHelp(tabId, { kind, key, task, context, input }) → Promise<string>`, `runOverview(tabId)`, `paperHelpState(s)`, `publishPaperHelp(tabId)`, `clearPaperHelp(tabId)`.
- Produces: panel messages `PAPER_HELP_START {kind, key}`, `PAPER_HELP_CHUNK {kind, key, chunk}`, `PAPER_HELP_DONE {kind, key, text}`, `PAPER_HELP_ERROR {kind, key, code, message}`, `PAPER_HELP_STATE {overview, trustFacts, section, guides, glossary, askThread}`. All carry `tabId`.
- Produces: tab state fields `overview: {level, text} | null`, `guides: {}`, `glossary: []`, `askThread: []`.

- [ ] **Step 1: Create `extension/paperFeatures.js`:**

```js
'use strict';

// Paper help: overview + trust card, section guides with jargon, ask-the-paper.
// Loaded by background.js (importScripts) and uses its globals: tabState, toPanel, streamTask,
// schedulePersistTab, readingLevel. Only functions here — nothing runs at load time.

const paperHelpQueue = new Map(); // tabId -> tail of a promise chain: one paper-help call at a time per tab

function queuePaperHelp(tabId, job) {
  const next = (paperHelpQueue.get(tabId) || Promise.resolve()).then(job).catch(err => console.warn('Distill paper help', err));
  paperHelpQueue.set(tabId, next);
  return next;
}

/** Stream one task to the panel. Resolves with the trimmed text, or '' after an error. */
function streamPaperHelp(tabId, { kind, key, task, context, input }) {
  const s = tabState.get(tabId);
  return new Promise(resolve => {
    let text = '';
    let settled = false;
    const fail = err => {
      if (settled) return;
      settled = true;
      toPanel({ type: 'PAPER_HELP_ERROR', tabId, kind, key, code: err?.code, message: err?.message || String(err) });
      resolve('');
    };
    toPanel({ type: 'PAPER_HELP_START', tabId, kind, key });
    streamTask({
      tabId, task, s, context, input,
      noAuthMessage: 'No API key set — click ⚙ to add one.',
      onChunk: chunk => {
        text += chunk;
        toPanel({ type: 'PAPER_HELP_CHUNK', tabId, kind, key, chunk });
      },
      onDone: () => {
        if (settled) return;
        settled = true;
        toPanel({ type: 'PAPER_HELP_DONE', tabId, kind, key, text });
        resolve(text.trim());
      },
      onError: fail
    }).catch(fail);
  });
}

function paperHelpState(s) {
  return {
    overview: s.overview || null,
    trustFacts: s.paper ? distillTrustFacts(s.paper) : [],
    section: s.section?.heading || '',
    guides: s.guides || {},
    glossary: s.glossary || [],
    askThread: s.askThread || []
  };
}

function publishPaperHelp(tabId) {
  const s = tabState.get(tabId);
  if (s?.paper) toPanel({ type: 'PAPER_HELP_STATE', tabId, ...paperHelpState(s) });
}

/** Overview of the whole paper; skipped when one exists at the current reading level. */
function runOverview(tabId) {
  return queuePaperHelp(tabId, async () => {
    const s = tabState.get(tabId);
    if (!s?.paper) return;
    const level = await readingLevel();
    if (s.overview?.text && s.overview.level === level) return;
    const text = await streamPaperHelp(tabId, {
      kind: 'overview', key: 'overview', task: 'overview',
      context: { title: s.title || s.paper.title },
      input: { excerpt: distillPaperExcerpt(s.paper) }
    });
    if (!text || tabState.get(tabId) !== s) return; // failed, or the tab moved on
    s.overview = { level, text };
    schedulePersistTab(tabId);
  });
}

function clearPaperHelp(tabId) {
  paperHelpQueue.delete(tabId);
}
```

`streamTask` adds `level` to the context (Task 1), so it isn't passed here. If `streamTask` doesn't return a promise in some branch, `.catch` throws. Check that `streamTask` is `async`; it is, at line 2138.

- [ ] **Step 2: Wire it into `background.js`.**
  - **importScripts (line 3):** append `'utils/paperHelp.js', 'paperFeatures.js'`.
  - **Fresh paper (`PAPER_DETECTED`):** in the `tabState.set(tabId, { … })` object, add `overview: null, guides: {}, glossary: [], askThread: [],`. After the `toPanel({ type: 'ARTICLE_DETECTED', … })` that follows it, add:

```js
        publishPaperHelp(tabId);
        void runOverview(tabId);
```

  - **Saved-progress branch:** after `await restoreState(tabId);`, add `void runOverview(tabId);`.
  - **`hasSavedProgress` condition:** add `|| !!existing.overview || (Array.isArray(existing.askThread) && existing.askThread.length > 0)`. Without it, a reload throws the overview away and asks the AI again.
  - **`restoreState`:** right after its `toPanel({ type: 'ARTICLE_DETECTED', … })`, add `publishPaperHelp(tabId);`.
  - **`clearTab`:** add `clearPaperHelp(tabId);`.
  - **Port switch:** next to the other cases, add:

```js
      case 'RETRY_OVERVIEW':
        void (async () => {
          await ensureTabHydrated(msg.tabId);
          void runOverview(msg.tabId);
        })();
        break;
```

- [ ] **Step 3: Smoke reads the new files.** In `scripts/smoke.mjs`, replace the two source reads:

```js
const read = file => readFileSync(join(extRoot, file), 'utf8');
const bg = read('background.js') + read('paperFeatures.js');
const sp = read('sidepanel.js') + read('sidepanelPaper.js');
```

- [ ] **Step 4: Lint.**
  - `package.json` `lint`: add `extension/paperFeatures.js`.
  - `eslint.config.mjs`: add this block:

```js
  {
    files: ['extension/paperFeatures.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...extGlobals,
        tabState: 'readonly', toPanel: 'readonly', streamTask: 'readonly', schedulePersistTab: 'readonly',
        readingLevel: 'readonly', distillPaperExcerpt: 'readonly', distillTrustFacts: 'readonly',
        distillParseLabelled: 'readonly', distillParseTerms: 'readonly', distillFindSection: 'readonly',
        distillMergeGlossary: 'readonly', distillPickSections: 'readonly'
      }
    },
    rules: { 'no-unused-vars': 'off' }
  },
```

  - In the background/sidepanel block's globals, add `queuePaperHelp`, `runOverview`, `publishPaperHelp`, `clearPaperHelp`, `runSectionGuide`, `runAsk`, `onSectionChanged`, `resendTerms`, `handlePaperMessage`, `distillTrustFacts` and `distillParseLabelled`, each as `'readonly'`. The names used by later tasks are listed now so lint doesn't need editing again.

- [ ] **Step 5: Run the gate.**

Run: `npm run lint && npx vitest run && npm run smoke`
Expected:
- lint and vitest PASS.
- smoke FAILS, because the `PAPER_HELP_*` types have no panel case yet. This failure is expected and clears in Task 8, which adds the cases.

Go straight to Task 8 and commit Tasks 6–8 together.

---

### Task 8: Overview and trust cards in the panel

**Files:**
- Modify: `extension/sidepanel.html` (top of `#viewRead`)
- Modify: `extension/sidepanelPaper.js`
- Modify: `extension/sidepanel.js:1292-1295` (forward messages)

**Interfaces:**
- Consumes: `PAPER_HELP_*` messages (Task 7), `distillParseLabelled` (Task 5).
- Produces: `handlePaperMessage(msg)`, `renderAll()`, and `addText(parent, tag, text, className)` in `sidepanelPaper.js`.
- Produces: panel → background `RETRY_OVERVIEW {tabId}`.

- [ ] **Step 1: HTML.** Put this as the first children of `<div id="viewRead" class="panel-view">`:

```html
      <section id="overviewCard" class="section hidden" aria-live="polite">
        <h2 class="section-title">Overview</h2>
        <div id="overviewBody"></div>
        <p><span id="overviewStatus" class="status-badge"></span> <button id="overviewRetryBtn" type="button" class="paper-link-btn hidden">Retry</button></p>
      </section>
      <section id="trustCard" class="section hidden">
        <h2 class="section-title">How much to trust it</h2>
        <ul id="trustFacts" class="fact-tags"></ul>
        <p id="trustStudy"></p>
        <div id="trustLimits"></div>
        <p class="hint">A single study rarely settles a question.</p>
      </section>
```

- [ ] **Step 2: Forward port messages.** In `extension/sidepanel.js` `handleMessage`, right after the `if (msg.tabId && msg.tabId !== currentTabId) return;` line, add:

```js
  handlePaperMessage(msg);
```

- [ ] **Step 3: Render.** Append to `extension/sidepanelPaper.js`:

```js
const OVERVIEW_LABELS = ['ASKED', 'DID', 'FOUND', 'WHY', 'STUDY', 'LIMITS'];
const OVERVIEW_PARTS = [['ASKED', 'The question'], ['DID', 'What they did'], ['FOUND', 'What they found'], ['WHY', 'Why it matters']];

function sendPaper(msg) { port?.postMessage({ ...msg, tabId: currentTabId }); }

function addText(parent, tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  parent.append(node);
  return node;
}

function bulletLines(text) {
  return String(text || '').split('\n').map(l => l.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean);
}

function overviewText() {
  return paperView.streams['overview:overview'] ?? paperView.state?.overview?.text ?? '';
}

function renderOverview() {
  const text = overviewText();
  const body = $('overviewBody');
  body.replaceChildren();
  const parsed = distillParseLabelled(text, OVERVIEW_LABELS);
  const labelled = OVERVIEW_PARTS.filter(([k]) => parsed[k]);
  for (const [k, label] of labelled) {
    addText(body, 'h3', label, 'overview-label');
    addText(body, 'p', parsed[k]);
  }
  // A reply with no labels at all still shows, as one paragraph.
  if (!labelled.length && parsed.lead && !('overview:overview' in paperView.streams)) addText(body, 'p', parsed.lead);
  if (paperView.state) show($('overviewCard'));
  renderTrust(parsed);
}

function renderTrust(parsed) {
  const facts = paperView.state?.trustFacts || [];
  const list = $('trustFacts');
  list.replaceChildren();
  for (const f of facts) {
    const li = document.createElement('li');
    if (f.href) {
      const a = addText(li, 'a', f.text);
      a.href = f.href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    } else {
      li.textContent = f.text;
    }
    list.append(li);
  }
  $('trustStudy').textContent = parsed.STUDY ? `Study: ${parsed.STUDY}` : '';
  const limits = $('trustLimits');
  limits.replaceChildren();
  const items = bulletLines(parsed.LIMITS);
  if (items.length) {
    addText(limits, 'h3', 'Limits the authors mention', 'overview-label');
    const ul = addText(limits, 'ul', '');
    for (const t of items) addText(ul, 'li', t);
  }
  $('trustCard').classList.toggle('hidden', !facts.length);
}

function renderAll() {
  renderOverview();
}

function resetPaperView() {
  paperView.state = null;
  paperView.section = '';
  paperView.streams = {};
  for (const id of ['overviewCard', 'trustCard']) hide($(id));
}

function handlePaperMessage(msg) {
  const k = `${msg.kind}:${msg.key}`;
  switch (msg.type) {
    case 'PAPER_HELP_STATE':
      paperView.state = msg;
      paperView.section = msg.section || paperView.section;
      paperView.streams = {};
      renderAll();
      break;
    case 'PAPER_HELP_START':
      paperView.streams[k] = '';
      if (msg.kind === 'overview') {
        hide($('overviewRetryBtn'));
        setStatus('overviewStatus', '⟳ Reading the paper…', 'updating');
      }
      renderAll();
      break;
    case 'PAPER_HELP_CHUNK':
      paperView.streams[k] = (paperView.streams[k] || '') + msg.chunk;
      renderAll();
      break;
    case 'PAPER_HELP_DONE':
      if (msg.kind === 'overview') {
        delete paperView.streams[k];
        if (paperView.state) paperView.state.overview = { level: paperView.level, text: msg.text };
        setStatus('overviewStatus', '', '');
      } else {
        paperView.streams[k] = msg.text;
      }
      renderAll();
      break;
    case 'PAPER_HELP_ERROR':
      delete paperView.streams[k];
      if (msg.kind === 'overview') {
        setStatus('overviewStatus', msg.message || 'Something went wrong.', 'error');
        show($('overviewRetryBtn'));
      }
      renderAll();
      break;
    case 'ARTICLE_NAVIGATING':
    case 'NO_ARTICLE':
    case 'PDF_DETECTED':
      resetPaperView();
      renderAll();
      break;
  }
}

$('overviewRetryBtn').addEventListener('click', () => sendPaper({ type: 'RETRY_OVERVIEW' }));
```

`sidepanel.js` also has `case 'NO_ARTICLE':` and similar cases. That's fine: they sit in different `switch` statements, and smoke only needs each case to exist somewhere.

- [ ] **Step 4: Run the gate.**

Run: `npm test`
Expected: PASS, with smoke reporting that all toPanel types have cases.

- [ ] **Step 5: Check by hand in Chrome.** Load the extension. Add a Groq key, or point it at the dev backend. Open `https://arxiv.org/html/2310.06825`. Check that:
- the Overview card streams in under four headings;
- the trust card shows "Preprint — not yet peer-reviewed · Oct 2023 · N authors · DOI …";
- switching the level and reloading the page does not re-run the overview at the same level.

- [ ] **Step 6: Commit Tasks 6–8.**

```bash
git add extension/utils/prompts.js backend/lib/prompts.js backend/server.js extension/background.js extension/paperFeatures.js extension/sidepanel.html extension/sidepanel.js extension/sidepanelPaper.js scripts/smoke.mjs eslint.config.mjs package.json docs/api.md tests/unit/prompts.test.mjs
git commit -m "feat: automatic paper overview and trust card

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

# Phase 3 — Section guide, jargon and glossary

### Task 9: Term parsing, section lookup and glossary merge

**Files:**
- Modify: `extension/utils/paperHelp.js`
- Test: `tests/unit/paperHelp.test.mjs`

**Interfaces:**
- Produces: `distillParseTerms(block) → Array<{ term, definition }>`. At most 12; terms over 60 chars are dropped.
- Produces: `distillFindSection(paper, heading) → { heading, kind, text } | null`.
- Produces: `distillMergeGlossary(glossary, terms, section, max = 150) → Array<{ term, definition, section }>`. The first definition wins, matched case-insensitively.

- [ ] **Step 1: Write the failing tests.** Append to `tests/unit/paperHelp.test.mjs`:

```js
describe('distillParseTerms', () => {
  it('reads em dash, en dash, spaced hyphen and colon lines; strips list markers and bold', () => {
    const block = '- **attention** — a way to weigh words\n2. p-value: chance of a fluke\n• baseline – the thing compared against\nself-attention - attention within one sentence';
    expect(help.distillParseTerms(block)).toEqual([
      { term: 'attention', definition: 'a way to weigh words' },
      { term: 'p-value', definition: 'chance of a fluke' },
      { term: 'baseline', definition: 'the thing compared against' },
      { term: 'self-attention', definition: 'attention within one sentence' }
    ]);
  });
  it('keeps a leading number that is part of the term', () => {
    expect(help.distillParseTerms('3D printing — building objects layer by layer')[0].term).toBe('3D printing');
  });
  it('skips lines without a definition, terms over 60 chars, and stops at 12', () => {
    expect(help.distillParseTerms('no separator here\n' + 'x'.repeat(61) + ' — too long')).toEqual([]);
    const many = Array.from({ length: 20 }, (_, i) => `t${i} — d`).join('\n');
    expect(help.distillParseTerms(many).length).toBe(12);
    expect(help.distillParseTerms(undefined)).toEqual([]);
  });
});

describe('distillFindSection', () => {
  it('finds by heading, ignoring case and spaces; Abstract maps to the abstract', () => {
    expect(help.distillFindSection(paper(), '  methods ')).toEqual({ heading: 'Methods', kind: 'methods', text: 'METH' });
    expect(help.distillFindSection(paper(), 'Abstract').text).toBe(paper().abstract);
    expect(help.distillFindSection(paper(), 'Figure 2')).toBeNull();
    expect(help.distillFindSection(paper(), '')).toBeNull();
    expect(help.distillFindSection(null, 'Methods')).toBeNull();
  });
});

describe('distillMergeGlossary', () => {
  it('adds new terms with their section, keeps the first definition, caps the list', () => {
    let g = help.distillMergeGlossary([], [{ term: 'Attention', definition: 'first' }], 'Intro');
    g = help.distillMergeGlossary(g, [{ term: 'attention', definition: 'second' }, { term: 'loss', definition: 'error' }], 'Methods');
    expect(g).toEqual([
      { term: 'Attention', definition: 'first', section: 'Intro' },
      { term: 'loss', definition: 'error', section: 'Methods' }
    ]);
    const full = Array.from({ length: 150 }, (_, i) => ({ term: `t${i}`, definition: 'd', section: 's' }));
    expect(help.distillMergeGlossary(full, [{ term: 'new', definition: 'd' }], 's').length).toBe(150);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail.**

Run: `npx vitest run tests/unit/paperHelp.test.mjs`
Expected: FAIL with `help.distillParseTerms is not a function`.

- [ ] **Step 3: Implement.** Add this to `extension/utils/paperHelp.js`, before the `module.exports` guard:

```js
/** "term — definition" lines (also –, " - " and ":") from a TERMS: block. */
function distillParseTerms(block) {
  const terms = [];
  for (const line of String(block || '').split('\n')) {
    const m = /^\s*(?:[-*•]|\d+[.)])?\s*(.+?)\s*(?:—|–|:|\s-\s)\s*(.+)$/.exec(line);
    if (!m) continue;
    const term = m[1].replace(/[*_"]/g, '').trim();
    if (!term || term.length > 60) continue;
    terms.push({ term, definition: m[2].trim() });
    if (terms.length === 12) break;
  }
  return terms;
}

/** The paper section with this heading (case and spacing ignored); "Abstract" is the abstract. */
function distillFindSection(paper, heading) {
  const p = paper || {};
  const want = String(heading || '').trim().toLowerCase();
  if (!want) return null;
  if (want === 'abstract') return p.abstract ? { heading: 'Abstract', kind: '', text: p.abstract } : null;
  const s = (Array.isArray(p.sections) ? p.sections : []).find(x => String(x.heading).trim().toLowerCase() === want);
  return s ? { heading: s.heading, kind: s.kind, text: s.text } : null;
}

/** Add a section's terms to the glossary; the first definition of a term wins. */
function distillMergeGlossary(glossary, terms, section, max = 150) {
  const list = Array.isArray(glossary) ? glossary.slice() : [];
  const seen = new Set(list.map(g => g.term.toLowerCase()));
  for (const t of terms || []) {
    const key = t.term.toLowerCase();
    if (seen.has(key) || list.length >= max) continue;
    seen.add(key);
    list.push({ term: t.term, definition: t.definition, section });
  }
  return list;
}
```

Add `distillParseTerms, distillFindSection, distillMergeGlossary` to `module.exports`.

The leading `(?:[-*•]|\d+[.)])?` strips "2." but not the "3" in "3D". In "p-value: …", the lazy `(.+?)` reaches `:` before any `\s-\s`, so the term stays whole.

- [ ] **Step 4: Run the tests and confirm they pass.** Same command. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add extension/utils/paperHelp.js tests/unit/paperHelp.test.mjs
git commit -m "feat: parse jargon terms, find sections, merge the glossary

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The `section_guide` task

**Files:**
- Modify: `extension/utils/prompts.js`, then `npm run sync:prompts`
- Modify: `backend/server.js` (three tables), `extension/background.js` (`AI_TUNING`), `docs/api.md`
- Test: `tests/unit/prompts.test.mjs`

**Interfaces:**
- Produces: `distillBuildPrompt('section_guide', { title, section: {heading, kind}, level }, { sectionText })`. Output: 2–5 sentences, then a `TERMS:` block.

- [ ] **Step 1: Write the failing test.** Add to the `tasks` table:

```js
    section_guide: [{ title: 'T', section: { heading: 'Methods', kind: 'methods' } }, { sectionText: 'SEC' }, ['T', '"Methods"', 'SEC', 'TERMS:', 'up to 12']],
```

Add this test:

```js
  it('section_guide trims the section to 6,000 chars', () => {
    expect(text(distillBuildPrompt('section_guide', {}, { sectionText: 'x'.repeat(20000) })).length).toBeLessThan(7000);
  });
```

- [ ] **Step 2: Run the test and confirm it fails.**

Run: `npx vitest run tests/unit/prompts.test.mjs`
Expected: FAIL with "No prompt for task 'section_guide'".

- [ ] **Step 3: Implement.** Add this case to `distillBuildPrompt`:

```js
    case 'section_guide':
      return out(sys('Guide them through one section of the paper.'), [
        `Paper title: ${title}`,
        section,
        `Section text:\n\n${distillPromptClamp(i.sectionText, 6000)}`,
        'In 2-5 plain sentences, say what this section is doing and what to take from it. ' +
          'Then write a line "TERMS:" and list up to 12 technical words or phrases that appear in the section, ' +
          'copied exactly as written there, one per line as "term — short definition". No markdown.'
      ]);
```

Run: `npm run sync:prompts`

- [ ] **Step 4: Register the task.**
  - `TASK_COSTS`: `section_guide: 10`.
  - Router: `section_guide: { primary: 'claude-haiku-4-5', fallback: 'claude-haiku-4-5' }`.
  - Both `AI_TUNING` tables (backend and extension): `section_guide: 380` (balanced) and `260` (ultra-lean).
  - `docs/api.md` row: `` | `section_guide` | 10 | `title`, `section`, `level` | `sectionText` | ``.

- [ ] **Step 5: Run the test and confirm it passes.** Same command. Expected: PASS. Commit together with Task 12, once smoke has a caller.

---

### Task 11: Underline terms in the page

**Files:**
- Create: `extension/utils/termMarks.js`
- Create: `tests/front/termMarks.dom.test.mjs`
- Modify: `extension/content.js` (the `onMessage` switch at ~462, `injectStyles` at ~539)
- Modify: `extension/manifest.json:35` (content_scripts js), `extension/reader.html:45-47`
- Modify: `eslint.config.mjs`, `package.json`

**Interfaces:**
- Produces: `distillMarkTerms(elements: Element[], terms: Array<{term, definition}>) → number`. It returns how many marks were added.
- Produces: `distillUnmarkTerms(root: Element|Document)`.
- Produces: marks shaped as `<span class="distill-term" tabindex="0" data-term data-definition>`.
- Produces: content messages `SHOW_TERMS {heading, terms}`, `CLEAR_TERMS`, `SCROLL_TO_TERM {term}`.

- [ ] **Step 1: Write the failing tests.** Create `tests/front/termMarks.dom.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { distillMarkTerms, distillUnmarkTerms } = require('../../extension/utils/termMarks.js');

const dom = html => new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html').body.firstElementChild;
const T = [{ term: 'attention', definition: 'weighing words' }];

describe('distillMarkTerms', () => {
  it('wraps the first whole-word, case-insensitive match in each element', () => {
    const root = dom('<p>Attention is all. More attention.</p><p>No match: attentions.</p>');
    expect(distillMarkTerms([...root.querySelectorAll('p')], T)).toBe(1);
    const mark = root.querySelector('.distill-term');
    expect(mark.textContent).toBe('Attention');
    expect(mark.dataset.term).toBe('attention');
    expect(mark.dataset.definition).toBe('weighing words');
    expect(mark.tabIndex).toBe(0);
    expect(root.querySelectorAll('.distill-term').length).toBe(1);
  });
  it('skips links, code and math', () => {
    const root = dom('<p><a href="#">attention</a> <code>attention</code> then attention</p>');
    distillMarkTerms([root.querySelector('p')], T);
    const mark = root.querySelector('.distill-term');
    expect(mark.parentElement.tagName).toBe('P');
    expect(root.querySelector('a').textContent).toBe('attention');
  });
  it('is idempotent and treats the term as text, not a pattern', () => {
    const root = dom('<p>attention and attention</p><p>cost (USD) here</p>');
    const ps = [...root.querySelectorAll('p')];
    distillMarkTerms(ps, T);
    expect(distillMarkTerms(ps, T)).toBe(0);
    expect(root.querySelectorAll('.distill-term').length).toBe(1);
    expect(distillMarkTerms(ps, [{ term: 'cost (USD)', definition: 'd' }])).toBe(1);
  });
  it('unmark restores the original text as one text node', () => {
    const root = dom('<p>Some attention here.</p>');
    distillMarkTerms([root.querySelector('p')], T);
    distillUnmarkTerms(root);
    expect(root.querySelector('.distill-term')).toBeNull();
    expect(root.querySelector('p').textContent).toBe('Some attention here.');
    expect(root.querySelector('p').childNodes.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail.**

Run: `npx vitest run tests/front/termMarks.dom.test.mjs`
Expected: FAIL, because the module isn't found.

- [ ] **Step 3: Implement.** Create `extension/utils/termMarks.js`:

```js
'use strict';

// Underline jargon terms in the paper. Text nodes only — paper text and AI terms are untrusted.

const DISTILL_TERM_SKIP = 'a, code, pre, math, script, style, .distill-term';

function distillEscapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Wrap the first whole-word match of each term in each element. Returns the number of marks added. */
function distillMarkTerms(elements, terms) {
  let added = 0;
  for (const el of elements) {
    const doc = el.ownerDocument;
    for (const { term, definition } of terms) {
      const already = [...el.querySelectorAll('.distill-term')].some(s => s.dataset.term.toLowerCase() === term.toLowerCase());
      if (already) continue;
      const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${distillEscapeRegExp(term)})(?=$|[^\\p{L}\\p{N}])`, 'iu');
      const walker = doc.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.parentElement?.closest(DISTILL_TERM_SKIP)) continue;
        const m = re.exec(node.data);
        if (!m) continue;
        const hit = node.splitText(m.index + m[1].length);
        hit.splitText(m[2].length);
        const span = doc.createElement('span');
        span.className = 'distill-term';
        span.tabIndex = 0;
        span.dataset.term = term;
        span.dataset.definition = definition;
        hit.replaceWith(span);
        span.append(hit);
        added++;
        break;
      }
    }
  }
  return added;
}

function distillUnmarkTerms(root) {
  for (const span of root.querySelectorAll('.distill-term')) {
    const parent = span.parentNode;
    span.replaceWith(...span.childNodes);
    parent.normalize();
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { distillMarkTerms, distillUnmarkTerms };
}
```

- [ ] **Step 4: Run the tests and confirm they pass.** Same command. Expected: PASS.

- [ ] **Step 5: Load the file in pages.**
  - `manifest.json` content_scripts `js`: `["utils/articleExtractor.js", "utils/paperExtractor.js", "utils/termMarks.js", "content.js"]`.
  - `reader.html`: add `<script src="utils/termMarks.js"></script>` after `utils/pdfPaper.js`.

- [ ] **Step 6: Content-script messages and the hover card.** In `extension/content.js`, add these helpers next to `sectionOf`:

```js
  /** The tracked paragraphs between this section's h2 and the next one. */
  function sectionParagraphs(heading) {
    const want = String(heading || '').trim().toLowerCase();
    const i = sectionHeads.findIndex(h => distillCleanHeading(distillNodeText(h)).slice(0, 120).toLowerCase() === want);
    if (i === -1) return [];
    const start = sectionHeads[i];
    const end = sectionHeads[i + 1];
    return paragraphs.filter(p => (start.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING) &&
      (!end || (end.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_PRECEDING)));
  }

  let termCard = null;
  function showTermCard(span) {
    if (!termCard) {
      termCard = document.createElement('div');
      termCard.className = 'distill-term-card';
      termCard.setAttribute('role', 'tooltip');
      document.body.append(termCard);
    }
    termCard.textContent = `${span.dataset.term}: ${span.dataset.definition}`;
    const r = span.getBoundingClientRect();
    termCard.style.left = `${Math.max(8, Math.min(r.left, innerWidth - 300)) + scrollX}px`;
    termCard.style.top = `${r.bottom + scrollY + 6}px`;
    termCard.hidden = false;
  }
  const onTermPointer = e => {
    const span = e.target.closest?.('.distill-term');
    if (span) showTermCard(span);
    else if (termCard) termCard.hidden = true;
  };
  document.addEventListener('mouseover', onTermPointer);
  document.addEventListener('focusin', onTermPointer);
```

In the `chrome.runtime.onMessage` switch, add:

```js
      case 'SHOW_TERMS':
        distillMarkTerms(sectionParagraphs(msg.heading), Array.isArray(msg.terms) ? msg.terms : []);
        break;
      case 'CLEAR_TERMS':
        distillUnmarkTerms(document.body);
        if (termCard) termCard.hidden = true;
        break;
      case 'SCROLL_TO_TERM': {
        const want = String(msg.term || '').toLowerCase();
        const span = [...document.querySelectorAll('.distill-term')].find(s => s.dataset.term.toLowerCase() === want);
        if (span) {
          span.scrollIntoView({ behavior: 'smooth', block: 'center' });
          span.focus({ preventScroll: true });
        }
        break;
      }
```

In `injectStyles`, append inside the template string:

```css
      .distill-term { text-decoration: underline dotted; text-underline-offset: 3px; cursor: help; }
      .distill-term:focus { outline: 2px solid var(--air-a95); outline-offset: 1px; }
      .distill-term-card { position: absolute; z-index: 2147483647; max-width: 280px; padding: 8px 10px;
        background: #fff; color: #222; border: 1px solid rgba(0,0,0,.15); border-radius: 8px;
        box-shadow: 0 4px 16px rgba(0,0,0,.15); font: 13px/1.4 system-ui, sans-serif; }
```

The hover card is positioned with `left`/`top` styles only. The text goes in through `textContent`.

- [ ] **Step 7: Lint.**
  - `package.json` `lint`: add `extension/utils/termMarks.js`.
  - `eslint.config.mjs`: add `'extension/utils/termMarks.js'` to the utils block's `files`.
  - Add `distillMarkTerms: 'readonly', distillUnmarkTerms: 'readonly'` to the content.js block's globals.

- [ ] **Step 8: Run the gate, then commit.**

Run: `npx vitest run tests/front && npm run lint`
Expected: PASS.

```bash
git add extension/utils/termMarks.js tests/front/termMarks.dom.test.mjs extension/content.js extension/manifest.json extension/reader.html eslint.config.mjs package.json
git commit -m "feat: underline jargon terms in the paper with a definition card

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Section guides in the service worker

**Files:**
- Modify: `extension/paperFeatures.js`
- Modify: `extension/background.js`:
  - the `ACTIVE_PARAGRAPH` case (~1176)
  - the port switch
  - `clearTab`
  - the saved-progress branch of `PAPER_DETECTED`
  - a new `chrome.storage.onChanged` listener next to the other top-level listeners

**Interfaces:**
- Consumes: `distillFindSection`, `distillParseLabelled`, `distillParseTerms`, `distillMergeGlossary` (Tasks 5 and 9); `section_guide` (Task 10).
- Produces: `runSectionGuide(tabId, heading)`, `onSectionChanged(tabId, heading)`, `resendTerms(tabId)`.
- Produces: guides are stored under the heading the content script reports (`s.section.heading`), as `{ level, text, terms }`.
- Produces: panel messages `SECTION_CHANGED {heading, hasGuide}`; after a guide finishes, a fresh `PAPER_HELP_STATE`.
- Produces: panel → background `GUIDE_SECTION {tabId, heading}` and `SCROLL_TO_TERM {tabId, term}`.

- [ ] **Step 1: Append to `extension/paperFeatures.js`:**

```js
const GUIDE_DWELL_MS = 8000;
const guideDwellTimers = new Map(); // tabId -> timeout

function sendTerms(tabId, heading, terms) {
  if (terms?.length) chrome.tabs.sendMessage(tabId, { type: 'SHOW_TERMS', heading, terms }).catch(() => {});
}

/** Guide for one section; on success its terms are underlined in the page and added to the glossary. */
function runSectionGuide(tabId, heading) {
  return queuePaperHelp(tabId, async () => {
    const s = tabState.get(tabId);
    const section = s?.paper && distillFindSection(s.paper, heading);
    if (!section) {
      toPanel({ type: 'PAPER_HELP_ERROR', tabId, kind: 'guide', key: heading, code: 'NO_SECTION', message: 'No guide for this part.' });
      return;
    }
    const level = await readingLevel();
    if (s.guides?.[heading]?.level === level) return sendTerms(tabId, heading, s.guides[heading].terms);
    const text = await streamPaperHelp(tabId, {
      kind: 'guide', key: heading, task: 'section_guide',
      context: { title: s.title || s.paper.title, section: { heading: section.heading, kind: section.kind } },
      input: { sectionText: section.text }
    });
    if (!text || tabState.get(tabId) !== s) return;
    const terms = distillParseTerms(distillParseLabelled(text, ['TERMS']).TERMS);
    s.guides = { ...s.guides, [heading]: { level, text, terms } };
    s.glossary = distillMergeGlossary(s.glossary, terms, heading);
    schedulePersistTab(tabId);
    sendTerms(tabId, heading, terms);
    publishPaperHelp(tabId);
  });
}

/** The reader entered a new section: tell the panel, and guide it after GUIDE_DWELL_MS there. */
function onSectionChanged(tabId, heading) {
  clearTimeout(guideDwellTimers.get(tabId));
  const s = tabState.get(tabId);
  if (!s?.paper || !heading) return;
  toPanel({ type: 'SECTION_CHANGED', tabId, heading, hasGuide: !!s.guides?.[heading] });
  guideDwellTimers.set(tabId, setTimeout(async () => {
    guideDwellTimers.delete(tabId);
    const now = tabState.get(tabId);
    if (now?.section?.heading !== heading || !distillFindSection(now.paper, heading)) return;
    if (now.guides?.[heading]?.level === await readingLevel()) return;
    void runSectionGuide(tabId, heading);
  }, GUIDE_DWELL_MS));
}

/** Re-underline every stored guide's terms at the current level (after a page reload). */
async function resendTerms(tabId) {
  const s = tabState.get(tabId);
  const level = await readingLevel();
  for (const [heading, g] of Object.entries(s?.guides || {})) if (g.level === level) sendTerms(tabId, heading, g.terms);
}
```

In `clearPaperHelp`, add:

```js
  clearTimeout(guideDwellTimers.get(tabId));
  guideDwellTimers.delete(tabId);
```

- [ ] **Step 2: Wire it into `background.js`.**
  - **`ACTIVE_PARAGRAPH`:** replace the `st.section = …` line with:

```js
        if (st && msg.section && st.section?.heading !== msg.section) {
          st.section = { heading: msg.section, kind: distillSectionKind(msg.section) };
          onSectionChanged(tabId, msg.section);
        }
```

  - **Saved-progress branch of `PAPER_DETECTED`:** after `void runOverview(tabId);`, add `void resendTerms(tabId);`.
  - **Port switch:** add:

```js
      case 'GUIDE_SECTION':
        void (async () => {
          await ensureTabHydrated(msg.tabId);
          void runSectionGuide(msg.tabId, String(msg.heading || '').slice(0, 120));
        })();
        break;
      case 'SCROLL_TO_TERM':
        chrome.tabs.sendMessage(msg.tabId, { type: 'SCROLL_TO_TERM', term: String(msg.term || '') }).catch(() => {});
        break;
```

  - **Level change:** add this top-level listener:

```js
// Reading level changed: drop the page's underlines and re-run the overview for the paper in view.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.readingLevel) return;
  for (const [tabId, s] of tabState) {
    if (s?.paper) chrome.tabs.sendMessage(tabId, { type: 'CLEAR_TERMS' }).catch(() => {});
  }
  chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
    if (tab && tabState.get(tab.id)?.paper) void runOverview(tab.id);
  }).catch(() => {});
});
```

  - **`clearTab`** already calls `clearPaperHelp`. Nothing to add.

- [ ] **Step 3: Run the gate.**

Run: `npm test`
Expected: smoke FAILS on `SECTION_CHANGED` with no panel case. Task 13 adds the case. Go straight to Task 13 and commit Tasks 10, 12 and 13 together.

---

### Task 13: "You're in" card and the Glossary view

**Files:**
- Modify: `extension/sidepanel.html` (after `#trustCard`)
- Modify: `extension/sidepanelPaper.js`

**Interfaces:**
- Consumes: `SECTION_CHANGED`; `PAPER_HELP_*` with `kind: 'guide'`; `state.guides`, `state.glossary`.
- Produces: panel → background `GUIDE_SECTION` and `SCROLL_TO_TERM`.

- [ ] **Step 1: HTML.** After the `#trustCard` section, add:

```html
      <section id="guideCard" class="section hidden" aria-live="polite">
        <h2 class="section-title">You're in: <span id="guideHeading"></span></h2>
        <p id="guideBody"></p>
        <button id="guideBtn" type="button" class="paper-link-btn hidden">Guide this section</button>
        <button id="guideTermsBtn" type="button" class="paper-link-btn hidden"></button>
        <p><span id="guideStatus" class="status-badge"></span></p>
      </section>
```

- [ ] **Step 2: Render the guide and the glossary.** In `extension/sidepanelPaper.js`, add the code below. Then:
  - replace `renderAll` with the version below;
  - add `'guideCard'` to the ids hidden in `resetPaperView`.

```js
function renderGuide() {
  const heading = paperView.section;
  const card = $('guideCard');
  if (!heading || !paperView.state) return hide(card);
  show(card);
  $('guideHeading').textContent = heading;
  const stored = paperView.state.guides?.[heading];
  const current = stored?.level === paperView.level ? stored : null;
  const text = paperView.streams[`guide:${heading}`] ?? current?.text ?? '';
  $('guideBody').textContent = distillParseLabelled(text, ['TERMS']).lead;
  $('guideBtn').classList.toggle('hidden', !!text || `guide:${heading}` in paperView.streams);
  const n = current?.terms?.length || 0;
  $('guideTermsBtn').textContent = n === 1 ? '1 term in the Glossary' : `${n} terms in the Glossary`;
  $('guideTermsBtn').classList.toggle('hidden', !n);
}

function renderGlossary() {
  const items = [...(paperView.state?.glossary || [])]
    .sort((a, b) => a.term.localeCompare(b.term, undefined, { sensitivity: 'base' }));
  const list = $('glossaryList');
  list.replaceChildren();
  $('glossaryEmpty').classList.toggle('hidden', items.length > 0);
  for (const g of items) {
    const dt = document.createElement('dt');
    const btn = addText(dt, 'button', g.term, 'paper-link-btn');
    btn.type = 'button';
    btn.title = 'Show in the paper';
    btn.addEventListener('click', () => sendPaper({ type: 'SCROLL_TO_TERM', term: g.term }));
    list.append(dt);
    const dd = addText(list, 'dd', g.definition);
    addText(dd, 'span', ` · ${g.section}`, 'glossary-section');
  }
}

function renderAll() {
  renderOverview();
  renderGuide();
  renderGlossary();
}

$('guideBtn').addEventListener('click', () => sendPaper({ type: 'GUIDE_SECTION', heading: paperView.section }));
$('guideTermsBtn').addEventListener('click', () => setPanel('glossary'));
levelSelect.addEventListener('change', renderGuide);
```

In `handlePaperMessage`, add these cases:

```js
    case 'SECTION_CHANGED':
      paperView.section = msg.heading;
      setStatus('guideStatus', '', '');
      renderGuide();
      break;
```

Also add guide branches to the existing cases:
- `PAPER_HELP_START`: `if (msg.kind === 'guide') setStatus('guideStatus', '⟳ Reading this section…', 'updating');`
- `PAPER_HELP_DONE`: `if (msg.kind === 'guide') setStatus('guideStatus', '', '');`
- `PAPER_HELP_ERROR`: `if (msg.kind === 'guide') setStatus('guideStatus', msg.message || 'Something went wrong.', 'error');`

The guide button shows again after an error, so tapping it retries.

- [ ] **Step 3: Run the gate.**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Check by hand in Chrome** on the arXiv paper. Check that:
- staying in "Methods" for 8 s fills "You're in: Methods";
- terms show a dotted underline, and hovering or tabbing shows the card;
- the Glossary lists the terms A–Z, and clicking one scrolls the paper to it;
- switching the level clears the underlines, and the button offers a new guide.

Repeat in the PDF reader (`reader.html?src=https://arxiv.org/pdf/1810.04805`).

- [ ] **Step 5: Commit Tasks 10, 12 and 13.**

```bash
git add extension/utils/prompts.js backend/lib/prompts.js backend/server.js extension/background.js extension/paperFeatures.js extension/sidepanel.html extension/sidepanelPaper.js docs/api.md tests/unit/prompts.test.mjs
git commit -m "feat: section guides with jargon underlines and a glossary

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

# Phase 4 — Ask the paper

### Task 14: Pick the paragraphs that answer a question

**Files:**
- Modify: `extension/utils/paperHelp.js`
- Test: `tests/unit/paperHelp.test.mjs`

**Interfaces:**
- Produces: `distillPickSections(paper, question, maxChars = 5000) → Array<{ heading, text }>`. Paragraphs come back in paper order, grouped by section, with the abstract first.

- [ ] **Step 1: Write the failing tests.** Append to `tests/unit/paperHelp.test.mjs`:

```js
describe('distillPickSections', () => {
  const p = {
    abstract: 'We study sleep in mice.',
    sections: [
      { heading: 'Methods', kind: 'methods', text: 'Mice slept in cages.\n\nWe measured heart rate.' },
      { heading: 'Results', kind: 'results', text: 'Sleep improved memory.\n\nHeart rate fell during sleep.' },
      { heading: 'Funding', kind: '', text: 'Paid by a grant.' }
    ]
  };
  it('keeps relevant paragraphs, in paper order, grouped by section', () => {
    expect(help.distillPickSections(p, 'What happened to heart rate?')).toEqual([
      { heading: 'Methods', text: 'We measured heart rate.' },
      { heading: 'Results', text: 'Heart rate fell during sleep.' }
    ]);
  });
  it('heading words count, stopwords do not', () => {
    expect(help.distillPickSections(p, 'who paid the funding')[0].heading).toBe('Funding');
    expect(help.distillPickSections(p, 'what was the')).toEqual(help.distillPickSections(p, ''));
  });
  it('with no match, falls back to the opening paragraphs within the budget', () => {
    const r = help.distillPickSections(p, "What's the main takeaway?", 60);
    expect(r[0]).toEqual({ heading: 'Abstract', text: 'We study sleep in mice.' });
    expect(r.map(x => x.text).join('').length).toBeLessThanOrEqual(60);
  });
  it('respects the budget and never returns nothing for a non-empty paper', () => {
    const big = { abstract: 'heart '.repeat(2000), sections: [] };
    const r = help.distillPickSections(big, 'heart', 500);
    expect(r[0].text.length).toBeLessThanOrEqual(500);
    expect(help.distillPickSections({}, 'heart')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail.**

Run: `npx vitest run tests/unit/paperHelp.test.mjs`
Expected: FAIL with `help.distillPickSections is not a function`.

- [ ] **Step 3: Implement.** Add to `extension/utils/paperHelp.js`:

```js
const DISTILL_STOPWORDS = new Set(('the and for are was were with that this from what which who whom how why when where does did ' +
  'has have had can could would should will their they them into about than then there these those its not but you your ' +
  'our out all any been being more most some such only also very just over under paper study authors').split(' '));

function distillWords(text) {
  return (String(text || '').toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || []).filter(w => !DISTILL_STOPWORDS.has(w));
}

/**
 * Paragraphs most likely to answer the question (word overlap, +2 when the heading matches),
 * best first until maxChars, then put back in paper order. No match → the opening paragraphs.
 * ponytail: keyword overlap, not embeddings; swap in embeddings if answers miss obvious passages.
 */
function distillPickSections(paper, question, maxChars = 5000) {
  const p = paper || {};
  const q = new Set(distillWords(question));
  const sections = [...(p.abstract ? [{ heading: 'Abstract', text: p.abstract }] : []), ...(Array.isArray(p.sections) ? p.sections : [])];
  const paras = [];
  sections.forEach((s, si) => {
    const headingBonus = distillWords(s.heading).some(w => q.has(w)) ? 2 : 0;
    String(s.text || '').split('\n\n').forEach((raw, pi) => {
      const text = raw.trim();
      if (!text) return;
      const hits = distillWords(text).filter(w => q.has(w)).length;
      paras.push({ si, pi, text, score: hits ? hits + headingBonus : headingBonus });
    });
  });
  const ranked = paras.filter(x => x.score > 0).sort((a, b) => b.score - a.score);
  const pool = ranked.length ? ranked : paras;
  const chosen = [];
  let used = 0;
  for (const x of pool) {
    if (used + x.text.length > maxChars) continue;
    chosen.push(x);
    used += x.text.length;
  }
  if (!chosen.length && pool.length) chosen.push({ ...pool[0], text: pool[0].text.slice(0, maxChars) });
  chosen.sort((a, b) => a.si - b.si || a.pi - b.pi);
  const out = [];
  for (const x of chosen) {
    const heading = sections[x.si].heading;
    const last = out[out.length - 1];
    if (last && last.heading === heading) last.text += `\n\n${x.text}`;
    else out.push({ heading, text: x.text });
  }
  return out;
}
```

Add `distillPickSections` to `module.exports`.

- [ ] **Step 4: Run the tests and confirm they pass.** Same command. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add extension/utils/paperHelp.js tests/unit/paperHelp.test.mjs
git commit -m "feat: pick the paper paragraphs that match a question

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: The `ask` task and its runner

**Files:**
- Modify: `extension/utils/prompts.js`, then `npm run sync:prompts`
- Modify: `backend/server.js` (three tables), `extension/background.js` (`AI_TUNING`, port switch), `docs/api.md`
- Modify: `extension/paperFeatures.js`
- Test: `tests/unit/prompts.test.mjs`

**Interfaces:**
- Consumes: `distillPickSections` (Task 14).
- Produces: `distillBuildPrompt('ask', { title, abstract, thread, level }, { question, excerpts })`. Output: the answer, an optional `BACKGROUND:` line, then a `FROM:` line.
- Produces: `runAsk(tabId, question)`. `askThread` entries are `{ q, a }`, at most 20. The stream key is the entry's index, as a string.
- Produces: panel → background `ASK_PAPER {tabId, question}`.

- [ ] **Step 1: Write the failing tests.** Add to the `tasks` table:

```js
    ask: [{ title: 'T', abstract: 'ABS', thread: [{ q: 'OLDQ', a: 'OLDA' }] }, { question: 'Q?', excerpts: [{ heading: 'Results', text: 'RES' }] },
      ['T', 'ABS', 'OLDQ', 'OLDA', 'Q?', '[Results]', 'RES', 'BACKGROUND:', 'FROM:', "doesn't say"]],
```

Add this test:

```js
  it('ask keeps only the last 3 turns and trims excerpts', () => {
    const thread = Array.from({ length: 6 }, (_, i) => ({ q: `q${i}`, a: `a${i}` }));
    const t = text(distillBuildPrompt('ask', { thread }, { question: 'x', excerpts: [{ heading: 'H', text: 'e'.repeat(20000) }] }));
    expect(t).not.toContain('q2');
    expect(t).toContain('q3');
    expect(t.length).toBeLessThan(8000);
  });
```

- [ ] **Step 2: Run the tests and confirm they fail.**

Run: `npx vitest run tests/unit/prompts.test.mjs`
Expected: FAIL with "No prompt for task 'ask'".

- [ ] **Step 3: Implement the prompt.** Add this case:

```js
    case 'ask': {
      const thread = (Array.isArray(c.thread) ? c.thread : []).slice(-3)
        .map(t => `Q: ${distillPromptClamp(t?.q, 300)}\nA: ${distillPromptClamp(t?.a, 600)}`).join('\n\n');
      const excerpts = (Array.isArray(i.excerpts) ? i.excerpts : []).slice(0, 20)
        .map(e => `[${distillPromptClamp(e?.heading, 120)}]\n${distillPromptClamp(e?.text, 5000)}`).join('\n\n');
      return out(sys('Answer their question about this paper.'), [
        `Paper title: ${title}`,
        `Abstract:\n\n${distillPromptClamp(c.abstract, 800) || '(not available)'}`,
        thread ? `Earlier questions:\n\n${thread}` : null,
        `Parts of the paper:\n\n${distillPromptClamp(excerpts, 5200) || '(none found)'}`,
        `Question: "${distillPromptClamp(i.question, 500)}"\n\n` +
          'Answer in 2-5 plain sentences using only the parts above. If they do not answer it, say the paper doesn\'t say. ' +
          'If general knowledge outside the paper would help, add one line starting "BACKGROUND:". ' +
          'End with a line "FROM:" listing the section names (in brackets above) you used. No markdown.'
      ]);
    }
```

Run: `npm run sync:prompts`

- [ ] **Step 4: Register the task.**
  - `TASK_COSTS`: `ask: 10`.
  - Router: `ask: { primary: 'claude-haiku-4-5', fallback: 'claude-haiku-4-5' }`.
  - Both `AI_TUNING` tables: `ask: 320` (balanced) and `220` (ultra-lean).
  - `docs/api.md` row: `` | `ask` | 10 | `title`, `abstract`, `thread`, `level` | `question`, `excerpts` | ``.

- [ ] **Step 5: Runner.** Append to `extension/paperFeatures.js`:

```js
const ASK_THREAD_MAX = 20;

/** Answer a question from the paper. The question shows in the thread at once; the answer streams in. */
function runAsk(tabId, question) {
  const s = tabState.get(tabId);
  const q = String(question || '').trim().slice(0, 500);
  if (!q || !s?.paper) return;
  const entry = { q, a: '' };
  s.askThread = [...(s.askThread || []), entry].slice(-ASK_THREAD_MAX);
  publishPaperHelp(tabId);
  return queuePaperHelp(tabId, async () => {
    const earlier = s.askThread.filter(e => e !== entry && e.a).slice(-3);
    const text = await streamPaperHelp(tabId, {
      kind: 'ask', key: String(s.askThread.indexOf(entry)), task: 'ask',
      context: { title: s.title || s.paper.title, abstract: s.paper.abstract || '', thread: earlier },
      input: { question: q, excerpts: distillPickSections(s.paper, q) }
    });
    if (text) entry.a = text;
    else s.askThread = s.askThread.filter(e => e !== entry); // failed: the panel keeps the question for Retry
    schedulePersistTab(tabId);
    publishPaperHelp(tabId);
  });
}
```

In the `background.js` port switch, add:

```js
      case 'ASK_PAPER':
        void (async () => {
          await ensureTabHydrated(msg.tabId);
          void runAsk(msg.tabId, msg.question);
        })();
        break;
```

- [ ] **Step 6: Run the tests.**

Run: `npx vitest run tests/unit/prompts.test.mjs && npm run lint`
Expected: PASS. Commit together with Task 16.

---

### Task 16: The Ask view

**Files:**
- Modify: `extension/sidepanelPaper.js`

**Interfaces:**
- Consumes: `state.askThread`; `PAPER_HELP_*` with `kind: 'ask'`.

- [ ] **Step 1: Implement.** Add to `extension/sidepanelPaper.js`, then add `renderAsk();` to `renderAll`:

```js
let lastAskQuestion = '';

function renderAsk() {
  const thread = paperView.state?.askThread || [];
  const box = $('askThread');
  box.replaceChildren();
  thread.forEach((entry, i) => {
    const item = addText(box, 'div', '', 'ask-item');
    addText(item, 'p', entry.q, 'ask-q');
    const text = paperView.streams[`ask:${i}`] ?? entry.a;
    const parsed = distillParseLabelled(text || '', ['BACKGROUND', 'FROM']);
    addText(item, 'p', parsed.lead || '…', 'ask-a');
    if (parsed.BACKGROUND) addText(item, 'p', `Background: ${parsed.BACKGROUND}`, 'ask-meta');
    if (parsed.FROM) addText(item, 'p', `From: ${parsed.FROM}`, 'ask-meta');
  });
  $('askStarters').classList.toggle('hidden', thread.length > 0);
  box.lastElementChild?.scrollIntoView({ block: 'nearest' });
}

function askPaper(question) {
  const q = question.trim();
  if (!q) return;
  if (!paperView.state) return setStatus('askStatus', 'Open a research paper to ask about it.', 'error');
  lastAskQuestion = q;
  hide($('askRetryBtn'));
  setStatus('askStatus', '', '');
  sendPaper({ type: 'ASK_PAPER', question: q });
}

$('askForm').addEventListener('submit', e => {
  e.preventDefault();
  askPaper($('askInput').value);
  $('askInput').value = '';
});
$('askInput').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    $('askForm').requestSubmit();
  }
});
for (const btn of document.querySelectorAll('.ask-starter')) btn.addEventListener('click', () => askPaper(btn.textContent));
$('askRetryBtn').addEventListener('click', () => askPaper(lastAskQuestion));
```

In `handlePaperMessage`'s `PAPER_HELP_ERROR` case, add:

```js
      if (msg.kind === 'ask') {
        setStatus('askStatus', msg.message || 'Something went wrong.', 'error');
        show($('askRetryBtn'));
      }
```

- [ ] **Step 2: Run the gate.**

Run: `npm test`
Expected: PASS. Smoke now sees `overview`, `section_guide` and `ask` in both TASK_COSTS and the background sources.

- [ ] **Step 3: Check by hand in Chrome.** On the arXiv paper, open Ask and tap "How sure are the authors?". Check that:
- the question shows at once and the answer streams below it;
- "From: …" names real section headings;
- a question the paper can't answer ("What is the capital of France?") gets "the paper doesn't say".

- [ ] **Step 4: Commit Tasks 15 and 16.**

```bash
git add extension/utils/prompts.js backend/lib/prompts.js backend/server.js extension/background.js extension/paperFeatures.js extension/sidepanelPaper.js docs/api.md tests/unit/prompts.test.mjs
git commit -m "feat: ask the paper, with answers sourced to its sections

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

# Phase 5 — Persistence, docs, full check

### Task 17: Keep paper help across reloads and worker restarts

**Files:**
- Modify: `extension/utils/pageStore.js` (caps, `distillBuildPageStatePayload`, `distillPagePayloadToState`, `distillHistoryPayloadToState`)
- Modify: `extension/background.js` (`tabSnapshotPayload` ~439, `snapshotToState` ~494)
- Test: `tests/unit/pageStore.test.mjs`

**Interfaces:**
- Produces: page snapshots carry `overview`, `guides`, `glossary` and `askThread`, with the caps below.
  - overview text: 3,500 chars
  - guides: 30 entries, each text 2,500 chars and 12 terms
  - glossary: 150 entries
  - askThread: 20 entries, `q` 500 chars, `a` 2,500 chars

- [ ] **Step 1: Write the failing tests.** Add to `tests/unit/pageStore.test.mjs`:

```js
describe('paper help fields', () => {
  it('round-trip with caps', () => {
    const guides = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`H${i}`, { level: 'everyday', text: 'g'.repeat(9000), terms: new Array(20).fill({ term: 't', definition: 'd' }) }]));
    const p = distillBuildPageStatePayload({
      overview: { level: 'simple', text: 'o'.repeat(9000) },
      guides,
      glossary: new Array(200).fill({ term: 't', definition: 'd', section: 's' }),
      askThread: Array.from({ length: 30 }, (_, i) => ({ q: `q${i}`.padEnd(900, 'q'), a: 'a'.repeat(9000) }))
    }, 1);
    expect(p.overview).toEqual({ level: 'simple', text: 'o'.repeat(3500) });
    expect(Object.keys(p.guides).length).toBe(30);
    expect(p.guides.H0.text.length).toBe(2500);
    expect(p.guides.H0.terms.length).toBe(12);
    expect(p.glossary.length).toBe(150);
    expect(p.askThread.length).toBe(20);
    expect(p.askThread[19].q.startsWith('q29')).toBe(true); // newest kept
    expect(p.askThread[0].q.length).toBe(500);
    expect(p.askThread[0].a.length).toBe(2500);
    const s = distillPagePayloadToState(p);
    expect(s.overview).toEqual(p.overview);
    expect(s.guides).toEqual(p.guides);
    expect(s.glossary).toEqual(p.glossary);
    expect(s.askThread).toEqual(p.askThread);
  });
  it('defaults when missing (old snapshots, legacy history)', () => {
    const empty = { overview: null, guides: {}, glossary: [], askThread: [] };
    const p = distillBuildPageStatePayload({}, 1);
    expect({ overview: p.overview, guides: p.guides, glossary: p.glossary, askThread: p.askThread }).toEqual(empty);
    const s = distillPagePayloadToState({ v: 1 });
    expect({ overview: s.overview, guides: s.guides, glossary: s.glossary, askThread: s.askThread }).toEqual(empty);
    const h = distillHistoryPayloadToState({});
    expect({ overview: h.overview, guides: h.guides, glossary: h.glossary, askThread: h.askThread }).toEqual(empty);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail.**

Run: `npx vitest run tests/unit/pageStore.test.mjs`
Expected: FAIL, because `p.overview` is `undefined`.

- [ ] **Step 3: Implement in `pageStore.js`.** Next to the other caps, add:

```js
const DISTILL_CAP_OVERVIEW_CHARS = 3500;
const DISTILL_CAP_GUIDES = 30;
const DISTILL_CAP_GUIDE_CHARS = 2500;
const DISTILL_CAP_GLOSSARY = 150;
const DISTILL_CAP_ASK_THREAD = 20;
const DISTILL_CAP_ASK_CHARS = 2500;

/** Overview, guides, glossary and ask thread, capped for storage. */
function distillPaperHelpFields(src) {
  const s = src || {};
  const guides = {};
  for (const [heading, g] of Object.entries(s.guides && typeof s.guides === 'object' ? s.guides : {}).slice(0, DISTILL_CAP_GUIDES)) {
    guides[heading] = {
      level: (g && g.level) || 'everyday',
      text: distillClampString(g && g.text, DISTILL_CAP_GUIDE_CHARS),
      terms: distillClampList(g && g.terms, 12)
    };
  }
  const o = s.overview;
  return {
    overview: o && typeof o === 'object' ? { level: o.level || 'everyday', text: distillClampString(o.text, DISTILL_CAP_OVERVIEW_CHARS) } : null,
    guides,
    glossary: distillClampList(s.glossary, DISTILL_CAP_GLOSSARY),
    askThread: (Array.isArray(s.askThread) ? s.askThread : []).slice(-DISTILL_CAP_ASK_THREAD)
      .map(e => ({ q: distillClampString(e && e.q, 500), a: distillClampString(e && e.a, DISTILL_CAP_ASK_CHARS) }))
  };
}
```

Then spread `...distillPaperHelpFields(src)` at the end of the object returned by `distillBuildPageStatePayload`. Spread `...distillPaperHelpFields(payload)` at the end of `distillPagePayloadToState`'s return. Spread `...distillPaperHelpFields(null)` at the end of `distillHistoryPayloadToState`'s return.

- [ ] **Step 4: The session snapshot in `background.js`.** In `tabSnapshotPayload`'s object, add:

```js
    overview: s.overview || null,
    guides: s.guides || {},
    glossary: s.glossary || [],
    askThread: s.askThread || [],
```

In `snapshotToState`'s returned object, add:

```js
    overview: snap.overview || null,
    guides: snap.guides && typeof snap.guides === 'object' ? snap.guides : {},
    glossary: Array.isArray(snap.glossary) ? snap.glossary : [],
    askThread: Array.isArray(snap.askThread) ? snap.askThread : [],
```

- [ ] **Step 5: Run the gate.**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add extension/utils/pageStore.js extension/background.js tests/unit/pageStore.test.mjs
git commit -m "feat: keep overview, guides, glossary and questions across reloads

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Docs

**Files:**
- Modify: `README.md`, `docs/STORE_LISTING.md`, `docs/api.md`

- [ ] **Step 1: `README.md` features list.** Replace the "Explain this paper" bullet with these four bullets:

```markdown
- **Overview and trust check** — when a paper opens: the question, what they did, what they found, why it matters; plus preprint/journal, date, authors, DOI, study size and the authors' own limits.
- **Section guide** — after a few seconds in a section (or on tap), a plain guide to it; its jargon gets a dotted underline with a definition on hover, and lands in the Glossary tab.
- **Reading level** — Simple, Everyday or Closer to the paper, for every explanation.
- **Ask the paper** — questions answered from the paper, naming the sections used; outside knowledge is marked "Background".
```

Remove the Alt+Shift+E shortcut wherever shortcuts are listed.

- [ ] **Step 2: `docs/STORE_LISTING.md`.** Rewrite the feature bullets in the detailed description to match. Drop "Explain this paper" and its shortcut. Add one reviewer note: "Ask, guides and the overview send only excerpts of the open paper to the AI provider the user chose."

- [ ] **Step 3: `docs/api.md`.** Check that the task table has exactly these rows: `now`, `summary`, `quiz_question`, `quiz_feedback`, `quiz_skipped_review`, `analysis`, `overview`, `section_guide`, `ask`. Every row except `ask` lists `level` in its context; `ask` has it already.

- [ ] **Step 4: Run the gate, then commit.**

Run: `npm test`
Expected: PASS. If `scripts/check-api-doc.mjs` runs from `npm test`, it checks the table too.

```bash
git add README.md docs/STORE_LISTING.md docs/api.md
git commit -m "docs: overview, section guides, glossary, reading level and ask

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 19: Full check in real Chrome

**Files:**
- Create: `<scratchpad>/pw/part3-check.mjs`. This is a throwaway script, not committed. It uses the playwright-core and Chrome for Testing setup from Part 2.

The AI is stubbed so the check is free and repeatable.

- [ ] **Step 1: Write the script.**
  1. Launch Chrome for Testing with `--disable-extensions-except=<ext> --load-extension=<ext>`, in a persistent context with a fresh profile.
  2. Get the service worker (`context.serviceWorkers()[0]` or `waitForEvent('serviceworker')`) and the extension ID from `sw.url()`.
  3. In the worker, record panel traffic and stub the model:

```js
await sw.evaluate(() => {
  self.__msgs = [];
  const realToPanel = self.toPanel;
  self.toPanel = m => { self.__msgs.push(m); realToPanel(m); };
  const canned = {
    overview: 'ASKED: Can a small model match big ones?\nDID: They trained a 7B model.\nFOUND: It beat larger models on tests.\nWHY: Cheaper AI.\nSTUDY: Benchmarks on public datasets.\nLIMITS:\n- Only English tests\n- No safety review',
    section_guide: 'This part explains how the model is built.\nTERMS:\nattention — a way for the model to weigh words\ntransformer — the kind of network used',
    ask: 'They are fairly confident but test only on benchmarks.\nBACKGROUND: Benchmarks can overstate real-world use.\nFROM: Results, Conclusion'
  };
  self.streamTask = async ({ task, onChunk, onDone }) => {
    for (const part of canned[task].match(/[\s\S]{1,20}/g)) { onChunk(part); await new Promise(r => setTimeout(r, 5)); }
    onDone();
  };
});
```

  4. Open `https://arxiv.org/html/2310.06825` in one tab. Open `chrome-extension://<id>/sidepanel.html` in a second tab as the panel. Its port connects and filters by tab, so set its `currentTabId` with `page.evaluate(id => wireActiveTab(id), tabId)`.
  5. Assert each item, using `page.textContent` / `page.$$eval`:
     - Overview card shows "The question … What they did … What they found … Why it matters".
     - Trust tags include "Preprint — not yet peer-reviewed" and "Oct 2023".
     - Limits list has 2 items.
     - Scrolling the paper into the section after the introduction ("Architectural details") and waiting 9 s gives a `__msgs` entry `PAPER_HELP_DONE` with `kind: 'guide'`.
     - The paper then has ≥ 1 `.distill-term`, and its hover shows `.distill-term-card` containing "weigh words".
     - The Glossary tab lists "attention" and "transformer", A–Z. Clicking "attention" moves the page `scrollY`.
     - Level → "Simple": `.distill-term` count goes to 0, and a new `PAPER_HELP_START` arrives with `kind: 'overview'`.
     - Ask → "How sure are the authors?" shows the answer, "Background: …" and "From: Results, Conclusion".
     - Reloading the paper tab restores the thread, glossary and overview without a new `PAPER_HELP_START` for `overview` at the same level.
  6. Repeat the overview, guide and underline checks on `chrome-extension://<id>/reader.html?src=https://arxiv.org/pdf/1810.04805`.
  7. Fail on any `console.error` from the page, panel or worker.

- [ ] **Step 2: Run the script.**

Run: `node <scratchpad>/pw/part3-check.mjs`
Expected: every assertion prints `ok`, and the run exits 0. Save one panel screenshot each for the Read, Ask and Glossary tabs, and send them to the user.

- [ ] **Step 3: One live call (optional, needs a key).** Remove the stub and run the overview once against Groq's free tier. Confirm the labels parse. If the 8B model drops labels, the raw-text fallback should still show a paragraph. Note the result in the wrap-up. Don't change prompts to chase a single run.

- [ ] **Step 4: Fix and commit.** Fix anything the check found in its own commit, each with a test where one is possible.

---

## Self-review against the spec

| Spec item | Task |
|---|---|
| Overview + trust run once on open | 7 (runOverview on detect; skipped when present at level), 8 |
| Guide after ~8 s in a section or on tap | 12 (`GUIDE_DWELL_MS`, `GUIDE_SECTION`), 13 |
| Trust facts, no outside lookups | 5 (`distillTrustFacts`), 8 |
| Three levels, every task | 1 (persona + `streamTask` injects level), 3 (switch), 12 (level change) |
| Jargon underlines + hover/focus card + Glossary | 9, 11, 12, 13 |
| Ask from the paper, Background/From lines, "doesn't say" | 14, 15, 16 |
| Tabs Read · Ask · Glossary; ⚙ for Settings; level in header | 3 |
| Labelled text, lenient parsing, streams | 5 (`distillParseLabelled`), 8/13/16 parse on each chunk |
| Explain this page removed | 2 |
| Excerpt budgets 7,000 / 6,000 / 5,000 | 5, 6, 10, 14, 15 |
| One paper-help call at a time per tab | 7 (`queuePaperHelp`) |
| textContent only | 8, 11, 13, 16 (tests build fixtures with DOMParser) |
| `date` field; arXiv date from DOI | 4, 5 |
| New tasks in TASK_COSTS / router / AI_TUNING ×2 / api.md | 6, 10, 15, 18 |
| `distillFindSection`, Abstract mapping, "No guide for this part" | 9, 12 |
| Glossary first-definition-wins, max 150; askThread max 20 | 9 (`distillMergeGlossary`), 15, 17 |
| Persisted in session snapshot + page state with caps | 17 |
| Messages table | 7, 8, 12, 13, 15 (+ `SCROLL_TO_TERM` panel → bg, added in 12) |
| Errors: card-level message + Retry; missing labels; no terms | 8 (overview retry, raw-text fallback), 13 (guide button returns), 16 (ask retry), 11 (no terms → no marks) |
| Tests listed in the spec | 1, 2, 5, 9, 11, 14, 15, 17; smoke 7; Chrome 19 |
| Docs (README, api.md, store listing) | 18 |

**Additions to the spec:**
- `distillMergeGlossary` is a pure helper, so "first definition wins" can be tested.
- Panel → background `SCROLL_TO_TERM`: the panel can't message the page directly.
- `resendTerms` re-underlines after a reload.
- The `hasSavedProgress` check counts the overview and the ask thread, so a reload doesn't pay for a new overview.
- The `cacheFirst` prompt-caching flag is dropped along with `explain_page`, its only user.

**Commits that wait for the next task:** Tasks 6, 10 and 15 commit together with the task that adds the first caller. Smoke requires every `TASK_COSTS` key to be used by the background, so they can't be committed alone.
