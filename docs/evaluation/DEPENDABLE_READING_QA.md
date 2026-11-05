# Dependable quiet reading — verification and handoff

November 5, 2026. Implementation is local on `claude/app-ui-ux-upgrade-8add1c`. Nothing pushed, merged or published. The updated production contents are in `/Users/rahilsheth/Downloads/Distill`, preserving its path/extension identity and unrelated files.

## Delivered

- Quiet defaults: intake, restore, section changes and explanation preferences do not invoke AI. Overview is manual in all modes. Automatic summaries/guides and check-ins are separate opt-ins; Quiet reading disables both. Historical `learnMode=true` does not reactivate assistance. Existing notes/results/preferences are retained.
- Check-ins no longer create scroll-blocking overlays. Later dismisses without generating a review. Stopping automatic work preserves explicit explanation requests, including their UI state.
- Test connection explicitly identifies unsaved settings. Save & connect validates and saves the exact provider/server/model snapshot. Edited fields, stale replies, disconnections and missing replies cannot save an untested model; pending checks recover within 35 seconds.
- Supplied Ask sources have Return to reading. Capture follows visible reading/selection independently of playback; return restores focus and leaves playback paused. PDF alignment is conservative, with a view-only page fallback or Reading view when needed. Full-source identity protects session return anchors.
- Completed explanations retain their original quoted context while a replacement streams separately. Canceled/stale responses cannot overwrite them. Explain cancellation and retries use fresh request ownership; old callbacks cannot save late results.
- Reused the measurement chat's local recorder/report without overwriting the older checkout. Added local-provider and paper-help labels, current lifecycle hooks, and reproducible browser samples. No new runtime dependencies or external telemetry.

## Verification

`npm test` passes lint, smoke/API docs, and **319 tests across 34 files**. New consequential checks were observed failing before fixes, including quiz restore, automatic inference policy, cancellation, connection snapshots/timeouts, manual versus playback source return, source identity, focus/progress restoration, stale analysis, retained results, retry ownership, local metric attribution and privacy allowlists.

`npm run pack` and ZIP integrity pass. Installed production-package checks use isolated temporary profiles, not the user's Chrome data.

### Browser fixtures: 35 checks passed

Actual background worker, content script and panel; deterministic streamed responses, not answer-quality evidence. Covers quiet intake, manual overview, experience preferences, valid/invalid citations, actual passage focus and return, first-use notes export, both themes at 360/480 px, 200% zoom, visible keyboard focus, reduced motion, cancellation/retry, interrupted/context errors, demographic-count guard, hidden production backend controls, discovery, invalid-model Connect preserving previous settings, Test versus Connect, local-only inference routing, offline saved answers and restore. A **60-second reading session generated zero automatic inference requests**; restore remained quiet. The CPU trace is preserved locally; task-level attribution remains incomplete.

### Real browser surfaces and documents

The native side-panel container opened from a real user gesture, attached to *Attention Is All You Need*, and fit its 360 × 711 px viewport without horizontal overflow. The quiet overview remained manual. OS shortcut dispatch and screen-reader operation were not verified.

Actual PDFs: Planck (69 pages), LIGO (16 pages), and Attention (15 pages). Silent pacing, saved position, Reading/Original PDF switches and resize paths were exercised. In addition to earlier title/heading checks, uniquely matched **paragraphs of 306, 592 and 1,138 characters** were navigated/highlighted on PDF pages, and source return succeeded for each. This is sampled paragraph support, not comprehensive alignment or table/math extraction validation. Original/Reading position checks pass after return-progress synchronization was repaired.

Real OS speech engine startup/boundary events were observed. Perceived sound, pronunciation and naturalness were not evaluated; no human listening claim follows from engine events.

### Direct local setup on the delivered path

The production copy at Downloads/Distill was loaded in a fresh temporary profile. **Ordinary direct Ollama validation succeeds with qwen2.5:7b**, with no relay or server-configuration changes. A missing model produces an actionable error, and an unreachable endpoint produces connection recovery guidance. The real Settings Test reports unsaved settings; Connect saves the exact `local / localhost:11434 / qwen2.5:7b` configuration. This supersedes the origin-blocked result for the separate dist/extension identity, whose different extension ID is still not authorized by Ollama. The user's existing personal Chrome storage was not changed by these profile tests.

LM Studio remains unavailable in this environment; Chrome built-in live inference remains unverified. No model/voice downloads or new credentials were used.

### Performance

See `PERFORMANCE_BASELINE.md`. Thirty warm panel observations per historical/current build yielded p95 29.7/29.1 ms to a frame opportunity. Narrow warm HTML extractor benchmarks also passed their budgets. These are not native-open, complete intake, PDF or AI latency claims. Remaining performance budgets are explicitly insufficient/unmeasured, not inferred from unit tests.

## Review and limitations

Independent whole-milestone review was attempted twice: the selected reviewer required an unavailable Ollama account; the fallback produced a concrete retry finding before hitting a service usage limit. That finding was reproduced RED→GREEN and fixed, as was an independently observed automatic-cancellation UI race. A complete independent review did not finish. The author reviewed the remaining changes; do not describe this as a clean independent review or release approval.

The frozen answer-fidelity gates, reference adjudication, participant pilot, human listening, broader accessibility/PDF alignment and full performance budgets remain open. This milestone improves reading behavior; it does not validate academic answer accuracy or retention. Sketches and the coherent-surface redesign remain later milestones.

## Try it

1. In `chrome://extensions`, reload Distill; refresh open paper tabs.
2. Open a supported paper. Confirm it starts quietly; choose Generate overview or select a passage and Ask about this.
3. Inspect a supplied source, Open source passage, then Return to reading. Check both location and keyboard focus.
4. Try Explain for a second selection while keeping the previous explanation visible. Cancel/retry without losing the earlier result.
5. Enable automatic help/check-ins only when wanted; choose Quiet reading to stop automatic work. Quizzes must not prevent scrolling.
6. In a PDF, try Read along in Reading and Original PDF. Narration remains an explicit Play action, with installed local voices by default.

## Next milestone

Design the coherent surface hierarchy using measured pain points: simplify the duplicated quiet status/action, keep reading controls compact, move long contextual help into the panel intentionally, and give saved notes/source-return actions clear homes. Prototype with actual HTML/PDF papers before changing all surfaces. Continue accuracy scoring separately; do not add generated sketches until source grounding is evaluated.
