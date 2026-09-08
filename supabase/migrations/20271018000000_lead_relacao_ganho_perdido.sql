-- Lei da Relação (CTO, 2026-09-08): ganho > somente perdas > lead.
-- Somente schema. A correção de marcas antigas tem script separado.
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_lead_recalcula_primeira_venda(p_lead uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_primeira timestamptz;
BEGIN
  IF p_lead IS NULL THEN RETURN; END IF;
  SELECT min(s.sold_at) INTO v_primeira
  FROM public.sale_events s
  JOIN public.leads l ON l.id = s.lead_id AND l.organization_id = s.organization_id
  WHERE l.id = p_lead
    AND s.event_type = 'sale'
    AND s.reversed_event_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.sale_events r
      WHERE r.organization_id = s.organization_id AND r.reversed_event_id = s.id
    );
  UPDATE public.leads SET primeira_venda_at = v_primeira
  WHERE id = p_lead AND primeira_venda_at IS DISTINCT FROM v_primeira;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_lead_recalcula_primeira_venda(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_lead_recalcula_primeira_venda(uuid) TO service_role;

-- Campo calculado do PostgREST: filtra ANTES de count/range, sem materializar
-- IDs no browser e sem depender da marca de venda antiga (que incluía perdas).
-- Parâmetro sem nome evita exposição como RPC. INVOKER preserva a RLS.
CREATE OR REPLACE FUNCTION public.relacao_negocios(public.leads)
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH desfechos AS (
    SELECT d.outcome
    FROM public.deals d
    WHERE d.organization_id = ($1).organization_id
      AND d.source_lead_id = ($1).id AND d.deleted_at IS NULL
    UNION ALL
    SELECT CASE
      WHEN d.outcome IN ('won', 'lost', 'open') THEN d.outcome
      WHEN st.stage_role IN ('won', 'lost') THEN st.stage_role::text
      ELSE 'open'
    END
    FROM public.pipeline_entries pe
    JOIN public.pipelines p ON p.id = pe.pipeline_id
      AND p.organization_id = pe.organization_id AND p.is_active = true
    LEFT JOIN public.deals d ON d.id = pe.deal_id
      AND d.organization_id = pe.organization_id AND d.deleted_at IS NULL
    LEFT JOIN public.pipeline_stages st ON st.pipeline_id = pe.pipeline_id
      AND st.organization_id = pe.organization_id AND st.is_active = true
      AND (st.stage_key = pe.stage_key OR st.id::text = pe.stage_key)
    WHERE pe.organization_id = ($1).organization_id AND pe.lead_id = ($1).id
      AND (pe.deal_id IS NULL OR d.id IS NOT NULL)
  )
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM desfechos WHERE outcome = 'won')
      OR EXISTS (
        SELECT 1 FROM public.sale_events s
        WHERE s.organization_id = ($1).organization_id AND s.lead_id = ($1).id
          AND s.event_type = 'sale' AND s.reversed_event_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM public.sale_events r
            WHERE r.organization_id = s.organization_id AND r.reversed_event_id = s.id
          )
      ) THEN 'cliente'
    WHEN EXISTS (SELECT 1 FROM desfechos WHERE outcome = 'lost')
      AND NOT EXISTS (SELECT 1 FROM desfechos WHERE outcome = 'open') THEN 'perdido'
    ELSE 'lead'
  END;
$$;
COMMENT ON FUNCTION public.relacao_negocios(public.leads) IS
  'Lei da Relação: ganho ou venda líquida = cliente; só negócios perdidos = perdido; demais = lead. Pedido ERP isolado não decide. RLS do chamador.';
REVOKE ALL ON FUNCTION public.relacao_negocios(public.leads) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.relacao_negocios(public.leads) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
