# Distill: local models and research-reader readiness

## Goal

Make reading a real paper measurably easier for newcomers and faster for experienced readers, while keeping answers traceable to the paper. A working demo, passing tests, and attractive screenshots are necessary but do not establish usefulness or retention.

## Starting point

- Working branch: `claude/app-ui-ux-upgrade-8add1c`; reviewed baseline: `cd163b195959ceb7053b8aa3668351373cde2a12`.
- Combined PR: https://github.com/rsheth8/distill/pull/5. Includes local models, paper intake, explanations, and redesign. Check current status before changing branches or PRs.
- Baseline verification: `docs/PANEL_REDESIGN_QA.md`; 229 automated tests, 22 real-model/layout checks, 25 fixture interaction checks, production package checks.
- Real inference covered one model (Ollama Qwen 2.5 7B) and one paper (*Attention Is All You Need*). Successful inference used a temporary loopback relay after a real origin rejection. This does not establish the ordinary direct-connection setup works end to end.
- LM Studio is implemented but has not had independent live-server verification. Chrome built-in Gemini Nano is not implemented. Figures/vision remain deferred.
- All reading levels currently use a newcomer persona. Ask cites section names, which does not establish passage-level grounding. Input clipping and retrieval need evaluation on long papers.
- The main checkout contains preexisting uncommitted work. Preserve it. Work in this worktree; inspect its current state first. Never reset, clean, overwrite, or merge unrelated changes.

## Delivery order

Work in small, reviewable changes. Complete the first evaluation before redesigning features. Each phase must report evidence, remaining failures, and what was actually tested. Keep engineering verification separate from human evidence.

### 1. Establish a reproducible baseline

Create a benchmark manifest with at least 12 legally accessible papers and stable source links, spread across computing, biomedical/clinical research, social sciences, and another quantitative or theoretical field. Include experimental and observational studies, a review/meta-analysis, a theory or equation-heavy paper, a table-heavy paper, a long paper, multi-column PDF, and an openly available scanned PDF or explicit unsupported-case fixture. Categories may overlap. Cover at least three publishing platforms plus PDF intake. Record format, document version, extraction coverage, expected sections, and limitations; avoid redistributing full papers without permission.

For every paper, define questions and source-supported reference notes before scoring model output: research question, design/population, key result with units and uncertainty when present, central limitation, one answerable methods/results question, and one deliberately unanswerable question. Record exact source passages and locations. Manually verify references; model-generated references alone are insufficient. Double-score at least 20% of cases with an independent reviewer when available; otherwise label scores provisional.

Run and preserve a baseline across overview, section guide, Ask, and selection explanation at each reading level. Save model/version, provider, prompt version, settings, run date, latency, failures, and actual output. Use live models for quality evaluation; deterministic fixtures are for regression behavior. Include at least two available local models if hardware permits; disclose gaps rather than silently substituting.

Deliverables: `docs/evaluation/papers.json`, `docs/evaluation/rubric.md`, a repeatable evaluation runner, and a baseline report. Prefer small manifests and source excerpts over bundled copyrighted PDFs.

### 2. Finish and verify local model connections

Ollama: test ordinary fresh-profile setup directly, including origin restriction and recovery, installed model discovery if supported, unavailable/wrong model, server stopped, timeouts, interrupted streams, retry/cancel, and context overflow. Provide precise actionable errors. Do not count relay-based testing as direct setup verification. Do not alter existing model-server settings or install/download models without user authorization.

LM Studio: run the same matrix against an actual available server, with its actual model identifier. If unavailable, finish adapter-level checks and mark live verification blocked by environment, not passed.

Chrome built-in model: first check current official Chrome documentation for Prompt API availability, extension/service-worker support, supported hardware/languages, permissions, download lifecycle, model capabilities, and store-build constraints. Record source links and date. Determine whether it can share the existing provider abstraction; implement capability detection, usable setup/progress, cancellation, and graceful unavailable states if feasible. Never promise universal availability or silently fall back to a cloud provider. If unsupported in the environment, document precise constraints and test the available/unavailable adapter paths without presenting mocks as real model validation.

Check local-only inference network behavior in a fresh profile after model setup. Distinguish model downloads and paper fetches from inference. Ensure paper content does not go to remote inference services in local mode. Do not claim the entire extension is offline merely because inference is local.

Deliverables: provider compatibility matrix, direct-setup evidence, actionable setup UI, and a capability-based Chrome decision/implementation. Every provider status must distinguish implemented, fixture-tested, live-tested, and unavailable.

### 3. Fix the highest-impact comprehension and trust problems

Use baseline failures to choose changes. Expected priorities:

- Separate reader expertise from explanation detail. Expert guidance should preserve terminology, methods, numerical results, assumptions, and uncertainty. Newcomer guidance should explain necessary terms without inventing analogies or dropping caveats. Validate across tasks, not just the top-level persona.
- Make important generated claims traceable to actual supplied passages, with usable source navigation for HTML and PDF. Validate source identifiers against retrieved input; never render invented citations as verified. Labels should reflect provenance, not imply that an AI trust score validates a paper.
- Test and improve section-aware retrieval/context allocation on long documents. Distinguish missing extraction, missing retrieved evidence, and an answer absent from the paper. Do not say “the paper does not say” merely because the selected context does not contain it.
- Preserve units, sample sizes, uncertainty, study type, and correlation/causation distinctions. Distinguish author claims from inference and outside background.
- For figures, tables, equations, and scanned documents: expose extraction limitations honestly. Start with accurate detection and source navigation; scope visual understanding separately. Do not imply a chart was interpreted from nearby text alone.
- Make cancel/retry, setup recovery, tab changes, and interrupted responses predictable. Preserve reading position and notes.

Update shared extension/backend prompts together (`npm run sync:prompts`). Keep stored data compatible. Add targeted regression tests for demonstrated bugs and consequential behavior rather than tests that merely repeat implementation.

### 4. Perform task-based UI/UX evaluation

Run browser walkthroughs across the corpus, HTML/PDF, both themes, 360/480 px panels, keyboard use, visible focus, zoom, reduced motion, and a screen-reader check where available. Exercise fresh install, first useful answer, returning to a paper, connection failures, no evidence, unsupported extraction, and repeated use across tabs. Cover native side-panel opening and shortcuts; previous browser automation used the extension page rather than the native side-panel container.

Then prepare a moderated pilot with 6–8 consenting participants: at least two newcomers, two advanced students or cross-disciplinary readers, and two experienced researchers. The agent can prepare scripts and materials but must not invent participants, recruit or message people without authorization, or claim human validation from simulated personas.

Use tasks such as: explain the main result and caveat; find the sample/design and supporting passage; assess whether a claim is supported; explain an unfamiliar passage; export a useful reading note. Compare with reading the source alone using counterbalanced comparable papers to reduce practice effects. Record correctness, time, task completion, source checks, confusion, setup help, and perceived usefulness. Keep sessions and recordings voluntary and minimize identifying data.

Ask what participants would use again and observe feature use; do not lead them toward praise. Arrange an optional return-use follow-up after 7 days. A small pilot is directional evidence, not proof of product-market fit.

Deliverables: task script, consent/data-handling notes, anonymized findings when participants exist, severity-ranked usability backlog, and follow-up results. Mark this phase pending until real sessions occur.

### 5. Release decision and handoff

Proposed acceptance gates (agree before evaluation; do not adjust after seeing scores):

| Area | Gate |
| --- | --- |
| Source fidelity | Zero observed critical errors in the benchmark: fabricated findings/citations, reversed result direction, materially wrong sample/units, or unjustified causal claims. Any failure requires a fix and rerun of affected cases. This is a sampled result, not a guarantee. |
| Grounding | Every rendered source link resolves to a supplied passage; at least 90% of scored substantive claims are supported by the cited passage under the documented rubric. |
| Comprehension | At least 90% of answerable benchmark tasks score acceptable for correctness and caveat preservation; unanswerable questions do not receive invented answers. Report by audience, task, provider/model, and document type, not aggregate alone. |
| Extraction | All benchmark papers either provide usable supported content or clearly identify incomplete/unsupported intake; no silent success on empty/misordered content. |
| Setup and recovery | Each advertised provider completes fresh-profile live setup where supported; unavailable environments are explicit. No silent cloud fallback. |
| UI | No unresolved blocker in paper intake, source verification, Ask, note export, keyboard access, or failure recovery. |
| Human usefulness | Directional pilot target: at least 80% core task completion without moderator rescue, no recurring serious misunderstanding, and concrete repeat-use intent from both newcomer and expert participants. Report counts with the small sample. Actual return use is measured separately. |

Measure latency by task, hardware and model, including time to first output and completion. Set performance budgets from observed workflows before optimization; never hide slow or failed runs.

Before release: run `npm test`, `npm run pack`, package integrity and installed-package checks, and targeted live checks after relevant provider/prompt changes. Commit reproducible harnesses and sanitized evidence, excluding secrets, personal data, downloaded model weights, and unnecessary paper copies. Update the existing PR when appropriate; do not merge or publish without a user instruction. Report engineering readiness and human validation separately.

## Instructions for the continuing agent

1. Read this plan and `docs/PANEL_REDESIGN_QA.md`, inspect Git status/current PR state, and preserve unrelated work.
2. Begin phase 1, then the direct Ollama setup path in phase 2. Establish measured failures before changing the UI.
3. Use current primary sources when choosing papers or investigating Chrome model APIs; record verified links. Do not infer Chrome built-in support from the presence of the Gemini cloud adapter.
4. Complete independent engineering work autonomously. If model installation, server configuration, credentials, or human participants are needed, identify the exact missing dependency and continue other phases that do not depend on it. Do not mark missing live checks passed.
5. Keep a progress file at `docs/evaluation/STATUS.md` listing completed evidence, active work, unresolved findings, environment blockers, and the next concrete step. Report progress in plain language.
6. Stop only at the requested milestone or a genuine dependency; leave concrete results and an actionable next step. Do not describe the entire product as validated because automated tests pass.
