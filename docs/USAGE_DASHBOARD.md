# Usage dashboard (Supabase)

Business metrics from **`public.distill_user_state`** — daily credit buckets per user (`guest:<installId>`). The API debits `remaining_credits` on each successful `/v1/ai/run`; rows are created on first guest auth.

**Schema:** [`supabase/migrations/20250513000000_distill_user_state.sql`](../supabase/migrations/20250513000000_distill_user_state.sql)

**When this applies:** Production/staging with `DATABASE_URL` set on Fly. Local file-backed dev has no Postgres rows.

---

## Quick start (Supabase)

1. Open your project → **SQL** → **New query**.
2. Paste a query from [`supabase/queries/`](../supabase/queries/) (or below).
3. **Save** as a snippet or turn on **Chart** for simple visuals.

For a richer UI, connect **Metabase** (or Grafana Postgres) to the same database using the **read-only** connection string (or a dedicated read replica).

---

## Core definitions

| Derived value | Formula |
|---------------|---------|
| Credits used (today’s bucket) | `daily_limit - remaining_credits` |
| Utilization % | `100.0 * (daily_limit - remaining_credits) / NULLIF(daily_limit, 0)` |
| Active user (proxy) | Row exists and `remaining_credits < daily_limit` (consumed at least 1 credit this period) |

`credits_reset_at` is when the current bucket rolls over (UTC; aligned with `USAGE_RESET_HOUR_UTC` on the API).

---

## Recommended dashboard panels

| Panel | Query file | Chart type |
|-------|------------|------------|
| Total guest installs | `01_totals.sql` | Single number |
| Credits used (all users, current bucket) | `01_totals.sql` | Single number |
| Active users (used ≥1 credit) | `01_totals.sql` | Single number |
| Users at ≥90% of daily limit | `02_heavy_users.sql` | Table |
| Reset schedule (next 24h) | `03_resets_upcoming.sql` | Table |
| Credit distribution histogram | `04_credit_distribution.sql` | Bar |
| Top 25 consumers | `05_top_consumers.sql` | Table |

---

## Metabase

1. **Admin → Databases → Add database → Postgres.**
2. Use Supabase **connection string** (Settings → Database). Prefer **read-only** user if you create one.
3. **SSL:** required; use pooler host (`*.pooler.supabase.com:6543`) for serverless-friendly connections.
4. For each SQL file: **+ New → SQL query** → paste → **Save** → add to a dashboard.

**Variables (optional):** wrap queries with Metabase `{{min_util_pct}}` filters on `02_heavy_users.sql` if you parameterize the `WHERE` clause.

---

## Grafana (Postgres data source)

1. Add **PostgreSQL** data source with the same URI.
2. Create panels with **Format: Table** or time series if you log snapshots externally.
3. Note: `distill_user_state` is **current state**, not a time series — for history you would need periodic snapshots or log-based metrics ([`METRICS.md`](METRICS.md)).

---

## Staging vs production

Use **separate** Supabase projects (recommended). Point Metabase/Grafana at the prod read-only URL for operator dashboards; use staging only for QA.

Never point a staging API at production `DATABASE_URL`.

---

## Privacy

- `user_id` is `guest:<installId>` — pseudonymous, not email.
- Do not export tables to public buckets without policy review.
- Admin inspect: `GET /v1/admin/user-state/:userId` or [`backend/scripts/admin.sh`](../backend/scripts/admin.sh).

---

## Related

- [`METRICS.md`](METRICS.md) — request/AI counters (in-memory on each machine)
- [`LOGGING.md`](LOGGING.md) — per-request NDJSON on Fly
- [`api.md`](api.md) — `/v1/usage` response shape
