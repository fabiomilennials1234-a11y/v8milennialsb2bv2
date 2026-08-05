-- ============================================================================
-- Filtro "Parado há" no board de funis — dias na etapa atual.
--
-- Vem do redesenho da aba de Funis (`.specs/mockups/funis-redesign/`), que
-- separa dois filtros de tempo de propósito: "Criados no período" (data de
-- criação, já suportado por p_period_after/before) e "Parado há" (dias na etapa
-- ATUAL). Um lead criado em maio pode ter se mexido ontem — é a diferença entre
-- "quem entrou" e "quem está encalhado".
--
-- Por que no servidor e não no cliente: `get_pipeline_page` (os cards) e
-- `get_pipeline_stage_counts` (o número no cabeçalho da coluna) consomem o MESMO
-- bloco de parâmetros justamente pra badge e cards não divergirem — filtrar
-- "parado há" no front faria a coluna dizer 21 mostrando 10, que é o bug que
-- levou esse desenho a existir.
--
-- Âncora temporal: COALESCE(stage_changed_at, entered_at, created_at) — o mesmo
-- encadeamento que fn_backfill_state_sales já usa pra datar entry parada, e o
-- fallback importa porque entries antigas têm stage_changed_at NULL.
--
-- Predicado por timestamp em vez de derivar idade por linha
-- (`now() - ts >= interval`, não `extract(epoch ...)/86400 >= n`): mantém a
-- coluna livre de função e portanto sargável.
--
-- ⚠️ Parâmetro novo com DEFAULT **não** substitui a função: cria um OVERLOAD ao
-- lado, e aí toda chamada com a aridade antiga vira ERROR 42725 "is not unique".
-- Foi o que as migrations 20270215000000 e 20270216000000 tiveram de limpar.
-- Por isso este arquivo DROPA todas as assinaturas antes de criar a nova.
--
-- Só schema: nenhum dado de cliente é lido, escrito ou movido.
-- ============================================================================

-- ── 1. Remove toda assinatura existente (evita overload ambíguo) ────────────
-- Sem CASCADE de propósito: se algo depender, a migration falha em vez de
-- derrubar o dependente junto.
DO $$
DECLARE
  r record;
  v_removidos int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('get_pipeline_page', 'get_pipeline_stage_counts')
  LOOP
    EXECUTE format('DROP FUNCTION %s', r.sig);
    v_removidos := v_removidos + 1;
    RAISE NOTICE 'Removida assinatura %.', r.sig;
  END LOOP;
  RAISE NOTICE '% assinatura(s) removida(s) antes do recreate.', v_removidos;
END$$;

-- ── 2. get_pipeline_page ────────────────────────────────────────────────────
CREATE FUNCTION "public"."get_pipeline_page"(
  "p_pipeline_slug" "text",
  "p_stage_id" "text",
  "p_org_id" "uuid",
  "p_page_size" integer DEFAULT 20,
  "p_cursor" timestamp with time zone DEFAULT NULL::timestamp with time zone,
  "p_search" "text" DEFAULT NULL::"text",
  "p_responsible_id" "uuid" DEFAULT NULL::"uuid",
  "p_tag_ids" "uuid"[] DEFAULT NULL::"uuid"[],
  "p_origins" "text"[] DEFAULT NULL::"text"[],
  "p_rating_min" integer DEFAULT NULL::integer,
  "p_rating_max" integer DEFAULT NULL::integer,
  "p_calor_min" integer DEFAULT NULL::integer,
  "p_calor_max" integer DEFAULT NULL::integer,
  "p_urgency" "text" DEFAULT NULL::"text",
  "p_product_type" "text" DEFAULT NULL::"text",
  "p_meeting_after" timestamp with time zone DEFAULT NULL::timestamp with time zone,
  "p_meeting_before" timestamp with time zone DEFAULT NULL::timestamp with time zone,
  "p_period_after" timestamp with time zone DEFAULT NULL::timestamp with time zone,
  "p_period_before" timestamp with time zone DEFAULT NULL::timestamp with time zone,
  "p_closed_status_keys" "text"[] DEFAULT NULL::"text"[],
  "p_updated_before" timestamp with time zone DEFAULT NULL::timestamp with time zone,
  "p_overdue_exclude_status_keys" "text"[] DEFAULT NULL::"text"[],
  "p_status_keys" "text"[] DEFAULT NULL::"text"[],
  "p_scheduled" boolean DEFAULT NULL::boolean,
  "p_qualification_tier" "text"[] DEFAULT NULL::"text"[],
  "p_pre_qualification_tier" "text"[] DEFAULT NULL::"text"[],
  "p_stalled_min_days" integer DEFAULT NULL::integer,
  "p_stalled_max_days" integer DEFAULT NULL::integer
) RETURNS TABLE(
  "id" "uuid", "pipeline_id" "uuid", "lead_id" "uuid", "stage_key" "text",
  "assigned_to" "uuid", "notes" "text", "metadata" "jsonb",
  "entered_at" timestamp with time zone, "stage_changed_at" timestamp with time zone,
  "created_at" timestamp with time zone, "updated_at" timestamp with time zone,
  "lead" "jsonb"
)
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
DECLARE v_pipeline_id UUID;
BEGIN
  SELECT p.id INTO v_pipeline_id FROM public.pipelines p WHERE p.slug=p_pipeline_slug AND p.type='system' AND p.organization_id=p_org_id; -- metric-lint-allow: corpo preservado da função original; funil custom tem caminho próprio (CustomPipelineKanban), mudar a resolução aqui seria alteração de comportamento fora do escopo deste filtro
  IF v_pipeline_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT pe.id, pe.pipeline_id, pe.lead_id, pe.stage_key, pe.assigned_to, pe.notes, pe.metadata,
    pe.entered_at, pe.stage_changed_at, pe.created_at, pe.updated_at,
    jsonb_build_object(
      'id', l.id, 'name', l.name, 'company', l.company, 'email', l.email, 'phone', l.phone,
      'rating', l.rating, 'origin', l.origin, 'segment', l.segment, 'faturamento', l.faturamento,
      'urgency', l.urgency, 'notes', l.notes, 'compromisso_date', l.compromisso_date,
      'ai_disabled', l.ai_disabled, 'avatar_url', l.avatar_url,
      'pre_qualification_tier', l.pre_qualification_tier, 'qualification_tier', l.qualification_tier,
      'sdr_id', l.sdr_id, 'closer_id', l.closer_id, 'responsible_id', l.responsible_id,
      'pre_sale_responsible_id', l.pre_sale_responsible_id, 'sale_responsible_id', l.sale_responsible_id,
      'responsible', CASE WHEN tm_resp.id IS NOT NULL THEN jsonb_build_object('id', tm_resp.id, 'name', tm_resp.name, 'avatar_url', tm_resp.avatar_url) ELSE NULL END,
      'sdr', CASE WHEN tm_sdr.id IS NOT NULL THEN jsonb_build_object('id', tm_sdr.id, 'name', tm_sdr.name, 'avatar_url', tm_sdr.avatar_url) ELSE NULL END,
      'closer', CASE WHEN tm_closer.id IS NOT NULL THEN jsonb_build_object('id', tm_closer.id, 'name', tm_closer.name, 'avatar_url', tm_closer.avatar_url) ELSE NULL END,
      'pre_sale_responsible', CASE WHEN tm_pre.id IS NOT NULL THEN jsonb_build_object('id', tm_pre.id, 'name', tm_pre.name, 'avatar_url', tm_pre.avatar_url) ELSE NULL END,
      'sale_responsible', CASE WHEN tm_sale.id IS NOT NULL THEN jsonb_build_object('id', tm_sale.id, 'name', tm_sale.name, 'avatar_url', tm_sale.avatar_url) ELSE NULL END,
      'lead_tags', COALESCE((SELECT jsonb_agg(jsonb_build_object('tag', jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color))) FROM public.lead_tags lt JOIN public.tags t ON t.id = lt.tag_id WHERE lt.lead_id = l.id), '[]'::jsonb)
    ) AS lead
  FROM public.pipeline_entries pe
  JOIN public.leads l ON l.id = pe.lead_id
  LEFT JOIN public.team_members tm_resp ON tm_resp.id = l.responsible_id
  LEFT JOIN public.team_members tm_sdr ON tm_sdr.id = l.sdr_id
  LEFT JOIN public.team_members tm_closer ON tm_closer.id = l.closer_id
  LEFT JOIN public.team_members tm_pre ON tm_pre.id = l.pre_sale_responsible_id
  LEFT JOIN public.team_members tm_sale ON tm_sale.id = l.sale_responsible_id
  WHERE pe.pipeline_id = v_pipeline_id AND pe.stage_key = p_stage_id AND pe.organization_id = p_org_id
    AND pe.lead_id IS NOT NULL AND (p_cursor IS NULL OR pe.created_at < p_cursor)
    AND (p_search IS NULL OR p_search = '' OR (l.name ILIKE '%' || p_search || '%' OR l.phone ILIKE '%' || p_search || '%' OR l.company ILIKE '%' || p_search || '%'))
    AND (p_responsible_id IS NULL OR ((pe.metadata->>'pre_sale_responsible_id')::UUID = p_responsible_id OR (pe.metadata->>'sale_responsible_id')::UUID = p_responsible_id OR l.pre_sale_responsible_id = p_responsible_id OR l.sale_responsible_id = p_responsible_id))
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
    AND (p_updated_before IS NULL OR (pe.updated_at <= p_updated_before AND (p_overdue_exclude_status_keys IS NULL OR pe.stage_key <> ALL(p_overdue_exclude_status_keys)))) -- metric-lint-allow: não é âncora de métrica — é o filtro de lista "sem toque desde" (p_updated_before, coluna "Vencidos" da página de funil). O R4 existe para que receita/venda não troque de mês quando alguém encosta na linha; aqui o último toque é exatamente a pergunta que o usuário faz. A âncora de período desta mesma query continua em metrics_period_at (ver linha acima).
    AND (p_status_keys IS NULL OR array_length(p_status_keys, 1) IS NULL OR pe.stage_key = ANY(p_status_keys))
    AND (NOT COALESCE(p_scheduled, FALSE) OR EXISTS (SELECT 1 FROM public.scheduled_user_messages sm WHERE sm.lead_id = l.id AND sm.organization_id = p_org_id AND sm.status = 'scheduled'))
    -- "Parado há": idade na etapa atual. min = piso (>= N dias completos);
    -- max = teto (ainda não completou N+1).
    AND (p_stalled_min_days IS NULL OR COALESCE(pe.stage_changed_at, pe.entered_at, pe.created_at) <= now() - make_interval(days => p_stalled_min_days))
    AND (p_stalled_max_days IS NULL OR COALESCE(pe.stage_changed_at, pe.entered_at, pe.created_at) > now() - make_interval(days => p_stalled_max_days + 1))
  ORDER BY pe.created_at DESC LIMIT p_page_size;
END;
$$;

-- ── 3. get_pipeline_stage_counts ────────────────────────────────────────────
CREATE FUNCTION "public"."get_pipeline_stage_counts"(
  "p_pipeline_slug" "text",
  "p_org_id" "uuid",
  "p_search" "text" DEFAULT NULL::"text",
  "p_responsible_id" "uuid" DEFAULT NULL::"uuid",
  "p_tag_ids" "uuid"[] DEFAULT NULL::"uuid"[],
  "p_origins" "text"[] DEFAULT NULL::"text"[],
  "p_rating_min" integer DEFAULT NULL::integer,
  "p_rating_max" integer DEFAULT NULL::integer,
  "p_calor_min" integer DEFAULT NULL::integer,
  "p_calor_max" integer DEFAULT NULL::integer,
  "p_urgency" "text" DEFAULT NULL::"text",
  "p_product_type" "text" DEFAULT NULL::"text",
  "p_meeting_after" timestamp with time zone DEFAULT NULL::timestamp with time zone,
  "p_meeting_before" timestamp with time zone DEFAULT NULL::timestamp with time zone,
  "p_period_after" timestamp with time zone DEFAULT NULL::timestamp with time zone,
  "p_period_before" timestamp with time zone DEFAULT NULL::timestamp with time zone,
  "p_closed_status_keys" "text"[] DEFAULT NULL::"text"[],
  "p_updated_before" timestamp with time zone DEFAULT NULL::timestamp with time zone,
  "p_overdue_exclude_status_keys" "text"[] DEFAULT NULL::"text"[],
  "p_status_keys" "text"[] DEFAULT NULL::"text"[],
  "p_scheduled" boolean DEFAULT NULL::boolean,
  "p_qualification_tier" "text"[] DEFAULT NULL::"text"[],
  "p_pre_qualification_tier" "text"[] DEFAULT NULL::"text"[],
  "p_stalled_min_days" integer DEFAULT NULL::integer,
  "p_stalled_max_days" integer DEFAULT NULL::integer
) RETURNS TABLE("stage_key" "text", "cnt" bigint)
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
DECLARE v_pipeline_id UUID;
BEGIN
  SELECT p.id INTO v_pipeline_id FROM public.pipelines p WHERE p.slug=p_pipeline_slug AND p.type='system' AND p.organization_id=p_org_id; -- metric-lint-allow: corpo preservado da função original; ver nota em get_pipeline_page acima
  IF v_pipeline_id IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT pe.stage_key, COUNT(*)::BIGINT AS cnt
  FROM public.pipeline_entries pe
  JOIN public.leads l ON l.id = pe.lead_id
  WHERE pe.pipeline_id = v_pipeline_id AND pe.organization_id = p_org_id AND pe.lead_id IS NOT NULL
    AND (p_search IS NULL OR p_search = '' OR (l.name ILIKE '%' || p_search || '%' OR l.phone ILIKE '%' || p_search || '%' OR l.company ILIKE '%' || p_search || '%'))
    AND (p_responsible_id IS NULL OR ((pe.metadata->>'pre_sale_responsible_id')::UUID = p_responsible_id OR (pe.metadata->>'sale_responsible_id')::UUID = p_responsible_id OR l.pre_sale_responsible_id = p_responsible_id OR l.sale_responsible_id = p_responsible_id))
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
    AND (p_updated_before IS NULL OR (pe.updated_at <= p_updated_before AND (p_overdue_exclude_status_keys IS NULL OR pe.stage_key <> ALL(p_overdue_exclude_status_keys)))) -- metric-lint-allow: não é âncora de métrica — é o filtro de lista "sem toque desde" (p_updated_before, coluna "Vencidos" da página de funil). O R4 existe para que receita/venda não troque de mês quando alguém encosta na linha; aqui o último toque é exatamente a pergunta que o usuário faz. A âncora de período desta mesma query continua em metrics_period_at (ver linha acima).
    AND (p_status_keys IS NULL OR array_length(p_status_keys, 1) IS NULL OR pe.stage_key = ANY(p_status_keys))
    AND (NOT COALESCE(p_scheduled, FALSE) OR EXISTS (SELECT 1 FROM public.scheduled_user_messages sm WHERE sm.lead_id = l.id AND sm.organization_id = p_org_id AND sm.status = 'scheduled'))
    AND (p_stalled_min_days IS NULL OR COALESCE(pe.stage_changed_at, pe.entered_at, pe.created_at) <= now() - make_interval(days => p_stalled_min_days))
    AND (p_stalled_max_days IS NULL OR COALESCE(pe.stage_changed_at, pe.entered_at, pe.created_at) > now() - make_interval(days => p_stalled_max_days + 1))
  GROUP BY pe.stage_key;
END;
$$;

-- ── 4. ACL ──────────────────────────────────────────────────────────────────
-- O EXECUTE chega por DOIS caminhos independentes neste projeto, e revogar de
-- um só deixa a função aberta:
--
--   1. Implícito via PUBLIC — toda função nasce com EXECUTE TO PUBLIC.
--   2. Explícito via ALTER DEFAULT PRIVILEGES — o projeto concede EXECUTE a
--      `anon` e `authenticated` NOMINALMENTE em toda função nova do schema
--      public. `REVOKE ... FROM PUBLIC` não encosta nesses.
--
-- Custou caro em 2026-07-29: `import_lead_into_custom_pipeline` subiu pra prod
-- com o revoke de PUBLIC feito e ficou executável por anon até o
-- has_function_privilege denunciar. Por isso os dois revokes, e não um.
--
-- `authenticated` MANTÉM o grant: o board é do usuário logado. Ambas as funções
-- são STABLE e sem SECURITY DEFINER, então a RLS de `leads`/`pipeline_entries`
-- ainda se aplica ao chamador — o grant não é o que isola tenant, é a RLS.
REVOKE ALL     ON FUNCTION "public"."get_pipeline_page"("text", "text", "uuid", integer, timestamp with time zone, "text", "uuid", "uuid"[], "text"[], integer, integer, integer, integer, "text", "text", timestamp with time zone, timestamp with time zone, timestamp with time zone, timestamp with time zone, "text"[], timestamp with time zone, "text"[], "text"[], boolean, "text"[], "text"[], integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "public"."get_pipeline_page"("text", "text", "uuid", integer, timestamp with time zone, "text", "uuid", "uuid"[], "text"[], integer, integer, integer, integer, "text", "text", timestamp with time zone, timestamp with time zone, timestamp with time zone, timestamp with time zone, "text"[], timestamp with time zone, "text"[], "text"[], boolean, "text"[], "text"[], integer, integer) FROM "anon";

REVOKE ALL     ON FUNCTION "public"."get_pipeline_stage_counts"("text", "uuid", "text", "uuid", "uuid"[], "text"[], integer, integer, integer, integer, "text", "text", timestamp with time zone, timestamp with time zone, timestamp with time zone, timestamp with time zone, "text"[], timestamp with time zone, "text"[], "text"[], boolean, "text"[], "text"[], integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION "public"."get_pipeline_stage_counts"("text", "uuid", "text", "uuid", "uuid"[], "text"[], integer, integer, integer, integer, "text", "text", timestamp with time zone, timestamp with time zone, timestamp with time zone, timestamp with time zone, "text"[], timestamp with time zone, "text"[], "text"[], boolean, "text"[], "text"[], integer, integer) FROM "anon";

GRANT EXECUTE ON FUNCTION "public"."get_pipeline_page"("text", "text", "uuid", integer, timestamp with time zone, "text", "uuid", "uuid"[], "text"[], integer, integer, integer, integer, "text", "text", timestamp with time zone, timestamp with time zone, timestamp with time zone, timestamp with time zone, "text"[], timestamp with time zone, "text"[], "text"[], boolean, "text"[], "text"[], integer, integer) TO "authenticated", "service_role";
GRANT EXECUTE ON FUNCTION "public"."get_pipeline_stage_counts"("text", "uuid", "text", "uuid", "uuid"[], "text"[], integer, integer, integer, integer, "text", "text", timestamp with time zone, timestamp with time zone, timestamp with time zone, timestamp with time zone, "text"[], timestamp with time zone, "text"[], "text"[], boolean, "text"[], "text"[], integer, integer) TO "authenticated", "service_role";

-- ── 5. Verificação ──────────────────────────────────────────────────────────
DO $$
DECLARE
  r record;
BEGIN
  -- 5a. Exatamente UMA assinatura por função (sem overload ambíguo).
  FOR r IN
    SELECT p.proname, count(*) AS n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('get_pipeline_page', 'get_pipeline_stage_counts')
    GROUP BY p.proname
  LOOP
    IF r.n <> 1 THEN
      RAISE EXCEPTION 'FAIL: % tem % assinaturas (esperava 1) — chamada viraria 42725.', r.proname, r.n;
    END IF;
  END LOOP;

  -- 5b. Os dois parâmetros novos existem.
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('get_pipeline_page', 'get_pipeline_stage_counts')
  LOOP
    IF r.args NOT LIKE '%p_stalled_min_days integer%'
       OR r.args NOT LIKE '%p_stalled_max_days integer%' THEN
      RAISE EXCEPTION 'FAIL: % não expõe p_stalled_min_days/p_stalled_max_days.', r.proname;
    END IF;
  END LOOP;

  -- 5c. anon NÃO executa (o grant a PUBLIC não pode ter sobrevivido).
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('get_pipeline_page', 'get_pipeline_stage_counts')
  LOOP
    IF has_function_privilege('anon', r.sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: anon ainda executa %.', r.sig;
    END IF;
    IF NOT has_function_privilege('authenticated', r.sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: authenticated NÃO executa % — o board quebraria.', r.sig;
    END IF;
  END LOOP;

  RAISE NOTICE 'VALIDATION PASSED: assinatura única, filtro parado-há exposto, anon sem EXECUTE.';
END$$;
