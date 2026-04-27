-- ============================================================
-- RPCs para Operations Center (Master Admin)
-- Métricas de runtime_logs e usage_events agregadas.
-- ============================================================

-- RPC 1: métricas gerais de operação
CREATE OR REPLACE FUNCTION get_operations_overview(interval_param TEXT DEFAULT '24 hours')
RETURNS JSON AS $$
  SELECT json_build_object(
    'jobs_success', COUNT(*) FILTER (WHERE status = 'success'),
    'jobs_error',   COUNT(*) FILTER (WHERE status = 'error'),
    'jobs_total',   COUNT(*),
    'orgs_active',  COUNT(DISTINCT organization_id)
  )
  FROM public.runtime_logs
  WHERE created_at > NOW() - interval_param::INTERVAL;
$$ LANGUAGE sql SECURITY DEFINER;

-- RPC 2: uso por organização
CREATE OR REPLACE FUNCTION get_usage_by_org(interval_param TEXT DEFAULT '7 days')
RETURNS TABLE (
  organization_id UUID,
  organization_name TEXT,
  total_events BIGINT,
  leads_criados BIGINT,
  cards_movidos BIGINT,
  mensagens_enviadas BIGINT,
  ultima_atividade TIMESTAMPTZ
) AS $$
  SELECT
    o.id,
    o.name,
    COUNT(*) AS total_events,
    COUNT(*) FILTER (WHERE u.event_type = 'lead_created') AS leads_criados,
    COUNT(*) FILTER (WHERE u.event_type = 'card_moved') AS cards_movidos,
    COUNT(*) FILTER (WHERE u.event_type = 'message_sent') AS mensagens_enviadas,
    MAX(u.created_at) AS ultima_atividade
  FROM public.usage_events u
  JOIN public.organizations o ON o.id = u.organization_id
  WHERE u.created_at > NOW() - interval_param::INTERVAL
  GROUP BY o.id, o.name
  ORDER BY ultima_atividade DESC;
$$ LANGUAGE sql SECURITY DEFINER;

-- Permissões: apenas master pode chamar
REVOKE ALL ON FUNCTION get_operations_overview(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_operations_overview(TEXT) TO authenticated;

REVOKE ALL ON FUNCTION get_usage_by_org(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_usage_by_org(TEXT) TO authenticated;
