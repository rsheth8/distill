# Moderated reading pilot — ready to schedule, not conducted

Status: pending real consenting participants. No invitations, recruiting, recordings or sessions have been performed. Owner must arrange 6–8 people: at least two newcomers, two advanced/cross-disciplinary readers and two experienced researchers. Findings and seven-day return use remain empty until actual observations exist.

## Consent and handling

Read aloud: “We are evaluating a reading tool, not you. Participation is voluntary. You may skip questions, stop at any time, or ask us to delete your session notes. The tool can be wrong. Please check important claims against the source. We will record task timings, answers and interaction observations under a random participant code. Recording your screen or voice is optional and requires separate permission. Do not enter private research or personal information.”

Record separate yes/no choices for participating, screen recording, audio recording and optional seven-day follow-up. Obtain permission before starting each recording. Do not collect names in the results sheet. Keep scheduling/contact details separately with access limited to the organizer; delete contact information after the follow-up. Default deletion of recordings and raw notes: 30 days after the pilot; retain de-identified findings only with consent. A participant may request deletion using their session code. Adapt organizational/institutional research requirements before recruiting.

## Design and assignment

Use two comparable source papers per audience/domain, selected and independently checked for similar length, difficulty, numerical density and task answerability. Do not call the current corpus a matched pair without that check. Use unfamiliar papers; ask about prior familiarity before assigning. Define reference answers before participants start.

Counterbalance conditions and papers. For each audience pair:

| Participant | First block | Second block |
| --- | --- | --- |
| A | source alone, paper X | Distill + source, paper Y |
| B | Distill + source, paper X | source alone, paper Y |

For additional participants alternate both order and paper assignment. Use different questions with comparable demands. Avoid teaching answers during the first block. A small pilot has limited power; compare observed counts, medians and confusion patterns without causal or population-wide conclusions.

## Session script (45–60 minutes)

1. Confirm consent, participant code and broad audience category. Ask about field familiarity, typical paper-reading goals and prior use of AI reading tools. Explain think-aloud: “Tell me what you are trying to do and what you expect to happen.”
2. Fresh setup (up to 8 minutes): “Set up the tool to read a paper using the provider already available on this computer.” Record time, errors and help. Do not require model installation during the study. If setup needs rescue, record it and continue on a prepared profile so reading tasks can still be observed. Separate setup completion from reading completion.
3. Reading block A (12 minutes): present the assigned paper and condition. Read each task once; start timing at the end of the instruction. Avoid pointing to a feature. Neutral prompts only: “What are you looking for?” or “What do you expect that to do?” Record every rescue.
4. Reading block B (12 minutes): comparable other paper/condition, counterbalanced as above.
5. Repeated-use/recovery (5 minutes): switch to another paper and back, find the existing note, simulate a disconnected provider, then retry. Ask which paper an answer belongs to; observe whether reading position or notes are lost.
6. Interview (8 minutes): “Which answer would you check?” “Where did the tool slow you down?” “What would you use again, if anything?” “What task would you still do directly in the source?” Ask for concrete examples, not praise. Offer optional return-use follow-up without pressure.

## Core tasks in each block

- Explain the main result and its most important caveat in your own words. Preserve units and uncertainty if relevant.
- Find the study design/sample (or theoretical assumptions) and show the exact supporting passage.
- Assess one plausible but unsupported claim. State whether the paper supports it and show your evidence. Include a correlation/causation trap for an observational paper.
- Explain an unfamiliar passage; identify anything you are still unsure about.
- Produce/export a useful reading note containing the result, caveat and source location. For source-alone condition, use the participant's normal note tool.

Predefine a five-minute timeout per core task. Moderator rescue is any instruction that identifies the correct control, passage or answer; encouragement and repeating the task verbatim are not rescue. Log abandoned tasks rather than removing them from denominators.

## Recording template

One row per participant × condition × task:

`participant_code, audience, field_familiarity, paper_id, condition, order, task_id, started_at, seconds, completed_without_rescue, rescue_count, correctness_0_2, caveat_score_0_2, source_checked, source_correct, unsupported_claim_accepted, confusion_quote, feature_used, setup_help, perceived_usefulness_1_7`

Use a separate consent ledger and record only permission flags in this dataset. Save participant responses verbatim when volunteered; do not infer missing answers. Reviewer uses the preapproved rubric and references, blind to condition when practical. Record setup failures separately, and include all started tasks in completion rates.

## Findings/backlog and return-use follow-up

No participant findings yet. Create anonymized findings only after sessions. Rank observed issues: blocker (cannot finish), serious (wrong understanding or repeated rescue), moderate (avoidable delay), minor (friction). Tie each issue to participant codes, task evidence and frequency; do not promote hypothetical feature requests above demonstrated failures.

At an optional seven-day check-in, ask whether the participant used Distill without prompting, for which task/paper, and what made them return or stop. Ask for a concrete note or example if they wish to share one. Distinguish stated intention, reported use and directly observed use. No follow-up automation or outreach is scheduled by this document.

Exit review: report completion numerator/denominator overall and per audience, correctness, caveat failures, median/range times by condition, source-check behavior, setup help, critical misunderstandings and useful repeated use. Compare with frozen pilot targets in `rubric.md`; mark inconclusive groups and missing follow-ups explicitly.
