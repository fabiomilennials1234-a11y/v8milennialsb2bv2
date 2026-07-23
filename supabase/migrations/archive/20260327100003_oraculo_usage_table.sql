CREATE TABLE IF NOT EXISTS public.oraculo_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  response TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_oraculo_usage_user_date ON oraculo_usage(user_id, created_at);
CREATE INDEX idx_oraculo_usage_org ON oraculo_usage(organization_id);
ALTER TABLE oraculo_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own oraculo usage" ON oraculo_usage FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own oraculo usage" ON oraculo_usage FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.check_oraculo_limit(p_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_used INTEGER; v_limit INTEGER := 3;
BEGIN
  SELECT COUNT(*) INTO v_used FROM oraculo_usage
  WHERE user_id = p_user_id
    AND created_at >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC')
    AND created_at < DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 day';
  RETURN jsonb_build_object('used', v_used, 'remaining', GREATEST(v_limit - v_used, 0), 'limit', v_limit);
END; $$;

CREATE OR REPLACE FUNCTION public.record_oraculo_usage(
  p_user_id UUID, p_org_id UUID, p_question TEXT, p_response TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_used INTEGER; v_limit INTEGER := 3;
BEGIN
  SELECT COUNT(*) INTO v_used FROM oraculo_usage
  WHERE user_id = p_user_id
    AND created_at >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC')
    AND created_at < DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 day';
  IF v_used >= v_limit THEN
    RETURN jsonb_build_object('error', 'limit_exceeded', 'used', v_used, 'remaining', 0);
  END IF;
  INSERT INTO oraculo_usage (user_id, organization_id, question, response) VALUES (p_user_id, p_org_id, p_question, p_response);
  RETURN jsonb_build_object('used', v_used + 1, 'remaining', v_limit - v_used - 1);
END; $$;

GRANT EXECUTE ON FUNCTION public.check_oraculo_limit(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_oraculo_limit(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_oraculo_usage(UUID, UUID, TEXT, TEXT) TO service_role;
