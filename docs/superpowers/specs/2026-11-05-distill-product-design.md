# Distill: the paper-first reading companion

Date: November 5, 2026. Product direction agreed in conversation; this written scope is for review. No product implementation is authorized by this document alone.

## Intent and first useful moment

Help newcomers understand research papers accurately and help experienced readers reach useful evidence faster. The paper remains the main experience. Explanations, visualizations, narration and notes support reading rather than compete with it.

Proposed first-five-minute outcome: open a supported paper, understand one difficult passage, inspect its supporting source, and save a useful note without losing reading position. This is the designer's proposed success scenario, not a measured participant outcome.

## Current baseline and coordination

- Use `claude/app-ui-ux-upgrade-8add1c` in the `.claude/worktrees/app-ui-ux-upgrade-8add1c` worktree. Planning baseline is `e9b0dff`. Recheck the branch and working tree before implementation.
- Preserve all existing uncommitted changes. Main checkout contains older, independently edited code. Never replace newer paper-reader files wholesale with main-checkout versions.
- Read `docs/evaluation/STATUS.md`, `docs/READ_ALONG_QA.md` and `docs/evaluation/rubric.md`. Existing tests and browser evidence are historical reports, not fresh verification of future changes.
- The other chat, “Find embedding and RAG usage,” has proposed measurement-only instrumentation and reporting in the main checkout. Its design/plan are `docs/superpowers/specs/2026-11-05-reading-performance-design.md` and `docs/superpowers/plans/2026-11-05-reading-performance-baseline.md` there. Coordinate by inspecting completed files/commits; do not duplicate or overwrite its work. Adapt only relevant tested changes onto this baseline.
- Read-along/local narration and conservative PDF alignment have been implemented. Perceived voice quality, full PDF alignment and broader accessibility remain unverified. Existing accuracy failures and human evaluation gaps remain release blockers.
- Current UI includes Read/Ask/Glossary, overview/caveats, section guides, selection actions, check-ins, notes export and connection settings. Auto-generated reading summaries and paper help exist; scroll-freezing quiz handlers still exist.

## Approaches and selected direction

1. Side-panel dashboard: put explanations, controls, sketches and history in the panel. Familiar to implement, but duplicates the paper and encourages crowded controls.
2. Paper-first assistance: distribute jobs across the source, contextual margin and side panel, sharing selection and reading position. More coordination work, but preserves the reader's focus. This is the direction the user agreed to.
3. Autonomous tutor: annotate, narrate, quiz and sketch continuously. Potentially engaging but adds interruptions, inference costs and incorrect interpretations. Defer; automation must be separately enabled and validated.

## Surface responsibilities

| Surface | Responsibility | Avoid |
| --- | --- | --- |
| Source / Original PDF / Reading view | Read, select, highlight, draw, inspect source evidence | Covering text, rewriting source meaning, competing scroll controllers |
| Contextual margin | One brief explanation, definition or sketch tied to an anchor | A second chat feed or permanent annotations on every paragraph |
| Side panel | Orientation, longer Ask exchanges, collected saved notes | Repeating the same explanation simultaneously in several surfaces |
| Compact reading control | Silent/voice play, pause, pace and resume-follow | A full settings console floating over text |

On narrow layouts, the contextual result occupies the panel or an intentional sheet rather than squeezing or covering the paper. Opening a longer exchange moves it to the panel with its source anchor intact. Normal source selection remains available.

## Interaction rules

- Fresh installs start in quiet reading. Opening, restoring, scrolling, changing section or changing explanation preferences starts zero automatic AI requests. Local extraction, navigation, saved results and controls remain usable.
- Explicit Explain, Ask, Generate overview, Guide this section, Retry or Sketch actions may invoke AI in quiet mode. Cached results may be shown without inference.
- One optional “Automatic reading help” preference enables progressive summary and section guidance. Overview remains manually requested in every mode. Check-ins remain a separate opt-in, off by default. Quiet means both preferences are false; a visible “Quiet reading” action disables both. Enabling either enters assisted reading, whose status names the enabled assistance. Switching to quiet cancels queued/active automatic work; it does not cancel an explicit user request.
- For existing installs, unset assistance preferences migrate to quiet without deleting notes, summaries, highlights, saved position or model preferences. Explain the new default once without a modal. A historical `learnMode` value alone must not enable check-ins after this migration.
- Quizzes never freeze scroll, block the document or require an answer to continue. Offer Skip and Later. Narration/read-along never starts without Play, and a check-in never takes over its position or playback.
- One selection/anchor context follows the user across explanation, Ask, sketch and notes. Source jumps offer Return to reading; only one return anchor is retained initially. Capture the selected passage if visible, otherwise the visible block at the 35% reading line and an offset within it, not an old playback cursor. Pause any active playback at its last confirmed position and retain that position separately; returning never restarts it. Returning restores focus as well as location.
- Manual wheel/touch/navigation input suspends follow scrolling. Resume following is explicit. Reduced motion removes animated travel/drawing while retaining all information and controls.
- Preserve the last completed result while a replacement loads, labeled with its original passage. Never relabel stale content as the new selection's answer. Distinguish pending, canceled, unavailable and failed states; avoid repeated toasts for one failure.
- Every long-running action exposes cancel/retry. Cancellation acknowledges local cancellation, not a promise that a remote provider stops billing. Navigation and stale callbacks cannot publish content to another paper.

## Connection and local-first experience

The chosen model used for a successful setup check must become the saved inference configuration when the user connects. “Test connection” alone must explicitly say it has not changed the saved configuration. Never show an unqualified Connected state for unsaved settings. Editing provider/address/model invalidates that check; save a validated snapshot, never fields edited during the check. Retry an old paper task with current saved settings.

Local inference and local narration are independent. Local narration works without a connected LLM. Never silently route either to an online provider. Optional online speech requires explicit selection and disclosure. Do not install/download models, modify server settings or restart services without session authorization. When local performance/quality is insufficient, disclose it and offer a choice; do not substitute cloud processing.

## Evidence and model quality

Keep facts extracted from the source, generated interpretations, outside background, personal notes and analogies visibly distinct. Citation-ID existence proves provenance, not claim support. Avoid paper trust scores or badges that imply scientific validity. Explain missing PDF text, tables, equations, figures or alignment before using the affected material.

The frozen readiness rubric remains unchanged: zero observed critical errors, at least 90% supported substantive claims and at least 90% acceptable answerable tasks, plus its remaining gates. The other chat's proposed 95% faithfulness/support goals are additional aspirational targets, not replacements or retroactive changes to that rubric. No quality pass without scored evidence and declared denominators. Human usefulness and retention need real sessions.

Evaluate actual local models by task/audience/format before recommending them. A larger model is not automatically a better or faster choice. Do not add a multi-call model chain to every action without quality and latency evidence.

## Sketching direction, after the foundation

Initial complete flow: select passage → Sketch this → step through → inspect supporting text/assumptions → save to notes. Generated sketches are on demand, not automatically drawn across the document.

Choose the form to fit the idea: relationships/causal models, sequences, comparisons, mathematical illustrations and arguments/counterexamples. A model may abstain or suggest prose if a picture would mislead. Distinguish source reconstruction, conceptual illustration and analogy; show simplifications and analogy limits. Invented illustrative values cannot resemble empirical results from the paper.

Use a constrained, validated scene description and an application-owned renderer. No model-generated executable JavaScript, arbitrary HTML/SVG markup or unsanitized source text. Allow static viewing, step controls, replay, dismissal and reduced motion. Generated scenes and the supporting passages are saved as notes with versions; they do not mutate source text. Detailed scene schema and renderer architecture require a separate implementation plan.

Authored browser prototypes demonstrate interactions only. They do not establish model accuracy, narration quality or usability. Mockups are stored in the chat-owned visualization directory, outside extension runtime files.

## Performance and privacy requirements

No new runtime dependencies for the first milestone. Instrumentation is disabled by default, opt-in and local, at most 200 completed samples per context; no persistent or remote telemetry. Never record URLs, titles, source/selection text, prompts, responses, credentials or personal identifiers. Use same-context clocks; keep cold/warm, model/provider, task, cache and failures distinguishable without storing user content. Model/hardware metadata belongs in a manually authored benchmark manifest, not ambient user tracking.

Initial budgets, not observed results:

| Measure | Proposed target / boundary |
| --- | --- |
| Warm panel readiness | p95 300 ms, initialization to usable interface rendering opportunity; native opening measured separately |
| Restore presented | p95 500 ms, state receipt to rendering opportunity; worker state loading measured separately |
| Action feedback / cached result | p95 100 ms, action to visible pending/result rendering opportunity |
| Steady reading | No extension-attributed task over 50 ms in a 60-second steady-scroll trace; use comparative profiling for attribution |
| Typical / long HTML extraction | p95 500 / 1,000 ms at approximately 2,000 / 10,000 words; PDF fetch/extraction measured separately |
| Local cancellation | p95 200 ms from user cancel to local acknowledgment |
| Short AI task | Aspirational median first text 2 s / completion 6 s; p95 5 s / 12 s, grouped by model/task/hardware and cold/warm state |
| Quiet reading | Zero automatic AI requests |

Require at least 30 local observations per scenario before conclusive local p95 status. AI p95 requires at least 100 successful cases per group; do not generate extra inference solely to fill a quota. Report smaller groups as insufficient, retain all failures and distinguish text receipt from UI presentation. Local reading budgets are release goals; AI timing remains a model compatibility measurement until evaluated hardware-specific budgets exist.

Later request/cache goals: one active AI request per tab, two extension-wide, explicit work prioritized, duplicate identical work shared, AI result cache capped at 20 MB independent of user notes. Initial context budgets of 1,500 tokens for short tips and 3,000 for selection/check-ins are candidates only; adopt limits only after fidelity evaluation. Do not sacrifice source context to hit an arbitrary latency/token number.

Offline promise covers locally retained state and cached results. Opening an uncached paper or running an unavailable model still requires the relevant resource; do not claim the entire extension works offline.

## Delivery sequence and decisions deferred

1. **Dependable quiet reading:** align worktrees/measurement work, establish baseline, eliminate scroll traps, fix model-save confusion, preserve context during cancel/retry/source jumps. Detailed plan accompanies this spec.
2. **Coherent interface:** prototype/refine the surface hierarchy and first-five-minute flow using actual papers at narrow/wide widths; then implement with an accessibility check. Keep controls and storage compatible.
3. **Reliable answers:** score existing outputs, repair consequential retrieval/grounding failures, extend source controls and introduce measured request/cache budgets. Some scoring can proceed alongside milestone 1 without overlapping files.
4. **On-demand visual explanations:** implement one complete passage-to-sketch-to-saved-note experience; expand visual forms only after task evaluation. Do not advertise grounded sketches before the evidence layer is verified.
5. **Human validation:** run the prepared newcomer/expert pilot, refine demonstrated failures, and collect voluntary return use. Preparation can happen earlier; no invented participant evidence.

Later milestones get separate detailed plans based on the previous milestone's evidence. Do not undertake all five as a single giant rewrite. Defer cross-paper libraries, vector databases, social features, autonomous tutoring, broad voice catalogs and figure/vision claims. They are not forbidden forever; each needs a demonstrated task and independent design.

## Acceptance

A reader can open a supported paper, read without interruption, connect a selected installed model without a hidden configuration mismatch, request and inspect passage help, save a useful note, and return after navigation/reload without losing position or data. Milestone 1 uses the existing “Ask about this” flow for supplied-source inspection; extending equivalent controls to Explain/overview/guide remains milestone 3. No forced scrolling, implicit cloud processing, inaccessible core controls or stale cross-paper results. Verify installed production build, HTML and real PDFs, both themes, narrow widths, keyboard/reduced motion and failures. Accuracy, performance and participant usefulness are separate evidence categories, never inferred from test counts.
