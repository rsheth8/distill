# Provider compatibility and direct setup

Evidence date: 2026-11-04/05 America/Chicago. Do not interpret adapter fixtures as model validation.

| Provider | Implementation | Automated/fixture checks | Live evidence | Remaining dependency |
| --- | --- | --- | --- | --- |
| Ollama | OpenAI-compatible local adapter, discovery, direct routing | Error/recovery and privacy routing regressions | Installed Qwen 2.5 7B and coder 1.5B base via Node API; limited Qwen 3.6 35B expert-overview probe (3 detail levels); Chrome fresh-profile setup rejects extension origin | User-managed origin allowance and restart before successful direct extension inference/recovery can be verified |
| LM Studio | Same local adapter, `/v1/models` discovery | Adapter/error fixtures; exact-ID help | No server on localhost:1234 | Actual running server and loaded model ID; no live pass |
| Chrome built-in | Window adapter and read-only availability UI; NOT a selectable inference provider | Available/unavailable, no-download, context and cancellation paths with fixtures | Chrome 156 extension page exposes API but reports unavailable | Available runtime and user-authorized model setup; window/worker bridge and live validation before advertising |
| Cloud providers | Existing adapters retained | Existing regression suite | No fresh live cloud tests in this work | User credentials; cloud success not claimed |

Ordinary Ollama setup was tested directly from the extension service worker in a fresh temporary profile. Both installed and wrong-model requests were rejected before model selection. Server-stopped behavior used an unreachable address, not stopping the user's server. No relay, server setting edit, model download or personal Chrome profile was used. Error recovery after configuring origins, context overflow, interrupted generation and successful direct cancellation still need live checks after the origin dependency is resolved; fixture checks cover their engineering paths.

The Settings command contains the current extension ID; a packaged extension can have a different ID. On macOS, users must set the displayed `OLLAMA_ORIGINS` value in the environment used by Ollama, fully quit/restart Ollama, then retry. Installing a model remains a user action. Read-only discovery never pulls/loads models. If an origin error blocks discovery, fix origins before diagnosing missing models. LM Studio requires its actual `/v1/models` identifier, not an Ollama tag guessed by Distill.

## Chrome decision

Official [Prompt API documentation](https://developer.chrome.com/docs/ai/prompt-api), checked November 4, 2026, lists extension availability from Chrome 138. It is window-only, not available in workers. Consequently the existing service-worker network adapter cannot invoke it directly; a document bridge needs lifecycle/cancellation tests before provider selection is enabled.

The documented desktop requirements include supported OS/hardware, 22 GB free profile-volume storage, an unmetered initial download, and supported languages (English, Japanese, Spanish, German, French). Availability must be checked with matching modality/language options. Creation can require user activation and offers download progress; cancellation/session destruction and context limits need handling. The current adapter requests English text only and never downloads by default. No vision capability is advertised.

The [Manifest V3 remote-code rules](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code) require packaged executable code. No remote polyfill or downloaded executable code is introduced. Store approval has not been sought or established. No new model permissions are added for an unavailable experimental adapter.

## Local-inference network boundary

Local provider routing now occurs before backend preferences/probes, even for old backend-only settings. Automated regression uses a reachable-backend scenario and verifies only the configured model route is used. Fresh-profile browser evidence records worker fetch destinations separately. The configured server address determines where inference goes; localhost keeps inference on this computer. Paper fetches and browser model downloads are separate traffic. This is not a claim that the whole extension works offline.
