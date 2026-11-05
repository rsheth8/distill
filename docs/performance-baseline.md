# Measuring Distill

Diagnostics are local, disabled by default, and keep at most 200 completed numeric samples per execution context. No URLs, article text, API keys, prompts or responses are collected. No samples are stored or transmitted. Enabling or disabling starts a fresh collection; worker restarts, navigation and panel closure lose that context's samples. Export before leaving.

## Collect a session

1. Reload the unpacked extension in `chrome://extensions` after updating its files. Reload the article as well.
2. Open DevTools for the side panel and the service worker. In article DevTools select Distill's **isolated content-script context**, not the page's main context.
3. In each relevant console run `distillPerformance.enable()`.
4. Read, request tips/explanations, repeat a request to exercise caching, and revisit an already-read article. Do not make paid calls just to fill a quota.
5. In each context run `copy(JSON.stringify(distillPerformance.snapshot(), null, 2))` and save the clipboard text as a JSON file. `copy` is a Chrome DevTools helper. Export contexts separately.
6. Run `distillPerformance.disable()` when finished. Normal reading uses the disabled path; no sample storage or frame scheduling occurs there.

Run the offline report:

```sh
npm run perf:report -- worker.json panel.json content.json
npm run perf:report -- --check worker.json panel.json content.json
```

Exit codes: 0 = valid report (which may still be inconclusive); 1 = a sufficiently sampled enforced budget failed with --check; 2 = malformed, missing or oversized input. Never equate exit 0 with all targets passing. Input files must each contain one version-1 export with at most 200 samples and be at most 1 MB.

## What the timings mean

- `ai_first_text`: gateway entry to first non-whitespace streamed text, retained only if the request completes successfully.
- `ai_complete`: gateway entry to completion, error or cancellation; includes settings reads, backend probing/authentication and actual provider dispatch. Direct and backend routes are separate. Backend provider is labeled `backend` because the browser cannot reliably identify its model.
- `cancel_ack`: local abort event to the gateway settling. This does not prove that provider computation or billing stopped. Existing cancellation is primarily for reading tips; this change does not add cancel controls for every task.
- `extraction`: actual synchronous `extractArticle` call. Does not include block collection, annotation or subsequent rendering. Use a trace for total detection cost.
- `restore_load`: actual session/local persisted-state hydration on GET_STATE, including fallback storage reads; not complete reopening/resume.
- `restore_presented`: RESTORED notice receipt to next frame opportunity; does not prove scroll position or every highlight was restored.
- `cache_presented`: cached-message receipt to next frame opportunity, excluding lookup and IPC.
- `action_feedback`: selected AI-button click dispatch to next frame opportunity, not a check that loading text appeared.
- `panel_ready`: panel-script initialization to next frame opportunity, if diagnostics were enabled before initialization. It excludes navigation, HTML parsing and preceding scripts.

UI measurements are **proxies**, reported as manual rather than passing a full user-facing budget. For startup, normally use Chrome's navigation/Performance trace. Pausing at a breakpoint before panel initialization allows enabling the console helper, but debugger-paused runs are diagnostic only and must not be used as benchmark evidence. Navigation/closure resets opt-in. A running context can be cleared with `distillPerformance.clear()`.

First-text and completion timings are grouped by task/provider/route/cache/outcome. Error/canceled counts are separate; an empty stream is a diagnostic error and has no first-text measurement (the existing UI callbacks are unchanged). Rates can be derived from terminal `ai_complete` counts, never by adding first-text rows to completions. Capture software/model versions separately because exports deliberately exclude identifying/freeform metadata.

## Reproducible browser protocol

Use four fixed local HTML fixtures served on localhost: a roughly 2,000-word article, a roughly 10,000-word article, a technical article with code/tables/lists, and an article populated after load. Save the fixtures used with the result so future comparisons use identical content. Chrome must have the unpacked extension enabled for localhost. A fixture server can be started with `python3 -m http.server 8080 --bind 127.0.0.1` in the fixture directory.

Record operator-authored metadata outside the diagnostic export: date, extension version and git revision plus dirty status, Chrome version, machine, article fixture, cold/warm state, model, route and network conditions. Keep each environment and fixture's exports in a separate folder. Never pool cold/warm, short/long, different machines, routes or providers to obtain enough samples.

For local p95 collect at least 30 observations per scenario. AI latency needs at least 100 successful requests per task/provider/route group for a conclusive p95; build this dataset during normal use rather than creating a burst of requests.

| Check | Procedure | Budget |
| --- | --- | --- |
| Warm panel | Record opening from click through useful visible UI in Chrome Performance | p95 300 ms |
| Resume | Close/reopen panel and reload article; verify position/highlights/results and record time to useful restored state | p95 500 ms |
| Scroll | Trace 60 seconds of reading each fixture; attribute long tasks to extension scripts | No extension task over 50 ms |
| Extraction | Enable content diagnostics then use Re-scan, classify by fixed fixture | p95 500 ms short / 1,000 ms long |
| Cached answer | Repeat explanation/selection, trace action through visible cached result | p95 100 ms |
| Action feedback | Click explain/analyze; inspect visible feedback in trace | p95 100 ms |
| AI | Export worker data during normal use; compare short tasks independently | first text median 2 s / p95 5 s; complete median 6 s / p95 12 s |
| Cancellation | Supersede a tip; confirm obsolete text stops and local request settles | p95 200 ms |
| Quiet reading | Disable automatic assistance and Learn Mode; read/scroll without invoking AI | Zero automatic requests |

Usability checks: notes and highlights survive reload; offline reading/notes/cached explanations remain usable; retry preserves selection; cancel does not alter reading position; quiz skip restores free scrolling; every core action works with keyboard focus. Record failures, including current forced quiz scrolling, rather than treating these as already fixed.

Review 50 outputs for material unsupported claims and quiz answerability, with source passages supplied to reviewers. Track numerator/denominator. Citations and structured schemas remain N/A until implemented. Target rates and later resource budgets live in the design document; this milestone measures and reports, without enforcing request concurrency, token limits or cache eviction.
