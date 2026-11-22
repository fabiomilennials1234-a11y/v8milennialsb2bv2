-- ════════════════════════════════════════════════════════════════════════════
-- Funil: o quadro inteiro (1ª página de cada coluna + contagens) numa chamada
-- ════════════════════════════════════════════════════════════════════════════
--
-- SINTOMA (prod, 21/11/2026): abrir `/funil/:slug` dispara 1 `get_pipeline_page`
-- POR ETAPA, em paralelo (até 40), mais `get_pipeline_stage_counts_by_id`. Cada
-- statement paga ~35 ms fixos de InitPlans de RLS (pipeline_entries tem 9
-- policies, leads 8) e a rajada infla a média para 329 ms por chamada.
--
-- CORREÇÃO: `get_pipeline_board` devolve num jsonb a 1ª página de cada coluna
-- pedida (no shape EXATO de `get_pipeline_page`) e as contagens (no shape EXATO
-- de `get_pipeline_stage_counts_by_id`):
--   {"counts":[{stage_id,stage_key,cnt}], "columns":{"<stage_key>":[linha]}}
-- "Carregar mais" continua em `get_pipeline_page` (cursor composto).
--
-- COMO: UMA varredura de pipeline_entries ⋈ leads (sob a RLS do usuário),
-- filtrada pelo WHERE de get_pipeline_page, marca cada card com `em_contagem`
-- (WHERE de get_pipeline_stage_counts_by_id) e guarda a chave e as colunas que a
-- linha devolve. As contagens agregam `em_contagem`; as
-- páginas numeram por etapa na ordem `(created_at DESC, id DESC)` e cortam em
-- `p_page_size`. Só os cards cortados pagam deals/team_members/etiquetas (mesmas
-- junções de get_pipeline_page); pipeline_entries e leads NÃO são relidos — cada
-- releitura pagaria de novo os InitPlans de RLS das duas tabelas.
--
-- POR QUE UM WHERE E UM BOOLEANO: os dois WHERE de prod NÃO são iguais.
-- A contagem só busca por `erp_code` e só considera co-dono quando a org tem a
-- flag `funil_contagem_coluna_completa`; a página faz as duas coisas sempre
-- (md5 de prod: page 838fccc1…, counts 6060982b…, 21/11/2026). O WHERE da
-- página é SUPERCONJUNTO do da contagem, então a varredura filtra pelo da
-- página e a contagem refina.
--
-- SEGURANÇA: SECURITY INVOKER (a RLS do usuário decide, igual às irmãs).
-- `assert_org_access` recusa cedo quem não é da org; funil de outra org devolve
-- vazio (o resolvedor exige `pipelines.organization_id = p_org_id`).
-- `service_role` NÃO executa: nenhum caller de servidor, e `assert_org_access`
-- deixaria service_role passar sem org.
--
-- Rollback: supabase/migrations/rollback/20280123000000_funil_quadro_numa_chamada.sql

CREATE OR REPLACE FUNCTION public.get_pipeline_board(
  p_org_id uuid,
  p_pipeline_id uuid,
  p_stage_keys text[] DEFAULT NULL::text[],
  p_page_size integer DEFAULT 20,
  p_search text DEFAULT NULL::text,
  p_responsible_id uuid DEFAULT NULL::uuid,
  p_tag_ids uuid[] DEFAULT NULL::uuid[],
  p_origins text[] DEFAULT NULL::text[],
  p_rating_min integer DEFAULT NULL::integer,
  p_rating_max integer DEFAULT NULL::integer,
  p_calor_min integer DEFAULT NULL::integer,
  p_calor_max integer DEFAULT NULL::integer,
  p_urgency text DEFAULT NULL::text,
  p_product_type text DEFAULT NULL::text,
  p_meeting_after timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_meeting_before timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_period_after timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_period_before timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_closed_status_keys text[] DEFAULT NULL::text[],
  p_updated_before timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_overdue_exclude_status_keys text[] DEFAULT NULL::text[],
  p_status_keys text[] DEFAULT NULL::text[],
  p_scheduled boolean DEFAULT NULL::boolean,
  p_qualification_tier text[] DEFAULT NULL::text[],
  p_pre_qualification_tier text[] DEFAULT NULL::text[],
  p_stalled_min_days integer DEFAULT NULL::integer,
  p_stalled_max_days integer DEFAULT NULL::integer
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET plan_cache_mode TO 'force_generic_plan'
AS $function$
DECLARE
  v_pipeline_id uuid;
  v_size        integer := least(greatest(coalesce(p_page_size, 20), 1), 50);
  v_keys        text[];
  -- Flag funil_contagem_coluna_completa: a CONTAGEM busca por erp_code e
  -- considera co-dono, como os cards. Sem ela, só a página faz isso.
  v_completa    boolean := false;
  -- Leads em que p_responsible_id é CO-dono (flag lead_owners_n_donos), uma vez.
  v_co          uuid[] := '{}'::uuid[];
  v_co_contagem uuid[] := '{}'::uuid[];
  v_out         jsonb;
BEGIN
  PERFORM public.assert_org_access(p_org_id);

  IF p_pipeline_id IS NULL THEN
    RETURN jsonb_build_object('counts', '[]'::jsonb, 'columns', '{}'::jsonb);
  END IF;
  SELECT p.id INTO v_pipeline_id
    FROM public.pipelines p
   WHERE p.organization_id = p_org_id
     AND p.id = p_pipeline_id;
  IF v_pipeline_id IS NULL THEN
    RETURN jsonb_build_object('counts', '[]'::jsonb, 'columns', '{}'::jsonb);
  END IF;

  -- Etapas: as pedidas, ou as ativas do funil na ordem (teto MAX_STAGES = 40).
  v_keys := COALESCE(p_stage_keys, ARRAY(
    SELECT ps.stage_key FROM public.pipeline_stages ps
     WHERE ps.pipeline_id = v_pipeline_id AND ps.is_active
     ORDER BY ps.position, ps.stage_key
     LIMIT 40));
  v_keys := v_keys[1:40];

  SELECT COALESCE(o.feature_flags ->> 'funil_contagem_coluna_completa' = 'true', false)
    INTO v_completa
    FROM public.organizations o
   WHERE o.id = p_org_id;
  v_completa := COALESCE(v_completa, false);

  IF p_responsible_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.organizations o
        WHERE o.id = p_org_id
          AND o.feature_flags ->> 'lead_owners_n_donos' = 'true') THEN
    v_co := ARRAY(
      SELECT lo.lead_id
        FROM public.lead_owners lo
       WHERE lo.team_member_id = p_responsible_id
         AND lo.organization_id = p_org_id
         AND lo.role = 'co');
  END IF;
  IF v_completa THEN
    v_co_contagem := v_co;
  END IF;

  WITH marcado AS MATERIALIZED (
    SELECT pe.id, pe.stage_id, pe.stage_key, pe.created_at,
      -- Colunas da linha, lidas AQUI: a 2ª passada não relê pipeline_entries
      -- nem leads (cada releitura pagaria de novo os InitPlans de RLS).
      pe.pipeline_id, pe.lead_id, pe.assigned_to, pe.notes, pe.metadata, pe.entered_at,
      pe.stage_changed_at, pe.updated_at, pe.deal_id, pe.organization_id,
      l.name AS l_name, l.company AS l_company, l.email AS l_email, l.phone AS l_phone, l.rating AS l_rating,
      l.origin AS l_origin, l.segment AS l_segment, l.faturamento AS l_faturamento, l.urgency AS l_urgency,
      l.notes AS l_notes, l.compromisso_date AS l_compromisso_date, l.ai_disabled AS l_ai_disabled,
      l.avatar_url AS l_avatar_url, l.erp_code AS l_erp_code, l.pre_qualification_tier AS l_pre_qualification_tier,
      l.qualification_tier AS l_qualification_tier, l.sdr_id AS l_sdr_id, l.closer_id AS l_closer_id,
      l.responsible_id AS l_responsible_id, l.pre_sale_responsible_id AS l_pre_sale_responsible_id,
      l.sale_responsible_id AS l_sale_responsible_id,
      -- Busca/responsável da CONTAGEM (subconjunto dos da página).
      ((p_search IS NULL OR p_search = '' OR (l.name ILIKE '%' || p_search || '%' OR l.phone ILIKE '%' || p_search || '%' OR l.company ILIKE '%' || p_search || '%' OR (v_completa AND l.erp_code ILIKE '%' || p_search || '%')))
        AND (p_responsible_id IS NULL OR ((pe.metadata->>'pre_sale_responsible_id')::UUID = p_responsible_id OR (pe.metadata->>'sale_responsible_id')::UUID = p_responsible_id OR l.pre_sale_responsible_id = p_responsible_id OR l.sale_responsible_id = p_responsible_id OR l.id = ANY (v_co_contagem)))
      ) AS em_contagem
    FROM public.pipeline_entries pe
    JOIN public.leads l ON l.id = pe.lead_id
    WHERE pe.pipeline_id = v_pipeline_id AND pe.organization_id = p_org_id AND pe.lead_id IS NOT NULL
      -- Busca/responsável da PÁGINA (get_pipeline_page, literal).
      AND (p_search IS NULL OR p_search = '' OR (l.name ILIKE '%' || p_search || '%' OR l.phone ILIKE '%' || p_search || '%' OR l.company ILIKE '%' || p_search || '%' OR l.erp_code ILIKE '%' || p_search || '%'))
      AND (p_responsible_id IS NULL OR ((pe.metadata->>'pre_sale_responsible_id')::UUID = p_responsible_id OR (pe.metadata->>'sale_responsible_id')::UUID = p_responsible_id OR l.pre_sale_responsible_id = p_responsible_id OR l.sale_responsible_id = p_responsible_id OR l.id = ANY (v_co)))
      -- Demais filtros: idênticos nas duas irmãs.
      AND (p_tag_ids IS NULL OR array_length(p_tag_ids, 1) IS NULL OR NOT EXISTS (SELECT unnest(p_tag_ids) EXCEPT SELECT lt2.tag_id FROM public.lead_tags lt2 WHERE lt2.lead_id = l.id))
      AND (p_qualification_tier IS NULL OR array_length(p_qualification_tier, 1) IS NULL OR l.qualification_tier::text = ANY(p_qualification_tier))
      AND (p_pre_qualification_tier IS NULL OR array_length(p_pre_qualification_tier, 1) IS NULL OR l.pre_qualification_tier::text = ANY(p_pre_qualification_tier))
      AND (p_origins IS NULL OR array_length(p_origins, 1) IS NULL OR l.origin::TEXT = ANY(p_origins))
      AND (p_rating_min IS NULL OR COALESCE(l.rating, 0) >= p_rating_min)
      AND (p_rating_max IS NULL OR COALESCE(l.rating, 0) <= p_rating_max)
      AND (p_calor_min IS NULL OR COALESCE(NULLIF(pe.metadata->>'calor', '')::INT, 5) >= p_calor_min)
      AND (p_calor_max IS NULL OR COALESCE(NULLIF(pe.metadata->>'calor', '')::INT, 5) <= p_calor_max)
      AND (p_urgency IS NULL OR l.urgency = p_urgency)
      AND (p_product_type IS NULL OR pe.metadata->>'product_type' = p_product_type)
      AND (p_meeting_after IS NULL OR NULLIF(pe.metadata->>'meeting_date', '')::TIMESTAMPTZ >= p_meeting_after)
      AND (p_meeting_before IS NULL OR NULLIF(pe.metadata->>'meeting_date', '')::TIMESTAMPTZ <= p_meeting_before)
      AND (p_period_after IS NULL OR (CASE WHEN p_closed_status_keys IS NOT NULL AND pe.stage_key = ANY(p_closed_status_keys) THEN COALESCE(NULLIF(pe.metadata->>'metrics_period_at', '')::TIMESTAMPTZ, pe.updated_at) ELSE pe.created_at END) >= p_period_after)
      AND (p_period_before IS NULL OR (CASE WHEN p_closed_status_keys IS NOT NULL AND pe.stage_key = ANY(p_closed_status_keys) THEN COALESCE(NULLIF(pe.metadata->>'metrics_period_at', '')::TIMESTAMPTZ, pe.updated_at) ELSE pe.created_at END) <= p_period_before)
      AND (p_updated_before IS NULL OR (pe.updated_at <= p_updated_before AND (p_overdue_exclude_status_keys IS NULL OR pe.stage_key <> ALL(p_overdue_exclude_status_keys)))) -- metric-lint-allow: filtro de lista por inatividade (espelho de get_pipeline_page); não ancora métrica nem soma receita
      AND (p_status_keys IS NULL OR array_length(p_status_keys, 1) IS NULL OR pe.stage_key = ANY(p_status_keys))
      AND (NOT COALESCE(p_scheduled, FALSE) OR EXISTS (SELECT 1 FROM public.scheduled_user_messages sm WHERE sm.lead_id = l.id AND sm.organization_id = p_org_id AND sm.status = 'scheduled'))
      AND (p_stalled_min_days IS NULL OR COALESCE(pe.stage_changed_at, pe.entered_at, pe.created_at) <= now() - make_interval(days => p_stalled_min_days))
      AND (p_stalled_max_days IS NULL OR COALESCE(pe.stage_changed_at, pe.entered_at, pe.created_at) > now() - make_interval(days => p_stalled_max_days + 1))
  ),
  contagem AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('stage_id', c.stage_id, 'stage_key', c.stage_key, 'cnt', c.cnt)
             ORDER BY c.stage_key, c.stage_id), '[]'::jsonb) AS counts
      FROM (SELECT m.stage_id, m.stage_key, count(*)::bigint AS cnt
              FROM marcado m WHERE m.em_contagem
             GROUP BY m.stage_id, m.stage_key) c
  ),
  corte AS (
    -- A linha inteira atravessa a numeração: nada de voltar a `marcado` por id
    -- (CTE não tem índice; o join de volta virava laço aninhado).
    SELECT n.*
      FROM (SELECT m.*,
                   row_number() OVER (PARTITION BY m.stage_key ORDER BY m.created_at DESC, m.id DESC) AS rn
              FROM marcado m
             WHERE m.stage_key = ANY (v_keys)) n
     WHERE n.rn <= v_size
  ),
  linha AS (
    -- Shape de get_pipeline_page, literal (mesmas junções e mesmo jsonb do lead).
    SELECT pe.stage_key AS coluna, pe.rn,
      jsonb_build_object(
        'id', pe.id, 'pipeline_id', pe.pipeline_id, 'lead_id', pe.lead_id, 'stage_key', pe.stage_key,
        'assigned_to', pe.assigned_to, 'notes', pe.notes,
        'metadata', CASE
          WHEN d.id IS NULL THEN pe.metadata
          ELSE jsonb_set(jsonb_set(
            CASE
              WHEN d.value IS NULL THEN COALESCE(pe.metadata, '{}'::jsonb)
              ELSE jsonb_set(COALESCE(pe.metadata, '{}'::jsonb), '{sale_value}', to_jsonb(d.value), true)
            END,
            '{deal_outcome}', to_jsonb(d.outcome), true),
            '{deal_outcome_at}', COALESCE(to_jsonb(d.outcome_at), 'null'::jsonb), true)
        END,
        'entered_at', pe.entered_at, 'stage_changed_at', pe.stage_changed_at,
        'created_at', pe.created_at, 'updated_at', pe.updated_at,
        'lead', jsonb_build_object(
          'id', pe.lead_id, 'name', pe.l_name, 'company', pe.l_company, 'email', pe.l_email, 'phone', pe.l_phone,
          'rating', pe.l_rating, 'origin', pe.l_origin, 'segment', pe.l_segment, 'faturamento', pe.l_faturamento,
          'urgency', pe.l_urgency, 'notes', pe.l_notes, 'compromisso_date', pe.l_compromisso_date,
          'ai_disabled', pe.l_ai_disabled, 'avatar_url', pe.l_avatar_url,
          'erp_code', pe.l_erp_code,
          'pre_qualification_tier', pe.l_pre_qualification_tier, 'qualification_tier', pe.l_qualification_tier,
          'sdr_id', pe.l_sdr_id, 'closer_id', pe.l_closer_id, 'responsible_id', pe.l_responsible_id,
          'pre_sale_responsible_id', pe.l_pre_sale_responsible_id, 'sale_responsible_id', pe.l_sale_responsible_id,
          'responsible', CASE WHEN tm_resp.id IS NOT NULL THEN jsonb_build_object('id', tm_resp.id, 'name', tm_resp.name, 'avatar_url', tm_resp.avatar_url) ELSE NULL END,
          'sdr', CASE WHEN tm_sdr.id IS NOT NULL THEN jsonb_build_object('id', tm_sdr.id, 'name', tm_sdr.name, 'avatar_url', tm_sdr.avatar_url) ELSE NULL END,
          'closer', CASE WHEN tm_closer.id IS NOT NULL THEN jsonb_build_object('id', tm_closer.id, 'name', tm_closer.name, 'avatar_url', tm_closer.avatar_url) ELSE NULL END,
          'pre_sale_responsible', CASE WHEN tm_pre.id IS NOT NULL THEN jsonb_build_object('id', tm_pre.id, 'name', tm_pre.name, 'avatar_url', tm_pre.avatar_url) ELSE NULL END,
          'sale_responsible', CASE WHEN tm_sale.id IS NOT NULL THEN jsonb_build_object('id', tm_sale.id, 'name', tm_sale.name, 'avatar_url', tm_sale.avatar_url) ELSE NULL END,
          'lead_tags', COALESCE((SELECT jsonb_agg(jsonb_build_object('tag', jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color))) FROM public.lead_tags lt JOIN public.tags t ON t.id = lt.tag_id WHERE lt.lead_id = pe.lead_id), '[]'::jsonb)
        )
      ) AS j
    FROM corte pe
    LEFT JOIN public.deals d ON d.id = pe.deal_id AND d.organization_id = pe.organization_id AND d.deleted_at IS NULL
    LEFT JOIN public.team_members tm_resp ON tm_resp.id = pe.l_responsible_id
    LEFT JOIN public.team_members tm_sdr ON tm_sdr.id = pe.l_sdr_id
    LEFT JOIN public.team_members tm_closer ON tm_closer.id = pe.l_closer_id
    LEFT JOIN public.team_members tm_pre ON tm_pre.id = pe.l_pre_sale_responsible_id
    LEFT JOIN public.team_members tm_sale ON tm_sale.id = pe.l_sale_responsible_id
  ),
  colunas AS (
    -- Toda etapa pedida aparece, mesmo vazia: o front semeia a coluna com [].
    SELECT COALESCE(jsonb_object_agg(s.k, COALESCE(
             (SELECT jsonb_agg(x.j ORDER BY x.rn) FROM linha x WHERE x.coluna = s.k),
             '[]'::jsonb)), '{}'::jsonb) AS columns
      FROM (SELECT DISTINCT u.k FROM unnest(v_keys) AS u(k) WHERE u.k IS NOT NULL) s
  )
  SELECT jsonb_build_object('counts', c.counts, 'columns', cl.columns)
    INTO v_out
    FROM contagem c, colunas cl;

  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_pipeline_board(uuid, uuid, text[], integer, text, uuid, uuid[], text[], integer, integer, integer, integer, text, text, timestamp with time zone, timestamp with time zone, timestamp with time zone, timestamp with time zone, text[], timestamp with time zone, text[], text[], boolean, text[], text[], integer, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_pipeline_board(uuid, uuid, text[], integer, text, uuid, uuid[], text[], integer, integer, integer, integer, text, text, timestamp with time zone, timestamp with time zone, timestamp with time zone, timestamp with time zone, text[], timestamp with time zone, text[], text[], boolean, text[], text[], integer, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
