# Distill HTTP API

Hand-maintained reference for the Node backend in [`backend/server.js`](../backend/server.js). When you add or change routes, update this file in the same PR.

**Version:** `0.1.0` (also returned by `GET /v1/config`)

**Default port (local):** `8787`

## Base URLs

| Environment | URL |
|-------------|-----|
| Production | `https://distill-api.fly.dev` |
| Staging | `https://distill-api-staging.fly.dev` |
| Local | `http://localhost:8787` |

Extension defaults: [`extension/utils/backendEnv.js`](../extension/utils/backendEnv.js).

---

## Conventions

### JSON errors

Failed JSON responses use:

```json
{ "code": "SOME_CODE", "message": "Human-readable detail." }
```

Rate-limited responses include `retryAfterSec` and a `Retry-After` header (seconds).

### Authentication

| Scheme | Header | Used on |
|--------|--------|---------|
| Guest JWT | `Authorization: Bearer <token>` | `/v1/usage`, `/v1/ai/run`, `/v1/auth/rotate` |
| Admin | `x-admin-secret: <ADMIN_SECRET>` | `/v1/admin/*` (only when enabled) |

Tokens are HMAC-signed JWT-like strings (`HS256`). Claims: `sub` (e.g. `guest:<installId>`), `iat`, `exp`, `ver` (token version for revocation). Signed with `BACKEND_SECRET`.

Obtain a token via `POST /v1/auth/guest`.

### CORS

- `CORS_ORIGIN=*` allows localhost and, on **loopback** `Host`, any `chrome-extension://` origin.
- With `PUBLIC_BACKEND=1` and non-loopback `Host`, `chrome-extension://` origins must appear in `EXTENSION_CORS_ORIGINS`.

### Request body limit

`application/json` bodies are limited to **1 MB**.

---

## Route index

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/healthz` | — | Liveness probe |
| `GET` | `/health` | — | Alias of `/healthz` |
| `GET` | `/metrics` | — | In-process counters (JSON) |
| `GET` | `/metrics/prometheus` | — | Same counters (Prometheus text) |
| `GET` | `/v1/config` | — | Safe feature flags |
| `POST` | `/v1/auth/guest` | — | Mint guest bearer token |
| `POST` | `/v1/auth/rotate` | Bearer | Invalidate old token, issue new |
| `GET` | `/v1/usage` | Bearer | Daily credit balance |
| `POST` | `/v1/ai/run` | Bearer | Stream AI output (SSE) |
| `POST` | `/v1/admin/revoke-user` | Admin | Bump token version (revoke sessions) |
| `POST` | `/v1/admin/reset-usage` | Admin | Reset user credits |
| `GET` | `/v1/admin/user-state/:userId` | Admin | Inspect usage + token version |

Admin routes return **404** unless `ENABLE_ADMIN_ROUTES=1` and `ADMIN_SECRET` is set.

---

## Operations & probes

### `GET /healthz` · `GET /health`

**Response `200`**

```json
{ "ok": true }
```

### `GET /metrics`

Coarse in-process counters (resets on deploy). See **[`METRICS.md`](METRICS.md)** for Prometheus/Grafana setup.

**Response `200`**

```json
{
  "ok": true,
  "requestsTotal": 0,
  "aiRunsTotal": 0,
  "aiRunErrors": 0,
  "aiRunAvgLatencyMs": 0,
  "aiRunLatencyMsSum": 0,
  "aiRunLatencyMsCount": 0
}
```

### `GET /metrics/prometheus`

Prometheus **text exposition format** (`text/plain; version=0.0.4`). Series names prefixed with `distill_`. Unauthenticated.

```bash
curl -s https://distill-api.fly.dev/metrics/prometheus
```

### `GET /v1/config`

No secrets; safe for extension status UI and ops.

**Response `200`**

```json
{
  "ok": true,
  "version": "0.1.0",
  "aiReady": true,
  "anthropicKeyConfigured": true,
  "geminiKeyConfigured": false,
  "llmProvider": "anthropic",
  "aiEnabled": true,
  "usageEnabled": true,
  "guestAuthEnabled": true
}
```

| Field | Meaning |
|-------|---------|
| `aiReady` | At least one LLM API key configured |
| `anthropicKeyConfigured` | Deprecated alias of `aiReady` |
| `llmProvider` | Resolved provider (`anthropic`, `gemini`, or configured default) |
| `aiEnabled` | `KILL_SWITCH_AI_RUN` is off |
| `usageEnabled` | `KILL_SWITCH_USAGE` is off |
| `guestAuthEnabled` | `KILL_SWITCH_GUEST_AUTH` is off |

---

## Auth

### `POST /v1/auth/guest`

Mint a bearer token for a stable install id.

**Rate limits:** per IP (`RATE_LIMIT_GUEST_AUTH_IP_PER_MIN`), per `installId` (`RATE_LIMIT_GUEST_AUTH_PER_INSTALL_PER_MIN`).

**Request body**

```json
{ "installId": "uuid-or-stable-string" }
```

| Field | Rules |
|-------|--------|
| `installId` | Required string, max 256 chars |

**Response `200`**

```json
{
  "token": "<jwt-like>",
  "tokenType": "Bearer",
  "expiresInSec": 2592000
}
```

**Errors:** `INSTALL_ID_REQUIRED`, `INSTALL_ID_INVALID`, `RATE_LIMIT_GUEST_AUTH`, `ENDPOINT_DISABLED`, `AUTH_STORE_UNAVAILABLE`

---

### `POST /v1/auth/rotate`

Requires valid bearer token. Bumps `token_version` for the user, invalidating previous tokens, then returns a new token.

**Response `200`**

```json
{
  "ok": true,
  "token": "<jwt-like>",
  "tokenType": "Bearer",
  "expiresInSec": 2592000
}
```

**Errors:** `AUTH_REQUIRED`, `AUTH_INVALID`, `AUTH_STORE_UNAVAILABLE`

---

## Usage

### `GET /v1/usage`

**Rate limits:** per IP and per user/install (`RATE_LIMIT_*`).

**Response `200`**

```json
{
  "remainingCredits": 1196,
  "dailyLimit": 1200,
  "resetAt": "2026-05-20T00:00:00.000Z"
}
```

Credits reset at `USAGE_RESET_HOUR_UTC` (UTC). Default daily pool: `DAILY_CREDITS` (default `1200`).

**Errors:** `AUTH_REQUIRED`, `AUTH_INVALID`, `RATE_LIMIT_IP`, `RATE_LIMIT_USER`, `ENDPOINT_DISABLED`, `USAGE_UNAVAILABLE`

---

## AI streaming

### `POST /v1/ai/run`

Proxies to Anthropic or Gemini (see `LLM_PROVIDER`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`). Response is **Server-Sent Events** (`Content-Type: text/event-stream`).

**Middleware order:** auth → rate limit → body validation → quota check (may return `402` before streaming).

**Request body**

```json
{
  "task": "now",
  "context": { },
  "input": { },
  "meta": { "aiMode": "balanced" }
}
```

| Field | Rules |
|-------|--------|
| `task` | Required; one of the [task names](#ai-tasks) below |
| `context` | Optional object (task-specific fields) |
| `input` | Optional object (task-specific fields) |
| `meta` | Optional object; `meta.aiMode` may be `balanced` (default) or `ultra-lean` |

**SSE events**

Each event:

```
event: <name>
data: <json>

```

| Event | Payload | When |
|-------|---------|------|
| `chunk` | `{ "text": "…" }` | Partial model output |
| `done` | `{ "model", "provider", "cost", "aiMode", "remainingCredits" }` | Success; credits debited |
| `error` | `{ "message": "…" }` | Provider or internal failure (HTTP status may still be `200`) |

**`done` example**

```json
{
  "model": "claude-haiku-4-5",
  "provider": "anthropic",
  "cost": 4,
  "aiMode": "balanced",
  "remainingCredits": 1196
}
```

`remainingCredits` reflects balance **after** debit.

**Errors (JSON, before stream):** `AUTH_*`, `RATE_LIMIT_*`, `TASK_REQUIRED`, `TASK_UNKNOWN`, `CONTEXT_INVALID`, `INPUT_INVALID`, `META_INVALID`, `QUOTA_EXCEEDED`, `ENDPOINT_DISABLED`, `USAGE_UNAVAILABLE`

On `QUOTA_EXCEEDED` (`402`):

```json
{
  "code": "QUOTA_EXCEEDED",
  "message": "Daily credits exhausted.",
  "remainingCredits": 0,
  "dailyLimit": 1200,
  "resetAt": "2026-05-20T00:00:00.000Z"
}
```

### AI tasks

Aligned with `extension/background.js` `streamTask` and `TASK_COSTS` in `server.js`.

| `task` | Base cost | Typical `context` | Typical `input` |
|--------|-----------|-------------------|-----------------|
| `now` | 4 | `recent` | `paragraph` |
| `summary` | 10 | `title`, `opener`, `recent`, `readCount`, `prevSummary` | `readSoFar`, `freshRead` |
| `quiz_question` | 5 | `recent` | — |
| `quiz_feedback` | 7 | `recent` | `question`, `answer` |
| `quiz_skipped_review` | 6 | `recent` | `question` |
| `analysis` | 12 | `title`, `opener`, `priorGist`, `recent` | `selection` |
| `explain_page` | 8 | — | `pageText` |

**Cost modes**

| `meta.aiMode` | Multiplier |
|---------------|------------|
| `balanced` | 1× base (table above) |
| `ultra-lean` | 0.6× base, rounded, minimum **1** credit |

**Model routing:** per-task primary/fallback in `TASK_MODEL_ROUTER` (Anthropic Haiku by default). With `LLM_PROVIDER=auto`, Gemini is preferred when `GEMINI_API_KEY` is set.

---

## Admin

Requires `ENABLE_ADMIN_ROUTES=1` and header `x-admin-secret: <ADMIN_SECRET>`. CLI helper: [`backend/scripts/admin.sh`](../backend/scripts/admin.sh).

### `POST /v1/admin/revoke-user`

```json
{ "userId": "guest:<installId>" }
```

**Response `200`:** `{ "ok": true, "userId": "…", "tokenVersion": 2 }`

### `POST /v1/admin/reset-usage`

```json
{ "userId": "guest:<installId>" }
```

**Response `200`:** `{ "ok": true, "userId": "…", "usage": { "remainingCredits", "dailyLimit", "resetAt" } }`

### `GET /v1/admin/user-state/:userId`

**Response `200`:** `{ "userId", "tokenVersion", "usage": { … } }`

**Errors:** `NOT_FOUND` (admin disabled), `ADMIN_UNAUTHORIZED`, `ADMIN_DISABLED`, `USER_ID_REQUIRED`, `AUTH_STORE_UNAVAILABLE`, `USAGE_STORE_UNAVAILABLE`

---

## Error code reference

| Code | HTTP | Endpoint(s) |
|------|------|-------------|
| `AUTH_REQUIRED` | 401 | Bearer routes |
| `AUTH_INVALID` | 401 | Bearer routes |
| `INSTALL_ID_REQUIRED` | 400 | `/v1/auth/guest` |
| `INSTALL_ID_INVALID` | 400 | `/v1/auth/guest` |
| `RATE_LIMIT_GUEST_AUTH` | 429 | `/v1/auth/guest` |
| `RATE_LIMIT_IP` | 429 | Usage, AI |
| `RATE_LIMIT_USER` | 429 | Usage, AI |
| `QUOTA_EXCEEDED` | 402 | `/v1/ai/run` |
| `TASK_REQUIRED` | 400 | `/v1/ai/run` |
| `TASK_UNKNOWN` | 400 | `/v1/ai/run` |
| `CONTEXT_INVALID` | 400 | `/v1/ai/run` |
| `INPUT_INVALID` | 400 | `/v1/ai/run` |
| `META_INVALID` | 400 | `/v1/ai/run` |
| `ENDPOINT_DISABLED` | 503 | Guest auth, usage, AI (kill switches) |
| `AUTH_STORE_UNAVAILABLE` | 503 | Auth, admin |
| `USAGE_UNAVAILABLE` | 503 | Usage |
| `USAGE_STORE_UNAVAILABLE` | 503 | Admin usage |
| `NOT_FOUND` | 404 | Admin (disabled) |
| `ADMIN_UNAUTHORIZED` | 401 | Admin |
| `ADMIN_DISABLED` | 503 | Admin |
| `USER_ID_REQUIRED` | 400 | Admin |

---

## Environment & kill switches

See [`backend/.env.example`](../backend/.env.example).

| Variable | Effect |
|----------|--------|
| `KILL_SWITCH_AI_RUN=1` | `/v1/ai/run` → `ENDPOINT_DISABLED` |
| `KILL_SWITCH_GUEST_AUTH=1` | `/v1/auth/guest` disabled |
| `KILL_SWITCH_USAGE=1` | `/v1/usage` disabled |

---

## Related docs

- [Backend README](../backend/README.md) — deploy, Postgres, Docker
- [Logging](LOGGING.md) — NDJSON access logs on Fly
- [Metrics](METRICS.md) — Prometheus scrape, Grafana panels, alerts
- [Staging](../backend/STAGING.md) — `distill-api-staging`
