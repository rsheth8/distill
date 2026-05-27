# Distill Quality + Cost Eval (Balanced vs Ultra-lean)

Use this to run a consistent side-by-side comparison across article types and tune per-task token budgets.

## Goal

- Compare `balanced` vs `ultra-lean` on quality, speed, and effective credit usage.
- Validate output quality across varied article types.
- Decide final token budgets per task with real data.

## Test Set (minimum 20 articles)

Run at least:

- 4 short news
- 4 long news/investigative
- 4 technical explainers (engineering/science/finance)
- 4 opinion/editorial
- 4 mixed-format pages (heavy quotes/lists/subheads)

Prefer public pages with stable content (no login/paywall).

## Per-Article Procedure

For each article, run both modes in this order:

1. Set mode to `balanced`.
2. Read 6-10 paragraphs naturally.
3. Capture:
   - now reading output (1 sample)
   - so far summary output (2 snapshots)
   - one highlight analysis output
   - one quiz question + feedback cycle
4. Repeat same flow with mode `ultra-lean`.
5. Score each task using rubric below.

Keep article/session behavior consistent between modes.

## Scoring Rubric (1-5)

Score each task per mode:

- **Accuracy**: factually aligned to read text only
- **Coverage**: captures key points without major omissions
- **Clarity**: understandable, concise, non-jargony
- **Helpfulness**: actionable/explanatory value for reader
- **Tone**: supportive and not robotic (quiz feedback especially)

Suggested pass threshold for launch:

- Balanced average >= 4.2
- Ultra-lean average >= 3.8
- No critical factual errors in either mode

## Logging Template

Copy this section per article:

```text
Article ID:
URL:
Type: short-news | long-news | technical | opinion | mixed
Length estimate: short | medium | long

Mode: balanced
- Now: Accuracy _, Coverage _, Clarity _, Helpfulness _, Notes:
- Summary: Accuracy _, Coverage _, Clarity _, Helpfulness _, Notes:
- Analysis: Accuracy _, Coverage _, Clarity _, Helpfulness _, Notes:
- Quiz Q: Quality _, Specificity _, Notes:
- Quiz Feedback: Correctness _, Tone _, Notes:
- Latency feel: fast | ok | slow
- Credit burn feel: low | medium | high

Mode: ultra-lean
- Now: Accuracy _, Coverage _, Clarity _, Helpfulness _, Notes:
- Summary: Accuracy _, Coverage _, Clarity _, Helpfulness _, Notes:
- Analysis: Accuracy _, Coverage _, Clarity _, Helpfulness _, Notes:
- Quiz Q: Quality _, Specificity _, Notes:
- Quiz Feedback: Correctness _, Tone _, Notes:
- Latency feel: fast | ok | slow
- Credit burn feel: low | medium | high

Winner:
Regression flags:
```

## Token Tuning Rules

Use these adjustment heuristics after first 8-10 articles:

- If outputs truncate or feel incomplete:
  - increase that task by +15% tokens (balanced first)
- If outputs are verbose/redundant:
  - decrease that task by -10% tokens
- If ultra-lean quality drops below threshold:
  - increase only impacted task (not all tasks)
- If latency spikes with little quality gain:
  - trim context caps before increasing tokens

Apply small changes, then re-check on 4 representative articles.

## Launch Recommendation Format

At end of 20+ run, produce:

- Final per-task token table for both modes
- Tasks where ultra-lean is acceptable default vs not
- Known weak domains (if any, e.g. highly technical long-form)
- Go/No-Go decision for current defaults

