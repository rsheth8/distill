-- Summary KPIs for the current credit bucket (all users).
-- Supabase SQL Editor: run as-is or save as "Distill — totals".

SELECT
  COUNT(*)::bigint AS total_users,
  COUNT(*) FILTER (
    WHERE remaining_credits < daily_limit
  )::bigint AS active_users_used_credits,
  COALESCE(SUM(daily_limit - remaining_credits), 0)::bigint AS credits_used_total,
  COALESCE(SUM(remaining_credits), 0)::bigint AS credits_remaining_total,
  COALESCE(SUM(daily_limit), 0)::bigint AS credits_budget_total,
  ROUND(
    100.0 * COALESCE(SUM(daily_limit - remaining_credits), 0)
      / NULLIF(SUM(daily_limit), 0),
    2
  ) AS utilization_pct
FROM public.distill_user_state;
