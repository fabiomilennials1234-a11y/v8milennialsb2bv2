-- Atomic lead + pipe creation RPC
-- Wraps lead INSERT + pipe entry INSERT in a single transaction.
-- If ANY insert fails, the entire function rolls back automatically.

CREATE OR REPLACE FUNCTION public.create_lead_with_pipe(
  -- Lead fields
  p_name TEXT,
  p_email TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL,
  p_normalized_phone TEXT DEFAULT NULL,
  p_company TEXT DEFAULT NULL,
  p_origin TEXT DEFAULT 'outro',
  p_organization_id UUID DEFAULT NULL,
  p_sdr_id UUID DEFAULT NULL,
  p_closer_id UUID DEFAULT NULL,
  p_rating INT DEFAULT 0,
  p_notes TEXT DEFAULT NULL,
  p_segment TEXT DEFAULT NULL,
  p_faturamento TEXT DEFAULT NULL,
  p_urgency TEXT DEFAULT NULL,
  p_responsible_id UUID DEFAULT NULL,
  p_meeting_date TIMESTAMPTZ DEFAULT NULL,
  p_compromisso_date TIMESTAMPTZ DEFAULT NULL,
  -- UTM fields
  p_utm_source TEXT DEFAULT NULL,
  p_utm_medium TEXT DEFAULT NULL,
  p_utm_campaign TEXT DEFAULT NULL,
  p_utm_term TEXT DEFAULT NULL,
  p_utm_content TEXT DEFAULT NULL,
  -- Pipe fields
  p_pipe_type TEXT DEFAULT NULL,          -- 'whatsapp', 'confirmacao', or NULL (no pipe)
  p_pipe_status TEXT DEFAULT NULL,
  p_pipe_meeting_date TIMESTAMPTZ DEFAULT NULL,
  p_meet_link TEXT DEFAULT NULL,
  p_pipe_responsible_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead_id UUID;
  v_pipe_id UUID;
  v_result JSONB;
BEGIN
  -- Insert lead
  INSERT INTO public.leads (
    name, email, phone, normalized_phone, company, origin,
    organization_id, sdr_id, closer_id, rating, notes,
    segment, faturamento, urgency, responsible_id,
    meeting_date, compromisso_date,
    utm_source, utm_medium, utm_campaign, utm_term, utm_content
  ) VALUES (
    p_name, p_email, p_phone, p_normalized_phone, p_company, p_origin,
    p_organization_id, p_sdr_id, p_closer_id, p_rating, p_notes,
    p_segment, p_faturamento, p_urgency, p_responsible_id,
    p_meeting_date, p_compromisso_date,
    p_utm_source, p_utm_medium, p_utm_campaign, p_utm_term, p_utm_content
  )
  RETURNING id INTO v_lead_id;

  v_result := jsonb_build_object('lead_id', v_lead_id, 'pipe_id', NULL, 'pipe_type', p_pipe_type);

  -- Insert pipe entry if requested
  IF p_pipe_type = 'whatsapp' THEN
    INSERT INTO public.pipe_whatsapp (
      lead_id, organization_id, status, responsible_id, sdr_id
    ) VALUES (
      v_lead_id, p_organization_id,
      COALESCE(p_pipe_status, 'novo'),
      p_pipe_responsible_id,
      p_sdr_id
    )
    RETURNING id INTO v_pipe_id;
    v_result := v_result || jsonb_build_object('pipe_id', v_pipe_id);

  ELSIF p_pipe_type = 'confirmacao' THEN
    INSERT INTO public.pipe_confirmacao (
      lead_id, organization_id, status, meeting_date,
      meet_link, sdr_id, closer_id, responsible_id
    ) VALUES (
      v_lead_id, p_organization_id,
      COALESCE(p_pipe_status, 'reuniao_marcada'),
      p_pipe_meeting_date, p_meet_link,
      p_sdr_id, p_closer_id,
      COALESCE(p_pipe_responsible_id, p_sdr_id, p_closer_id)
    )
    RETURNING id INTO v_pipe_id;
    v_result := v_result || jsonb_build_object('pipe_id', v_pipe_id);
  END IF;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_lead_with_pipe TO authenticated, service_role;
