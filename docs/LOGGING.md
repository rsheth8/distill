# Backend logging (Fly.io)

Distill emits **one JSON object per line** (NDJSON). On Fly, enable structured HTTP access logs on stdout so `fly logs` and the Fly dashboard capture them.

## Production setup (done)

Both apps have:

```bash
fly secrets set REQUEST_LOG_STDOUT=1 -a distill-api
fly secrets set REQUEST_LOG_STDOUT=1 -a distill-api-staging
```

Fly restarts machines automatically after secret changes. No `REQUEST_LOG_FILE` inside the container (ephemeral disk; use stdout instead).

## Log types

| `level` | Source | Example fields |
|---------|--------|----------------|
| `access` | Every HTTP response (except skipped paths) | `method`, `path`, `statusCode`, `durationMs`, `requestId`, `ip`, `userAgent` |
| `info` | Guest auth, `/v1/ai/run` completion, admin | `route`, `task`, `latencyMs`, `userId`, `model` |
| `error` | Failures | `msg`, `error` |
| `warn` | Startup hints | `msg`, `hint` |

Skipped from access log by default: `/healthz`, `/health`, `/metrics`. Override with `REQUEST_LOG_SKIP_PATHS` (use `-` to log everything).

## View logs on Fly

```bash
# Live tail (production)
fly logs -a distill-api

# Staging
fly logs -a distill-api-staging

# Recent lines only
fly logs -a distill-api --no-tail | tail -20
```

Dashboard: [Fly app monitoring](https://fly.io/apps/distill-api/monitoring) → **Logs**.

After a health check you should see lines like:

```json
{"level":"access","ts":"…","requestId":"…","method":"GET","path":"/v1/config","statusCode":200,"durationMs":1,"ip":"…","userAgent":"…"}
```

## Export to another stack (optional)

Fly can ship logs to external systems (see [Fly log export](https://fly.io/docs/monitoring/logging/)):

- **Datadog / Better Stack / Logtail** — configure a Fly log shipper or drain in the Fly dashboard.
- **Manual** — `fly logs` piped to a script, or poll the [Fly Machines logs API](https://fly.io/docs/machines/api/machines-resource/#get-logs-for-a-machine).

Filter on `level: "access"` for request volume; `route: "/v1/ai/run"` in `level: "info"` lines for AI latency and task mix.

## Local development

In `backend/.env`:

```bash
REQUEST_LOG_STDOUT=1
# optional file copy:
# REQUEST_LOG_FILE=./data/access.ndjson
```

Docker Compose: access lines appear in `docker compose logs -f api`.

## Related env vars

See [`backend/.env.example`](../backend/.env.example): `REQUEST_LOG_FILE`, `REQUEST_LOG_MAX_BYTES`, `REQUEST_LOG_MAX_FILES`, `REQUEST_LOG_SKIP_PATHS`.
