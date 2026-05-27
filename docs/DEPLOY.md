# Deploying the backend (Fly.io + GitHub Actions)

## Automatic deploy (recommended)

On every push to **`main`** / **`master`** that touches `backend/`, GitHub Actions runs [`.github/workflows/deploy-backend.yml`](../.github/workflows/deploy-backend.yml):

1. `fly deploy --ha=false` → **`distill-api`**
2. Post-deploy smoke: `/healthz`, `/v1/config`, `/metrics/prometheus`

**Staging** is **not** auto-deployed on push. Use **Actions → Deploy backend → Run workflow** and choose `staging` or `both`.

### One-time: `FLY_API_TOKEN` secret

On your machine (Fly CLI logged in):

```bash
fly auth token
# or a long-lived deploy token:
fly tokens create deploy -x 999999h
```

In GitHub: **Repository → Settings → Secrets and variables → Actions → New repository secret**

| Name | Value |
|------|--------|
| `FLY_API_TOKEN` | Token from above |

Re-run a failed workflow or push to `main` after adding the secret.

### Nightly eval matrix

[`.github/workflows/eval-matrix.yml`](../.github/workflows/eval-matrix.yml) runs **`npm run eval:matrix`** against a **local** backend in CI (not production), with live Anthropic calls. Default: **1 matrix row** per night (~12 LLM calls: balanced + ultra-lean × six tasks).

| Secret | Required | Notes |
|--------|----------|--------|
| `GEMINI_API_KEY` | Preferred | [Free tier](https://aistudio.google.com/apikey); same key style as Fly |
| `ANTHROPIC_API_KEY` | Or this | Legacy; use if you have not switched CI to Gemini yet |

Set **at least one**. With both set, `LLM_PROVIDER=auto` prefers Gemini.

`BACKEND_SECRET` is **not** a GitHub secret — the workflow uses a fixed CI-only value on `localhost`.

See also [`FREE_LLM.md`](FREE_LLM.md) for moving production off paid Anthropic.

**Manual run:** Actions → **Eval matrix** → Run workflow. Optional inputs: `limit` (rows), `start` (1-based row index). Use a higher `limit` sparingly (cost + runtime).

**Artifacts:** `eval-matrix-<run_id>` uploads `scripts/eval/article-test-matrix.ci.out.csv` for review.

**Local equivalent:**

```bash
# Terminal 1
cp backend/.env.example backend/.env   # set GEMINI_API_KEY (see FREE_LLM.md)
npm start --prefix backend

# Terminal 2
node scripts/eval/run-matrix.mjs --limit 1 --out scripts/eval/article-test-matrix.ci.out.csv
node scripts/eval/assert-matrix-out.mjs scripts/eval/article-test-matrix.ci.out.csv
```

### Optional: approval gate

In GitHub: **Settings → Environments → New environment** named `production` (and `staging` if you like).

- Enable **Required reviewers** so deploy jobs wait for approval.
- The workflow already sets `environment: production` / `staging` on deploy jobs.

## Manual deploy

```bash
# Production
npm run deploy:backend

# Staging
npm run deploy:backend:staging

# Verify
npm run check:backend-remote
npm run check:backend-staging
curl -s https://distill-api.fly.dev/metrics/prometheus | head
```

## What gets deployed

- Docker image from [`backend/Dockerfile`](../backend/Dockerfile)
- Config: [`backend/fly.toml`](../backend/fly.toml) (prod) or [`backend/fly.staging.toml`](../backend/fly.staging.toml)
- **Secrets stay on Fly** — not in the image. Set with `fly secrets set -a distill-api …`

## Extension after API URL changes

If the production hostname changes, update `extension/utils/backendEnv.js` (`prod`) and release a new extension build. The API deploy alone does not update Chrome clients.

## Related

- [`backend/README.md`](../backend/README.md) — first-time Fly + Supabase setup
- [`backend/STAGING.md`](../backend/STAGING.md) — staging app
- [`BACKEND_ROADMAP.md`](BACKEND_ROADMAP.md) — Phase 3 checklist
