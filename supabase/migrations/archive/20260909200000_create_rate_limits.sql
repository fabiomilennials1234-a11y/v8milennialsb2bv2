-- ============================================================================
-- Migration: Persistent Rate Limiting
-- Description: Creates rate_limits table, check_rate_limit RPC, and cleanup
-- ============================================================================

-- 1. Create rate_limits table
CREATE TABLE IF NOT EXISTS public.rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL,                -- e.g. "api_key:tq_live_abc:lead-webhook"
  window_start TIMESTAMPTZ NOT NULL,
  window_seconds INT NOT NULL DEFAULT 60,
  request_count INT NOT NULL DEFAULT 1,
  max_requests INT NOT NULL DEFAULT 100,
  UNIQUE(key, window_start)
);

CREATE INDEX idx_rate_limits_key_window
  ON public.rate_limits(key, window_start DESC);

-- 2. RLS: internal table, service_role only
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access"
  ON public.rate_limits
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 3. check_rate_limit RPC
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_key TEXT,
  p_max_requests INT DEFAULT 100,
  p_window_seconds INT DEFAULT 60
)
RETURNS TABLE(allowed BOOLEAN, remaining INT, reset_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_request_count INT;
  v_max_requests INT;
BEGIN
  -- Calculate window start: truncate to minute for 60s windows, sliding for custom
  IF p_window_seconds = 60 THEN
    v_window_start := date_trunc('minute', now());
  ELSE
    v_window_start := now() - (p_window_seconds || ' seconds')::interval;
  END IF;

  -- Upsert: insert new window or increment existing
  INSERT INTO rate_limits (key, window_start, window_seconds, request_count, max_requests)
  VALUES (p_key, v_window_start, p_window_seconds, 1, p_max_requests)
  ON CONFLICT (key, window_start)
  DO UPDATE SET request_count = rate_limits.request_count + 1
  RETURNING rate_limits.request_count, rate_limits.max_requests
  INTO v_request_count, v_max_requests;

  RETURN QUERY
    SELECT
      (v_request_count <= v_max_requests)::BOOLEAN AS allowed,
      GREATEST(v_max_requests - v_request_count, 0)::INT AS remaining,
      (v_window_start + (p_window_seconds || ' seconds')::interval) AS reset_at;
END;
$$;

-- 4. Cleanup function: purge expired windows (run via pg_cron every hour)
CREATE OR REPLACE FUNCTION public.purge_expired_rate_limits()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM rate_limits
  WHERE window_start + (window_seconds || ' seconds')::interval < now() - interval '1 hour';
END;
$$;

-- 5. Grant execute on RPCs
GRANT EXECUTE ON FUNCTION public.check_rate_limit(TEXT, INT, INT) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.purge_expired_rate_limits() TO service_role;
