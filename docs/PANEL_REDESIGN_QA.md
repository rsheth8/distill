# Distill 3.0.0 redesign verification

The eight redesign implementation tasks and the final implementation review are complete.
The branch includes the research-paper reader and the Ollama / LM Studio provider.

## Fixes from final review

- The Connected onboarding card can be dismissed.
- Key validation records the provider and key submitted, disables duplicate checks, and ignores outdated replies after provider changes. Editing the input while a request runs cannot save an untested key.
- Backend-only settings are hidden outside an applicable development site. Store builds also ignore old backend-only site preferences, so a saved development preference cannot block direct AI calls.
- Section tracking uses headings at the reading line. A large figure with no visible paragraph no longer leaves the map and guide stuck on the previous section. Scrolling back above the sections clears the current section.
- Switching tabs clears the previous paper, summary and selection. Restoring a non-paper tab explicitly shows the not-a-paper state.

## Automated checks

- `npm test`: lint, smoke checks, API documentation checks, and all **229 tests in 22 files** pass.
- New regression coverage exercises onboarding dismissal, failed checks, stale provider responses, saving the validated key, local setup, production backend controls and routing, section tracking over figures, and clearing old tab content.
- `npm run pack`: builds `dist/distill-3.0.0.zip`.
- `unzip -tq dist/distill-3.0.0.zip`: no archive errors.

## Chrome verification

Used Chrome for Testing with the actual extension loaded in isolated temporary profiles.
The panel was opened as its extension page for browser automation; the harness kept its
selected article tab fixed to model the native side-panel container. Browser toolbar
placement and operating-system shortcut dispatch were not exercised.

**22 real-model and layout checks passed.** On the live arXiv HTML version of
*Attention Is All You Need* (`https://arxiv.org/html/1706.03762`), verified extraction,
section-map creation and jumping, a completed overview and trust information, a section
guide, and an Ask answer using the existing Ollama `qwen2.5:7b` model. Onboarding,
Connection settings and the populated paper panel fit at 360 px and 480 px in light and
dark themes. Screenshots were rendered and inspected.

The direct Ollama request correctly reported its origin restriction. Real-model calls
then used a temporary loopback relay to the same Ollama process; responses were not
simulated. The relay was closed afterward. No Ollama settings, personal Chrome profile,
or saved user keys were changed. Direct access still needs the `OLLAMA_ORIGINS` setup
already documented in Connection settings.

**25 interaction checks passed** using a local paper fixture and deterministic streamed
AI responses through the actual background worker and panel connection:

- Jumping into a section containing a tall figure updates the current section.
- A section guide populates the glossary and marks jargon on the source page.
- Selection → Ask about this carries the quote and receives a completed answer.
- Focus dims source paragraphs; check-ins can be enabled.
- Progressive summaries group bullets by section and survive reloading the paper.
- Copy notes produces a Markdown export containing the summary. Clipboard writes were captured by the harness rather than changing the system clipboard.
- The populated panel fits both widths and themes; reduced motion disables the logo animation.
- Switching to a normal website removes the previous paper and notes.
- The actual sample PDF loads into the reading view; its section map jumps, both themes use the shared tokens, and Original PDF renders page canvases.
- No JavaScript page errors were recorded.

The packaged production extension was also loaded separately to verify its version,
hidden backend settings, four Settings groups, and ignored backend-only preferences.

Local evidence is generated under `dist/qa/` (screenshots and JSON results); these build
artifacts are ignored by Git. Live cloud-provider calls were not repeated because the
fresh test profiles had no personal API keys. This is a functional smoke check of one
real local model and paper, not a broad evaluation of explanation quality.

## Deferred scope

Figures / vision and Chrome's built-in Gemini Nano remain follow-ups. The existing
paper-reader follow-ups (Escape dismissal for word cards, duplicated abstract in Ask
context, and first-definition glossary behavior) are unchanged.
