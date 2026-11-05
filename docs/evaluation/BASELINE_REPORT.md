# Provisional baseline report

Captured November 4–5, 2026 on an Apple M2 Max with 32 GiB unified memory. This is engineering/model-output evidence, not a validated quality score or human study. Acceptance gates remain unmet.

## Original behavior

The frozen cd163b1 prompts and retrieval helpers produced **594 live outputs**: 11 papers × 2 installed models × 3 detail levels × (overview, section guide, selection explanation, 6 Ask questions). The twelfth paper's PMC source did not yield usable content and was withheld, not silently replaced. All original prompts assume a newcomer, including “closer to the paper”; no expert baseline existed.

The exploratory capture used temperature 0.5 and a 700-token output limit for every task. This differs from the shipped balanced limits (420 overview, 380 guide, 260 selection, 320 Ask), so the run is not a controlled production-budget comparison. Model digests, provider/server version, settings, timestamps, prompts, source hashes, first-token/completion timing and actual output remain under `dist/evaluation/baseline`. Sanitized outputs, hashes and grouped timing are committed in `evidence/baseline-outputs.jsonl` and `evidence/baseline-summary.json`. Email-shaped output is redacted in committed copies; original output hashes refer to local raw captures.

| Model | Outputs | Terminal completion with nonblank output | Empty | Truncated | Completion median |
| --- | ---: | ---: | ---: | ---: | ---: |
| Qwen 2.5 7B | 297 | 296 | 0 | 1 | 3,213 ms |
| Qwen 2.5 Coder 1.5B base | 297 | 69 | 131 | 97 | 440 ms |

“Terminal completion” says nothing about correctness, caveat preservation or usefulness. The coder **base** model is a poor reader candidate; its fast blank answers must not be marketed as good latency. It is included because it was already installed, not as a substitute for a suitable instruction model. A separate limited probe of the installed Qwen 3.6 35B returned three nonblank completed expert overviews (one paper, three detail levels; 26,442 / 4,426 / 6,116 ms), recorded separately; it is not a second full quality baseline.

The one Qwen 7B truncation was the close-detail section guide for Attention Is All You Need. Complete-looking HTTP streams and actual useful text are different outcomes. The new code rejects blank/truncated/interrupted outputs instead of saving partial answers as success.

## Extraction and supplied-evidence failures

- Production HTML intake extracted nine sources on arXiv and PLOS. PMC returned an incomplete/challenge response. Expected-section checks are recorded, but character counts do not measure semantic coverage.
- The actual PDF reader extracted LIGO and Planck section text. Original Poppler diagnostics are separate from production reader evidence.
- Planck's inline abstract initially stopped mid-word at 565 characters because later paragraph blocks were discarded. The repaired production reader retains 3,360 abstract characters. This is a measured extraction repair, not a claim that all equations/tables are intact.
- The LIGO PDF has no detected labeled abstract; table-only parameters can be missing. The panel now states that limitation. Its original table must be checked for distance/credible intervals; a model recalling such numbers from pretraining is not supplied-evidence grounding.
- A synthetic raster-only text-layer fixture produces no usable text. Empty intake cannot call overview or Ask inference. This is a fixture check, not an OCR or vision capability.
- Long paragraphs were clipped from the front, repeated query terms could dominate retrieval, and Ask's prompt clipped context again. Bounded passage windows and unique-term ranking now reduce those failure modes. Lexical retrieval still has synonym/cross-passage limits.

## Post-change evidence and limits

Targeted Qwen 7B production-budget runs cover the Facebook observational paper, the Bangladesh handwashing trial and the repaired long Planck PDF, both audiences and all three detail levels. Their actual outputs and terminal failures are recorded separately from the original baseline. The models are called through Node's loopback API; this does **not** establish successful direct extension-origin setup.

Ask now scopes abstention to supplied passages, retains unique passage IDs and exposes supplied text with source navigation. Unknown IDs receive no source controls. The machine audit records ID membership only. It cannot establish whether the passage supports a claim. Overview/guide/selection do not yet have equivalent per-claim source controls; the grounding gate is therefore not met across all tasks.

All 55 answerable reference notes for the 11 accessible papers have source-inspected draft criteria and exact extracted-paragraph ranges/hashes, with short previews. They are **not human-approved references**. Six references for the blocked PMC case and independent scoring of at least three papers remain pending. No numerical correctness/grounding acceptance rate is reported.

## Provider and UI evidence

Ordinary direct Ollama setup in fresh Chrome Settings gets the actionable origin rejection, including the exact extension ID. Wrong-model behavior remains blocked before model selection. An unreachable address was used instead of stopping the user's server. LM Studio is unavailable; Chrome's built-in API exists but reports unavailable. No server settings were changed and no model was installed/downloaded.

Automated routing and installed-package fixture requests establish that paper-bearing local inference stays at the configured loopback server even with old backend preferences. Fresh-install metadata/config requests are visible in the network evidence; this is not an offline-extension claim. Native side-panel opening, 360 px layout, following the active arXiv paper and unavailable-server recovery were observed. OS shortcuts and screen-reader use remain pending.

See STATUS.md for final automated/package counts and PROVIDERS.md for the compatibility matrix. HUMAN_STUDY.md and scores.template.json prepare the actual pilot and independent review. No participant sessions or return-use observations exist.

## Critical post-change finding and remediation

An agent source/output spot check found a materially wrong sample count in the initial post-change Facebook expert/close Ask q3: it said 500 participants, although Methods states 82 recruited people. The abstract's 500-million-user background population was not a study sample. The answer cited a real supplied passage ID; ID membership alone therefore did not catch the error. This is an observed critical source-fidelity failure, independent of terminal completion. It must remain in the evidence and blocks a passing fidelity claim.

The affected retrieval omitted explicit recruitment context. The repair prioritizes methods recruitment/enrollment passages for study/design/result questions and explicitly prohibits converting background populations into study samples. A targeted regression covers the misleading background-number pattern. Reruns of Facebook design/result questions across audiences/details are recorded in `fidelity-repair`; all critical-error adjudication remains provisional until human source review.

One expert/close handwashing selection explanation also reached the shipped 260-token limit. Its partial answer is rejected by the extension. Selection instructions now request three concise sentences and avoid elementary definitions for experts; affected selection reruns are preserved separately. Neither repair erases the failing initial output or establishes broad model reliability.

The initial repaired-Planck cohort also had a truncated close-detail newcomer guide at the shipped 380-token limit. Guide instructions now request 2–3 concise sentences and at most six short definitions; affected guides are rerun separately without changing the scoring gates.

### Final repair boundary

The first repair cohort revealed an invented 49-male count; the next revealed analysis-exclusion scope drift. Those are retained as failures. Final retrieval narrows clear study-design questions to the abstract/methods and explicitly preserves enrollment versus analysis scope. Six final design answers reported the source's 82 recruited people. One still inferred 29 males; it is unreported in supplied evidence and the final limited count guard predicts withholding that answer rather than saving it. A deterministic installed-extension check exercises this same rejection path. No general claim-verification capability is implied, and the live extension/model combination remains origin-blocked.

The six selection and six guide reruns completed at the original production limits after concise output guidance. The initial 162-case production-budget cohort retains its two truncations. In total, 801 actual model outputs are preserved across the original 594-case exploratory run, 162 initial production-budget cases, 3 larger-model probes and 42 targeted repair cases. Do not pool them into an accuracy score: prompts, retrieval and model scope differ, and human adjudication has not happened.
