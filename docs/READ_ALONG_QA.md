# Read-along design, verification and walkthrough

November 5, 2026. Local test build; nothing merged or published.

## Design

Immutable block/character offsets drive silent word pacing, speech, source navigation and selection starts. DOM ranges leave source text intact. Section reporting consumes the same block. Existing notes/storage stay intact; reading positions use a separate versioned per-paper key. Restores validate length and initial source sample. View switches preserve the offset. Manual wheel/touch/navigation keys suspend following; Resume following restores it. Hidden tabs pause. Pause cancels speech and resumes from the last confirmed boundary, so a few words can repeat.

Installed Web Speech voices are the zero-download path, filtered by `localService`. Chrome on this Mac exposes Samantha plus other installed OS voices. Speech reads exact extracted text in sentence chunks bounded to 320 characters, using independent speech rate and silent WPM. Generation guards discard stale callbacks. Word highlights use actual engine boundaries; without events a chunk/sentence range stays highlighted. Online voices require session opt-in and selection. No API credentials or provider SDK added. Service identity, billing and availability depend on the browser voice service; online voices were not exercised.

[Chrome speech documentation](https://developer.chrome.com/docs/extensions/reference/api/tts) documents OS speech, variable event support and cancellation. [Web Speech specification](https://webaudio.github.io/web-speech-api/#dom-speechsynthesisvoice-localservice) defines local-service classification. [Piper](https://github.com/OHF-Voice/piper1-gpl) is a feasible optional neural engine requiring engine/model installation and integration. It was not installed or benchmarked; improved listening quality is not established. OS voices need no extension-managed model memory/download and yielded responsive word events here; pronunciation/naturalness remain unscored.

Original PDF alignment prefers a whole source block and then a bounded sentence, requiring uniqueness across the PDF and within its page. Ranges project onto selectable text layers, preserving layout. Lazy rendering triggers repaint; source resolution can navigate to an unrendered page. Resize rebuilds canvases/text layers. Missing matches display a Reading view fallback. Repeated headers are rejected. Page lookup preserves PDF end-of-line metadata; rendered text ranges count line breaks so line-end hyphens can align. Other extraction/order discrepancies still fail closed.

## Evidence

- `npm test`: 286 tests across 26 files pass, including lint, smoke/API docs and coverage. New tests cover offsets, quantities, chunk bounds, ambiguous/repeated PDF context, stale callback cancellation, silent pause, manual-follow suspension and local/online routing. DOM speech adapters are fixtures.
- `npm run pack` and ZIP integrity pass. Production contents copied into `/Users/rahilsheth/Downloads/Distill` without deleting unrelated files, then loaded from that directory in an isolated Chrome for Testing profile.
- Reproducible harness: `scripts/eval/research/read-along-browser.mjs`. Requires existing Playwright and Chrome via `DISTILL_PLAYWRIGHT`, `DISTILL_CHROME`; optional `DISTILL_EXTENSION_DIR` selects the copied package. Planck uses existing `dist/evaluation/accuracy-source/planck-v3.pdf`; the other PDFs load from arXiv.
- Seven HTML checks: silent advancement, immediate reload persistence, 360/480 px controls in light/dark with reduced motion, real local speech start/stop. No page JavaScript errors.
- Samantha local voice entered speaking state, emitted actual word boundaries and stopped after Stop. No speech callbacks simulated in browser harness. **No perceived sound, pronunciation or naturalness was heard/evaluated by the agent.** This does not fulfill the requested human listening acceptance test.
- Real PDFs: Planck 2013 XVI (69 pages), LIGO 1602.03837 (16 pages), Attention 1706.03762 (15 pages). Position survives Original/Reading switches and viewport resize; text layers render and unique first-page matches highlight. Latest first-page matches include titles/headings; earlier runs also matched LIGO body text and Attention footnote text. These are smoke checks, not full-document alignment or equation/table validation.
- Browser request logs showed paper fetches and no remote speech requests during local narration. OS/browser speech traffic is outside this log; no packet-level offline proof. Code only invokes a selected voice marked local and never silently selects a remote fallback.
- Raw results, installed voice inventory and screenshots: ignored `dist/evaluation/read-along/`.

## Limitations / acceptance gaps

Scanned PDFs without selectable text remain unsupported, explicitly showing original pages. No OCR added. Two-column order, equations, tables, citations, URLs, footnotes and scientific pronunciation inherit existing extraction and selected voice behavior. No paraphrases or invented mathematical/figure descriptions. Use Next / skip and source/Reading view controls. There is no dedicated equation pronunciation or table-reading policy yet.

Passages split across pages or affected by line hyphens/order changes may fail alignment. Page placeholders use first-page dimensions. Resize is tested; actual browser zoom and long-document memory behavior need broader QA. The independent reviewer caught hidden-view resize and remote-only auto-selection bugs; regression tests now cover both. Scroll-based read-summary bookkeeping remains; selection explanations still use existing serialized DOM anchors. This is not a complete migration of every legacy feature to canonical positions. Source jumps can land at paragraph starts.

Human audio comparison, screen-reader assessment, full keyboard journey, sustained long-paper playback, offline packet capture, remote-provider failure testing and comprehensive lazy-page/zoom/navigation matrix remain unperformed. No optional neural installer ships. Browser harness reports individual PDF failures in JSON; process exit alone is not a PDF pass.

## Walkthrough

1. Reload Distill in `chrome://extensions`, then refresh open paper tabs. Keep `/Users/rahilsheth/Downloads/Distill` as the installation path.
2. Open an HTML paper or Distill's PDF reader. Expand Read along at lower right. Select a passage, then Start from selection; Alt-click also sets position. Play in Silent mode and adjust Silent WPM.
3. Try Previous, Next / skip and Pause. Scroll manually; following pauses. Resume following returns to the position.
4. Choose Narration, an installed local voice, Preview, then Play. Adjust Speech rate separately. Stop preserves position; leaving the tab pauses playback.
5. Switch between Reading and Original PDF. Unique aligned passages highlight; otherwise use Show Reading view. Reload to restore position. Online voices stay hidden until enabled for this session.
