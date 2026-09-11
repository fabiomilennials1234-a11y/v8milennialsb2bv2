-- Rollback restores the prior function body, including its reference to the
-- removed leads.meeting_date column. Applying this rollback makes the RPC
-- unavailable again and is only appropriate with a matching schema rollback.

CREATE OR REPLACE FUNCTION public.create_lead_with_pipe(
  p_name text,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_normalized_phone text DEFAULT NULL,
  p_company text DEFAULT NULL,
  p_origin text DEFAULT 'outro',
  p_organization_id uuid DEFAULT NULL,
  p_sdr_id uuid DEFAULT NULL,
  p_closer_id uuid DEFAULT NULL,
  p_rating integer DEFAULT 0,
  p_notes text DEFAULT NULL,
  p_segment text DEFAULT NULL,
  p_faturamento text DEFAULT NULL,
  p_urgency text DEFAULT NULL,
  p_responsible_id uuid DEFAULT NULL,
  p_meeting_date timestamptz DEFAULT NULL,
  p_compromisso_date timestamptz DEFAULT NULL,
  p_utm_source text DEFAULT NULL,
  p_utm_medium text DEFAULT NULL,
  p_utm_campaign text DEFAULT NULL,
  p_utm_term text DEFAULT NULL,
  p_utm_content text DEFAULT NULL,
  p_pipe_type text DEFAULT NULL,
  p_pipe_status text DEFAULT NULL,
  p_pipe_meeting_date timestamptz DEFAULT NULL,
  p_meet_link text DEFAULT NULL,
  p_pipe_responsible_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_lead_id uuid;
  v_pipe_id uuid;
  v_result jsonb;
BEGIN
  PERFORM public.assert_org_access(p_organization_id);

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

  IF p_pipe_type = 'whatsapp' THEN
    v_pipe_id := public.fn_entrada_sistema_criar(
      p_organization_id => p_organization_id,
      p_slug => 'whatsapp',
      p_lead_id => v_lead_id,
      p_stage_key => COALESCE(p_pipe_status, 'novo'),
      p_assigned_to => COALESCE(p_pipe_responsible_id, p_sdr_id), -- metric-lint-allow: restore of the prior compatibility body.
      p_metadata => jsonb_build_object(
        'responsible_id', p_pipe_responsible_id,
        'sdr_id', p_sdr_id,
        'scheduled_date', NULL::timestamptz));
    v_result := v_result || jsonb_build_object('pipe_id', v_pipe_id);
  ELSIF p_pipe_type = 'confirmacao' THEN
    v_pipe_id := public.fn_entrada_sistema_criar(
      p_organization_id => p_organization_id,
      p_slug => 'confirmacao',
      p_lead_id => v_lead_id,
      p_stage_key => COALESCE(p_pipe_status, 'reuniao_marcada'),
      p_assigned_to => COALESCE(p_pipe_responsible_id, p_sdr_id, p_closer_id), -- metric-lint-allow: restore of the prior compatibility body.
      p_metadata => jsonb_build_object(
        'meeting_date', p_pipe_meeting_date,
        'is_confirmed', false,
        'closer_id', p_closer_id,
        'responsible_id', COALESCE(p_pipe_responsible_id, p_sdr_id, p_closer_id), -- metric-lint-allow: restore of the prior compatibility body.
        'sdr_id', p_sdr_id,
        'meet_link', p_meet_link,
        'metrics_period_at', NULL::timestamptz));
    v_result := v_result || jsonb_build_object('pipe_id', v_pipe_id);
  END IF;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.create_lead_with_pipe IS
  'Rollback of 20271019144203; requires a schema that still has leads.meeting_date.';
