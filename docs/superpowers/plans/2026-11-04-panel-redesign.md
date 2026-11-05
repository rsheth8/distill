# Part 2 Panel Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework Distill's side panel for papers: remove article-era features, add a sticky section map with tap-to-jump, group "So far" by section, and give the panel and PDF reader one paper-and-ink look.

**Architecture:** Pure logic goes in `extension/utils/paperHelp.js` (section map model, bullet grouping) and a new DOM-only `extension/utils/sectionMap.js` (renderer), both unit tested. `sidepanelPaper.js` wires them to port messages. The background adds `sections` to `PAPER_HELP_STATE`, tags summary bullets with their section, and forwards `JUMP_TO_SECTION` to the content script. Styling moves to a shared `extension/tokens.css`.

**Tech Stack:** Vanilla JS, Chrome MV3, Vitest (node + happy-dom projects), ESLint.

**Spec:** `docs/superpowers/specs/2026-11-04-panel-redesign-design.md`

## Global Constraints

- No new npm dependencies; no remote code (MV3). Icons are inline SVG paths from Lucide (ISC licence).
- Paper text and AI output go into the DOM with `textContent` or text nodes only — never `innerHTML`.
- Copy is sentence case, no emoji, no "!" in system copy.
- Every new `extension/**/*.js` file is added to the `lint` script in `package.json`.
- `npm test` (lint + smoke + coverage) passes at the end of every task.
- Element IDs named in the spec's "Removed" list must not appear in `sidepanel.html`, `sidepanel.js` or `sidepanelPaper.js` after Task 3.
- Old storage keys (`readerMode`, `aiMode`, `autoNowMode`, `autoResumeAfterQuiz`) are left in storage, just no longer read.

## File map

| File | Change |
|---|---|
| `extension/tokens.css` | Create: paper-and-ink colour tokens, light and dark |
| `extension/utils/sectionMap.js` | Create: `distillRenderSectionMap(container, segments, onJump)` |
| `extension/utils/paperHelp.js` | Add `distillSectionMap`, `distillGroupBullets`, `distillBulletKey` |
| `extension/utils/pageStore.js` | Persist `bulletSections` |
| `extension/paperFeatures.js` | `sections` in `paperHelpState` |
| `extension/background.js` | Tag bullets; `JUMP_TO_SECTION`; remove now-tip, reader mode, teleprompter routing |
| `extension/content.js` | `SCROLL_TO_SECTION`; `ink` accent; marker style; remove word scroll |
| `extension/sidepanel.html/.css/.js` | Layout, cuts, icons, onboarding, settings groups |
| `extension/sidepanelPaper.js` | Paper card, section map, grouped So far, selection card |
| `extension/reader.html` | Link `tokens.css`, toolbar pill style |
| `tests/unit/paperHelp.test.mjs`, `tests/unit/pageStore.test.mjs`, `tests/front/sectionMap.dom.test.mjs`, `scripts/smoke.mjs` | Tests |

---

### Task 1: Sync Part 3 and shared tokens

**Files:**
- Create: `extension/tokens.css`
- Modify: `extension/sidepanel.css` (`:root` and dark `:root` blocks at the top), `extension/sidepanel.html` (`<head>`), `extension/reader.html` (`<head>` `<style>` `:root` lines, `#toolbar button` rules)

**Interfaces:**
- Produces: CSS custom properties `--paper-bg`, `--paper`, `--ink`, `--ink-muted`, `--paper-line`, `--marker` on `:root`, used by every later task.

- [ ] **Step 1: Merge the finished Part 3 and check the baseline**

Only start once the paper branch's Part 3 plan (`docs/superpowers/plans/2026-11-04-explanation-features.md`) has all phases committed.

```bash
git merge --no-edit refs/heads/claude/project-catch-up-afb980
npm ci && (cd backend && npm ci)
npm test
```
Expected: merge succeeds (resolve any conflict by keeping both sides), `npm test` passes. If a function or element ID this plan names no longer exists, stop and report it rather than guessing.

- [ ] **Step 2: Create `extension/tokens.css`**

```css
/* Paper and ink: shared by the side panel and the PDF reader. */
:root {
  color-scheme: light dark;
  --paper-bg:   #e8e6e1;
  --paper:      #faf9f6;
  --ink:        #2b2a27;
  --ink-muted:  #6b6860;
  --paper-line: #d4d1c9;
  --marker:     rgba(250, 204, 21, 0.38);
}

@media (prefers-color-scheme: dark) {
  :root {
    --paper-bg:   #1f1e1c;
    --paper:      #272624;
    --ink:        #ece9e2;
    --ink-muted:  #a29e94;
    --paper-line: #3a3835;
    --marker:     rgba(250, 204, 21, 0.28);
  }
}
```

- [ ] **Step 3: Point the panel's colour names at the tokens**

In `extension/sidepanel.html` add before the existing stylesheet link:

```html
<link rel="stylesheet" href="tokens.css" />
```

In `extension/sidepanel.css`, replace the colour lines of the light `:root` block (keep the accent and font lines) with:

```css
  --bg:          var(--paper-bg);
  --bg-surface:  var(--paper);
  --bg-elevated: color-mix(in srgb, var(--paper-line) 45%, var(--paper));
  --border-sub:  var(--paper-line);
  --border-mid:  color-mix(in srgb, var(--paper-line) 70%, var(--ink-muted));
  --text-pri:    var(--ink);
  --text-sec:    var(--ink-muted);
  --text-muted:  color-mix(in srgb, var(--ink-muted) 75%, var(--paper));
  --text-dim:    var(--paper-line);
  --shadow:      0 1px 2px rgba(43, 42, 39, 0.06);
```

In the `@media (prefers-color-scheme: dark)` `:root` block, delete the same ten colour lines (the `var()` mappings follow the tokens automatically) and keep its accent lines. Change the two default accent values to the ink preset: light `--accent: #2f4f73` with `--accent-a05…a95` as `rgba(47,79,115,…)`; dark `--accent: #a9c1dc` with `rgba(169,193,220,…)`.

- [ ] **Step 4: Point the reader at the tokens**

In `extension/reader.html`, add `<link rel="stylesheet" href="tokens.css">` before `<style>`, delete its `:root { … }` line and its dark `@media … :root { … }` line, and replace `var(--bg)`, `var(--paper)`, `var(--fg)`, `var(--muted)`, `var(--line)` in the remaining rules with `var(--paper-bg)`, `var(--paper)`, `var(--ink)`, `var(--ink-muted)`, `var(--paper-line)`. Replace the `#toolbar button[aria-pressed="true"]` rule with:

```css
    #toolbar button[aria-pressed="true"] { color: var(--ink); background: var(--paper); border-color: var(--paper-line); }
```

- [ ] **Step 5: Check visually and run tests**

Load the extension unpacked, open the panel and an arXiv PDF in the reader, in light and dark (System Settings → Appearance). Both should show the warm paper colours. Then:

```bash
npm test
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add extension/tokens.css extension/sidepanel.css extension/sidepanel.html extension/reader.html
git commit -m "feat: paper-and-ink tokens shared by the panel and the PDF reader"
```

---

### Task 2: Ink accent and marker highlights

**Files:**
- Modify: `extension/sidepanel.js` (`ACCENTS`, every `|| 'blue'` fallback), `extension/content.js` (`ACCENT_PRESETS`, `applyArticleAccent` fallback, `|| 'blue'` fallbacks, `.distill-term` rule in `injectStyles`)
- Test: `tests/front/accent-color.dom.test.mjs` (read it first; extend only if it asserts the default id)

**Interfaces:**
- Produces: accent id `'ink'`, the default everywhere.

- [ ] **Step 1: Add the preset first in the panel**

In `extension/sidepanel.js`, make `ACCENTS` start with:

```js
  { id: 'ink',     name: 'Ink',     light: '#2f4f73', dark: '#a9c1dc', dot: '#2f4f73' },
```

Replace every `r.accentId || 'blue'` (and any other `'blue'` default for `accentId`) with `'ink'`:

```bash
grep -n "'blue'" extension/sidepanel.js extension/content.js extension/background.js
```
Expected after the edits: only the `blue:` preset entries remain.

- [ ] **Step 2: Same in the content script**

In `extension/content.js`, add as the first entry of `ACCENT_PRESETS`:

```js
    ink:     { light: '#2f4f73', dark: '#a9c1dc' },
```

and change `ACCENT_PRESETS[accentId] || ACCENT_PRESETS.blue` to `ACCENT_PRESETS[accentId] || ACCENT_PRESETS.ink`.

- [ ] **Step 3: Marker highlight for jargon in the page**

In `injectStyles` in `extension/content.js`, replace the `.distill-term` rule with:

```css
      .distill-term { background: rgba(250, 204, 21, 0.38); border-radius: 2px; padding: 0 1px; cursor: help; text-decoration: none; }
      @media (prefers-color-scheme: dark) { .distill-term { background: rgba(250, 204, 21, 0.28); } }
```

The marker colour is fixed (not the accent) because it sits on the paper's own page. `reader.html` loads `content.js` on its reading view, so the reader gets the same rule. The panel has no term marks today (`sidepanel.css` has no `.distill-term`), so nothing to change there.

- [ ] **Step 4: Run tests**

```bash
npm test
```
Expected: PASS. If `accent-color.dom.test.mjs` asserts `blue` as the default, update that expectation to `ink`.

- [ ] **Step 5: Commit**

```bash
git add extension/sidepanel.js extension/content.js tests/front/accent-color.dom.test.mjs
git commit -m "feat: ink accent by default and marker highlights for jargon"
```

---

### Task 3: Remove article-era features

**Files:**
- Modify: `extension/sidepanel.html`, `extension/sidepanel.js`, `extension/sidepanel.css`, `extension/background.js`, `extension/content.js`
- Test: `scripts/smoke.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: a Read view with no `assistantStatus`, `actionsRow`, `nowSection`, `historyDetails`. `focusBtn` and `learnBtn` still exist (moved in Task 6), as do `timeLabel` and `progressLabel` (moved in Task 5).

- [ ] **Step 1: Add the guard to the smoke script first**

In `scripts/smoke.mjs`, after the line `const sp = read('sidepanel.js') + read('sidepanelPaper.js');`, add:

```js
const removedIds = [
  'scrollPlayBtn', 'scrollSlowBtn', 'scrollFastBtn', 'scrollSpeedLabel', 'autoResumeToggle',
  'readerModeSelect', 'aiModeSelect', 'autoNowModeSelect',
  'nowSection', 'nowText', 'nowStatus', 'nowTipBtn', 'nowRefreshBtn', 'nowHintChip',
  'historyDetails', 'historyActionBtn', 'moreResumeBadge', 'pinnedAnalysesSection', 'pinnedAnalysesList',
  'pageAnalysesSection', 'pageAnalysesList', 'recentCheckinsSection', 'recentCheckinsList',
  'resumeCard', 'resumeMeta', 'resumeText', 'resumeClearBtn',
  'assistantStatus', 'routingDot', 'routingText', 'usageLabel', 'usageFallback', 'progressBar',
  'actionsRow', 'analyzeActionBtn', 'explainBtnMain',
  'copyNotesBtn', 'copyNotesPlainBtn', 'copyBtn', 'exportAnalysisMdBtn', 'exportAnalysisTxtBtn'
];
const panelSources = sp + read('sidepanel.html');
const leftover = removedIds.filter(id => new RegExp(`['"]${id}['"]`).test(panelSources));
if (leftover.length) fail(`Removed panel ids still referenced: ${leftover.join(', ')}`);
```

Use the file's existing `read` helper (it reads from `extRoot`); if it is named differently, use that name.

- [ ] **Step 2: Run smoke to see it fail**

Run: `node scripts/smoke.mjs`
Expected: FAIL with `Removed panel ids still referenced: scrollPlayBtn, …`.

- [ ] **Step 3: Remove the markup**

In `extension/sidepanel.html` delete: the whole `<section id="assistantStatus">` except that the `<span id="progressLabel">` and `<span id="timeLabel">` move, unchanged, into a new `<p id="readingMeta" class="hint reading-meta"></p>` placed as the first child of `#mainContent`; the whole `<section id="actionsRow">` except that `focusBtn` and `learnBtn` move, unchanged, into the So far section's `.header-actions` before `summaryStatus`; `<section id="nowSection">`; `<details id="historyDetails">`; the `copyNotesBtn`, `copyNotesPlainBtn`, `copyBtn`, `exportAnalysisMdBtn`, `exportAnalysisTxtBtn` buttons; and in Settings the rows containing `autoResumeToggle`, `aiModeSelect`, `readerModeSelect`, `autoNowModeSelect`.

- [ ] **Step 4: Remove the panel code**

In `extension/sidepanel.js` delete:
- The `// ── Auto-scroll ──` block: `scrolling`, `scrollSpeed`, `SPEED_*`, `autoResumeAfterQuiz`, `resumeScrollAfterQuiz`, the four `scroll*` consts, `updateSpeedLabel`, `setScrolling` and their listeners; `maybeResumeScrollAfterQuiz` and its calls; the `SCROLL_PAUSED` / `SCROLL_ENDED` cases.
- `aiModeSelect`, `autoNowModeSelect`, `readerModeSelect`, `autoResumeToggle` consts, their load code and listeners.
- Now reading: the `now*` consts, `nowHintChipTimer`, `hideNowHintChip`, `showNowHintChip`, `showNowPanelIfAllowed`, `requestNowTip`, their listeners, and the `NOW_CACHED`, `NOW_START`, `NOW_CHUNK`, `NOW_DONE`, `NOW_HINT` cases.
- History: `historyDetails`, `moreResumeBadge`, `historyActionBtn`, `toggleHistoryPanel`, the pins block (`PINS_STORAGE_KEY`, `MAX_PINNED_ANALYSES`, `pinnedAnalysesCache`, `loadPinnedIntoCache`, `persistPins`, `pinKeyForPageEntry`, `isEntryPinned`, `togglePinAnalysis`, `unpinByKey`, `applyPinnedAnalysisToPanel`, `renderPinnedAnalysesList`), `renderPageAnalysesList`, `recentCheckins*` and `renderRecentCheckins`, the `resume*` consts and the `RESUME_DATA` case body except the toast line (keep `showToast` for the restore notice in `RESTORED`).
- Status card: `routingDot`, `routingText`, `usageFallback`, `usageLabel`, `progressBar`, `setRoutingStatus` and its calls. In `USAGE_UPDATE` / `USAGE_UNAVAILABLE` keep only the Settings text updates (`fairUseText`, `usageResetText`). In `PROGRESS_UPDATE` drop the `progressBar.style.width` line.
- `analyzeActionBtn` and its listener (the selection card in Task 6 replaces it); `explainBtnMain` if still present.
- The three copy buttons' listeners and their `show(...)` calls in `SUMMARY_DONE`; keep the `NOTES_DATA` case (Task 6 reuses it). Delete `buildAnalysisExportMarkdown`, `buildAnalysisExportPlain`, `setAnalysisExportEnabled` and their calls.

After each deletion run `npx eslint extension/sidepanel.js`; `no-undef` and `no-unused-vars` errors point at leftovers to remove.

- [ ] **Step 5: Remove the background and content-script code**

In `extension/background.js`:
- Delete `READER_MODE_KEY`, `readerMode`, its storage load and `onChanged` branch, and `summaryCadenceForMode`; replace its call sites with the former default:

```js
const SUMMARY_CADENCE = { minNewWords: 95, minIntervalMs: 11000, forceIntervalWords: 200 };
```

- Delete `AUTO_NOW_MODE_KEY`, `getAutoNowMode`, `defaultNowAssistState`, `nowParagraphHash`, `nowAssistState`, `schedulePauseToExplain`, `pauseExplainTimers`, `streamNowReading` and the paragraph-difficulty scorer only they use, plus their call sites and the panel message cases that request a tip. Remove `now` from both `taskMaxTokens` blocks in `AI_TUNING` only if `smoke.mjs` does not require it; leave `backend/server.js` as is.
- Delete the `START_SCROLL` / `STOP_SCROLL` / `SET_SCROLL_SPEED` forwarding cases and the `SCROLL_PAUSED` relay.
- Delete `if (!bag.readerMode) patch.readerMode = 'skim';` from the install defaults.
- Read `AI_MODE_KEY` usage: make `getAiMode()` return `'balanced'` unconditionally.

In `extension/content.js` delete the word-scroll mode: `scrollWpm`, `wordParaSpans`, `wordIdx`, `wrapWords`, `advanceWord`, `startWordMode`, `stopWordMode`, the trail-class updater, the `START_SCROLL` / `STOP_SCROLL` / `SET_SCROLL_SPEED` cases, `SCROLL_PAUSED`/`SCROLL_ENDED` sends, and the `.air-word*` CSS and `air-word-ripple` keyframes. Keep `freezeScroll` / `unfreezeScroll` (check-ins use them).

```bash
grep -n "readerMode\|autoNowMode\|AUTO_NOW\|START_SCROLL\|wordParaSpans\|air-word\|NOW_START" extension/*.js
```
Expected: no output.

- [ ] **Step 6: Remove dead CSS**

In `extension/sidepanel.css` delete rules whose selectors only target removed elements: `.assistant-status`, `.status-*`, `.routing-*`, `.usage-label`, `.usage-fallback`, `.progress-wrap`, `.progress-bar`, `.actions-row*`, `.tele-*`, `.mode-bar*`, `.mode-btn*`, `.speed-*`, `.now-*`, `.more-*`, `.analyses-*`, `.checkins-*`, `.resume-card`. Keep `.action-btn` (focus and learn still use it).

- [ ] **Step 7: Run all checks**

```bash
npm test
```
Expected: PASS, including the new smoke guard. Load unpacked, open an arXiv HTML paper: summary builds, check-ins still trigger with Learn on, focus still dims.

- [ ] **Step 8: Commit**

```bash
git add -A extension scripts/smoke.mjs
git commit -m "refactor: remove teleprompter, presets, now-reading tips, history drawer and status card"
```

---

### Task 4: Section map model and renderer

**Files:**
- Modify: `extension/utils/paperHelp.js`, `package.json` (`lint` script)
- Create: `extension/utils/sectionMap.js`
- Test: `tests/unit/paperHelp.test.mjs`, `tests/front/sectionMap.dom.test.mjs`

**Interfaces:**
- Produces:
  - `distillSectionMap(sections: {heading, kind, chars}[], currentHeading: string) → {heading, kind, flex, state: 'read'|'current'|'ahead', line}[]`
  - `distillRenderSectionMap(container: HTMLElement, segments, onJump: (heading) => void) → void`

- [ ] **Step 1: Write the failing unit tests**

Append to `tests/unit/paperHelp.test.mjs`:

```js
describe('distillSectionMap', () => {
  const secs = [
    { heading: 'Introduction', kind: 'intro', chars: 1000 },
    { heading: 'Methods', kind: 'methods', chars: 4000 },
    { heading: 'Results', kind: 'results', chars: 0 },
    { heading: 'Related work', kind: 'other', chars: 2000 }
  ];
  it('marks sections before the current one read, the current one current, the rest ahead', () => {
    expect(help.distillSectionMap(secs, 'methods').map(s => s.state)).toEqual(['read', 'current', 'ahead', 'ahead']);
  });
  it('scales width into 0.5–2 by length', () => {
    const m = help.distillSectionMap(secs, '');
    expect(m[1].flex).toBe(2);
    expect(m[2].flex).toBe(0.5);
    expect(m[0].flex).toBeCloseTo(0.88, 2);
  });
  it('gives each known kind a plain line and other kinds none', () => {
    const m = help.distillSectionMap(secs, '');
    expect(m[1].line).toBe('How they did it. Fine to skim.');
    expect(m[3].line).toBe('');
  });
  it('treats an unknown current heading as all ahead', () => {
    expect(help.distillSectionMap(secs, 'Appendix').every(s => s.state === 'ahead')).toBe(true);
  });
  it('survives empty and malformed input', () => {
    expect(help.distillSectionMap(null, 'x')).toEqual([]);
    expect(help.distillSectionMap([null, { kind: 'intro' }], 'x')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/unit/paperHelp.test.mjs`
Expected: FAIL with `help.distillSectionMap is not a function`.

- [ ] **Step 3: Implement `distillSectionMap`**

In `extension/utils/paperHelp.js`, before the `module.exports` block:

```js
const DISTILL_SECTION_LINES = {
  intro: 'The question and why it matters.',
  methods: 'How they did it. Fine to skim.',
  results: 'What they found.',
  discussion: 'What it means, and its limits.'
};

/** Segments for the panel's section map: width by length, read/current/ahead by position. */
function distillSectionMap(sections, currentHeading) {
  const norm = h => String(h || '').trim().toLowerCase().slice(0, 120);
  const list = (Array.isArray(sections) ? sections : []).filter(s => s && s.heading);
  const longest = Math.max(1, ...list.map(s => s.chars || 0));
  const cur = list.findIndex(s => norm(s.heading) === norm(currentHeading));
  return list.map((s, i) => ({
    heading: s.heading,
    kind: s.kind || 'other',
    flex: Math.round((0.5 + 1.5 * Math.min(1, (s.chars || 0) / longest)) * 100) / 100,
    state: cur === -1 || i > cur ? 'ahead' : i === cur ? 'current' : 'read',
    line: DISTILL_SECTION_LINES[s.kind] || ''
  }));
}
```

Add `distillSectionMap` to the `module.exports` object.

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run tests/unit/paperHelp.test.mjs`
Expected: PASS.

- [ ] **Step 5: Write the failing DOM test**

Create `tests/front/sectionMap.dom.test.mjs`:

```js
import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { distillRenderSectionMap } = require('../../extension/utils/sectionMap.js');

const seg = (heading, state, flex = 1) => ({ heading, kind: 'other', flex, state, line: '' });

describe('distillRenderSectionMap', () => {
  it('hides the map when there are fewer than two sections', () => {
    const box = document.createElement('div');
    distillRenderSectionMap(box, [seg('Only', 'current')], () => {});
    expect(box.hidden).toBe(true);
    expect(box.children.length).toBe(0);
  });
  it('renders one button per section with its state and width', () => {
    const box = document.createElement('div');
    distillRenderSectionMap(box, [seg('Intro', 'read', 0.5), seg('Methods', 'current', 2)], () => {});
    const btns = box.querySelectorAll('button');
    expect(box.hidden).toBe(false);
    expect(btns.length).toBe(2);
    expect(btns[1].dataset.state).toBe('current');
    expect(btns[1].style.flexGrow).toBe('2');
    expect(btns[1].getAttribute('aria-current')).toBe('step');
    expect(btns[0].getAttribute('aria-label')).toBe('Intro, read. Jump to this section');
  });
  it('calls onJump with the heading when a segment is clicked', () => {
    const box = document.createElement('div');
    const onJump = vi.fn();
    distillRenderSectionMap(box, [seg('Intro', 'read'), seg('Methods', 'ahead')], onJump);
    box.querySelectorAll('button')[1].click();
    expect(onJump).toHaveBeenCalledWith('Methods');
  });
  it('replaces the previous render', () => {
    const box = document.createElement('div');
    distillRenderSectionMap(box, [seg('A', 'read'), seg('B', 'current')], () => {});
    distillRenderSectionMap(box, [seg('A', 'read'), seg('B', 'read'), seg('C', 'current')], () => {});
    expect(box.querySelectorAll('button').length).toBe(3);
  });
});
```

- [ ] **Step 6: Run it to see it fail**

Run: `npx vitest run tests/front/sectionMap.dom.test.mjs`
Expected: FAIL with `Cannot find module '../../extension/utils/sectionMap.js'`.

- [ ] **Step 7: Implement the renderer**

Create `extension/utils/sectionMap.js`:

```js
'use strict';

// Renders the panel's section map: one button per paper section. DOM only, no chrome.*.

const DISTILL_STATE_WORDS = { read: 'read', current: 'you are here', ahead: 'not read yet' };

function distillRenderSectionMap(container, segments, onJump) {
  const list = Array.isArray(segments) ? segments : [];
  container.replaceChildren();
  container.hidden = list.length < 2;
  if (container.hidden) return;
  for (const s of list) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'section-seg';
    btn.dataset.state = s.state;
    btn.style.flexGrow = String(s.flex);
    btn.title = s.heading;
    btn.setAttribute('aria-label', `${s.heading}, ${DISTILL_STATE_WORDS[s.state] || s.state}. Jump to this section`);
    if (s.state === 'current') btn.setAttribute('aria-current', 'step');
    btn.addEventListener('click', () => onJump(s.heading));
    container.append(btn);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { distillRenderSectionMap };
}
```

Add `extension/utils/sectionMap.js` to the `lint` script in `package.json`, after `extension/utils/paperHelp.js`.

- [ ] **Step 8: Run tests**

Run: `npx vitest run tests/front/sectionMap.dom.test.mjs tests/unit/paperHelp.test.mjs && npm run lint`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add extension/utils/paperHelp.js extension/utils/sectionMap.js package.json tests/unit/paperHelp.test.mjs tests/front/sectionMap.dom.test.mjs
git commit -m "feat: section map model and renderer"
```

---

### Task 5: Paper card, sticky section map and jump-to-section

**Files:**
- Modify: `extension/paperFeatures.js` (`paperHelpState`), `extension/background.js` (panel message switch next to `case 'SCROLL_TO_TERM':`), `extension/content.js` (message switch next to `case 'SCROLL_TO_TERM':`), `extension/sidepanel.html`, `extension/sidepanel.css`, `extension/sidepanelPaper.js`, `scripts/smoke.mjs`

**Interfaces:**
- Consumes: `distillSectionMap`, `distillRenderSectionMap` (Task 4); `#readingMeta` with `progressLabel` / `timeLabel` (Task 3).
- Produces: `PAPER_HELP_STATE.sections: {heading, kind, chars}[]`; panel → bg `{type: 'JUMP_TO_SECTION', tabId, heading}`; bg → content `{type: 'SCROLL_TO_SECTION', heading}`.

- [ ] **Step 1: Add the smoke check first**

In `scripts/smoke.mjs`, after the removed-ids guard, add:

```js
const bgAll = read('background.js') + read('paperFeatures.js');
if (!/case 'JUMP_TO_SECTION'/.test(bgAll)) fail('background does not handle JUMP_TO_SECTION');
if (!/case 'SCROLL_TO_SECTION'/.test(read('content.js'))) fail('content script does not handle SCROLL_TO_SECTION');
if (!/type: 'JUMP_TO_SECTION'/.test(sp)) fail('panel never sends JUMP_TO_SECTION');
```

Run: `node scripts/smoke.mjs`
Expected: FAIL with `background does not handle JUMP_TO_SECTION`.

- [ ] **Step 2: Send sections with the paper state**

In `extension/paperFeatures.js`, in the object returned by `paperHelpState(s)`, add:

```js
    sections: (s.paper?.sections || []).map(x => ({ heading: x.heading, kind: x.kind || 'other', chars: (x.text || '').length })),
```

- [ ] **Step 3: Route the jump**

In `extension/background.js`, next to `case 'SCROLL_TO_TERM':` in the panel port switch:

```js
      case 'JUMP_TO_SECTION':
        chrome.tabs.sendMessage(msg.tabId, { type: 'SCROLL_TO_SECTION', heading: String(msg.heading || '') }).catch(() => {});
        break;
```

In `extension/content.js`, next to `case 'SCROLL_TO_TERM':`:

```js
      case 'SCROLL_TO_SECTION': {
        const want = String(msg.heading || '').trim().toLowerCase().slice(0, 120);
        const head = sectionHeads.find(h => distillCleanHeading(distillNodeText(h)).slice(0, 120).toLowerCase() === want);
        head?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        break;
      }
```

A heading that isn't on the page does nothing.

- [ ] **Step 4: Add the paper card markup**

In `extension/sidepanel.html`, move `#articleTitleBar` inside `#viewRead` as its first child and rebuild it as:

```html
      <section id="paperCard" class="paper-card hidden">
        <h1 id="articleTitle" class="paper-title"></h1>
        <p id="paperByline" class="paper-byline"></p>
        <ul id="paperFacts" class="fact-tags"></ul>
        <button id="fullTextLink" class="full-text-link hidden" type="button">Only the abstract is on this page. Open the full paper →</button>
        <div class="paper-where">
          <div id="sectionMap" class="section-map" role="group" aria-label="Sections of this paper" hidden></div>
          <p class="paper-where-line"><span id="sectionNow" class="section-now"></span> <span id="sectionLine" class="section-line"></span></p>
        </div>
      </section>
```

Move `#readingMeta` (from Task 3) into `.paper-where` after `.paper-where-line`. Delete the old `articleTitleBar` wrapper; keep the `articleTitle` and `fullTextLink` IDs so existing code in `sidepanel.js` still finds them. In `sidepanel.js`, replace uses of `articleTitleBar` with `$('paperCard')`. Delete the `<ul id="trustFacts">` from `#trustCard`; its facts now render into `#paperFacts`.

- [ ] **Step 5: Style it**

Append to `extension/sidepanel.css`:

```css
.paper-card { padding: 14px 14px 0; background: var(--bg-surface); border-bottom: 1px solid var(--border-sub); }
.paper-title { font: 500 17px/1.3 var(--font-text); color: var(--text-pri); margin: 0 0 4px; }
.paper-byline { font-size: 12px; color: var(--text-sec); margin: 0 0 6px; }
.paper-where { position: sticky; top: 0; z-index: 5; background: var(--bg-surface); padding: 8px 0 10px; }
.section-map { display: flex; gap: 3px; }
.section-seg { flex-basis: 0; min-width: 10px; height: 8px; padding: 0; border: 0; border-radius: 4px; cursor: pointer; background: var(--border-mid); }
.section-seg[data-state="read"] { background: var(--accent-a35); }
.section-seg[data-state="current"] { background: var(--accent); }
.section-seg:hover, .section-seg:focus-visible { outline: 2px solid var(--accent-a35); outline-offset: 2px; }
.paper-where-line { margin: 6px 0 0; font-size: 12px; }
.section-now { font-weight: 600; color: var(--text-pri); }
.section-line { color: var(--text-sec); }
.reading-meta { margin: 2px 0 0; }
#paperFacts li:first-child { background: color-mix(in srgb, #f59e0b 18%, transparent); border-color: transparent; color: var(--text-pri); }
```

The first fact is always the publication status (`distillTrustFacts` puts it first), so it gets the badge tint.

- [ ] **Step 6: Render the card and map**

In `extension/sidepanelPaper.js` add:

```js
function renderPaperCard() {
  const st = paperView.state;
  const card = $('paperCard');
  if (!st) return hide(card);
  show(card);
  const facts = st.trustFacts || [];
  const list = $('paperFacts');
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
  const segs = distillSectionMap(st.sections || [], paperView.section);
  distillRenderSectionMap($('sectionMap'), segs, heading => sendPaper({ type: 'JUMP_TO_SECTION', heading }));
  const cur = segs.find(s => s.state === 'current');
  $('sectionNow').textContent = cur ? cur.heading : '';
  $('sectionLine').textContent = cur?.line || '';
}
```

In `renderTrust`, delete the block that fills `$('trustFacts')` and change the last line to `$('trustCard').classList.toggle('hidden', !parsed.STUDY && !bulletLines(parsed.LIMITS).length);`. Call `renderPaperCard()` first in `renderAll()` and at the end of the `SECTION_CHANGED` case. Add `hide($('paperCard'))` to `resetPaperView()`.

Byline: the background does not send authors in `PAPER_HELP_STATE`. Add to `paperHelpState` in `paperFeatures.js`:

```js
    byline: [s.paper?.authors?.length ? (s.paper.authors.length > 2 ? `${s.paper.authors[0]} et al.` : s.paper.authors.join(' and ')) : '', s.paper?.source && s.paper.source !== 'generic' && s.paper.source !== 'pdf' ? { arxiv: 'arXiv', pmc: 'PubMed Central', biorxiv: 'bioRxiv' }[s.paper.source] || '' : ''].filter(Boolean).join(' · '),
```

and in `renderPaperCard` set `$('paperByline').textContent = st.byline || '';`.

In `extension/sidepanel.html`, load the renderer after `paperHelp.js`:

```html
  <script src="utils/sectionMap.js"></script>
```

- [ ] **Step 7: Run checks and try it**

```bash
npm test
```
Expected: PASS. Load unpacked; open `https://arxiv.org/html/2310.06825` (or any arXiv HTML paper with 4+ sections). The map shows segments; scrolling moves the current one; tapping a segment scrolls the paper; the map stays pinned while the overview scrolls under it. On a PDF in the reader, tapping still works or does nothing (no error in the console).

- [ ] **Step 8: Commit**

```bash
git add extension scripts/smoke.mjs
git commit -m "feat: paper card with a sticky section map that jumps to sections"
```

---

### Task 6: So far by section, selection card, copy menu, header toggles

**Files:**
- Modify: `extension/utils/paperHelp.js`, `extension/utils/pageStore.js`, `extension/background.js` (summary `onDone`, restore that sends `SUMMARY_CHUNK`/`SUMMARY_DONE`), `extension/sidepanel.html`, `extension/sidepanel.css`, `extension/sidepanel.js` (`renderSummary`, `SUMMARY_DONE`, `SELECTION_CHANGED`, focus/learn handlers), `extension/sidepanelPaper.js`
- Test: `tests/unit/paperHelp.test.mjs`, `tests/unit/pageStore.test.mjs`

**Interfaces:**
- Consumes: `paperView.state.sections` (Task 5).
- Produces:
  - `distillBulletKey(bullet: string) → string`
  - `distillGroupBullets(bullets: string[], bulletSections: {[key]: heading}, sectionOrder: string[]) → {heading, bullets}[]`
  - `s.bulletSections` in tab state and page snapshots; `SUMMARY_DONE.bulletSections`.

- [ ] **Step 1: Write the failing grouping tests**

Append to `tests/unit/paperHelp.test.mjs`:

```js
describe('distillGroupBullets', () => {
  const tags = { [help.distillBulletKey('B in methods')]: 'Methods', [help.distillBulletKey('A in intro')]: 'Introduction' };
  it('groups bullets under their sections in paper order, untagged first', () => {
    expect(help.distillGroupBullets(['B in methods', 'Old one', 'A in intro'], tags, ['Introduction', 'Methods'])).toEqual([
      { heading: '', bullets: ['Old one'] },
      { heading: 'Introduction', bullets: ['A in intro'] },
      { heading: 'Methods', bullets: ['B in methods'] }
    ]);
  });
  it('puts sections missing from the order after the known ones', () => {
    const g = help.distillGroupBullets(['x'], { [help.distillBulletKey('x')]: 'Appendix' }, ['Introduction']);
    expect(g).toEqual([{ heading: 'Appendix', bullets: ['x'] }]);
  });
  it('keys ignore case, spacing and a leading bullet mark', () => {
    expect(help.distillBulletKey('•  Hello   World ')).toBe(help.distillBulletKey('hello world'));
  });
  it('survives bad input', () => {
    expect(help.distillGroupBullets(null, null, null)).toEqual([]);
  });
});
```

Run: `npx vitest run tests/unit/paperHelp.test.mjs`
Expected: FAIL with `help.distillBulletKey is not a function`.

- [ ] **Step 2: Implement grouping**

In `extension/utils/paperHelp.js` before `module.exports`:

```js
/** Stable key for a summary bullet (case, spacing and a leading bullet mark ignored). */
function distillBulletKey(bullet) {
  return String(bullet || '').replace(/^\s*[-*•]\s*/, '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 200);
}

/** Summary bullets grouped by the section they were written in, in paper order; untagged first. */
function distillGroupBullets(bullets, bulletSections, sectionOrder) {
  const tags = bulletSections || {};
  const order = Array.isArray(sectionOrder) ? sectionOrder : [];
  const groups = new Map();
  for (const b of Array.isArray(bullets) ? bullets : []) {
    const heading = tags[distillBulletKey(b)] || '';
    if (!groups.has(heading)) groups.set(heading, []);
    groups.get(heading).push(b);
  }
  const rank = h => (h === '' ? -1 : order.indexOf(h) === -1 ? order.length : order.indexOf(h));
  return [...groups].sort((a, b) => rank(a[0]) - rank(b[0])).map(([heading, list]) => ({ heading, bullets: list }));
}
```

Add both to `module.exports`. Run: `npx vitest run tests/unit/paperHelp.test.mjs` — Expected: PASS.

- [ ] **Step 3: Write the failing persistence test**

In `tests/unit/pageStore.test.mjs`, inside `describe('distillBuildPageStatePayload', …)` add:

```js
  it('keeps bulletSections and round-trips them, capped at 40 entries', () => {
    const many = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`b${i}`, 'Methods']));
    const payload = distillBuildPageStatePayload({ pageUrl: 'https://x.test', bulletSections: many }, 1);
    expect(Object.keys(payload.bulletSections).length).toBe(40);
    expect(distillPagePayloadToState(payload).bulletSections.b59).toBe('Methods');
  });
```

Run: `npx vitest run tests/unit/pageStore.test.mjs` — Expected: FAIL (`payload.bulletSections` undefined).

- [ ] **Step 4: Persist the tags**

In `extension/utils/pageStore.js`, in `distillBuildPageStatePayload`'s returned object after `lastSummaryUnitCount`:

```js
    bulletSections: Object.fromEntries(Object.entries(src.bulletSections || {}).slice(-40)),
```

In `distillPagePayloadToState`'s returned object after `lastSummary,`:

```js
    bulletSections: (payload && payload.bulletSections && typeof payload.bulletSections === 'object') ? payload.bulletSections : {},
```

Run: `npx vitest run tests/unit/pageStore.test.mjs` — Expected: PASS.

- [ ] **Step 5: Tag bullets when a summary finishes**

In `extension/background.js`, in the summary `onDone`, after `s.lastSummary = trimSummaryLength(merged);`:

```js
        s.bulletSections = s.bulletSections || {};
        const heading = s.section?.heading || '';
        for (const b of normalizeSummaryShape(s.lastSummary).bullets) {
          const key = distillBulletKey(b);
          if (heading && !s.bulletSections[key]) s.bulletSections[key] = heading;
        }
```

Change the following `toPanel({ type: 'SUMMARY_DONE', tabId })` to `toPanel({ type: 'SUMMARY_DONE', tabId, bulletSections: s.bulletSections })`, and do the same where restore sends `SUMMARY_DONE` after `SUMMARY_CHUNK` with `s.lastSummary`. Where tab state is reset for a new page (the object containing `lastSummary: ''`), add `bulletSections: {},`.

- [ ] **Step 6: Render the grouped summary**

In `extension/sidepanel.js`, add a module variable `let summaryBulletSections = {};`, set it in `SUMMARY_DONE` (`summaryBulletSections = msg.bulletSections || {};`) and clear it in `ARTICLE_NAVIGATING`. Replace `renderSummary(text, container)` with:

```js
function renderSummary(text, container) {
  container.replaceChildren();
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const gist = lines.find(l => l.toLowerCase().startsWith('the gist:'));
  const bullets = lines.filter(l => l.startsWith('•')).map(l => l.slice(1).trim());
  const other = lines.filter(l => l !== gist && !l.startsWith('•'));
  if (gist) {
    const p = document.createElement('p');
    p.className = 'gist-line summary-line';
    const label = document.createElement('span');
    label.className = 'gist-label';
    label.textContent = 'The gist: ';
    p.append(label, document.createTextNode(gist.slice('the gist:'.length).trim()));
    container.append(p);
  }
  const order = (typeof paperView !== 'undefined' && paperView.state?.sections || []).map(s => s.heading);
  for (const group of distillGroupBullets(bullets, summaryBulletSections, order)) {
    if (group.heading) {
      const h = document.createElement('p');
      h.className = 'summary-group';
      h.textContent = group.heading;
      container.append(h);
    }
    for (const b of group.bullets) {
      const div = document.createElement('div');
      div.className = 'bullet-line summary-line';
      const dot = document.createElement('span');
      dot.className = 'bullet-dot';
      dot.textContent = '•';
      const span = document.createElement('span');
      span.textContent = b;
      div.append(dot, span);
      container.append(div);
    }
  }
  for (const t of other) {
    const p = document.createElement('p');
    p.className = 'body-text summary-line';
    p.textContent = t;
    container.append(p);
  }
}
```

`sidepanel.js` loads before `utils/paperHelp.js` and `sidepanelPaper.js`, but `renderSummary` only runs on port messages, after all scripts have loaded, so `distillGroupBullets` and `paperView` exist by then. `distillBulletKey` in the background comes from `utils/paperHelp.js`, already in its `importScripts`.

- [ ] **Step 7: Copy menu and header toggles**

In `extension/sidepanel.html`, in the So far `.header-actions` (which now holds `focusBtn` and `learnBtn` from Task 3), add before `summaryStatus`:

```html
            <details id="copyMenu" class="copy-menu">
              <summary class="btn-copy">Copy notes</summary>
              <div class="copy-menu-list">
                <button type="button" data-format="markdown">Markdown</button>
                <button type="button" data-format="plain">Plain text</button>
              </div>
            </details>
```

In `extension/sidepanel.js`:

```js
for (const btn of document.querySelectorAll('#copyMenu [data-format]')) {
  btn.addEventListener('click', () => {
    $('copyMenu').open = false;
    port?.postMessage({ type: 'GET_NOTES', tabId: currentTabId, format: btn.dataset.format });
  });
}
```

`NOTES_DATA` (kept in Task 3) already copies and toasts. Remove the old text toggling of `focusIcon` in the focus handler (Task 7 swaps in icons); keep `setActionActive`.

Append to `extension/sidepanel.css`:

```css
.summary-group { margin: 10px 0 2px; font-size: 11px; font-weight: 600; color: var(--text-sec); }
.copy-menu { position: relative; }
.copy-menu > summary { list-style: none; cursor: pointer; }
.copy-menu > summary::-webkit-details-marker { display: none; }
.copy-menu-list { position: absolute; right: 0; top: calc(100% + 4px); z-index: 10; display: flex; flex-direction: column; min-width: 120px; padding: 4px; background: var(--bg-surface); border: 1px solid var(--border-mid); border-radius: 8px; box-shadow: var(--shadow); }
.copy-menu-list button { text-align: left; padding: 6px 8px; border: 0; border-radius: 6px; background: none; color: var(--text-pri); font: inherit; cursor: pointer; }
.copy-menu-list button:hover { background: var(--bg-elevated); }
```

- [ ] **Step 8: Selection card**

In `extension/sidepanel.html`, rename the Highlight section's title to "Selected text" and replace its header buttons (`analyzeBtn` stays, relabelled) with:

```html
            <button id="analyzeBtn" type="button" class="btn-copy">Explain</button>
            <button id="askAboutBtn" type="button" class="btn-primary btn-sm">Ask about this</button>
```

In `extension/sidepanelPaper.js`:

```js
$('askAboutBtn').addEventListener('click', () => {
  const quote = ($('selectedPreview').textContent || '').trim().slice(0, 300);
  if (!quote) return;
  setPanel('ask');
  const input = $('askInput');
  input.value = `About "${quote}": `;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
});
```

The Ask input has `maxlength="500"`, so the quote is capped at 300 characters.

- [ ] **Step 9: Run checks and try it**

```bash
npm test
```
Expected: PASS. In Chrome on an arXiv paper: scroll through two sections; So far shows bullets under section labels; reload the page and the grouping returns; Copy notes → Markdown pastes the notes; select a sentence → Ask about this opens Ask with the quote.

- [ ] **Step 10: Commit**

```bash
git add extension tests/unit/paperHelp.test.mjs tests/unit/pageStore.test.mjs
git commit -m "feat: So far grouped by section, selection card with Ask about this, one copy menu"
```

---

### Task 7: Icons, empty states and the thinking animation

**Files:**
- Modify: `extension/sidepanel.html`, `extension/sidepanel.css`, `extension/sidepanel.js` (stream start/end handlers), `extension/sidepanelPaper.js` (`PAPER_HELP_START` / `DONE` / `ERROR`)

**Interfaces:**
- Produces: `setThinking(key: string, on: boolean)` global in `sidepanel.js`; class `is-thinking` on `<body>`.

- [ ] **Step 1: Swap glyphs for inline SVG**

Every icon uses this wrapper (Lucide paths, 24×24 viewBox, 1.75 stroke):

```html
<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">PATHS</svg>
```

| Where | Replaces | PATHS |
|---|---|---|
| `#settingsBtn` (add `aria-label="Settings"`) | `⚙` | `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68 1.65 1.65 0 0 0 10 3.17V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>` |
| `#focusBtn` icon (`aria-label="Focus"`) | `◎` | `<circle cx="12" cy="12" r="3"/><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/>` |
| `#learnBtn` icon (`aria-label="Check-ins"`) | `◈` | `<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>` |
| `#noArticle` `.state-icon` | `📄` | `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 15h6"/>` |
| `#pdfCard` `.state-icon` | `📄` | `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M10 13l2 2 4-4"/>` |
| `#backendDownCard` `.state-icon` | `🖥` | `<path d="M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5.17-2.8M19 13a10 10 0 0 0-2.3-1.6M12 20h.01"/>` |

Remove the `👋` from the setup card title. Keep `focusBtn`/`learnBtn` as icon-only buttons; keep their `.action-label` spans but add `class="sr-only"` so screen readers still read them.

```bash
grep -nP "[\x{2600}-\x{27BF}\x{1F300}-\x{1FAFF}◎◉◈◌✦≡⚙]" extension/sidepanel.html extension/sidepanel.js
```
Expected: no output.

Append to `extension/sidepanel.css`:

```css
.ico { width: 16px; height: 16px; display: block; }
.state-icon .ico { width: 28px; height: 28px; margin: 0 auto; color: var(--text-sec); }
```

- [ ] **Step 2: Thinking animation**

In `extension/sidepanel.js` add near `show`/`hide`:

```js
const thinkingStreams = new Set();
/** Logo waves drift while any AI stream runs. */
function setThinking(key, on) {
  if (on) thinkingStreams.add(key); else thinkingStreams.delete(key);
  document.body.classList.toggle('is-thinking', thinkingStreams.size > 0);
}
```

Call `setThinking('summary', true)` in `SUMMARY_START`, `false` in `SUMMARY_DONE`; same with key `'analysis'` for `ANALYSIS_START`/`ANALYSIS_DONE`, `'quiz'` for `QUIZ_START`/`QUIZ_DONE` and `FEEDBACK_START`/`FEEDBACK_DONE`. In `ERROR` and `ARTICLE_NAVIGATING` call `thinkingStreams.clear(); document.body.classList.remove('is-thinking');`. In `sidepanelPaper.js` call `setThinking(k, true)` in `PAPER_HELP_START` and `setThinking(k, false)` in `PAPER_HELP_DONE` and `PAPER_HELP_ERROR`.

Append to `extension/sidepanel.css`:

```css
@keyframes distill-drift { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(-14px); } }
body.is-thinking .wavy-d-logo g path { animation: distill-drift 2.4s ease-in-out infinite; }
body.is-thinking .wavy-d-logo g path:nth-child(even) { animation-delay: -1.2s; }
@media (prefers-reduced-motion: reduce) { body.is-thinking .wavy-d-logo g path { animation: none; } }
```

- [ ] **Step 3: Run checks and look**

```bash
npm test
```
Expected: PASS. In Chrome: icons render crisp in both themes; the logo waves move while the overview streams and stop when it finishes; with macOS "Reduce motion" on they don't move.

- [ ] **Step 4: Commit**

```bash
git add extension
git commit -m "feat: SVG icons, no emoji, and a thinking animation on the logo"
```

---

### Task 8: Onboarding, Settings groups and docs

**Files:**
- Modify: `extension/sidepanel.html` (`#setupHintCard`, `#settingsPanel`), `extension/sidepanel.js` (onboarding connect success path, `setupHintOpenSettingsBtn` handler), `extension/sidepanel.css`, `README.md`, `docs/STORE_LISTING.md`, `CHANGELOG.md`, `extension/manifest.json` (`version`)

**Interfaces:**
- Consumes: `aiProviderSelect`, `applyProviderUi(provider)`, `setPanel(panel)` from `sidepanel.js`.

- [ ] **Step 1: Pick the sample paper**

Open candidate arXiv HTML papers and choose one whose page has a `citation_title` meta tag and at least four `h2` sections, and on which Distill shows the section map. Default candidate: `https://arxiv.org/html/1706.03762` (check it has an HTML version; if not, pick another). Record it:

```js
const SAMPLE_PAPER_URL = 'https://arxiv.org/html/1706.03762';
```

near the top of `extension/sidepanel.js`.

- [ ] **Step 2: Rebuild the setup card**

Replace the body of `#setupHintCard` with:

```html
      <div class="setup-hint-body">
        <p class="setup-hint-title">Read research papers in plain language</p>
        <p class="setup-hint-text">Distill uses your own free AI key. No account, no cost.</p>
        <a id="onboardGetKeyLink" class="onboard-key-link" href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer">Get a free Groq key</a>
        <span id="onboardSubstep" class="onboard-substep">Groq Console · no credit card</span>
        <div class="onboard-row">
          <input id="onboardKeyInput" type="password" placeholder="gsk_…" aria-label="Your Groq API key" autocomplete="off" spellcheck="false" />
          <button id="onboardConnectBtn" type="button" class="btn-primary">Connect</button>
        </div>
        <p id="onboardStatusLine" class="hint key-status-line" role="status"></p>
        <button id="onboardLocalBtn" type="button" class="paper-link-btn">Prefer fully private? Run a model on your computer</button>
        <div id="onboardDone" class="onboard-done hidden">
          <p>Connected.</p>
          <button id="onboardSampleBtn" type="button" class="btn-primary">Try it on a sample paper</button>
        </div>
      </div>
      <div class="setup-hint-actions">
        <button id="setupHintDismissBtn" type="button" class="btn-copy">Dismiss</button>
      </div>
```

Delete `setupHintOpenSettingsBtn` and its handler. In `sidepanel.js`:

```js
$('onboardLocalBtn').addEventListener('click', () => {
  aiProviderSelect.value = 'local';
  aiProviderSelect.dispatchEvent(new Event('change'));
  setPanel('settings');
});
$('onboardSampleBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: SAMPLE_PAPER_URL });
});
```

In `KEY_VALIDATION_RESULT`, inside the `target === 'onboard'` → `msg.ok` storage callback, replace the `setKeyStatus(...)`, `syncSetupHintCard()` and `showToast(...)` lines with:

```js
            for (const el of [setupHintCard.querySelector('.onboard-row'), $('onboardLocalBtn'), $('onboardGetKeyLink'), $('onboardSubstep'), onboardStatusLine]) hide(el);
            show($('onboardDone'));
            cachedSetupHintDismissed = true;
            chrome.storage.local.set({ distillSetupHintDismissed: true });
```

so the card turns into "Connected. Try it on a sample paper" and does not come back next time. `syncSetupHintCard()` must not hide the card while `#onboardDone` is visible: add `if (!$('onboardDone').classList.contains('hidden')) return show(setupHintCard);` as its first line.

- [ ] **Step 3: Group Settings**

Wrap the existing Settings rows in four sections, in this order, each starting with `<h2 class="settings-group-title">Name</h2>`:

- **Connection:** `.settings-ai-row` (provider, key, local fields, Save/Test/Remove, status) and the Usage row.
- **Appearance:** Accent colour row and `#sitePrefsSection` minus `siteBackendOnlyToggle` and its hint.
- **Privacy and data:** `.privacy-settings-block` and Saved reading history.
- **Advanced:** `#advancedBackendDetails`, the `siteBackendOnlyToggle` label and its hint, and Keyboard shortcuts.

Use `<section class="settings-group">` for each. Append to `extension/sidepanel.css`:

```css
.settings-group { display: flex; flex-direction: column; gap: 14px; padding: 14px; background: var(--bg-surface); border: 1px solid var(--border-sub); border-radius: 12px; }
.settings-group + .settings-group { margin-top: 12px; }
.settings-group-title { font: 600 13px/1.3 var(--font-ui); color: var(--text-pri); margin: 0; }
.settings-panel label { text-transform: none; letter-spacing: 0; }
```

Hide the Advanced group when `backendUiEnabled` is false and it would be empty (keyboard shortcuts stay, so it is never empty — leave it visible).

- [ ] **Step 4: Docs**

- `README.md` "What this is": replace the focus/teleprompter wording with the section map ("see which part of the paper you're in, and jump to any section") and keep the rest.
- `docs/STORE_LISTING.md` features: add "A map of the paper's sections that shows where you are"; remove any teleprompter mention.
- `CHANGELOG.md`: new top entry `## [3.0.0] — <date of merge>` with Added (section map, grouped So far, Ask about this, copy menu, paper-and-ink look, onboarding sample paper) and Removed (teleprompter, reader/AI mode presets, now-reading tips, history drawer).
- `extension/manifest.json`: `"version": "3.0.0"`.

- [ ] **Step 5: Full check**

```bash
npm test
```
Expected: PASS.

In Chrome with a fresh profile (`--user-data-dir` to an empty temp folder), load unpacked and check, in light and dark:
1. Onboarding: local link opens Settings with Local selected; connecting a key shows "Connected" and the sample button opens the sample paper.
2. Sample paper: paper card, preprint/journal badge, sticky map, jump, overview, trust, guide, grouped So far, check-ins with the Learn toggle, focus, copy menu, Ask about this, glossary, marker highlights.
3. A PDF opened in the reader: same panel, warm reader colours, map jump works or is a no-op.
4. A non-paper page: the not-a-paper card with its icon.
5. Settings: four groups, no uppercase labels, Advanced present.

Also open the stubbed preview (see the spec's Testing section) at 360 px and 480 px wide and check nothing overflows.

- [ ] **Step 6: Commit**

```bash
git add extension README.md docs/STORE_LISTING.md CHANGELOG.md
git commit -m "feat: key-first onboarding with a sample paper, grouped Settings; docs for 3.0.0"
```
