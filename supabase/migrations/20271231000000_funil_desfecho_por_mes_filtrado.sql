-- 20271231000000_funil_desfecho_por_mes_filtrado.sql
--
-- A pilha de Ganhos/Perdidos acerta o total COM filtro ativo no board
-- (hotfix Café Jurerê, 09/11). ADITIVA: só cria uma função; nada existente muda.
--
-- ── O defeito ────────────────────────────────────────────────────────────
-- `get_funil_desfecho_por_mes` (20271210000000, Chamado 172ef046) dá o total da
-- etapa inteira, mas não recebe filtro. Com qualquer filtro no board (busca,
-- responsável, período, etiqueta…) o front não pode usá-la — ela contaria outro
-- recorte — e a pilha volta a somar só os cards carregados (20 por página):
-- total e meses errados até clicar "Carregar mais" várias vezes.
--
-- ── O conserto ───────────────────────────────────────────────────────────
-- Mesma saída de `get_funil_desfecho_por_mes`, com os MESMOS filtros que o
-- board manda ao `get_pipeline_page` (`sharedRpcFilterParams` no front). O
-- WHERE é o do `get_pipeline_page` vigente em prod (md5 do prosrc
-- 996f958ef0b5ace51b2641c732ab5824, 09/11/2026 = 20271124000000), sem etapa e
-- sem cursor: a pilha soma exatamente os cards que a coluna pagina, inclusive
-- busca por código do ERP e co-dono (lead_owners_n_donos).
-- Rating/calor ficam de fora: aposentados, o board não os manda.
--
-- Desfecho, data, mês e valor: as mesmas regras de 20271210000000 (espelho de
-- cardOutcome / cardClosedAt / projectSaleValue no front).
--
-- SECURITY INVOKER pelo mesmo motivo da irmã: a RLS do usuário decide, igual à
-- coluna. `assert_org_access` recusa cedo quem não é da org.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.get_funil_desfecho_por_mes_filtrado(uuid, uuid, text, text, uuid, uuid[], text[], text, text, timestamptz, timestamptz, timestamptz, timestamptz, text[], timestamptz, text[], text[], boolean, text[], text[], integer, integer);

CREATE OR REPLACE FUNCTION public.get_funil_desfecho_por_mes_filtrado(
  p_pipeline_id uuid,
  p_org_id uuid,
  p_tz text DEFAULT 'America/Sao_Paulo',
  p_search text DEFAULT NULL,
  p_responsible_id uuid DEFAULT NULL,
  p_tag_ids uuid[] DEFAULT NULL,
  p_origins text[] DEFAULT NULL,
  p_urgency text DEFAULT NULL,
  p_product_type text DEFAULT NULL,
  p_meeting_after timestamptz DEFAULT NULL,
  p_meeting_before timestamptz DEFAULT NULL,
  p_period_after timestamptz DEFAULT NULL,
  p_period_before timestamptz DEFAULT NULL,
  p_closed_status_keys text[] DEFAULT NULL,
  p_updated_before timestamptz DEFAULT NULL,
  p_overdue_exclude_status_keys text[] DEFAULT NULL,
  p_status_keys text[] DEFAULT NULL,
  p_scheduled boolean DEFAULT NULL,
  p_qualification_tier text[] DEFAULT NULL,
  p_pre_qualification_tier text[] DEFAULT NULL,
  p_stalled_min_days integer DEFAULT NULL,
  p_stalled_max_days integer DEFAULT NULL
)
RETURNS TABLE(stage_key text, outcome text, month_key text, cnt bigint, total numeric)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pipeline_id uuid;
  -- Leads em que p_responsible_id é CO-dono: mesma regra do get_pipeline_page.
  v_co_lead_ids uuid[] := '{}'::uuid[];
BEGIN
  PERFORM public.assert_org_access(p_org_id);

  -- Fuso: mesma validação da irmã (IANA ou UTC; abreviação e POSIX fora).
  IF p_tz IS NULL OR p_tz !~ '^(UTC|[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)+)$' THEN
    RAISE EXCEPTION 'fuso horario invalido: %', p_tz USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.now() AT TIME ZONE p_tz;

  IF p_pipeline_id IS NULL THEN
    RETURN;
  END IF;
  SELECT p.id INTO v_pipeline_id
    FROM public.pipelines p
   WHERE p.organization_id = p_org_id
     AND p.id = p_pipeline_id;
  IF v_pipeline_id IS NULL THEN
    RETURN;
  END IF;

  IF p_responsible_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.organizations o
        WHERE o.id = p_org_id
          AND o.feature_flags ->> 'lead_owners_n_donos' = 'true') THEN
    v_co_lead_ids := ARRAY(
      SELECT lo.lead_id
        FROM public.lead_owners lo
       WHERE lo.team_member_id = p_responsible_id
         AND lo.organization_id = p_org_id
         AND lo.role = 'co');
  END IF;

  RETURN QUERY
  WITH card AS (
    SELECT
      pe.stage_key AS etapa,
      CASE WHEN d.id IS NOT NULL THEN d.outcome ELSE ps.stage_role::text END AS desfecho,
      COALESCE(d.outcome_at, pe.stage_changed_at, pe.entered_at, pe.created_at) AS fechado_em,
      COALESCE(
        d.value,
        CASE jsonb_typeof(pe.metadata -> 'sale_value')
          WHEN 'number' THEN (pe.metadata ->> 'sale_value')::numeric
          WHEN 'string' THEN
            CASE WHEN (pe.metadata ->> 'sale_value')
                      ~ '^[[:space:]]*[+]?([0-9]{1,30}([.][0-9]{0,30})?|[.][0-9]{1,30})[[:space:]]*$'
                 THEN btrim(pe.metadata ->> 'sale_value')::numeric
            END
        END
      ) AS valor
    FROM public.pipeline_entries pe
    JOIN public.leads l ON l.id = pe.lead_id
    LEFT JOIN public.deals d
      ON d.id = pe.deal_id
     AND d.organization_id = pe.organization_id
     AND d.deleted_at IS NULL
    LEFT JOIN public.pipeline_stages ps
      ON ps.pipeline_id = pe.pipeline_id
     AND ps.stage_key = pe.stage_key
    WHERE pe.pipeline_id = v_pipeline_id
      AND pe.organization_id = p_org_id
      AND pe.lead_id IS NOT NULL
      -- ↓ filtros: cópia do WHERE do get_pipeline_page (20271124000000), sem etapa e cursor
      AND (p_search IS NULL OR p_search = '' OR (l.name ILIKE '%' || p_search || '%' OR l.phone ILIKE '%' || p_search || '%' OR l.company ILIKE '%' || p_search || '%' OR l.erp_code ILIKE '%' || p_search || '%'))
      AND (p_responsible_id IS NULL OR ((pe.metadata->>'pre_sale_responsible_id')::uuid = p_responsible_id OR (pe.metadata->>'sale_responsible_id')::uuid = p_responsible_id OR l.pre_sale_responsible_id = p_responsible_id OR l.sale_responsible_id = p_responsible_id OR l.id = ANY (v_co_lead_ids)))
      AND (p_tag_ids IS NULL OR array_length(p_tag_ids, 1) IS NULL OR NOT EXISTS (SELECT unnest(p_tag_ids) EXCEPT SELECT lt2.tag_id FROM public.lead_tags lt2 WHERE lt2.lead_id = l.id))
      AND (p_qualification_tier IS NULL OR array_length(p_qualification_tier, 1) IS NULL OR l.qualification_tier::text = ANY(p_qualification_tier))
      AND (p_pre_qualification_tier IS NULL OR array_length(p_pre_qualification_tier, 1) IS NULL OR l.pre_qualification_tier::text = ANY(p_pre_qualification_tier))
      AND (p_origins IS NULL OR array_length(p_origins, 1) IS NULL OR l.origin::text = ANY(p_origins))
      AND (p_urgency IS NULL OR l.urgency = p_urgency)
      AND (p_product_type IS NULL OR pe.metadata->>'product_type' = p_product_type)
      AND (p_meeting_after IS NULL OR NULLIF(pe.metadata->>'meeting_date', '')::timestamptz >= p_meeting_after)
      AND (p_meeting_before IS NULL OR NULLIF(pe.metadata->>'meeting_date', '')::timestamptz <= p_meeting_before)
      AND (p_period_after IS NULL OR (CASE WHEN p_closed_status_keys IS NOT NULL AND pe.stage_key = ANY(p_closed_status_keys) THEN COALESCE(NULLIF(pe.metadata->>'metrics_period_at', '')::timestamptz, pe.updated_at) ELSE pe.created_at END) >= p_period_after) -- metric-lint-allow: cópia do filtro de período do get_pipeline_page (lista), não âncora nova
      AND (p_period_before IS NULL OR (CASE WHEN p_closed_status_keys IS NOT NULL AND pe.stage_key = ANY(p_closed_status_keys) THEN COALESCE(NULLIF(pe.metadata->>'metrics_period_at', '')::timestamptz, pe.updated_at) ELSE pe.created_at END) <= p_period_before) -- metric-lint-allow: cópia do filtro de período do get_pipeline_page (lista), não âncora nova
      AND (p_updated_before IS NULL OR (pe.updated_at <= p_updated_before AND (p_overdue_exclude_status_keys IS NULL OR pe.stage_key <> ALL(p_overdue_exclude_status_keys)))) -- metric-lint-allow: filtro de lista por inatividade; não ancora métrica nem soma receita
      AND (p_status_keys IS NULL OR array_length(p_status_keys, 1) IS NULL OR pe.stage_key = ANY(p_status_keys))
      AND (NOT COALESCE(p_scheduled, FALSE) OR EXISTS (SELECT 1 FROM public.scheduled_user_messages sm WHERE sm.lead_id = l.id AND sm.organization_id = p_org_id AND sm.status = 'scheduled'))
      AND (p_stalled_min_days IS NULL OR COALESCE(pe.stage_changed_at, pe.entered_at, pe.created_at) <= now() - make_interval(days => p_stalled_min_days))
      AND (p_stalled_max_days IS NULL OR COALESCE(pe.stage_changed_at, pe.entered_at, pe.created_at) > now() - make_interval(days => p_stalled_max_days + 1))
  )
  SELECT
    c.etapa,
    c.desfecho,
    COALESCE(to_char(c.fechado_em AT TIME ZONE p_tz, 'YYYY-MM'), 'sem-data'),
    count(*)::bigint,
    sum(CASE WHEN c.valor >= 0 THEN c.valor END)
  FROM card c
  WHERE c.desfecho IN ('won', 'lost')
  GROUP BY 1, 2, 3;
END;
$function$;

COMMENT ON FUNCTION public.get_funil_desfecho_por_mes_filtrado(uuid, uuid, text, text, uuid, uuid[], text[], text, text, timestamptz, timestamptz, timestamptz, timestamptz, text[], timestamptz, text[], text[], boolean, text[], text[], integer, integer) IS
  'get_funil_desfecho_por_mes com os filtros do board (os mesmos do get_pipeline_page): numeros da pilha de Ganhos/Perdidos com filtro ativo. SECURITY INVOKER de proposito: a RLS do usuario decide, igual a coluna.';

REVOKE ALL ON FUNCTION public.get_funil_desfecho_por_mes_filtrado(uuid, uuid, text, text, uuid, uuid[], text[], text, text, timestamptz, timestamptz, timestamptz, timestamptz, text[], timestamptz, text[], text[], boolean, text[], text[], integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_funil_desfecho_por_mes_filtrado(uuid, uuid, text, text, uuid, uuid[], text[], text, text, timestamptz, timestamptz, timestamptz, timestamptz, text[], timestamptz, text[], text[], boolean, text[], text[], integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_funil_desfecho_por_mes_filtrado(uuid, uuid, text, text, uuid, uuid[], text[], text, text, timestamptz, timestamptz, timestamptz, timestamptz, text[], timestamptz, text[], text[], boolean, text[], text[], integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_funil_desfecho_por_mes_filtrado(uuid, uuid, text, text, uuid, uuid[], text[], text, text, timestamptz, timestamptz, timestamptz, timestamptz, text[], timestamptz, text[], text[], boolean, text[], text[], integer, integer) TO service_role;
