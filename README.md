# Distill

**Distill** is a Chrome extension (MV3) that helps you read long articles: progressive summaries, optional comprehension check-ins, highlight analysis, explain-page, and reading-time style affordances. **Out of the box**, Distill is **bring-your-own-key (BYOK)**: AI runs **browser → provider** using a free API key you supply (a free **Google Gemini** key works—no credit card). Your key stays in your browser, and there is **no Distill server in the middle**. This keeps it free for the maintainer (nothing to host) and free for users (their own free-tier quota). Providers: **Gemini** or **Groq** (both free tier), or **Anthropic Claude** (paid) — switch in Settings and paste your own key.

- **Extension UI & logic:** `extension/` — load this folder as an **unpacked** extension in `chrome://extensions` (Developer mode → Load unpacked). First run shows a 2-step onboarding: get a free key → paste & connect.
- **Backend API (optional, advanced):** `backend/` — Express app with guest JWT auth, SSE streaming, daily credits, rate limits, optional **Supabase Postgres**. It is **off by default** and only needed if you want to self-host or run a shared deployment instead of BYOK. See **[`backend/README.md`](backend/README.md)** for Fly.io deploy, Docker, admin routes, and logging. Long-term backend work is tracked in **[`docs/BACKEND_ROADMAP.md`](docs/BACKEND_ROADMAP.md)**.
- **Publishing:** see **[`docs/STORE_LISTING.md`](docs/STORE_LISTING.md)** (permission justifications, data-usage answers, listing copy) and **[`docs/PRIVACY.md`](docs/PRIVACY.md)** / [`docs/privacy.html`](docs/privacy.html).

Version: `extension/manifest.json` → `"version"`. Changelog: [`CHANGELOG.md`](CHANGELOG.md).

---

## Repository layout

```
article-reader-extension/
├── extension/                 # Chrome extension (side panel, background SW, content script)
│   ├── manifest.json
│   ├── background.js          # Tab state, AI streaming, backend token + offline queue
│   ├── content.js             # Article detection, scroll / reading signals
│   ├── sidepanel.html|.js|.css
│   ├── backend-help.html      # Opens from UI for local backend start instructions
│   ├── icons/
│   └── utils/                 # Shared helpers (backend URL, export, accent, extractor)
├── backend/                   # Node API (Express)
│   ├── server.js              # Routes, Anthropic proxy, auth, quotas (single file by design)
│   ├── lib/stateStore.js      # File or Postgres persistence for usage + token_version
│   ├── scripts/check-remote.mjs
│   ├── Dockerfile / fly.toml
│   └── README.md              # Deep dive: deploy, env, admin, eval matrix
├── supabase/migrations/       # SQL for hosted Postgres (e.g. distill_user_state)
├── docs/BACKEND_ROADMAP.md    # Phased backend hardening plan (track progress here)
├── docker-compose.yml         # Local API (+ optional Postgres profile)
├── scripts/
│   ├── smoke.mjs              # CI: panel message types, TASK_COSTS alignment, /health
│   └── eval/                  # Optional quality/cost matrix vs live API
├── tests/                     # Vitest: backend integration, unit, front (happy-dom)
├── vitest.config.mjs
├── eslint.config.mjs
├── package.json               # Root: lint, smoke, test, deploy:backend, check:backend-remote
└── CHANGELOG.md
```

**Design note:** `backend/server.js` is intentionally a single large module for this MVP so deploys and code search stay simple; extract routers or services when complexity grows.

---

## Requirements

- **Chrome** (or Chromium) for the extension.
- **For end users:** a free AI key. Easiest is **Google Gemini** via [Google AI Studio](https://aistudio.google.com/apikey) (no credit card). If Gemini's free tier isn't available in your country/account, use **Groq** ([console.groq.com/keys](https://console.groq.com/keys)) — also free, broader availability. Paste it on first run. Anthropic (paid) is also supported.
- **Node 18+** (global `fetch`) for tests and the optional backend.
- **For self-hosting the optional backend / dev:** Node backend plus `BACKEND_SECRET` and `GEMINI_API_KEY` (see [`docs/FREE_LLM.md`](docs/FREE_LLM.md)) or `ANTHROPIC_API_KEY`. See [`backend/README.md`](backend/README.md).

---

## Local development

### 1. Backend

```bash
cp backend/.env.example backend/.env
# Edit backend/.env — BACKEND_SECRET (≥24 chars) and GEMINI_API_KEY (see docs/FREE_LLM.md)

npm install --prefix backend
npm start --prefix backend
```

Default URL: `http://localhost:8787`. Health: `curl http://localhost:8787/healthz`

Without `DATABASE_URL`, usage is stored under `backend/data/state.json` (gitignored). With `DATABASE_URL`, usage + JWT revocation versions live in Postgres (see `supabase/migrations/`).

### 2. Extension

1. Open `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → choose the **`extension/`** directory (the one that contains `manifest.json`).
3. Open the Distill side panel on any article. On first run, follow the 2-step onboarding: **get a free Gemini key** → paste & connect. AI then runs directly from your browser using your key. To self-host instead, open **Settings → Advanced** and enable the hosted backend.

The optional in-app backend help opens `extension/backend-help.html` with local-dev commands.

### 3. Quality checks (from repo root)

```bash
npm install          # root devDependencies (eslint, vitest, …)
npm test             # lint + structural smoke + vitest coverage
```

---

## Hosted production (summary)

1. Run Supabase migration SQL (see `supabase/migrations/`).
2. Deploy API to **Fly.io**; set secrets (`BACKEND_SECRET`, `ANTHROPIC_API_KEY`, `DATABASE_URL`, `PUBLIC_BACKEND`, `EXTENSION_CORS_ORIGINS`, …). Never commit secrets.
3. Set `extension/utils/backendEnv.js` **`prod`** URL to your Fly hostname. It must **not** equal `DISTILL_BACKEND_PROD_UNCONFIGURED` (template sentinel), or Production mode falls back to localhost.

Commands:

```bash
npm run deploy:backend      # fly deploy --ha=false from backend/
npm run check:backend-remote # GET /healthz + /v1/config (override URL in script args / env)
```

Full checklist: **[`backend/README.md`](backend/README.md)**.

---

## Configuration at a glance

| Concern | Where |
|--------|--------|
| Extension prod/dev API base | `extension/utils/backendEnv.js`, or Chrome storage override in Settings |
| Backend env (local) | `backend/.env` (from `.env.example`) |
| Backend env (Fly) | `fly secrets set …` |
| CORS for `chrome-extension://` in production | `PUBLIC_BACKEND=1` + `EXTENSION_CORS_ORIGINS` on the server |
| Kill switches | `KILL_SWITCH_*` in env |

---

## Privacy (short)

- **Default (BYOK direct mode):** article payloads go from the browser **directly to your chosen AI provider** (Google Gemini or Anthropic); your API key stays in Chrome local storage and is never sent to any Distill server. Note: Google's Gemini **free tier** may use submitted content to improve its products—use a paid key or Anthropic for sensitive material.
- **Optional backend mode (off by default):** payloads go to a backend URL you configure; that server uses its own provider key. See Settings copy and `backend/README.md` for what the backend may log or persist.
- Full policy: [`docs/PRIVACY.md`](docs/PRIVACY.md).

---

## Further reading

| Doc | Contents |
|-----|----------|
| [`backend/README.md`](backend/README.md) | Fly, Docker, Postgres, rate limits, admin CLI, request logs, eval matrix |
| [`docs/BACKEND_ROADMAP.md`](docs/BACKEND_ROADMAP.md) | Phased plan: CI remote checks, Compose, Redis, CD, security |
| [`docs/LOGGING.md`](docs/LOGGING.md) | NDJSON access logs, `fly logs`, optional export to Datadog/etc. |
| [`docs/api.md`](docs/api.md) | HTTP API routes, auth, SSE, tasks, error codes |
| [`docs/METRICS.md`](docs/METRICS.md) | `/metrics` JSON + Prometheus scrape, Grafana, alerts |
| [`docs/USAGE_DASHBOARD.md`](docs/USAGE_DASHBOARD.md) | Supabase SQL for credit usage / Metabase panels |
| [`docs/FREE_LLM.md`](docs/FREE_LLM.md) | Free-tier Gemini on Fly (no user API keys) |
| [`docs/DEPLOY.md`](docs/DEPLOY.md) | GitHub Actions Fly deploy (`FLY_API_TOKEN`); nightly eval (`GEMINI_API_KEY`) |
| [`CHANGELOG.md`](CHANGELOG.md) | Release notes |
| [`backend/.env.example`](backend/.env.example) | All backend environment variables |
