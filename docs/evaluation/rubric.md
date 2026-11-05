# Frozen evaluation protocol, v1

Created 2026-11-04; gates copied from the readiness plan before quality scoring. Do not change thresholds after seeing scores. No outputs have been scored against human-verified references yet.

## Corpus and references

`papers.json` contains 12 papers and six questions per paper. Categories overlap. Source pages/PDFs remain at their publishers; full source and model-input caches stay in ignored `dist/evaluation/`. Record version, URL, retrieval timestamp and SHA-256. PDF Poppler diagnostics are not evidence that Distill's PDF intake worked; `production-pdf.json` is separate evidence from the actual reader.

Before quality scoring, a human reads each source and approves reference notes for question, design/population, numerical result (including units and interval type), limitation and methods/results question. Each note needs a short exact passage, section/page and an answer criterion. The sixth question deliberately asks for private contact information absent from the supplied paper. The agent's reference candidates are drafts, not manual human verification. A source-access failure stays unscorable, not a model failure or a zero-quality paper.

An independent reviewer should double-score at least 3 of 12 papers, stratified across fields and document types; include both audiences, all tasks and models for those papers. Reviewers score blind to model identity when practical. Record disagreements, adjudication and inter-rater agreement. Until a reviewer exists, all scores are provisional. No simulated reader counts as a participant.

## Unit of scoring

One output at one audience/detail/task/model/paper is a case. Score every substantive claim, not only the answer as a whole. Mark unsupported, contradicted, partly supported or supported; distinguish direct author claim, inference, and outside background. A supplied-passage ID verifies provenance only. Inspect the cited passage for support and use the source navigation control to verify its destination.

For each output record:

- Correctness: 0 materially wrong; 1 incomplete/minor error; 2 correct for the task.
- Caveats and quantity preservation: 0 materially misleading; 1 partial; 2 preserves study type, sample, units, direction, uncertainty and main caveat when relevant.
- Audience usefulness: 0 unusable; 1 needs repair; 2 understandable/actionable for that audience without loss of meaning.
- Grounding: supported claims / all substantive claims, with each claim and passage ID recorded. Uncited substantive claims count in the denominator. Unsupported IDs get no source-navigation credit.
- Critical error: fabricated finding/citation, reversed direction, materially wrong sample/units, or unjustified causation. Any one fails the source-fidelity gate and triggers repair/rerun of affected cases.
- Answerable task acceptable: correctness=2, caveats=2, usefulness≥1, no critical error. Unanswerable task acceptable: explicitly abstains without invented details. A retrieval miss must not be presented as proof of absence from the full paper.
- Extraction: usable supported content, clearly incomplete/unsupported, or silent failure. Record missing tables, figures, math, headings and reading-order problems separately from retrieval failures.

Report denominators and failures by audience, detail, task, model/provider, field, format and paper length. Never replace missing cases with a passing aggregate. HTTP completion, schema compliance and deterministic fixture checks are not quality scores.

## Gates

- Zero observed critical errors; a sampled result is not a guarantee.
- All rendered source controls refer to supplied passages; ≥90% supported substantive claims.
- ≥90% acceptable answerable tasks; no invented answers to unanswerable questions.
- Every corpus intake usable or explicitly incomplete/unsupported.
- Every advertised provider completes ordinary fresh-profile setup where supported; explicit unavailable states and no silent cloud fallback.
- No unresolved blocker for intake, source verification, Ask, note export, keyboard use or recovery.
- Pilot target: ≥80% core-task completion without moderator rescue, no recurring serious misunderstanding, and concrete repeat-use intent from newcomer and expert groups. Report small-sample counts; actual return use is separate.

## Reproduction

Run from the worktree root (no server settings or model downloads are performed):

```
node scripts/eval/research/run.mjs --extract-only
node scripts/eval/research/run.mjs --models=qwen2.5:7b --production-budget --cached-only --out=dist/evaluation/production-baseline
node scripts/eval/research/run.mjs --prompts=current --models=qwen2.5:7b --production-budget --cached-only --audiences=newcomer,expert --out=dist/evaluation/current
node scripts/eval/research/report.mjs
```

`baseline-prompts.cjs` and `baseline-paper-help.cjs` freeze cd163b1 behavior. The first exploratory run used 700 output tokens for every task, which differs from shipped balanced limits (420 overview / 380 guide / 260 selection / 320 Ask). Keep that evidence separate from production-budget reruns. Default evaluation temperature is 0.5. Two-minute task timeout; resumable files are not overwritten. A new prompt or setting needs a new output directory. Blank/truncated responses are failures regardless of HTTP status.

Browser harnesses accept `DISTILL_PLAYWRIGHT` (installed module path) and `DISTILL_CHROME` (browser executable). They use temporary profiles. `local-browser.mjs` checks ordinary direct setup; `pdf-browser.mjs` captures production PDF extraction. They do not install dependencies. Run on the same hardware without concurrent inference; record memory, CPU/GPU, model digest, quantization, first-token and completion latency. Do not average away model reload time. Performance budgets remain unset until a representative production-budget workflow is observed.
