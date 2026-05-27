-- Users who have consumed most of today's bucket (high utilization).
-- Adjust 90 to another threshold as needed.

SELECT
  user_id,
  remaining_credits,
  daily_limit,
  daily_limit - remaining_credits AS credits_used,
  ROUND(
    100.0 * (daily_limit - remaining_credits) / NULLIF(daily_limit, 0),
    1
  ) AS utilization_pct,
  credits_reset_at,
  token_version
FROM public.distill_user_state
WHERE daily_limit > 0
  AND (daily_limit - remaining_credits)::float / daily_limit >= 0.90
ORDER BY credits_used DESC, credits_reset_at ASC
LIMIT 100;
