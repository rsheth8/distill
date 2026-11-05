# Draft update for existing PR #5

Distill could send a local-mode task to a reachable optional backend, save incomplete streams as completed answers, and omit the first overview/Ask exchange from exported notes. This continuation routes local inference first, handles interrupted/truncated responses with recovery, and exports useful first-use notes with supplied evidence.

Reading guidance now separates experience from detail, preserves quantitative caveats, and limits missing-evidence answers to the supplied context. Ask shows inspectable supplied passages and navigates to source text; unknown generated IDs do not gain source controls. Provenance is not a fact check. PDF intake now retains inline-abstract continuation text, and missing abstract/empty extraction states are explicit. arXiv source labels no longer assert that a paper has never been reviewed.

The 12-paper evaluation harness freezes original prompts/retrieval, retains actual local-model outputs/timing and distinguishes exploratory settings from production budgets. Source notes are agent-inspected drafts; human reference approval and independent scoring have not happened. The 6–8-person pilot script, consent handling, counterbalancing, score template and severity backlog are prepared; no participant sessions, recruiting or return-use follow-up were performed.

Validation: full automated suite and package checks are recorded in STATUS.md; the production extension was loaded in a temporary profile for fixture interactions. Native side-panel opening/layout and connection failure were checked on a real arXiv paper. Ordinary fresh-profile direct Ollama setup is blocked by server origin policy; LM Studio is unavailable; Chrome built-in reports unavailable and is not an advertised inference provider. No model weights were downloaded and no server settings were changed.

Release remains blocked on the documented source-fidelity/grounding, provider setup and human-usefulness gates. Overview/guide/selection do not yet have Ask's per-claim passage controls. This draft is local; it has not been posted to GitHub. Nothing is merged or published.
