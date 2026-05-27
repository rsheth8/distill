# Backend roadmap

Phased plan to harden, scale, and operate the Distill API. Work through phases in order where possible; items within a phase can be parallelized.

**Status key:** `[ ]` not started · `[~]` in progress · `[x]` done

Track progress by checking boxes in PRs. Root commands: `npm test`, `npm run deploy:backend`, `npm run check:backend-remote`.

---

## Phase 0 — Baseline & verify (1–2 days)

Confirm production matches how we develop and test.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 0.1 | Document prod checklist (Postgres, secrets, CORS, extension URL) | [x] | This file + [`backend/README.md`](../backend/README.md) |
| 0.2 | `npm run check:backend-remote` in CI (scheduled + on `main`) | [x] | [`.github/workflows/backend-remote.yml`](../.github/workflows/backend-remote.yml) |
| 0.3 | Manual prod verification: `fly secrets list`, Supabase migration applied | [x] | Fly verified 2026-05-18 (see below); run Supabase SQL if you want explicit table proof |
| 0.4 | Confirm `extension/utils/backendEnv.js` `prod` matches Fly hostname | [x] | `https://distill-api.fly.dev` matches Fly hostname |

### Prod verification

```bash
# Health (no secrets)
npm run check:backend-remote

# Fly (requires fly auth)
fly secrets list -a distill-api
fly status -a distill-api

# Supabase: confirm table exists
# SELECT 1 FROM public.distill_user_state LIMIT 1;
```

Expected Fly secrets (minimum): `BACKEND_SECRET`, `GEMINI_API_KEY` (recommended free tier) or `ANTHROPIC_API_KEY`, `DATABASE_URL`, `PUBLIC_BACKEND=1`, `EXTENSION_CORS_ORIGINS`.

### Verification log

| Date | Check | Result |
|------|--------|--------|
| 2026-05-18 | `fly secrets list -a distill-api` | All six secrets deployed: `BACKEND_SECRET`, `ANTHROPIC_API_KEY`, `DATABASE_URL`, `PUBLIC_BACKEND`, `EXTENSION_CORS_ORIGINS` |
| 2026-05-18 | `fly status -a distill-api` | App `distill-api`, hostname `distill-api.fly.dev`, machine `started` in `iad` |
| 2026-05-18 | `npm run check:backend-remote` | `/healthz` + `/v1/config` 200 |
| 2026-05-18 | `backendEnv.js` prod URL | Matches Fly hostname |

**Optional:** In Supabase SQL Editor, `SELECT 1 FROM public.distill_user_state LIMIT 1;` — confirms migration `20250513000000_distill_user_state.sql` was applied. With `DATABASE_URL` on Fly, the API already expects this table for usage persistence.

**Phase 0 complete** — proceed to [Phase 1](#phase-1--developer-experience-2-4-days).

---

## Phase 1 — Developer experience (2–4 days)

Make local and CI environments match production patterns.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 1.1 | Docker Compose: API + optional Postgres | [x] | [`docker-compose.yml`](../docker-compose.yml) |
| 1.2 | Document Compose in `backend/README.md` | [x] | |
| 1.3 | Staging Fly app (`distill-api-staging`) | [x] | [`fly.staging.toml`](../backend/fly.staging.toml), [`STAGING.md`](../backend/STAGING.md), extension **Staging** server option |
| 1.4 | Mocked SSE test for `/v1/ai/run` (no live LLM) | [x] | [`tests/backend/ai-run-sse.integration.test.mjs`](../tests/backend/ai-run-sse.integration.test.mjs) |
| 1.5 | OpenAPI / route list doc generated or hand-maintained | [x] | [`docs/api.md`](api.md) + `scripts/check-api-doc.mjs` in smoke |

---

## Phase 2 — Observability & operations (2–3 days)

See production behavior without SSH.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 2.1 | Production logging: `REQUEST_LOG_STDOUT=1` on Fly | [x] | Set on `distill-api` + `distill-api-staging` (2026-05-19) |
| 2.2 | Document log ingestion (Fly logs → your stack) | [x] | [`docs/LOGGING.md`](LOGGING.md) |
| 2.3 | `/metrics` scrape or export doc | [x] | [`docs/METRICS.md`](METRICS.md), `GET /metrics/prometheus`, [`prometheus/scrape.example.yml`](prometheus/scrape.example.yml) |
| 2.4 | Usage dashboard query (Supabase SQL / Metabase) | [x] | [`docs/USAGE_DASHBOARD.md`](USAGE_DASHBOARD.md), [`supabase/queries/`](../supabase/queries/) |
| 2.5 | LLM spend alerts (Anthropic/Gemini billing) | [ ] | External to repo |

---

## Phase 3 — CI/CD & environments (2–3 days)

Automate deploy and catch regressions against real hosts.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 3.1 | Scheduled remote health workflow | [x] | Phase 0.2 |
| 3.2 | Deploy workflow on merge to `main` (`FLY_API_TOKEN`) | [x] | [`.github/workflows/deploy-backend.yml`](../.github/workflows/deploy-backend.yml), [`DEPLOY.md`](DEPLOY.md) |
| 3.3 | Post-deploy smoke in CD (`check:backend-remote`) | [x] | Included in deploy workflow (+ `/metrics/prometheus` curl) |
| 3.4 | Nightly eval matrix job (GitHub secret for API key) | [x] | [`.github/workflows/eval-matrix.yml`](../.github/workflows/eval-matrix.yml), [`DEPLOY.md`](DEPLOY.md#nightly-eval-matrix) |
| 3.5 | Custom domain + TLS on Fly | [ ] | DNS + `fly certs` |

---

## Phase 4 — Reliability & scale (1–2 weeks)

Required before multiple Fly machines or heavy abuse.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 4.1 | Redis for rate limits (Fly Redis or Upstash) | [ ] | Replace in-memory `Map`s in `server.js` |
| 4.2 | Enable multi-machine deploy (`--ha` or count > 1) | [ ] | After 4.1 |
| 4.3 | Postgres required in prod (fail boot if `DATABASE_URL` missing when `NODE_ENV=production`) | [ ] | |
| 4.4 | Supabase backup / PITR verified | [ ] | Console checklist |
| 4.5 | Graceful shutdown + drain (already partial) | [ ] | Review `gracefulShutdown` under load |

---

## Phase 5 — Security & abuse (ongoing)

| # | Task | Status | Notes |
|---|------|--------|-------|
| 5.1 | Expand security integration tests | [ ] | CORS, quotas, payload limits |
| 5.2 | Admin: IP allowlist or VPN-only | [ ] | |
| 5.3 | Admin audit log (table or NDJSON) | [ ] | |
| 5.4 | `BACKEND_SECRET` rotation runbook + dual-key window | [ ] | |
| 5.5 | Request signing / install attestation (if abuse grows) | [ ] | |
| 5.6 | PII & retention policy for access logs | [ ] | |

---

## Phase 6 — API & product evolution

| # | Task | Status | Notes |
|---|------|--------|-------|
| 6.1 | Extract routers: `auth`, `ai`, `admin` | [ ] | When adding next route |
| 6.2 | Feature flags via `/v1/config` | [ ] | Kill switches already env-based |
| 6.3 | New tasks / endpoints (document in extension smoke) | [ ] | Keep `TASK_COSTS` aligned |
| 6.4 | User accounts beyond `guest:<installId>` | [ ] | OAuth / magic link |
| 6.5 | Server-side fetch (strict URL allowlist) | [ ] | High abuse risk — design carefully |
| 6.6 | Free-tier LLM on Fly (Gemini primary; drop Anthropic spend) | [~] | [`FREE_LLM.md`](FREE_LLM.md) — code supports Gemini; operator cutover + optional Groq |

---

## Suggested order (sprints)

| Sprint | Focus | Exit criteria |
|--------|--------|----------------|
| **Sprint 1** | Phase 0 + 1.1–1.2 | CI remote check green; Compose documented; prod checklist done |
| **Sprint 2** | Phase 1.3–1.5 + 2.1–2.3 | Staging app; mocked SSE test; logs on Fly |
| **Sprint 3** | Phase 3.2–3.5 + 4.3 | CD to Fly; prod requires Postgres |
| **Sprint 4** | Phase 4.1–4.2 + 5.1 | Redis rate limits; multi-machine |
| **Sprint 5+** | Phase 5–6 as needed | Security + product features |

---

## Changelog

| Date | Change |
|------|--------|
| 2026-05-18 | Roadmap created; Phase 0.2, 1.1–1.2 started |
| 2026-05-18 | Phase 0.3–0.4 verified (Fly secrets, status, extension prod URL) |
| 2026-05-18 | Phase 1.4: mocked `/v1/ai/run` SSE tests (chunk/done, error, model fallback) |
| 2026-05-18 | Phase 1.3: `distill-api-staging` deployed; extension Staging server option |
| 2026-05-19 | Phase 2.1–2.2: `REQUEST_LOG_STDOUT=1` on Fly; [`LOGGING.md`](LOGGING.md) |
| 2026-05-19 | Phase 1.5: [`api.md`](api.md) HTTP reference |
| 2026-05-19 | Phase 2.3: [`METRICS.md`](METRICS.md), Prometheus text endpoint |
| 2026-05-19 | Phase 2.4: [`USAGE_DASHBOARD.md`](USAGE_DASHBOARD.md), Supabase SQL query pack |
| 2026-05-19 | Phase 3.2–3.3: GitHub Actions Fly deploy + post-deploy smoke |
| 2026-05-24 | Phase 3.4: nightly eval matrix workflow + `assert-matrix-out.mjs` |
