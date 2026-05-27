-- Top users by credits consumed in the current bucket.

SELECT
  user_id,
  daily_limit - remaining_credits AS credits_used,
  remaining_credits,
  daily_limit,
  credits_reset_at,
  token_version
FROM public.distill_user_state
WHERE remaining_credits < daily_limit
ORDER BY credits_used DESC
LIMIT 25;
