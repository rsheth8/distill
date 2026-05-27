-- Users with zero credits left (blocked until reset).

SELECT
  user_id,
  daily_limit,
  credits_reset_at,
  credits_reset_at - NOW() AS time_until_reset,
  token_version
FROM public.distill_user_state
WHERE remaining_credits = 0
ORDER BY credits_reset_at ASC
LIMIT 100;
