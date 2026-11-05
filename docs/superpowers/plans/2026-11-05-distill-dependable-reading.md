# Dependable Quiet Reading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reader can read, request help, verify a source and resume without unwanted AI interruptions, scroll traps or model-configuration confusion.

**Architecture:** Extend the existing paper-reader worktree, shared background request gateway, canonical read-along positions and panel state. Add small pure preference/configuration helpers rather than rewriting the app. Reuse/adapt the other chat's local measurement tooling before creating duplicate instrumentation.

**Tech Stack:** Existing plain JavaScript Chrome MV3 extension, pdf.js, Vitest/happy-dom and installed Playwright/Chrome. No new runtime dependencies.

**Spec:** docs/superpowers/specs/2026-11-05-distill-product-design.md

## Global Constraints

- Preserve all existing uncommitted changes. Never replace newer paper-reader files wholesale with main-checkout versions.
- Fresh installs start in quiet reading. Opening, restoring, scrolling, changing section or changing explanation preferences starts zero automatic AI requests.
- No new runtime dependencies for the first milestone. Instrumentation is disabled by default, opt-in and local, at most 200 completed samples per context; no persistent or remote telemetry.
- Never record URLs, titles, source/selection text, prompts, responses, credentials or personal identifiers.
- Quizzes never freeze scroll, block the document or require an answer to continue.
- Local inference and local narration are independent. Never silently route either to an online provider.
- The frozen readiness rubric remains unchanged. No merge, publishing, model installation or service configuration changes without user authorization.

## Review Focus

- Migration with saved `learnMode=true`: preserve user data but do not silently start automatic AI or resurrect a blocking quiz (Task 2).
- Service-worker restart or a PDF opened via reader.html: missing metrics are inconclusive; reading initialization still obeys quiet mode (Tasks 1–2).
- Provider/model fields edited during a connection test: no untested settings can become the connected saved configuration (Task 3).
- Source anchor invalid after navigation/re-extraction: do not jump to unrelated text or display old results as current (Task 4).
- Quiet mode enabled while work is queued: cancel automatic work while preserving explicit user requests and their source context (Task 2).

## File responsibilities and delivery boundaries

Existing `background.js`/`paperFeatures.js` own inference triggers and restore; `sidepanel.js`/`sidepanelPaper.js` own setup and result presentation; `content.js`/`reader.js`/`readAlong.js` own visible source positions and scrolling. Keep this division. Do not broadly refactor the large files in this milestone.

New focused helpers: `extension/utils/readingAssistance.js` (preference migration and trigger policy), `extension/utils/localConnection.js` (normalized configuration equality), `extension/utils/sourceReturn.js` (one versioned source return anchor). Load each with the repository's classic-script/CommonJS pattern and update explicit script/lint includes as needed.

### Task 1: Integrate measurement work against the correct baseline

**Files:** Inspect main-checkout `docs/superpowers/specs/2026-11-05-reading-performance-design.md`, `docs/superpowers/plans/2026-11-05-reading-performance-baseline.md`, and any completed implementation commits. Adapt `extension/utils/performanceMetrics.js`, `scripts/perf/report.mjs`, their unit/lifecycle tests and lifecycle includes only when available. Create `docs/evaluation/PERFORMANCE_BASELINE.md` in this worktree.

**Interfaces:** Preserve the other plan's recorder `distillCreatePerformanceRecorder({enabled=false, now=performance.now, limit=200})` and console `distillPerformance` APIs. Extend allowlisted provider labels with `local`; separate routes from providers. Record model/hardware/cold/warm grouping in operator-created manifests using isolated runs so aggregated exports never mix them. Same-context duration only.

- [ ] Inspect actual Git state and record baseline commit, dirty-file ownership, and whether instrumentation is proposed, in progress or committed. Do not write files another active agent is editing; if unfinished, record the integration dependency and continue Task 2. Do not port old paper-reader implementations.
- [ ] Review the companion measurement plan against this spec: add the `local` provider, actual paper/PDF intake boundaries, and canonical read-along restoration where applicable. Preserve all privacy bounds and finite-sample rules. Implement the measurement plan's tested tasks if there is no competing implementation.
- [ ] Add/extend tests for local inference timing, reader.html initialization, disabled instrumentation doing no work, and service-worker restart resulting in empty/missing samples rather than zero latency. Run relevant focused tests before/after hooks.
- [ ] Collect an actual pre-change baseline in temporary profiles using fixtures and available real papers; keep historical reports separate. Report pending scenarios if tooling integration remains blocked. Never use happy-dom timings as browser performance or make extra inference calls solely to satisfy sample quotas.
- [ ] Verify offline report statistics and privacy export allowlists. Record pass/fail/insufficient/unsupported per budget in PERFORMANCE_BASELINE.md with environment and run boundaries. Commit only reviewed integration files and evidence.

### Task 2: Quiet defaults and nonblocking assistance

**Files:** Create `extension/utils/readingAssistance.js`, `tests/unit/readingAssistance.test.mjs`, `tests/front/quietReading.dom.test.mjs`. Modify `extension/background.js`, `extension/paperFeatures.js`, `extension/content.js`, `extension/sidepanel.js`, `extension/sidepanel.html`, `extension/sidepanel.css`, relevant script includes and lint configuration.

**Interfaces:** `distillReadingAssistance(prefs)` returns `{schemaVersion:1, automaticHelp:boolean, checkins:boolean}`. Read/save under `readingAssistance`; unset/invalid values resolve to false/false regardless of historical learnMode. Quiet means both flags are false; the Quiet reading action sets both false. A checkins-only configuration is assisted, not quiet. `distillMayAutoRun(assistance, task)` permits summary/section guide only with automaticHelp, quiz only with checkins, and never overview. Overview is manual in all modes. Explicit actions bypass auto policy but retain normal provider/error handling. Tag work as `origin:'automatic'|'user'` at existing task entry points; carry that through queue/abort ownership so mode changes cancel only automatic work. No separate provider pipeline.

- [ ] Write failing policy tests: fresh/unset/invalid prefs, legacy learnMode=true, automaticHelp only, checkins only labeled assisted, Quiet action disables both, overview remains manual in every configuration, and explicit actions allowed in quiet. Assert migration retains unrelated stored keys and saved paper data.
- [ ] Inventory every automatic trigger: paper intake/overview, paragraph summary cadence, section changes, audience/detail changes, restore of unfinished work and quiz restore. Write browser/DOM regression cases that count gateway calls after these events: zero in quiet; explicit overview/guide/Ask/Explain work; valid caches render without a request.
- [ ] Implement the preference helper and guarded trigger calls. Add clear Generate overview/Guide actions in quiet empty states, one Automatic reading help preference, separate Check-ins preference and a visible Quiet reading action that disables both. Label active assistance explicitly. Migrate unset preferences to quiet once and display a nonmodal explanation; use the new preference as source of truth for the existing check-in control.
- [ ] Write regression cases for queued automatic work canceled by quiet, already active automatic work aborted, explicit work not canceled, and late results rejected. Implement origin ownership at existing queue/cadence entry points. Do not infer origin from task name; the same task can be requested manually.
- [ ] Remove freeze overlay/scroll guard activation and all sends/restores of FREEZE_SCROLL. Remove obsolete overlay CSS/functions, tolerate old messages safely, and preserve dismiss/skip/answer flows. Add Later to dismiss without marking an answer or forcing reread. Assert wheel/keyboard scrolling and active read-along remain available during quiz display and restore.
- [ ] Run focused tests and `npm test`. Use installed-browser network/request inspection to verify zero automatic AI requests during intake, 60-second reading and restore in quiet. Distinguish local paper/config fetches from inference. Commit the policy and nonblocking changes together.

### Task 3: Connect the exact model that was tested

**Files:** Create `extension/utils/localConnection.js`, `tests/unit/localConnection.test.mjs`. Modify `extension/sidepanel.js`, `extension/sidepanel.html`, relevant includes/lint configuration, and `tests/front/onboarding.dom.test.mjs`.

**Interfaces:** `distillLocalConnectionSnapshot({baseUrl,model})` returns normalized `{baseUrl,model}` using the same trailing slash and `/v1` normalization as `localChatConfig`; `distillSameLocalConnection(a,b)` compares those exact normalized fields. Each pending validation contains `{requestId, intent:'test'|'connect', provider, localSnapshot}` in addition to existing key fields. Preserve background request-id matching and existing cloud-key behavior.

- [ ] Add failing regressions: Test checks unsaved qwen2.5:7b while saved/default model is qwen3:4b; test success must say “Test passed; connection settings are not saved.” Connect validates and atomically saves the tested model/address/provider only on success.
- [ ] Add regressions for model/address/provider edits during validation, out-of-order replies, failed checks, disconnected ports, and repeated clicks. A changed field invalidates the request and re-enables retry; no stale reply can save fields or show Connected. A lost reply exits pending state with an actionable error within 35 seconds; reconnect does not silently resubmit inference.
- [ ] Implement snapshot normalization and separate Test versus Connect intents. Show Connected only for the matching saved successful configuration. Cloud-key handling must preserve its existing validation safety. Set current saved local preferences before returning to Read; do not download a missing default model automatically.
- [ ] In a temporary profile, test with actually installed qwen2.5:7b and a deliberately invalid model name. If the test profile's origin is rejected, record the block and use fixtures for the UI contract; do not change Ollama permissions without authorization or count a relay as direct setup success. Retry a paper task and inspect the actual requested model.
- [ ] Run focused tests and `npm test`, update setup instructions, and commit the setup fix independently.

### Task 4: Keep context through results and source jumps

**Files:** Create `extension/utils/sourceReturn.js`, `tests/unit/sourceReturn.test.mjs`, `tests/front/readingContinuity.dom.test.mjs`. Modify `extension/sidepanelPaper.js`, `extension/sidepanel.js`, `extension/content.js`, `extension/reader.js`, `extension/readAlong.js` and script/lint includes only where needed. Reuse `extension/utils/readAlong.js` and current paper-help source IDs/retrieval.

**Interfaces:** One return anchor `{schemaVersion:1,paperKey,sourceVersion,blockIndex,charOffset,view:'html'|'reading'|'pdf',focusTarget}`; charOffset is an absolute canonical-source offset and blockIndex is a validated mapping hint. `distillValidSourceReturn(anchor,{paperKey,sourceVersion,textLength})` rejects mismatched versions/pages and out-of-range positions. Derive sourceVersion from extracted text, not length alone. Use versioned full-source hashing with Web Crypto where feasible. Capture a visible selected passage if present, otherwise the visible block at the 35% viewport reading line and its nearest text offset. In PDF view invert the existing alignment mapping; on ambiguity capture current page plus viewport-relative location as a view-only fallback, not a fabricated canonical anchor. Keep that fallback in a separate `{paperKey,sourceVersion,page,relativeY}` record valid only in the unchanged PDF view. Pause active playback at its last confirmed position, preserving its cursor separately. `focusTarget` is an allowlisted control identifier, never arbitrary executable markup or a stored CSS selector. Anchor memory is per current paper session; durable reading position uses existing storage.

- [ ] Write regressions for source jump → Return restores visible reading offset and focus, including manual scroll far beyond the playback cursor; paused speech retains its separate confirmed cursor and never restarts on return. A second jump replaces the single return anchor; switched paper or changed source invalidates the anchor instead of jumping to another occurrence. HTML and PDF controls must follow their visible view, including the view-only PDF fallback when inverse alignment is ambiguous.
- [ ] Implement Return to reading on evidence navigation using the existing canonical model. If PDF alignment is uncertain, offer Reading view and preserve the requested passage; never highlight an unrelated match. Preserve the current view when supported. Do not create a second scroll-follow controller.
- [ ] Add result-state regressions: old completed answer remains labeled for its original passage while new work loads; cancellation/failure leaves it intact; stale callbacks cannot append to the replacement or another paper. Keep selection available for retry. Implement separate pending and completed result contexts where missing.
- [ ] Test reload/tab/view changes with saved notes and positions, a repeated source phrase, modified source content, a scrolled manual-follow pause and keyboard-only source return. Switching views must not implicitly start playback or inference. Offline cached results remain available; an uncached remote paper is explicitly unavailable rather than claimed offline.
- [ ] Run focused tests and `npm test`. Verify a real HTML paper and three existing real PDFs with different layouts; report unmatched cases rather than treating a title-only match as complete PDF support. Commit continuity fixes.

### Task 5: Installed-package acceptance and next design brief

**Files:** Add `scripts/eval/research/dependable-reading-browser.mjs`, `docs/evaluation/DEPENDABLE_READING_QA.md`; update PERFORMANCE_BASELINE.md, docs/evaluation/STATUS.md and relevant setup documentation. Retain the benchmark's source/version records.

**Interfaces:** Browser checks use the actual production package and temporary Chrome profiles, alongside explicit deterministic fixtures. Emit sanitized results by scenario with `pass|fail|insufficient|unsupported`; retain failures. Do not mix fixture results with live quality scores.

- [ ] Run Task 2–4 scenarios in the actual native side-panel workflow, 360/480 px widths, both themes, 200% zoom, keyboard and reduced motion. Check HTML, Reading/Original PDF, disconnected provider, invalid model, extraction failure, cancellation/retry, stale replies and offline cached state. State which screen-reader and actual audio listening checks were performed or remain pending.
- [ ] Repeat baseline measurements on the same environment/inputs after changes. Separate HTML/PDF, cold/warm, cache/fresh and provider/model groups. Do not attribute page long tasks to the extension from a duration alone; compare traces. Document unmet targets without replacing them with test counts.
- [ ] Run `npm test`, `npm run pack`, `unzip -tq dist/distill-3.0.0.zip`, then verify the installed production build. Re-run only affected live-model cases; retain the frozen quality protocol and existing critical-error evidence.
- [ ] Record the first-five-minute walkthrough: open supported paper → quiet reading → Ask about this selection → inspect supplied source → Return → save/export note → reopen at position. Use Ask's existing source controls, not hypothetical Explain citations. State engineering readiness separately from accuracy and participant usefulness.
- [ ] Document milestone 2's design inputs and measured pain points, not speculative feature tickets. Prepare a separate coherent-interface plan before altering all surfaces; sketches, scheduling/cache limits and full AI reliability each need their own subsequent plan.
- [ ] Commit scoped code/docs/evidence. Update Downloads/Distill in place only when requested for the next test build; preserve its path/identity and unrelated files. Do not push, merge or publish as part of this plan.

## Scope and completion

This plan implements milestone 1 only. It does not implement drawings, a full UI redesign, semantic search, neural voice installations or a new task scheduler. Scoring existing answers and preparing participant sessions can continue independently. A blocked instrumentation integration or unavailable model is reported explicitly; unrelated engineering tasks can proceed. The milestone is complete only when the specified behavior works and the evidence report names remaining quality/environment limitations. User review of the written scope precedes implementation.
