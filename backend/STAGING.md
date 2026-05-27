# Staging API (`distill-api-staging`)

Separate Fly app for QA before production deploys. Hostname: **`https://distill-api-staging.fly.dev`**

Production remains **`distill-api`** (`fly.toml`). Staging uses [`fly.staging.toml`](fly.staging.toml).

## First-time setup

### 1. Create the Fly app (once)

```bash
cd backend
fly apps create distill-api-staging
```

### 2. Set secrets

**Recommended:** Use a **separate Supabase project** (or database) for staging so credits and user state never touch production.

**Quick start (from local `backend/.env`, optional `backend/.env.staging`):**

```bash
cp env.staging.example .env.staging   # edit EXTENSION_CORS_ORIGINS + optional DATABASE_URL
./scripts/bootstrap-staging-secrets.sh
```

Copy `EXTENSION_CORS_ORIGINS` from your production Fly app (same value you used for `distill-api`). Prefer a **separate** `DATABASE_URL` and `STAGING_BACKEND_SECRET` in `.env.staging` so staging does not share prod tokens or credits.

Minimum secrets:

| Secret | Notes |
|--------|--------|
| `BACKEND_SECRET` | Use a **different** value than production (staging tokens must not work on prod) |
| `ANTHROPIC_API_KEY` | Can match prod (lower rate limits on staging are optional) |
| `DATABASE_URL` | Staging Postgres URI (strongly prefer not sharing prod) |
| `PUBLIC_BACKEND` | `1` |
| `EXTENSION_CORS_ORIGINS` | Same `chrome-extension://…` ids as prod |

Optional staging tweaks:

```bash
fly secrets set -a distill-api-staging DAILY_CREDITS=5000
```

### 3. Deploy

```bash
npm run deploy:staging
# repo root: npm run deploy:backend:staging
```

### 4. Verify

```bash
npm run remote:check:staging
# or: npm run check:backend-staging
```

### 5. Extension

**Settings → Advanced → Server → Staging**, reload the side panel.  
Or set **Custom server URL** to `https://distill-api-staging.fly.dev`.

## Routine deploys

| Change | Command |
|--------|---------|
| Staging code | `npm run deploy:staging` (from `backend/`) |
| Staging secrets | `fly secrets set -a distill-api-staging KEY=value` then redeploy |
| Production | `npm run deploy` / `npm run deploy:backend` (uses `fly.toml`) |

## Isolation checklist

- [ ] Staging uses its own `BACKEND_SECRET`
- [ ] Staging `DATABASE_URL` points at non-production Postgres (or accept shared DB for solo dev only)
- [ ] After testing, switch extension back to **Production**
