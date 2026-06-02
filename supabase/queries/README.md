# Supabase SQL queries (usage dashboard)

Runnable in **Supabase SQL Editor** or **Metabase** (native query). Requires the `distill_user_state` table from [`../migrations/`](../migrations/). Setup guide: **[`../../docs/USAGE_DASHBOARD.md`](../../docs/USAGE_DASHBOARD.md)**.

| File | Purpose |
|------|---------|
| `01_totals.sql` | KPIs: users, credits used/remaining, utilization % |
| `02_heavy_users.sql` | Users at ≥90% of daily limit |
| `03_resets_upcoming.sql` | Resets in next 24h |
| `04_credit_distribution.sql` | Histogram of credits used |
| `05_top_consumers.sql` | Top 25 by credits used |
| `06_exhausted.sql` | Users at 0 credits |
