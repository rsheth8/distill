# Distill

**Distill** is a Chrome extension (MV3) that helps you read long articles: progressive summaries, optional comprehension check-ins, highlight analysis, explain-page, and reading-time / focus tools.

**Default mode is bring-your-own-key (BYOK):** AI runs **browser → provider** using a free API key you supply. Your key stays in Chrome local storage; there is **no Distill server in the middle**. The default provider is **Groq** (free tier, no credit card); **Gemini**, **OpenAI**, and **Anthropic** are one-click alternatives in Settings.

| Area | Path |
|------|------|
| Extension (load unpacked) | `extension/` |
| Optional hosted API | `backend/` — off by default; see [`backend/README.md`](backend/README.md) |
| Web Store pack | `npm run pack` → `dist/distill-<version>.zip` (BYOK-only; no backend UI) |
| Privacy & listing | [`docs/PRIVACY.md`](docs/PRIVACY.md), [`docs/STORE_LISTING.md`](docs/STORE_LISTING.md) |

**Version:** `extension/manifest.json` → `"version"`. **Changelog:** [`CHANGELOG.md`](CHANGELOG.md).

---

## Repository layout

```
├── extension/                 # Chrome extension (side panel, service worker, content script)
│   ├── manifest.json
│   ├── background.js          # Tab state, AI streaming, optional backend proxy
│   ├── content.js             # Article detection, scroll / reading signals
│   ├── sidepanel.html|.js|.css
│   ├── backend-help.html      # Local backend setup (dev / Advanced only)
│   ├── icons/
│   └── utils/                 # Extractor, adapters (Gemini, OpenAI-compat, …), pageStore
├── backend/                   # Optional Node API (Express) — self-host / Fly.io
│   ├── server.js
│   ├── lib/stateStore.js
│   ├── Dockerfile, fly.toml, fly.staging.toml
│   └── README.md
├── supabase/migrations/       # Postgres schema for hosted usage state
├── supabase/queries/          # SQL for usage dashboards
├── docs/                      # API, deploy, metrics, privacy, store listing, …
├── scripts/
│   ├── pack-extension.mjs     # Web Store zip (BYOK-only build)
│   ├── smoke.mjs              # CI structural checks
│   └── eval/                  # Optional quality/cost matrix vs live API
├── tests/                     # Vitest (unit, backend integration, DOM)
├── docker-compose.yml         # Local API (+ optional Postgres profile)
├── package.json
└── CHANGELOG.md
```

---

## Requirements

- **Chrome** (or Chromium) for the extension.
- **End users:** a free AI key — default **Groq** ([console.groq.com/keys](https://console.groq.com/keys)); **Gemini** ([AI Studio](https://aistudio.google.com/apikey)) is also free where eligible. **OpenAI** and **Anthropic** are supported with paid keys.
- **Developers:** Node 18+ for `npm test` and the optional backend.

---

## Quick start (extension only)

1. Open `chrome://extensions` → **Developer mode** → **Load unpacked** → select **`extension/`** (folder containing `manifest.json`).
2. Open the Distill side panel on a long article.
3. On first run: get a free **Groq** key → paste → connect. AI calls go directly to your provider.

No backend required for normal use.

---

## Local development

### Extension

Load **`extension/`** as unpacked (above). Dev builds include **Settings → Advanced → hosted backend** (`extension/utils/buildConfig.js` sets `DISTILL_INCLUDE_BACKEND = true`).

### Optional backend

Only needed for self-hosted / shared-quota mode:

```bash
cp backend/.env.example backend/.env
# Edit: BACKEND_SECRET (≥24 chars) and GEMINI_API_KEY (see docs/FREE_LLM.md)

npm install --prefix backend
npm start --prefix backend
```

Default URL: `http://localhost:8787` — health: `curl http://localhost:8787/healthz`

Without `DATABASE_URL`, usage is stored in `backend/data/state.json` (gitignored). With `DATABASE_URL`, usage + JWT revocation use Postgres (`supabase/migrations/`).

In the extension: **Settings → Advanced** → enable hosted backend and point at your URL. `extension/backend-help.html` lists the same commands.

### Quality checks (repo root)

```bash
npm install
npm test          # eslint + smoke + vitest coverage
npm run pack      # dist/distill-<version>.zip for Web Store (BYOK-only)
```

---

## Hosted API (operators)

For a shared Fly deployment (not the default Web Store build):

1. Run Supabase migration (`supabase/migrations/`).
2. Deploy `backend/` to Fly; set secrets (`BACKEND_SECRET`, `GEMINI_API_KEY` or `ANTHROPIC_API_KEY`, `DATABASE_URL`, `PUBLIC_BACKEND`, `EXTENSION_CORS_ORIGINS`, …).
3. Ensure `extension/utils/backendEnv.js` `prod` matches your hostname (currently `https://distill-api.fly.dev`).

```bash
npm run deploy:backend
npm run check:backend-remote
```

Full checklist: [`backend/README.md`](backend/README.md). Staging: [`backend/STAGING.md`](backend/STAGING.md).

---

## Configuration

| Concern | Where |
|--------|--------|
| Extension prod/dev/staging API base | `extension/utils/backendEnv.js`, or Chrome storage override in Settings |
| Backend env (local) | `backend/.env` from `backend/.env.example` |
| Backend env (Fly) | `fly secrets set …` |
| CORS for `chrome-extension://` | `PUBLIC_BACKEND=1` + `EXTENSION_CORS_ORIGINS` |
| Kill switches | `KILL_SWITCH_*` env vars |

---

## Privacy (short)

- **BYOK (default):** article text goes **directly to your AI provider**; keys stay in `chrome.storage.local`. Provider free tiers may use content for product improvement — use paid keys or Anthropic for sensitive material.
- **Optional backend:** payloads go to a URL you configure; see [`backend/README.md`](backend/README.md) and [`docs/PRIVACY.md`](docs/PRIVACY.md).

---

## Further reading

| Doc | Contents |
|-----|----------|
| [`backend/README.md`](backend/README.md) | Fly, Docker, Postgres, admin, logging, eval matrix |
| [`docs/api.md`](docs/api.md) | HTTP routes, auth, SSE, tasks |
| [`docs/DEPLOY.md`](docs/DEPLOY.md) | GitHub Actions Fly deploy, nightly eval |
| [`docs/FREE_LLM.md`](docs/FREE_LLM.md) | BYOK vs shared cloud architecture |
| [`docs/LOGGING.md`](docs/LOGGING.md) | NDJSON access logs, `fly logs` |
| [`docs/METRICS.md`](docs/METRICS.md) | `/metrics`, Prometheus |
| [`docs/USAGE_DASHBOARD.md`](docs/USAGE_DASHBOARD.md) | Supabase / Metabase usage SQL |
| [`docs/STORE_LISTING.md`](docs/STORE_LISTING.md) | Chrome Web Store submission pack |
| [`docs/BACKEND_ROADMAP.md`](docs/BACKEND_ROADMAP.md) | Ops hardening checklist (maintainers) |
| [`CHANGELOG.md`](CHANGELOG.md) | Release notes |
