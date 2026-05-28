# Changelog

All notable changes to this project are documented here. The extension version is defined in `extension/manifest.json` (Chrome Web Store uses that value).

## [2.2.0] — 2026-05-28

### Changed

- **Groq is now the default provider** (was Gemini). Groq's free tier is reliably available across accounts/regions, so it's the most dependable "$0" default. New installs default to `aiProvider: 'groq'`; the first-run onboarding now points to a free Groq key.

### Added

- **OpenAI as a provider** (`gpt-4o-mini`). The provider menu is now Groq (free) · OpenAI · Gemini (free) · Anthropic.
- **Shared OpenAI-compatible adapter** — `extension/utils/groqAdapter.js` was generalized into `extension/utils/openaiCompatAdapter.js` (provider-neutral `distillBuildChatRequestBody` / `distillParseChatChunk` / `distillClassifyChatError`), powering both Groq and OpenAI via one `streamOpenAiCompat` path in `background.js`. Error messages now interpolate the provider label + key-console URL, and detect `insufficient_quota`/billing 429s (non-retryable) vs. transient rate limits (retried). 12 unit tests.
- Provider-aware onboarding/Settings copy (key link text, source line, and placeholder update per selected provider).

## [2.1.0] — 2026-05-28

### Added

- **Groq as a third BYOK provider (free tier).** Groq has a genuinely free API tier with broader regional availability than Google's Gemini free tier (which isn't offered to every account/region). Pick **Groq** in Settings → AI provider, grab a free key at [console.groq.com/keys](https://console.groq.com/keys), and connect. Uses the OpenAI-compatible chat completions API.
  - `extension/utils/groqAdapter.js` — request builder (Anthropic-style messages → OpenAI `messages`), streaming chunk parser (`choices[].delta.content`), and error classifier (invalid key / rate limit / model / overload). Covered by `tests/unit/groqAdapter.test.mjs` (11 tests).
  - `streamGroq` in `background.js` (SSE, retry on 5xx + 429 retry-after), provider routing, key validation, and `groqApiKey` storage. Default Groq model: `llama-3.1-8b-instant` (fast, high free-tier limits — well suited to Distill's many short calls).
  - The "no free-tier Gemini quota" message now points users to Groq as the free alternative.

## [2.0.5] — 2026-05-28

### Fixed

- **Distinguish "no free-tier quota" / "daily quota exhausted" from a transient per-minute limit.** Gemini returns HTTP 429 for all three, but a project with `limit: 0` (no free-tier eligibility — needs billing, or account/region not eligible) or a used-up daily quota will *never* succeed on retry. Distill was treating these as transient: it waited ~30s and then failed with a misleading "retry after Ns" message, which made the extension appear broken. `distillClassifyGeminiError` now returns `GEMINI_NO_FREE_QUOTA` / `GEMINI_DAILY_QUOTA` (non-retryable, with clear guidance to enable billing or switch provider) vs. `GEMINI_RATE_LIMIT` (per-minute, retried). Verified against the live API.
- **Reverted default model to `gemini-2.0-flash`** (from `gemini-2.0-flash-lite`). flash-lite offered no reliable free-tier advantage and varies by account eligibility.
- **Backend tests are now hermetic w.r.t. a local `backend/.env`.** `http.integration` neutralizes `GEMINI_API_KEY` as well as `ANTHROPIC_API_KEY`, so a developer's real `.env` (loaded by dotenv in `server.js`) can no longer leak a key and flip the `aiReady`/`anthropicKeyConfigured` config flags during tests.

## [2.0.4] — 2026-05-28

### Changed

- **Free-tier 429s are now handled gracefully instead of surfaced as errors.** Distill's reading companion fires several short calls while you scroll (progressive summaries + tips), which could burst past Gemini's free per-minute limit. Two mitigations in `streamGemini`:
  - **Throttle:** the start of Gemini calls is serialized with a minimum gap so bursts get spaced out and can't exceed the per-minute limit.
  - **Auto-retry on 429:** rate-limited requests transparently wait out the server's `retry-after` (capped at 30s, up to 2 attempts) and then succeed, so a background summary just appears a little later rather than showing a "free-tier limit reached" error. The error is only shown if retries are exhausted. Aborts during the wait are respected.

## [2.0.3] — 2026-05-28

### Fixed

- **Side panel no longer throws `ReferenceError: Cannot access 'PINS_STORAGE_KEY' before initialization` on load.** The pinned-analyses cache was bootstrapped at the top of `sidepanel.js`, but `loadPinnedIntoCache()` reads `PINS_STORAGE_KEY` — a `const` declared later — hitting its temporal dead zone (an unhandled promise rejection on every open). The bootstrap call now runs at the end of the file, after all declarations are initialized.

## [2.0.2] — 2026-05-28

### Changed

- **Default Gemini model is now `gemini-2.0-flash-lite`** (was `gemini-2.0-flash`). It has roughly double the free-tier requests-per-minute limit and lower latency, which reduces "free-tier limit reached" (HTTP 429) errors for Distill's chatty workload (progressive summaries + tips). Quality is more than sufficient for short reading-companion outputs.

## [2.0.1] — 2026-05-28

### Fixed

- **Content script no longer runs on web-app/console/auth pages.** It declared any page with >500 chars of text an "article" and mutated the DOM (injected styles, added classes + `data-air-id`), which crashed framework-managed SPAs — notably **Google AI Studio**, the page our own onboarding links to (symptom: "unable to fetch" errors). Added `exclude_matches` for AI Studio, Google Cloud Console, Anthropic Console, and Google account/Workspace apps (Mail, Docs, Drive, Calendar, Meet, Chat). Bump to `2.0.1`.

## [2.0.0] — 2026-05-27

### Changed (breaking: default AI path)

- **Bring-your-own-key (BYOK) is now the default product.** AI runs **browser → provider** using the user's own key; the hosted "Distill cloud" backend is now **off by default** and demoted to an opt-in Advanced setting. `useBackendProxy` now defaults to `false`; new installs default `aiProvider` to `gemini`.
- **Settings reorganized key-first:** an AI provider selector (Google Gemini / Anthropic) with a "Get a free key" link, a **Test key** button, and provider-aware placeholders/links. Cloud + server-target controls moved under **Advanced**. Privacy copy rewritten for BYOK, including the Gemini free-tier data-use caveat. Usage panel reframed around your provider quota (no "daily credits" in direct mode).
- **Manifest:** version `2.0.0`; PNG icons (16/32/48/128) replace the SVG; description rewritten for BYOK.

### Added

- **Direct Gemini streaming** — `streamGemini` in `extension/background.js` calls the Generative Language API (`streamGenerateContent?alt=sse`) with the user's key, with a single backoff retry on transient 5xx and friendly handling of invalid-key / 403 / 429 / safety-block cases.
- **Provider adapter** — `extension/utils/geminiAdapter.js` converts Anthropic-style `{ systemPrompt, messages }` into Gemini `{ systemInstruction, contents }`, parses streamed chunks, classifies errors, and reads `RetryInfo`. Covered by `tests/unit/geminiAdapter.test.mjs` (18 tests).
- **Guided first-run onboarding** — a 2-step card (get a free Gemini key → paste & connect) with inline key validation, plus a **Test key** flow in Settings (`VALIDATE_AI_KEY` → `KEY_VALIDATION_RESULT`).
- **Store/publish docs** — `docs/PRIVACY.md` + hostable `docs/privacy.html`, and `docs/STORE_LISTING.md` (per-permission justifications, data-usage answers, listing copy, asset checklist).

## [Unreleased]

### Added

- **Nightly eval matrix CI** — [`.github/workflows/eval-matrix.yml`](.github/workflows/eval-matrix.yml) runs one matrix row against a local backend with `ANTHROPIC_API_KEY`; `scripts/eval/assert-matrix-out.mjs` fails on `regression_flags`. See [`docs/DEPLOY.md`](docs/DEPLOY.md#nightly-eval-matrix).
- **GitHub Actions deploy** — [`.github/workflows/deploy-backend.yml`](.github/workflows/deploy-backend.yml) deploys `distill-api` on `main` backend changes; post-deploy smoke; manual workflow for staging. See [`docs/DEPLOY.md`](docs/DEPLOY.md).
- **Usage dashboard SQL** — [`docs/USAGE_DASHBOARD.md`](docs/USAGE_DASHBOARD.md) and [`supabase/queries/`](supabase/queries/) for Supabase / Metabase (credit totals, top users, resets, histogram).
- **`GET /metrics/prometheus`** — Prometheus text exposition; guide in [`docs/METRICS.md`](docs/METRICS.md) with example scrape config and Grafana queries.
- **[`docs/api.md`](docs/api.md)** — HTTP API reference (routes, auth, SSE, tasks, errors); `scripts/check-api-doc.mjs` keeps route index in sync with `server.js`.
- **Fly request logging** — `REQUEST_LOG_STDOUT=1` on production and staging; guide in [`docs/LOGGING.md`](docs/LOGGING.md).
- **Staging Fly app** `distill-api-staging` — [`backend/fly.staging.toml`](backend/fly.staging.toml), [`backend/STAGING.md`](backend/STAGING.md), bootstrap script, extension **Settings → Staging** server target.
- Mocked **`/v1/ai/run` SSE** integration tests (`tests/backend/ai-run-sse.integration.test.mjs`) — chunk/done stream, error event, primary→fallback model; no live LLM.
- Root **[`README.md`](README.md)** — project overview, directory map, local dev, testing, deploy pointers, configuration table.
- **Vitest** + **Supertest** backend HTTP tests under `tests/backend/` (auth, usage, validation, CORS-safe health checks) and **unit tests** for `distillPageUrlKey` under `tests/unit/`. Run `npm run unit` alone or full `npm test` (lint + structural smoke + vitest).
- **Front-oriented tests**: `vitest.front.mjs` runs **happy-dom** with a minimal **`chrome` mock** (`tests/front/setup.mjs`). Covers accent CSS helpers on a real `document` and smoke-checks the mock. Pure clipboard/export string builders live in `extension/utils/exportClip.js` and are covered under `tests/unit/exportClip.test.mjs` (Node).

### Changed

- `backend/server.js` calls `app.listen` only when executed as the main script; `module.exports = { app }` supports in-process integration tests.
- Single **Vitest** config with **two projects** (`node` + `front`); removed `vitest.front.mjs`.
- Pinned “Copy MD” uses **`distillBuildPinnedAnalysisMarkdown`** in `extension/utils/exportClip.js` (same output, one implementation).
- `.gitignore`: ignore `coverage/`, `node_modules/.vite/`, and stray **`backend/backend/`** from wrong working directory.

### Removed

- Accidental nested **`backend/backend/`** tree when present (local state only).
- Generated **`coverage/`** and stray **`backend/data/.ci-state-*.json`** from the working tree when cleaning the repo (both remain gitignored if recreated).

## [1.1.0] — 2026-05-10

### Changed

- Chrome extension sources live under `extension/` (load that directory as the unpacked extension in `chrome://extensions`).

### Added

- Automated CI: ESLint on the extension service worker, side panel, shared URL helper, smoke runner, and Vitest tests; structural smoke (`scripts/smoke.mjs`) via `npm test`.
- Smoke coverage: every `toPanel({ type: … })` from `extension/background.js` is handled in `extension/sidepanel.js`, AI `task` names stay aligned with backend `TASK_COSTS`, and the backend responds on `GET /health`.

### Engineering

- When you ship to the Chrome Web Store: bump `"version"` in `extension/manifest.json` (semver, three segments), add a dated section here under a `[x.y.z]` heading, then tag or release as you prefer.
