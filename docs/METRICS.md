# Backend metrics

Coarse **in-process** counters for the Distill API. No PII; values reset when a Fly machine restarts or redeploys.

Implementation: [`backend/server.js`](../backend/server.js) (`metrics` object, incremented per request / AI run).

---

## Endpoints

| Format | URL | `Content-Type` |
|--------|-----|----------------|
| JSON (default) | `GET /metrics` | `application/json` |
| Prometheus text | `GET /metrics/prometheus` | `text/plain; version=0.0.4` |

Production: `https://distill-api.fly.dev/metrics`  
Staging: `https://distill-api-staging.fly.dev/metrics/prometheus`

Both paths are **unauthenticated** (same as `/healthz`). Do not expose secrets here.

### JSON example

```bash
curl -s https://distill-api.fly.dev/metrics | jq
```

```json
{
  "ok": true,
  "requestsTotal": 1240,
  "aiRunsTotal": 87,
  "aiRunErrors": 2,
  "aiRunAvgLatencyMs": 1432,
  "aiRunLatencyMsSum": 124592,
  "aiRunLatencyMsCount": 87
}
```

| Field | Meaning |
|-------|---------|
| `requestsTotal` | All HTTP requests (via `requestLifecycleMiddleware`) |
| `aiRunsTotal` | `/v1/ai/run` handlers entered |
| `aiRunErrors` | AI runs that ended with an SSE `error` event |
| `aiRunAvgLatencyMs` | `round(aiRunLatencyMsSum / aiRunLatencyMsCount)` or `0` |
| `aiRunLatencyMsSum` / `aiRunLatencyMsCount` | Raw sums for Prometheus `rate()` / averages |

### Prometheus text example

```bash
curl -s https://distill-api.fly.dev/metrics/prometheus
```

```
# HELP distill_requests_total HTTP requests since process start.
# TYPE distill_requests_total counter
distill_requests_total 1240
…
```

Exported series:

| Metric | Type | Notes |
|--------|------|--------|
| `distill_requests_total` | counter | HTTP volume |
| `distill_ai_runs_total` | counter | AI usage |
| `distill_ai_run_errors_total` | counter | Failed streams |
| `distill_ai_run_latency_ms_sum` | counter | Use with `_count` for avg latency |
| `distill_ai_run_latency_ms_count` | counter | AI run count for latency |
| `distill_ai_run_latency_ms_avg` | gauge | Precomputed mean (same as JSON) |

---

## Limitations

- **Per-machine, not global** — With one Fly machine (`--ha=false`) this matches the app. Multiple machines each expose their own counters; Prometheus must scrape every instance or aggregate in queries.
- **Resets on deploy** — Counters restart at 0; use `rate()` / `increase()` in Prometheus, not raw values for SLOs.
- **Not a substitute for logs** — For per-user or per-task breakdown, use NDJSON access logs ([`LOGGING.md`](LOGGING.md)) or Supabase usage data.

---

## Prometheus scrape config

Example [`docs/prometheus/scrape.example.yml`](prometheus/scrape.example.yml):

```yaml
scrape_configs:
  - job_name: distill-api
    scrape_interval: 30s
    metrics_path: /metrics/prometheus
    static_configs:
      - targets: ['distill-api.fly.dev:443']
    scheme: https

  - job_name: distill-api-staging
    scrape_interval: 30s
    metrics_path: /metrics/prometheus
    static_configs:
      - targets: ['distill-api-staging.fly.dev:443']
    scheme: https
```

Run Prometheus locally:

```bash
prometheus --config.file=docs/prometheus/scrape.example.yml
```

Then open `http://localhost:9090` and try:

```promql
rate(distill_requests_total[5m])
rate(distill_ai_runs_total[5m])
rate(distill_ai_run_errors_total[5m]) / rate(distill_ai_runs_total[5m])
distill_ai_run_latency_ms_avg
```

---

## Grafana

1. Add a **Prometheus** data source pointing at your Prometheus server (or Grafana Cloud Prometheus).
2. Import or build a dashboard with panels:
   - **Request rate:** `sum(rate(distill_requests_total[5m]))`
   - **AI runs / min:** `sum(rate(distill_ai_runs_total[5m])) * 60`
   - **AI error ratio:** `sum(rate(distill_ai_run_errors_total[5m])) / sum(rate(distill_ai_runs_total[5m]))`
   - **Avg AI latency:** `avg(distill_ai_run_latency_ms_avg)` or `sum(rate(distill_ai_run_latency_ms_sum[5m])) / sum(rate(distill_ai_run_latency_ms_count[5m]))`

**Without Prometheus:** use the **JSON API** datasource or Grafana **Infinity** plugin against `GET /metrics` (poll every 30–60s). Prefer `/metrics/prometheus` when possible.

---

## Fly.io platform metrics

Fly also exposes **machine-level** CPU, memory, and HTTP proxy metrics in the dashboard. Those complement app metrics:

| Source | What you learn |
|--------|----------------|
| App `/metrics/prometheus` | AI volume, errors, latency |
| Fly dashboard | CPU/RAM, restarts, proxy 5xx |
| `fly logs` ([`LOGGING.md`](LOGGING.md)) | Per-route access, `requestId`, debugging |

---

## Alerting ideas

| Alert | PromQL (example) | Severity |
|-------|------------------|----------|
| AI error rate high | `sum(rate(distill_ai_run_errors_total[10m])) / sum(rate(distill_ai_runs_total[10m])) > 0.05` | warning |
| No traffic (prod down?) | `sum(rate(distill_requests_total[15m])) == 0` | critical (tune for low-traffic) |
| AI latency high | `avg(distill_ai_run_latency_ms_avg) > 8000` | warning |

Wire alerts in Grafana Alerting, Prometheus Alertmanager, or Grafana Cloud.

---

## Local development

```bash
curl -s http://localhost:8787/metrics | jq
curl -s http://localhost:8787/metrics/prometheus
```

After a few API calls, counters increase. Restarting `npm start` resets them.

---

## Related

- [`api.md`](api.md) — route reference
- [`LOGGING.md`](LOGGING.md) — NDJSON access logs
- [`USAGE_DASHBOARD.md`](USAGE_DASHBOARD.md) — Supabase credit usage SQL (business metrics)
