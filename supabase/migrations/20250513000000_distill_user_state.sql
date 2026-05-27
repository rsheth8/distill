-- Distill API: per-user credits + JWT revocation version.
-- Apply in Supabase: SQL Editor → New query, or `supabase db push` if you use the Supabase CLI.

CREATE TABLE IF NOT EXISTS public.distill_user_state (
  user_id TEXT PRIMARY KEY,
  token_version INTEGER NOT NULL DEFAULT 1,
  remaining_credits INTEGER NOT NULL,
  daily_limit INTEGER NOT NULL,
  credits_reset_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS distill_user_state_reset_idx
  ON public.distill_user_state (credits_reset_at);

ALTER TABLE public.distill_user_state ENABLE ROW LEVEL SECURITY;

-- No Supabase Auth policies: the API connects with the service role / pooler string (bypasses RLS).
-- If you ever use the anon key from browsers, add explicit policies; the Node API should use service_role.

COMMENT ON TABLE public.distill_user_state IS 'Distill backend: daily credit bucket + token_version for JWT invalidation.';
