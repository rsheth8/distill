# Part 2 — Panel redesign

Parts 1 and 3 made Distill a research-paper reader with an overview, trust facts, section
guides, jargon, a glossary and ask-the-paper. The panel still carries the article-reader
UI around them. This part removes what papers don't need, re-orders the Read tab around
"where am I in this paper", and gives the panel and the PDF reader one calm "paper and
ink" look.

Built on this branch, which merges `claude/project-catch-up-afb980` (Parts 1 and 3) and
`claude/localized-llm-models-577ce4` (local model provider). **Implementation starts after
Part 3's last phase lands on the paper branch; merge it in again first.** This work
rewrites `sidepanel.html/.js/.css`, which Part 3 is still editing.

## Decisions

| Topic | Decision |
|---|---|
| Navigation | Keep Part 3's header (level switch + gear) and Read · Ask · Glossary tabs. The gear is the only way into Settings. |
| Read tab order | Paper card (its section map stays stuck to the top while scrolling) → overview → trust → You're in (guide) → So far → selection card. |
| Section map | One segment per paper section, width by length, states read / current / ahead. Tap scrolls the paper to that section. |
| Selection | One selection card: "Explain" (existing analysis) and "Ask about this" (opens Ask with the quote filled in). |
| Removed | Teleprompter, reader and AI mode presets, auto and manual Now reading tips, history drawer (pins, recent check-ins, resume card), Assistant status card. |
| Exports | One "Copy notes" menu: Markdown or plain text. |
| Look | Paper and ink, shared with `reader.html` through one `tokens.css`. New default accent `ink`; the accent picker stays. |
| Jargon marks | Marker highlight instead of dotted underline, in the page and in panel text. |
| Icons | Inline SVG (Lucide, ISC licence), no Unicode glyphs or emoji. No new dependency. |
| Motion | Logo waves drift while any AI stream is running; still under `prefers-reduced-motion`. |
| Onboarding | Groq key first; quiet link to local-model setup; "Try it on a sample paper" after connecting. |
| Settings | Four groups: Connection, Appearance, Privacy and data, Advanced. |

## Read tab

Top to bottom:

1. **Paper card.** Title (serif), authors and source on one line, then the trust fact
   tags from `distillTrustFacts` (preprint badge in the warning tint, date, authors, DOI
   link). The "only the abstract is here" link sits under it. The fact tags move up
   here instead of repeating in the trust card.
2. **Section map**, the last row of the paper card. It is `position: sticky` under the
   tabs, so where-am-I stays visible while the overview and other cards scroll past.
   Hidden when the paper has fewer than two sections. Under the bar:
   current section name, its plain line (below), and the existing time-left label.
   Labels show only for the current section when there are more than five sections.

   | `kind` | Plain line |
   |---|---|
   | `intro` | The question and why it matters. |
   | `methods` | How they did it. Fine to skim. |
   | `results` | What they found. |
   | `discussion` | What it means, and its limits. |
   | `other` | (heading only) |

3. **Overview and "How much to trust it".** Part 3's cards, same content, restyled.
   The trust card keeps Study, Limits and its fixed closing line.
4. **You're in.** Part 3's guide card, unchanged in behaviour.
5. **So far.** The progressive summary's gist line, then its bullets grouped under
   section labels. Today the summary is one merged list (`mergeSummaryText`, max 8
   bullets) with no section info, so the background tags each bullet with the reader's
   section (`s.section.heading`) when the summary run that produced it finishes, and
   keeps `s.bulletSections: {[bullet lowercased]: heading}` next to `lastSummary`
   (persisted by `pageStore.js`, same cap as the bullets). Untagged bullets (old saved
   state) go under no label. Prompts and the 8-bullet cap are unchanged. Check-ins
   appear inline here, as today.
6. **Selection card.** Shown when text is selected: the quote, "Explain" and "Ask about
   this". Replaces the Highlight section's header buttons.

## Removed

Delete the UI, its handlers and its storage reads; leave old storage keys in place
(they're ignored, so no migration):

- Teleprompter: `scrollPlayBtn`, `scrollSlowBtn`, `scrollFastBtn`, `scrollSpeedLabel`,
  `autoResumeToggle`, and the content-script word-by-word scroll.
- Presets: `readerModeSelect`, `aiModeSelect`. Everyone runs `balanced` tuning.
- Now reading: `nowSection`, `nowTipBtn`, `nowRefreshBtn`, `nowHintChip`,
  `autoNowModeSelect`, and the background tip task if nothing else calls it.
- History drawer: `historyDetails`, `historyActionBtn`, pinned and page analyses lists,
  `recentCheckinsSection`, `resumeCard`. The "Restored your progress" toast stays.
- Status card: `assistantStatus` (routing pill, usage pill). Progress moves into the
  section map; backend status stays in Settings → Advanced.
- Export buttons: `copyNotesBtn`, `copyNotesPlainBtn`, `copyBtn`, `exportAnalysis*Btn`,
  replaced by one "Copy notes" menu in the So far header.
- Action rows: `actionsRow` goes. Focus becomes a toggle icon in the So far header.

## Look

**`extension/tokens.css`**, linked by `sidepanel.html` and `reader.html` (its inline
`:root` block moves there):

| Token | Light | Dark |
|---|---|---|
| `--bg` (page) | `#e8e6e1` | `#1f1e1c` |
| `--paper` (cards) | `#faf9f6` | `#272624` |
| `--fg` | `#2b2a27` | `#ece9e2` |
| `--muted` | `#6b6860` | `#a29e94` |
| `--line` | `#d4d1c9` | `#3a3835` |
| `--marker` | `rgba(250, 204, 21, 0.38)` | `rgba(250, 204, 21, 0.28)` |

`sidepanel.css` maps its existing names (`--bg-surface`, `--text-pri`, …) to these, so
selectors don't change. The `ink` accent preset (`#2f4f73` light, `#a9c1dc` dark) is
added first in both `ACCENTS` (`sidepanel.js`) and `ACCENT_PRESETS` (`content.js`) and
becomes the default; existing users keep their saved choice. Fonts stay: Manrope for UI,
Newsreader for paper and AI text.

In the page, `.distill-term` gets `background: var(--marker)` with no underline. The
marker colour is fixed rather than themed because it sits on the paper's own page.

## Onboarding

The setup card becomes: one line on what Distill does, "Get a free Groq key" link, key
input, Connect. Under it: "Prefer fully private? Run a model on your computer", which
opens Settings → Connection with Local model selected. After a successful connect the
card turns into "Connected. Try it on a sample paper" linking to one fixed arXiv HTML
paper (chosen during build; must have a `citation_title` and at least four sections).

## Settings

- **Connection:** provider, key or local fields, Save / Test / Remove, usage link.
- **Appearance:** accent, this-site panel size and theme.
- **Privacy and data:** the privacy notes, Clear all saved history.
- **Advanced:** hosted backend (dev builds only), per-site backend-only toggle, keyboard
  shortcuts note.

Group headings are sentence case; rows inside are not uppercase.

## Other screens

The not-a-paper, PDF and backend-down cards use an SVG icon instead of emoji and the
new tokens. `reader.html`'s toolbar uses the same pill style as the panel tabs.

## Messages

| Direction | Type | Payload |
|---|---|---|
| bg → panel | `PAPER_HELP_STATE` | adds `sections: [{heading, kind, chars}]` from `paper.sections` |
| bg → panel | `SUMMARY_DONE` (and restore) | adds `bulletSections` |
| panel → bg | `JUMP_TO_SECTION` | `{tabId, heading}` |
| bg → content | `SCROLL_TO_SECTION` | `{heading}` — scrolls to the matching entry in `sectionHeads` |

A heading not found in the page (some PDFs) does nothing. "Ask about this" stays inside
the panel: it switches to the Ask tab and fills the question box.

## Components

- `distillSectionMap(sections, currentHeading)` in `extension/utils/paperHelp.js`, pure:
  returns `[{heading, kind, flex, state, line}]`. `flex` is `chars` scaled into
  0.5–2 so short sections stay tappable; `state` is `read` before the current index,
  `current`, else `ahead`; unknown current heading → all `ahead`.
- `extension/sidepanelPaper.js` renders the paper card, section map, selection card and
  copy menu; `sidepanel.js` loses the removed features.
- `distillGroupBullets(bullets, bulletSections, sectionOrder)` in `paperHelp.js`, pure:
  returns `[{heading, bullets}]` in paper order, untagged first with heading `''`.
- `extension/tokens.css` as above. Icons are inline SVG in `sidepanel.html`.

## Testing

- `tests/unit/paperHelp.test.mjs`: `distillSectionMap` states, flex bounds, unknown
  heading, empty list; `distillGroupBullets` order, untagged bullets, unknown headings.
- `tests/unit/pageStore.test.mjs`: `bulletSections` round-trips and is capped.
- `tests/front/sectionMap.dom.test.mjs`: map hidden under two sections, renders
  segments, click posts `JUMP_TO_SECTION`.
- `scripts/smoke.mjs`: removed element IDs no longer referenced in `sidepanel.js`; new
  message types handled on both ends.
- Visual: the stubbed panel preview, light and dark, at 360 px and 480 px.
- Real Chrome, extension loaded: an arXiv HTML paper and a PDF in the reader; check the
  map follows scrolling, tap jumps, marker highlights, Ask about this, copy menu,
  onboarding with a fresh profile, and both themes.

## Build order

Each step ends with tests and lint passing and a commit.

1. Merge the finished Part 3 in again; `tokens.css`; repoint `sidepanel.css` and
   `reader.html`; `ink` accent default; marker highlight.
2. Remove the cut features (UI, handlers, content-script teleprompter).
3. Paper card, section map, `JUMP_TO_SECTION` / `SCROLL_TO_SECTION`.
4. Bullet section tags in the background and `pageStore.js`; So far grouped by
   section; selection card; copy menu; focus toggle.
5. SVG icons, empty states, logo motion.
6. Onboarding and Settings groups.
7. README, store listing screenshots list, CHANGELOG; full Chrome check.

## Out of scope

Figures (Part 4), new AI tasks, a pinned ask bar, removing old storage keys, redesigning
the PDF reader beyond its toolbar and colours.
