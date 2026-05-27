-- Buckets resetting in the next 24 hours (UTC).

SELECT
  user_id,
  remaining_credits,
  daily_limit,
  credits_reset_at,
  credits_reset_at - NOW() AS time_until_reset
FROM public.distill_user_state
WHERE credits_reset_at > NOW()
  AND credits_reset_at <= NOW() + INTERVAL '24 hours'
ORDER BY credits_reset_at ASC
LIMIT 200;
