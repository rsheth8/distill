# Dependable-reading performance evidence

November 5, 2026. Local operator-run Chrome for Testing on arm64. These are narrow engineering measurements, not user or model-quality validation.

The measurement chat completed its work in the older main checkout as uncommitted changes. Its recorder, report and tests were copied without changing that checkout, then adapted for the paper reader, local provider and paper-help task names. The new lifecycle hooks preserve the current implementation; older background/panel files were not copied. Diagnostics are disabled by default, content-free, memory-only, and capped at 200 samples per context. See `docs/performance-baseline.md` for console controls and offline export. Model/hardware/scenario cohorts must be kept separate by the operator; the content-free export cannot reconstruct those groups afterward.

## Observed browser samples

To recover a pre-change comparison after measurement-tool integration became available, the historical extension was reconstructed from `0e7dd4d` into task-owned scratch, with the same production backend flag as the current package. Each ran in a separate fresh temporary profile, sequentially, on the same machine. Neither used inference. There is one cold panel observation and 30 warm observations per build. Extraction samples repeatedly execute the build's actual extractors on fixed synthetic HTML; they exclude navigation/fetch, full intake, PDF reconstruction and layout startup.

| Scenario | Historical p95, ms | Current p95, ms | Current target/status |
| --- | ---: | ---: | --- |
| Warm panel initialization → next frame opportunity, n=30 | 29.7 | 29.1 | 300 ms / pass for this boundary |
| Typical HTML warm extractor functions, approximately 2,000 words, n=30 | 0.4 | 0.3 | 500 ms / pass for this narrow benchmark |
| Long HTML warm extractor functions, approximately 10,000 words, n=30 | 0.8 | 0.9 | 1,000 ms / pass for this narrow benchmark |

These differences do not establish a meaningful speed improvement. Frame opportunities are paint proxies, not pixels verified by a person. Cold samples are insufficient for p95 conclusions. Full PDF intake, restoration presentation, cached-result presentation, AI latency by actual model, and cancellation presentation remain insufficient/unmeasured against their budgets. Do not claim all performance targets passed.

The installed-package fixture walkthrough records a 60-second quiet reading trace and verifies zero automatic inference requests during that period and after restore. The first captured trace contained 52,275 events and no individual extension-attributed FunctionCall span over 50 ms. That is not proof that every extension-attributed main-thread task was under 50 ms; task-level attribution requires a broader trace review. Final trace and run counts are recorded in the QA evidence, separately from these initial samples.

## Reproduction

Use an already installed Playwright and Chrome via `DISTILL_PLAYWRIGHT` and `DISTILL_CHROME`. `node scripts/perf/browser-baseline.mjs` tests `dist/extension`; optionally set `DISTILL_BASELINE_EXTENSION` to a separately reconstructed historical extension. It writes observed durations under ignored `dist/evaluation/dependable-performance`. `npm run perf:report -- export.json` validates diagnostic samples and reports outcome-separated groups; small groups remain insufficient. It never merges different model/hardware/scenario runs automatically.

No benchmark triggers paid/cloud inference, changes Ollama settings, or modifies a personal Chrome profile. Original source copies, screenshots and raw browser CPU traces stay in ignored local evidence; committed measurement evidence contains only numeric samples and operator-authored scenario metadata.
