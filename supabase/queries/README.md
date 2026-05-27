# Supabase SQL queries (usage dashboard)

Runnable in **Supabase SQL Editor** or **Metabase** (native query). See **[`../../docs/USAGE_DASHBOARD.md`](../../docs/USAGE_DASHBOARD.md)** for setup.

| File | Purpose |
|------|---------|
| `01_totals.sql` | KPIs: users, credits used/remaining, utilization % |
| `02_heavy_users.sql` | Users at ≥90% of daily limit |
| `03_resets_upcoming.sql` | Resets in next 24h |
| `04_credit_distribution.sql` | Histogram of credits used |
| `05_top_consumers.sql` | Top 25 by credits used |
| `06_exhausted.sql` | Users at 0 credits |
