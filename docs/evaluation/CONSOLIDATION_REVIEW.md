# Consolidation review — November 5, 2026

Status: engineering candidate; academic accuracy gate FAILED. No release approval.

## Changes and evidence

The interrupted accuracy work preserved generic headline results and discussion caveats in bounded Ask retrieval. A further reproduced failure showed that generic result questions selected regression procedures and background instead of quantified outcome findings. The new regression failed before result-section/quantified-finding ranking and passes afterward. Passage IDs, source offsets, and total input budgets are retained. Extension/backend prompts remain identical and explicitly preserve uncertainty, subgroup context and coefficient scales. The evaluation runner now honors `--levels=close`; earlier accidentally captured simple/everyday cases remain preserved and separate.

Prior repairs: 12 Facebook captures (four intended close-detail cases plus eight extra detail-level cases), four Planck captures, two handwashing guides. This session adds four Facebook result/limitation cases, two coefficient-scale probes and two final-candidate result cases using installed Qwen 2.5 7B, temperature 0.5, shipped 320-token Ask budget, sequential local inference. All 26 captures are sanitized in `evidence/accuracy-repair-*-outputs.jsonl` and `evidence/consolidation-*-outputs.jsonl`. Prompts and paper caches remain ignored. These add to, rather than replace, the earlier 801 outputs.

`evidence/consolidation-diagnostics.json` records 16 close-detail Ask cases with claim assessments and provisional correctness/caveat/usefulness ratings. This is author-run diagnostic review, not human-approved scoring under the frozen protocol, independent adjudication, a representative sample, or a release percentage. The two guides are discussed below without adding them to the Ask denominator.

## Accuracy findings

- Old Facebook newcomer result: confuses between-message affect with two-week life satisfaction; a critical factual error. Expert result preserves the two time scales but omits reported coefficients.
- Updated result retrieval supplies both actual outcome passages, including B=.08 and B=−.012. Both audiences now retrieve/cite them, but invent a per-use interpretation; the expert also invents a per-day slope. This is not a quality pass.
- A final general coefficient-scale prompt probe removes the per-day wording, but the expert still says “each additional use.” The newcomer uses generic per-unit wording without defining the measurement scale. Critical unit interpretation remains unresolved. Do not keep stacking prompt edits or describe retrieval success as answer correctness. Next investigation should compare a structured evidence-first answer representation with free-form coefficient interpretation, evaluated on held-out papers before rollout.
- Facebook limitation reruns identify generalizability or the need for experimental causal confirmation, with supplied Discussion IDs.
- Planck reruns preserve H0=67.3 ±1.2 km/s/Mpc. The source PDF Table 5 supports the Planck+WP+highL combination, but the cited abstract alone does not establish that combination. Answers still omit the 68% error convention; low-multipole caveats are partly retained. This is partial repair, not full uncertainty preservation.
- Handwashing guides no longer attribute the young-contact association to intervention. However, the expert guide mostly describes the section without the primary null result; both define the index case more strongly than the source warrants (PCR confirmation was not required for all index cases). Broad null wording also omits the subgroup SAR 1.49 (1.01–2.19). These guides remain incomplete, not independently validated.

## Consolidation and verification

The UI branch already contains the local-model and earlier paper-reader branches, plus the performance recorder/report integration in cb9dacb. The older main checkout is preserved with its unrelated uncommitted changes; copying its old background/panel files would regress the paper reader. PR #3/#4 are historical predecessor work; PR #5 is the combined candidate.

Fresh `npm test`: 328 tests across 34 files, lint, smoke/API documentation and coverage pass. Fresh production package builds successfully. Installed-package Chrome fixture verification, ZIP/source-byte checks, independent review and final PR/CI state are recorded in the final handoff below when complete. Browser fixtures verify behavior, not model answer accuracy. Human listening, full accessibility, human reference approval and pilot sessions remain pending. Live LM Studio/Chrome built-in inference and most performance budgets remain unverified. Direct Ollama validation on the Downloads extension identity was verified by the later dependable-reading milestone; older origin-blocked notes describe a different extension identity.

## Independent engineering review and fix pass

A fresh read-only reviewer inspected focused paths across cd163b1..6ecb596 plus the unfinished accuracy changes, using synthetic VM/happy-dom reproductions. It found five Important bugs and no Critical engineering findings in that bounded coverage. Each finding was reproduced as a failing regression in this session before the fix:

1. Stop aborted only active paper-help inference. Queue epochs now invalidate older pending jobs, guard a job stopped during async setup, and remove canceled queued Ask entries. Newly submitted jobs still run serially.
2. Quiz-feedback errors could discard an explicit explanation's UI owner. Feedback errors are task-scoped, analysis errors carry request identity, and unrelated retry errors preserve the active explanation and other thinking indicators.
3. Citation A → citation B replaced the original return anchor. A source-checking excursion now retains its first anchor until Return.
4. Original PDF page fallback rejected return from Reading view. Return restores Original PDF before restoring the saved page offset.
5. Paragraph-ID deduplication excluded later windows containing uncertainty even with spare context budget. Retrieval now merges contiguous context under the same paragraph ID when it fits the total budget. Saved provenance retains up to the same 5,000-character passage limit, so reload cannot silently strip the interval again.

Two additional consequences were reproduced RED→GREEN: canceled queued Ask entries remained saved, and merged sources were cut back to 1,200 characters in persistence. An unscoped retry error regression also fails before ownership handling and passes afterward. Final full suite: **328 tests / 34 files** including lint, smoke/API docs and coverage.

Deferred Minor: the existing “Refresh overview” action returns the cached overview at unchanged audience/detail rather than regenerating. This remains documented; no new feature or cache policy was added in this fix pass.

Reviewer declined corpus-wide fidelity, live provider compatibility, actual PDF alignment coverage, speech quality, accessibility, performance and usefulness. Ruling: retain those as explicitly unmet/unverified gates; synthetic engineering review cannot establish them. Cost if mistaken: overstated release confidence. The author fixed/retested the reported engineering issues; no second independent review or blanket whole-repository approval is claimed.

## Final-candidate model probe

After the review fixes, two additional close-detail Facebook result captures were collected at unchanged shipped settings (`reviewed-candidate-outputs.jsonl`). Both retain the correct time scales and coefficients and use generic predictor-unit wording, without the earlier per-day/per-event wording. Neither fully defines the scale or preserves reported significance/caveat context; the newcomer also lacks inline citations. The two provisional diagnostic ratings remain incomplete, not acceptable under the frozen rubric. These two observations do not erase prior critical failures or establish held-out accuracy, and the academic release gate remains unmet.

## Final package handoff

Source commit: 96d06aad8dceb34cde167eddf8f44c43803fc335. Final production ZIP/source-byte integrity and Downloads copy verification pass. All **35 final installed-package fixture checks pass**, including the 60-second zero-automatic-inference session, reload and offline saved answers. A separate real browser read-along run passed seven HTML controls/speech checks and sampled paragraph navigation/highlight/return on Planck (69 pages), LIGO (16) and Attention (15). OS speech events were observed; listening quality remains unassessed. Sanitized evidence and final archive hash: `evidence/consolidation-engineering.json`.

PR #5 is the draft integration candidate; predecessor PRs #3/#4 remain open and unchanged. Both the UI worktree and the separate main checkout are preserved. No merge or publication. The next accuracy milestone requires source-approved reference scoring and evidence-first quantity representation evaluated on held-out cases, rather than another unscored prompt-only change. Human sessions and missing provider/accessibility/performance checks remain separate work.
