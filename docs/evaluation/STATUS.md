# Research-reader readiness status

Updated: November 5, 2026 (America/Chicago). Engineering continuation committed locally; release gates NOT met. Nothing merged, pushed or published.

## Git and preservation

- Work is in `claude/app-ui-ux-upgrade-8add1c`, in the requested worktree.
- PR #5 was open with successful CI at the starting cd163b1 baseline. Local continuation checks are separate from that CI; local commits have not been pushed.
- Main-checkout unrelated tracked/untracked edits are untouched. The preexisting untracked `docs/ACADEMIC_READINESS_PLAN.md` is preserved unchanged.
- Local commits: af170f4 (evaluation scaffolding), 69efb88 (privacy/evidence/recovery), 8bfd0c2 (first-use notes/incomplete intake). 4d92505 (population evidence/count guard) constrains population evidence and withholds unmatched demographic counts; final evidence/handoff commit records the completed captures.

## Implemented engineering

- Local inference takes priority over backend routing, including old backend-only preferences. Paper-bearing requests cannot silently fall through to a cloud adapter.
- Read-only installed-model discovery, exact-ID setup help, context-window errors, 30-second connection-test timeout, two-minute streaming bound, cancellation/retry, and explicit blank/truncated/interrupted failures. No models are installed/loaded by discovery.
- Reader experience is independent from explanation detail. Shared extension/backend prompts instruct models to preserve units, uncertainty, study type and caveats; Ask abstention refers to supplied passages rather than asserting the full paper is silent.
- Ask uses bounded passage retrieval, unique-term matching, source IDs, expandable supplied text and navigation to matching source text. Invented IDs get no source controls. Supplied provenance is explicitly not claim validation.
- Long-section overview sampling includes endings and marks omitted middles. Physics observation/detector headings are recognized. Planck inline-PDF abstract continuation is repaired; missing abstract/empty extraction is explicit and empty sources do not trigger overview/Ask inference.
- First-use note export now includes overview, caveats, Ask answers and cited supplied passages even without a running summary. Stored notes/data remain readable.
- Source labels no longer claim that arXiv material has never been reviewed. Chrome built-in capability status is usable without downloading; its experimental window adapter is not advertised as an inference provider.

## Automated and browser evidence

- `npm test`: lint, smoke/API documentation checks and **275 tests in 24 files pass**. New regressions cover local routing privacy, long-paragraph evidence, unknown citations, storage compatibility, empty intake, PDF abstract continuation, stream completion/cancel/context errors and first-use export, bounded design context and demographic-count withholding.
- `npm run pack` and ZIP integrity pass. Actual production extension loaded separately in a temporary profile: **27 fixture interaction/layout checks pass**, including first-use export, passage navigation, cancellation/retry, context failure, discovery, unavailable Chrome model, backend controls hidden, visible keyboard focus, reduced motion, 360/480 px both themes and 200% zoom. These are deterministic response fixtures, not model quality or human validation.
- Native headed Chrome side-panel container opened from an actual user gesture. Its 360 × 711 px document had no horizontal overflow, followed the active real arXiv paper and displayed unavailable-local-server recovery. OS shortcut dispatch and real screen-reader use remain pending.
- Actual production PDF intake exercised both LIGO and Planck. Planck abstract grew from 565 to 3,360 characters after repair. Tables/math and LIGO's undetected abstract remain limitations, not successful visual understanding.
- Sanitized evidence: `evidence/direct-setup.json`, `native-panel.json`, `installed-package.json`, `local-inference-network.json`, `pdf-intake.json`. Screenshots/full prompts/source caches stay in ignored `dist/evaluation/`.

## Real-model evidence

- Original exploratory baseline: **594 actual outputs**, 11 usable papers, two installed models, all three detail levels, overview/guide/selection plus six Ask questions. Qwen 2.5 7B: 296 nonblank terminal completions, 1 truncation. Coder 1.5B base: 69 nonblank terminal completions, 131 empty, 97 truncated. The coder base model is not a recommended reader. These are terminal outcomes, NOT correctness scores.
- Original capture used a fixed 700-token budget and newcomer persona. It differs from production task budgets; no controlled before/after quality improvement is claimed.
- Completed captures: 162 Qwen 7B post-change production-budget cases across Facebook/handwashing/repaired Planck, both audiences and all three detail levels (160 terminal completions, 2 truncations). A limited expert-overview probe of installed Qwen 3.6 35B completed 3 cases on one paper. Subsequent targeted repairs add 42 cases. Total preserved live outputs: **801**, with cohorts/settings separate. These terminal counts are not quality scores. No concurrent inference was used.
- Run records retain actual outputs, model/provider/settings, prompt hashes, run date, time to first output and completion time. Machine citation audits establish ID membership only.

## Ordinary direct setup and environment blockers

- Fresh-profile Chrome Settings → Local model → Test connection reaches Ollama directly and receives its origin restriction with the exact extension ID. No relay used. Successful direct extension inference/recovery remains **blocked**, not passed. Wrong-model recovery is blocked before selection by the same origin policy.
- A separate Node loopback API can run inference without the browser origin. That is quality-capture infrastructure, not proof ordinary extension setup works.
- LM Studio has no available server/model at localhost:1234. Chrome 156 exposes `LanguageModel` in the panel but reports `unavailable`; no browser-model download or live built-in inference occurred. No fresh cloud calls with credentials were performed.
- No existing server settings were changed, server stopped, credentials used, or model installed/downloaded. Unreachable-server testing used a different endpoint rather than stopping the user's server.
- Local inference traffic is distinct from paper fetches and fresh-install metadata/config requests. The latter can contact the configured backend without paper content; the entire extension is not claimed offline. The model-server address determines where inference goes; loopback keeps it on this computer.

## Human validation and release gaps

- 12-paper manifest spans four fields, arXiv/PLOS/PMC and PDF, including theory, randomized/observational work, meta-analysis, tables, long and multi-column papers. A synthetic raster-only unsupported fixture is included. PMC access is incomplete.
- 55 answerable reference notes have agent-inspected source criteria and exact extracted-paragraph ranges/hashes. **No human reference sign-off or independent double-scoring has occurred.** The blocked PMC paper needs six completed reference criteria. All quality scoring remains provisional/unperformed, not a passing percentage.
- Ask's source controls do not establish substantive claim support; overview/guide/selection still lack equivalent per-claim passage controls. Benchmark fidelity/grounding/comprehension gates remain open.
- Human pilot materials are prepared in `HUMAN_STUDY.md`, with consent/data handling, 6–8 participant mix, counterbalancing, source-alone comparison, tasks, timing/rescue/correctness measures and optional seven-day follow-up. `scores.template.json` contains no scores. No participants recruited/messaged, sessions run, recordings made or return use observed.
- `USABILITY_BACKLOG.md` distinguishes engineering severity from actual participant evidence. No human usefulness/retention claim is justified.

## Next concrete steps

1. Human reviewer approves source references, checks original PDF quantities/table cells and resolves the PMC source; an independent reviewer double-scores at least three papers. Use the frozen rubric and report by task/audience/model/format.
2. Owner configures Ollama's displayed origin allowance and restarts it; repeat ordinary successful setup, wrong-model, context, interrupted-stream and cancellation checks directly. Supply a running LM Studio server with its actual model ID for its live matrix.
3. Use those measured quality failures to prioritize remaining passage controls/retrieval repairs, then rerun affected cases. Do not add figures/vision or advertise Chrome built-in inference without verified capability and live support.
4. Organizer arranges real consenting participants and a screen-reader/shortcut check. Run the prepared pilot; collect actual follow-up use separately. Release decision remains withheld.

## Fidelity findings and targeted reruns

- The initial post-change expert/close Facebook answer claimed **500 participants instead of 82 recruited people**, confusing background platform population with study sample. A valid supplied ID did not prevent this critical error. It remains in `current-outputs.jsonl`.
- First repair added recruitment-context retrieval and quantity guidance. Its 12 reruns all completed, but an expert answer invented **49 males** despite reporting 82 total / 53 females. Another repair cohort correctly reported 82 but overstated analysis-specific exclusions as whole-study exclusions. All failing outputs remain preserved; nothing is erased or relabelled as correct.
- Final code reserves one relevant methods passage without crowding out results; high-confidence study-design questions exclude irrelevant results-analysis details. Prompts preserve denominator/exclusion scope and prohibit invented demographic complements. A limited literal-count guard rejects unmatched male/female counts before completed-answer publication/saving, while allowing explicit refutations. This is not a general fact checker.
- `fidelity-repair-v2` has 12 terminal completions and `fidelity-repair-v3` has 6. In v3, all six design answers state 82 recruited people. One newcomer answer still inferred **29 males**, absent from supplied source text. The machine audit predicts it would be withheld by the final guard; the same actual extension guard path is fixture-tested. This is not a live model-through-browser pass because origins remain blocked. Quality/fidelity gates stay **not met / pending human adjudication**.
- One expert/close handwashing selection and one newcomer/close Planck guide were truncated at shipped limits. Concise selection guidance and bounded glossary output repaired these tasks. Their 6 selection and 6 guide reruns completed without truncation at the same budgets. No accuracy or usefulness pass follows from that completion result.
- Full output/hash/timing evidence is in `evidence/*-outputs.jsonl` and `*-summary.json`; full prompts and source caches remain in ignored `dist/evaluation/`. Machine ID membership and limited count audits are clearly separate from claim-support scoring. Human reference sign-off, independent scoring, participant sessions and return-use evidence remain unperformed.
