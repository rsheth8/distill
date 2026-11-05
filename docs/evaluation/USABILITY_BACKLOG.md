# Severity-ranked reading/recovery backlog

No human sessions have occurred. Severity below is an engineering assessment from source inspection, live model captures or browser walkthroughs, not observed participant prevalence.

| Priority | Demonstrated problem / evidence | Disposition |
| --- | --- | --- |
| Critical | Local selection could be bypassed by reachable backend routing | Fixed; privacy regression and browser loopback capture. Does not imply entire extension is offline. |
| Critical | Post-change Facebook expert result answer confused 500-million background users with 82 recruited participants; real supplied ID did not prevent the false sample | Critical fidelity gate remains open. Recruitment context is now reserved without crowding out results; quantity scope is explicit. Targeted reruns now state 82; unreported demographic complements can still appear and are withheld by a limited guard. Source/claim adjudication remains required. |
| High | Model HTTP success could yield blank or truncated answers; stream EOF could save partial text | Blank-output guard retained; truncation/interruption now fail with recovery. Real base coder outputs show why success codes alone are inadequate. |
| High | Planck PDF inline abstract stopped mid-word at 565 characters | Continuation repair retains 3,360 characters in actual reader; regression added. Table/math fidelity still incomplete. |
| High | Ask treated retrieval misses as proof the full paper was silent | Prompt now limits abstention to supplied passages. Human review must check adherence. |
| High | Sources were section-name strings with no supplied-passage validation | Ask now exposes supplied passage text/IDs and navigates to matching source text. Unknown IDs get no controls. This verifies provenance only; claim support still requires review. Overview/guide/selection lack equivalent per-claim source controls and remain a release-gate gap. |
| High | PMC benchmark source returned no usable text; LIGO abstract not detected and table values can be omitted | Incomplete/unsupported states documented; empty extraction cannot trigger overview or Ask inference. Obtain accessible source and check original PDF table values before scoring. |
| Medium | All reading detail levels assumed a newcomer; source label implied arXiv material had never been reviewed | Added independent reader experience; prompts retain numerical caveats at every level. Source review status now explicitly unverified. Human usefulness not established. |
| Medium | Long paragraphs and repeated keywords could crowd out relevant evidence | Bounded windows and unique-term ranking added; overview also includes section endings. Lexical retrieval still misses synonyms, table-only values and cross-passage relationships. Evaluate before adding retrieval infrastructure. |
| Medium | Stopping, interrupted answers and provider recovery needed predictable outcomes | Stop/current-response and retry exercised in fixture browser checks; direct successful Ollama recovery is still blocked by origin policy. |
| Pending assessment | Native shortcuts, full keyboard order/focus audit, screen-reader use, repeated-use retention and note utility | Native container opening/layout and error recovery checked. OS shortcuts and screen-reader check remain pending; pilot materials define actual tasks and outcome collection. |

Next human review: approve source references and score claim support, starting with clinical null results, observational causation and Planck units/uncertainty. Do not prioritize additional features over failures discovered in that review. No participant findings or return-use claims should be added until real sessions exist.
