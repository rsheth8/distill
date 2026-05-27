-- Histogram: how many users fall into each "credits used" band (current bucket).
-- Chart in Supabase: bar chart on bucket_label vs user_count.

WITH bands AS (
  SELECT
    user_id,
    daily_limit - remaining_credits AS credits_used,
    CASE
      WHEN daily_limit - remaining_credits = 0 THEN '0'
      WHEN daily_limit - remaining_credits BETWEEN 1 AND 50 THEN '1-50'
      WHEN daily_limit - remaining_credits BETWEEN 51 AND 200 THEN '51-200'
      WHEN daily_limit - remaining_credits BETWEEN 201 AND 500 THEN '201-500'
      WHEN daily_limit - remaining_credits BETWEEN 501 AND 1000 THEN '501-1000'
      ELSE '1000+'
    END AS bucket_label,
    CASE
      WHEN daily_limit - remaining_credits = 0 THEN 0
      WHEN daily_limit - remaining_credits BETWEEN 1 AND 50 THEN 1
      WHEN daily_limit - remaining_credits BETWEEN 51 AND 200 THEN 2
      WHEN daily_limit - remaining_credits BETWEEN 201 AND 500 THEN 3
      WHEN daily_limit - remaining_credits BETWEEN 501 AND 1000 THEN 4
      ELSE 5
    END AS bucket_order
  FROM public.distill_user_state
)
SELECT
  bucket_label,
  COUNT(*)::bigint AS user_count
FROM bands
GROUP BY bucket_label, bucket_order
ORDER BY bucket_order;
