# Distill Backend (MVP)

Project overview, repo layout, and local quick start: **[`../README.md`](../README.md)**.

Implements the required public-launch endpoints (full reference: **[`../docs/api.md`](../docs/api.md)**):

- `POST /v1/auth/guest`
- `POST /v1/ai/run` (SSE events: `chunk`, `done`, `error`)
- `GET /v1/usage`

Includes:

- bearer token auth middleware
- quota middleware (daily credits + per-task costs)
- rate limiting (per-IP + per-user)
- model routing with fallback
- structured access logs (optional NDJSON file + rotation) and route-level logs for AI runs (task/model/latency/cost)
- kill switches via env
- file-backed persistent state (usage + token version), or **Postgres** when `DATABASE_URL` is set (recommended for Fly.io + Supabase)
- optional admin endpoints behind `x-admin-secret`

Cost behavior:

- `balanced` mode charges base per-task costs
- `ultra-lean` mode charges ~40% less (0.6x, rounded, minimum 1)

## Run

1. Copy `.env.example` to `.env` and set values.
2. Install deps:

```bash
npm install --prefix backend
```

3. Start:

```bash
npm start --prefix backend
```

Server defaults to `http://localhost:8787`.

## Fly.io + Supabase Postgres (production API)

1. In [Supabase](https://supabase.com), create a project → **SQL** → run the migration in `supabase/migrations/20250513000000_distill_user_state.sql` (or use Supabase CLI `db push`). Usage dashboards: **[`../docs/USAGE_DASHBOARD.md`](../docs/USAGE_DASHBOARD.md)** and ready-made queries in **`../supabase/queries/`**.
2. Copy the **connection string** (pooler URI, port **6543**, is fine for `node-pg`). Set it as `DATABASE_URL` on Fly (secret), not in the extension.
3. Install [Fly CLI](https://fly.io/docs/hands-on/install-flyctl/), then from `backend/`:

```bash
fly launch
fly secrets set \
  BACKEND_SECRET="$(openssl rand -hex 32)" \
  ANTHROPIC_API_KEY="sk-ant-api03-..." \
  DATABASE_URL="postgresql://..." \
  PUBLIC_BACKEND=1 \
  EXTENSION_CORS_ORIGINS="chrome-extension://YOUR_EXTENSION_ID"
fly deploy
```

4. Point the extension’s production backend URL at `https://<your-app>.fly.dev` (or your custom domain) via `extension/utils/backendEnv.js` (`prod` must differ from `DISTILL_BACKEND_PROD_UNCONFIGURED`) or the Settings URL override.

### CI deploy (GitHub Actions)

Pushes to `main` that change `backend/` auto-deploy **`distill-api`**. Add repo secret **`FLY_API_TOKEN`**. Details: **[`../docs/DEPLOY.md`](../docs/DEPLOY.md)**.

### After the first deploy (routine changes)

| What you change | What to run |
|-----------------|-------------|
| Server code (`server.js`, `lib/`, Dockerfile) | From `backend/`: `npm run deploy` or repo root: `npm run deploy:backend` |
| Secrets (API keys, `DATABASE_URL`, CORS list) | `fly secrets set KEY=value …` then `npm run deploy` (roll machines to pick up env) |
| Extension API hostname | Edit `extension/utils/backendEnv.js` (`prod`), reload extension in `chrome://extensions` |
| New Chrome extension ID (unpacked vs store) | `fly secrets set EXTENSION_CORS_ORIGINS=chrome-extension://…` (comma‑separate multiple) |
| Supabase schema | Run new SQL in Supabase, then deploy only if app code depends on it |

Quick health check against production (no Fly login needed):

```bash
npm run check:backend-remote
# or with another base URL:
npm run remote:check --prefix backend -- https://your-api.example
```

`npm run deploy` uses `fly deploy --ha=false` so a single Machine is enough for this API and avoids odd multi-machine smoke failures while you are small.

### Staging (`distill-api-staging`)

Separate Fly app for pre-production QA. Full setup: **[`STAGING.md`](STAGING.md)**.

```bash
fly apps create distill-api-staging          # once
./scripts/bootstrap-staging-secrets.sh       # from backend/, uses backend/.env
npm run deploy:staging
npm run remote:check:staging
```

In the extension: **Settings → Advanced → Server → Staging** (`https://distill-api-staging.fly.dev`).

With `DATABASE_URL` set, the server stores **daily credits** and **JWT `token_version`** in `public.distill_user_state` and skips `STATE_FILE_PATH` for that data. Rate-limit maps stay in memory (reset on deploy); move to Redis if you scale horizontally.

## Docker (demos / friends / CI)

### Docker Compose (recommended for local)

From the repo root (persists usage under a named volume at `/data/state.json` in the container):

```bash
cp backend/.env.example backend/.env   # set BACKEND_SECRET + at least one LLM key
docker compose up --build
```

API: `http://localhost:8787`. Optional Postgres (same schema as Supabase migration):

```bash
docker compose --profile postgres up --build
# backend/.env: DATABASE_URL=postgresql://distill:distill@postgres:5432/distill
```

Postgres is exposed on host port **5433** so it does not clash with a local Postgres on 5432.

### Single container

From the repo root, build and run with your env file (port **8787**):

```bash
docker build -t distill-backend ./backend
docker run --rm -p 8787:8787 --env-file backend/.env distill-backend
```

`PORT` defaults to `8787` in the image. Persist usage state across container restarts by mounting a volume and pointing `STATE_FILE_PATH` at it, for example:

```bash
docker run --rm -p 8787:8787 --env-file backend/.env \
  -v distill-state:/data \
  -e STATE_FILE_PATH=/data/state.json \
  distill-backend
```

## Request logging

Fly production/staging: **`REQUEST_LOG_STDOUT=1`** is set on `distill-api` and `distill-api-staging`. Tail with `fly logs -a distill-api`. Full guide: **[`../docs/LOGGING.md`](../docs/LOGGING.md)**.

App counters: `GET /metrics` (JSON) and `GET /metrics/prometheus` (Prometheus text). See **[`../docs/METRICS.md`](../docs/METRICS.md)**.

**Access log (HTTP):** After each response, the server can emit one NDJSON line per request with `level: "access"`, ISO `ts`, `requestId`, `method`, `path`, `statusCode`, `durationMs`, `ip`, and a truncated `userAgent`.

- **File (with rotation):** set `REQUEST_LOG_FILE` to a path (relative paths resolve under the `backend/` directory). When the file reaches `REQUEST_LOG_MAX_BYTES` (default 10 MiB), it is rotated to `<file>.1`, `<file>.2`, … keeping up to `REQUEST_LOG_MAX_FILES` (default 5) numbered backups. The parent directory is created if missing.
- **Stdout NDJSON:** set `REQUEST_LOG_STDOUT=1` to duplicate the same access lines to stdout (in addition to any file). Useful with `docker logs` or agents that only tail process output.
- **Noise control:** by default `/healthz`, `/health`, and `/metrics` are omitted from the access log. Set `REQUEST_LOG_SKIP_PATHS` to a comma-separated list, or `-` to log every path.

**Task / route logs:** successful guest auth, admin actions, and completed `/v1/ai/run` streams still log separate `level: "info"` JSON lines to stderr/stdout for debugging (not rotated by the server).

**Platforms:** In Kubernetes, ECS, Fly.io, Railway, etc., you typically do **not** need a log file inside the container. Omit `REQUEST_LOG_FILE`, enable `REQUEST_LOG_STDOUT=1` if you want NDJSON on stdout, and let the platform collect stdout/stderr—or run the binary under your process manager and **pipe stdout to your log stack** (for example `node server.js 2>&1 | your-agent`). Structured access lines remain one JSON object per line for easy ingestion.

## Article matrix eval (optional)

With the backend running and `ANTHROPIC_API_KEY` set, run the CSV matrix against live `/v1/ai/run` from the repo root:

```bash
npm run eval:matrix --prefix backend
```

Equivalent: `node scripts/eval/run-matrix.mjs` (defaults: matrix and output CSVs live next to the script under `scripts/eval/`). See `scripts/eval/quality-cost-eval.md` for the manual quality rubric.

**CI:** nightly [`.github/workflows/eval-matrix.yml`](../.github/workflows/eval-matrix.yml) (`--limit 1` by default). After a local run: `node scripts/eval/assert-matrix-out.mjs scripts/eval/article-test-matrix.ci.out.csv`. Repo secret: `ANTHROPIC_API_KEY` — [`../docs/DEPLOY.md`](../docs/DEPLOY.md#nightly-eval-matrix).

## Notes

- When **`DATABASE_URL` is not set**, usage/token-version state persists to `backend/data/state.json` by default. If you set `STATE_FILE_PATH` in `.env`, use a path relative to the `backend/` folder (for example `./data/state.json`) or an absolute path—avoid `./backend/data/...`, which resolves to a nested `backend/backend/...` on disk.
- Rate-limit counters are in-memory and reset on restart (fine for now).
- For production scale, add Redis for rate limits or run a single machine until you outgrow it.
- Token signing is HMAC JWT-like; rotate `BACKEND_SECRET` for production.
- With **`DATABASE_URL`**, usage and token versions are read/written in Postgres; `STATE_FILE_PATH` is not used for that data (you can omit mounting a state volume on Fly).
- Without **`DATABASE_URL`**, usage + token versions persist to `STATE_FILE_PATH` (default `backend/data/state.json`).

## Admin Operations

Admin routes are hidden unless explicitly enabled.

Set both `ENABLE_ADMIN_ROUTES=1` and `ADMIN_SECRET` to enable admin routes. If not enabled, admin routes return 404.

Header required for all admin routes:

`x-admin-secret: <ADMIN_SECRET>`

### Revoke user session(s)

`POST /v1/admin/revoke-user`

Body:

```json
{ "userId": "guest:<installId>" }
```

This bumps token version so previously issued tokens become invalid.

### Reset user usage

`POST /v1/admin/reset-usage`

Body:

```json
{ "userId": "guest:<installId>" }
```

Resets credits for the user to daily default.

### Inspect user state

`GET /v1/admin/user-state/:userId`

Returns token version and current usage record.

## Admin CLI Helper

Use `backend/scripts/admin.sh` for common operations:

```bash
ADMIN_SECRET=your-secret backend/scripts/admin.sh status "guest:<installId>"
ADMIN_SECRET=your-secret backend/scripts/admin.sh revoke "guest:<installId>"
ADMIN_SECRET=your-secret backend/scripts/admin.sh reset "guest:<installId>"
```

Optional custom backend URL:

```bash
BASE_URL=http://localhost:8787 ADMIN_SECRET=your-secret backend/scripts/admin.sh status "guest:<installId>"
```

## Rotate your session token

`POST /v1/auth/rotate` (requires `Authorization: Bearer <token>`)

This revokes the current token and returns a fresh one.
