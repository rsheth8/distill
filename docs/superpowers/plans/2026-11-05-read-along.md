# Unified reading design and implementation plan

Use one immutable block/character model derived from Reading HTML. DOM ranges provide word highlights without rewriting scientific text or disrupting selection. PDF text layers align only unique normalized context matches; unmatched text stays unhighlighted with a Reading view fallback. View changes retain the canonical offset. Never queue text as completed reading.

Installed Web Speech localService voices are the zero-download path. Unlike a background chrome.tts broker this works in the existing content script and reader with no new permission. Require a concrete local voice; never invoke a browser default that could be remote. Explicit online voice selection is session-only with a transmission disclosure. Sentence/length bounded chunks and generation tokens prevent stale callbacks after cancellation. Real boundary events map exact source characters; absent boundaries show sentence/chunk ranges. Pause cancels and resumes from last confirmed position. Hidden tabs pause.

Alternatives: chrome.tts offers extension-wide playback but adds permission and broker complexity; Piper offers optional local neural speech but needs engine/model installation, memory and timing work. No downloads or server changes. Existing OS voices have minimal startup overhead, variable pronunciation/naturalness, and engine-dependent timing. Neural quality is not asserted without a listening comparison.

1. Add tested pure position, speech chunking, routing and playback session primitives.
2. Add accessible in-page controls, source selection, silent pacing, speech, persistence and follow suspension.
3. Integrate lazy PDF text layers and view-preserving navigation; guard unreliable alignment.
4. Run full checks, production packaging and browser verification; record real versus simulated evidence. Copy package contents into Downloads/Distill preserving unrelated files. Commit only task files.
