-- 20270919000000 — SCRUM-647
-- Projeção única das métricas de dinheiro.
--
-- PROBLEMA (medido em prod, 2026-09-03)
-- A tradução de `pipeline_entries.metadata` para colunas tipadas (sale_value,
-- o trio/quinteto de atribuição, calor, loss_reason, as datas) está copiada em
-- 20 lugares: as 6 views de compat mais 14 funções que fazem o cast inline.
-- Cada cópia é uma chance de divergência silenciosa de número — o defeito-raiz
-- da auditoria de métricas de 2026-07 (ADR-0017).
--
-- ESTA MIGRATION
--   1. cria UMA projeção canônica, `public.negocio_projetado`;
--   2. reaponta o primeiro lote de leitoras para ela.
-- NÃO toca nas 6 views de compat — elas caem na SCRUM-639.
-- NÃO muda nenhum número: os casts abaixo são cópia literal da `pg_get_viewdef`
-- das views de compat de prod, capturada em 2026-09-03.
--
-- DESENHO — por que view simples, e não função nem materializada:
--   * o planner faz INLINE de view simples, então cada leitora continua com o
--     mesmo plano e o mesmo uso de índice de hoje. Uma função set-returning
--     seria uma barreira de otimização e mudaria plano em 7 funções de métrica;
--   * materializada precisaria de REFRESH e passaria a mentir entre refreshes —
--     inaceitável para dinheiro;
--   * `security_invoker = on` espelha as 6 views de compat (medido: as 6 têm
--     `security_invoker=on`), então a RLS de `pipeline_entries` / `pipelines` /
--     `pipeline_stages` (as 3 têm relrowsecurity = true) continua valendo e o
--     recorte por org não muda.
--
-- DUAS DECISÕES QUE PRESERVAM O NÚMERO, medidas antes de escrever:
--   * `LEFT JOIN pipeline_stages`: 40 das 48.140 entradas têm `stage_id` NULL.
--     Um INNER JOIN sumiria com 40 linhas de dinheiro em silêncio.
--   * `funil_sistema`: identidade canônica do funil nativo — o slug apenas
--     quando o funil é de sistema, NULL quando é custom. Substitui o par
--     par slug-mais-tipo-nativo por UMA coluna. Não é o anti-padrão R3 do
--     ADR-0017 (filtrar métrica pelo tipo do funil): a projeção não filtra
--     nada, ela ROTULA, e quem consome passa a comparar uma coluna só.
--     Medido: 0 pipelines com
--     slug nativo fora de `type='system'`, então a coluna é não-ambígua.
--     Efeito colateral bem-vindo: apaga 2 `metric-lint-allow` que existiam em
--     `get_funnel_health_stage_leads` só para carregar aquele par.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. A PROJEÇÃO
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.negocio_projetado
WITH (security_invoker = on) AS
SELECT
  -- ── colunas próprias da entrada ──────────────────────────────────────────
  pe.id,
  pe.organization_id,
  pe.lead_id,
  pe.pipeline_id,
  pe.stage_id,
  pe.stage_key,
  pe.assigned_to,
  pe.notes,
  pe.deal_id,
  pe.entered_at,
  pe.stage_changed_at,
  pe.closed_at,
  pe.created_at,
  pe.updated_at,
  pe.metadata,

  -- ── identidade do funil ──────────────────────────────────────────────────
  p.slug          AS pipeline_slug,
  p.type          AS pipeline_type,
  p.name          AS pipeline_name,
  p.display_order AS pipeline_display_order,
  -- slug do funil NATIVO; NULL quando o funil é custom. Ver nota de desenho.
  CASE p.type WHEN 'system' THEN p.slug END AS funil_sistema,

  -- ── papel da etapa ───────────────────────────────────────────────────────
  ps.stage_role,
  ps.name              AS stage_name,
  ps."position"        AS stage_position,
  ps.is_final_positive AS stage_is_final_positive,
  ps.is_final_negative AS stage_is_final_negative,

  -- ── A PROJEÇÃO: casts copiados literalmente das views de compat ──────────
  -- pipe_propostas
  (pe.metadata ->> 'sale_value'::text)::numeric               AS sale_value,
  (pe.metadata ->> 'product_id'::text)::uuid                  AS product_id,
  pe.metadata ->> 'product_type'::text                        AS product_type,
  (pe.metadata ->> 'calor'::text)::integer                    AS calor,
  pe.metadata ->> 'loss_reason'::text                         AS loss_reason,
  (pe.metadata ->> 'loss_reason_id'::text)::uuid              AS loss_reason_id,
  (pe.metadata ->> 'commitment_date'::text)::date             AS commitment_date,
  (pe.metadata ->> 'contract_duration'::text)::integer        AS contract_duration,
  -- atribuição (pipe_whatsapp / pipe_confirmacao / pipe_propostas / custom_pipe_entries)
  (pe.metadata ->> 'closer_id'::text)::uuid                   AS closer_id,
  (pe.metadata ->> 'sdr_id'::text)::uuid                      AS sdr_id,
  (pe.metadata ->> 'responsible_id'::text)::uuid              AS responsible_id,
  (pe.metadata ->> 'pre_sale_responsible_id'::text)::uuid     AS pre_sale_responsible_id,
  (pe.metadata ->> 'sale_responsible_id'::text)::uuid         AS sale_responsible_id,
  -- pipe_confirmacao — o COALESCE é da viewdef, não é invenção desta migration
  COALESCE((pe.metadata ->> 'is_confirmed'::text)::boolean, false) AS is_confirmed,
  (pe.metadata ->> 'meeting_date'::text)::timestamp with time zone AS meeting_date,
  pe.metadata ->> 'meet_link'::text                           AS meet_link,
  -- pipe_whatsapp
  (pe.metadata ->> 'scheduled_date'::text)::timestamp with time zone AS scheduled_date,
  -- âncora temporal de métrica (pipe_confirmacao / pipe_propostas)
  (pe.metadata ->> 'metrics_period_at'::text)::timestamp with time zone AS metrics_period_at
FROM public.pipeline_entries pe
JOIN public.pipelines p        ON p.id  = pe.pipeline_id
LEFT JOIN public.pipeline_stages ps ON ps.id = pe.stage_id;

COMMENT ON VIEW public.negocio_projetado IS
  'SCRUM-647 — projeção canônica de pipeline_entries: as colunas próprias da '
  'entrada + a identidade do funil + o papel da etapa + os campos de metadata '
  'já tipados. Fonte ÚNICA da tradução metadata->coluna. Casts idênticos aos '
  'das 6 views de compat (capturados de prod em 2026-09-03). Somente leitura: '
  'escrita continua indo direto em pipeline_entries.';

COMMENT ON COLUMN public.negocio_projetado.funil_sistema IS
  'Slug do funil quando ele é nativo (type=system); NULL quando é custom. '
  'Substitui o par slug=X AND type=system por uma coluna só.';

-- Grants: as views de compat de dinheiro (pipe_whatsapp/confirmacao/propostas)
-- NÃO dão nada a anon — esta também não. Só SELECT: a projeção é leitura, e o
-- INSTEAD OF que justificava arwdDxtm nas views de compat não existe aqui.
--
-- O REVOKE de anon é OBRIGATÓRIO e não é zelo: `ALTER DEFAULT PRIVILEGES` do
-- schema public concede `anon=rxtm` a TODA relação nova de dono postgres
-- (medido em pg_default_acl, 2026-09-03). Sem esta linha a projeção nasce
-- legível por anon — 48.140 entradas com valor de venda de 78 orgs. É o mesmo
-- vetor da tabela de backup que nasceu pública. `REVOKE ... FROM PUBLIC` não
-- resolve: o grant é direto no papel anon. O ensaio pegou isto.
REVOKE ALL ON public.negocio_projetado FROM PUBLIC;
REVOKE ALL ON public.negocio_projetado FROM anon;
REVOKE ALL ON public.negocio_projetado FROM authenticated;
REVOKE ALL ON public.negocio_projetado FROM service_role;
REVOKE ALL ON public.negocio_projetado FROM mcp_readonly;
GRANT SELECT ON public.negocio_projetado TO authenticated;
GRANT SELECT ON public.negocio_projetado TO service_role;
GRANT SELECT ON public.negocio_projetado TO mcp_readonly;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. LOTE 1 — as leitoras que passam a ler pela projeção
--
-- Critério de entrada no lote: (i) leitura pura — nada que escreva, nada que
-- rode dentro de policy de RLS; (ii) o cast inline de hoje é IDÊNTICO ao da
-- view de compat, então a troca é neutra por construção; (iii) `CREATE OR
-- REPLACE` preserva assinatura e grants (sem DROP: DROP+CREATE devolveria
-- EXECUTE para PUBLIC/anon).
-- Corpos abaixo = corpo EXATO de prod de 2026-09-03 com a tradução trocada.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── api_get_lead ───────────────────────────────────────────────────────────
-- Troca: pipeline_entries+pipelines -> negocio_projetado; sale_value pela
-- projeção; o par slug/type do campo 'sold' vira funil_sistema.
-- `IS NOT DISTINCT FROM` e não `=` porque 'sold' é VALOR num jsonb: com `=`,
-- um funil custom daria NULL onde hoje dá false.
CREATE OR REPLACE FUNCTION public.api_get_lead(p_org uuid, p_lead_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'id', l.id, 'name', l.name, 'company', l.company, 'email', l.email, 'phone', l.phone,
    'origin', l.origin::text, 'rating', l.rating, 'qualification_score', l.qualification_score,
    'tier', COALESCE(l.qualification_tier, l.pre_qualification_tier)::text,
    'responsible_id', l.responsible_id, 'sdr_id', l.sdr_id, 'closer_id', l.closer_id,
    'pre_sale_responsible_id', l.pre_sale_responsible_id, 'sale_responsible_id', l.sale_responsible_id,
    'created_at', l.created_at, 'updated_at', l.updated_at,
    'tags', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color))
      FROM lead_tags lt JOIN tags t ON t.id = lt.tag_id WHERE lt.lead_id = l.id), '[]'::jsonb),
    'custom_fields', COALESCE((SELECT jsonb_agg(jsonb_build_object('field_name', cf.field_name,
      'field_type', cf.field_type, 'value', cfv.value) ORDER BY cf.display_order)
      FROM lead_custom_field_values cfv JOIN lead_custom_fields cf ON cf.id = cfv.field_id
      WHERE cfv.lead_id = l.id), '[]'::jsonb),
    'pipes', COALESCE((SELECT jsonb_agg(jsonb_build_object('pipeline', np.pipeline_slug, 'pipeline_name', np.pipeline_name,
      'type', np.pipeline_type, 'stage_key', np.stage_key,
      'sold', (np.stage_key = 'vendido' AND np.funil_sistema IS NOT DISTINCT FROM 'propostas'),
      'sale_value', np.sale_value, 'entered_at', np.entered_at,
      'stage_changed_at', np.stage_changed_at) ORDER BY np.pipeline_display_order)
      FROM negocio_projetado np
      WHERE np.lead_id = l.id AND np.organization_id = p_org), '[]'::jsonb)
  )
  FROM leads l
  WHERE l.id = p_lead_id AND l.organization_id = p_org AND l.deleted_at IS NULL;
$function$;

-- ── api_list_leads ─────────────────────────────────────────────────────────
-- Troca: o LATERAL de venda passa pela projeção. Medido: 0 leads com mais de
-- uma entry 'vendido' em propostas, então o LIMIT 1 sem ORDER BY (que já era
-- não-determinístico) não muda de resposta.
CREATE OR REPLACE FUNCTION public.api_list_leads(p_org uuid, p_stage text[] DEFAULT NULL::text[], p_tier text[] DEFAULT NULL::text[], p_tag text[] DEFAULT NULL::text[], p_origin text[] DEFAULT NULL::text[], p_responsible_id uuid DEFAULT NULL::uuid, p_created_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_created_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_q text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_cursor_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, name text, company text, email text, phone text, origin text, rating integer, qualification_score integer, tier_efetivo text, tags jsonb, responsible_id uuid, sdr_id uuid, closer_id uuid, sold boolean, sale_value numeric, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    l.id,
    l.name,
    l.company,
    l.email,
    l.phone,
    l.origin::text,
    l.rating,
    l.qualification_score,
    COALESCE(l.qualification_tier, l.pre_qualification_tier)::text AS tier_efetivo,
    COALESCE(
      (
        SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color))
        FROM lead_tags lt
        JOIN tags t ON t.id = lt.tag_id
        WHERE lt.lead_id = l.id
      ),
      '[]'::jsonb
    ) AS tags,
    l.responsible_id,
    l.sdr_id,
    l.closer_id,
    COALESCE(v.sold, false) AS sold,
    v.sale_value,
    l.created_at
  FROM leads l
  LEFT JOIN LATERAL (
    SELECT true AS sold, np.sale_value AS sale_value
    FROM negocio_projetado np
    WHERE np.funil_sistema = 'propostas'
      AND np.lead_id = l.id
      AND np.organization_id = p_org
      AND np.stage_key = 'vendido'
    LIMIT 1
  ) v ON true
  WHERE l.organization_id = p_org
    AND l.deleted_at IS NULL
    AND COALESCE(l.is_shadow, false) = false
    AND (p_tier IS NULL
         OR COALESCE(l.qualification_tier, l.pre_qualification_tier)::text = ANY(p_tier))
    AND (p_origin IS NULL OR l.origin::text = ANY(p_origin))
    AND (p_responsible_id IS NULL
         OR p_responsible_id IN (
              l.responsible_id, l.sdr_id, l.closer_id,
              l.pre_sale_responsible_id, l.sale_responsible_id
            ))
    AND (p_created_from IS NULL OR l.created_at >= p_created_from)
    AND (p_created_to IS NULL OR l.created_at <= p_created_to)
    AND (p_q IS NULL OR (
           l.name ILIKE '%' || p_q || '%'
        OR l.company ILIKE '%' || p_q || '%'
        OR l.email ILIKE '%' || p_q || '%'
        OR l.phone ILIKE '%' || p_q || '%'
    ))
    AND (p_stage IS NULL OR EXISTS (
           SELECT 1 FROM pipeline_entries pe2
           WHERE pe2.lead_id = l.id
             AND pe2.organization_id = p_org
             AND pe2.stage_key = ANY(p_stage)
    ))
    AND (p_tag IS NULL OR EXISTS (
           SELECT 1 FROM lead_tags lt2
           JOIN tags t2 ON t2.id = lt2.tag_id
           WHERE lt2.lead_id = l.id
             AND lower(t2.name) = ANY(SELECT lower(x) FROM unnest(p_tag) AS x)
    ))
    AND (
      p_cursor_created_at IS NULL
      OR l.created_at < p_cursor_created_at
      OR (l.created_at = p_cursor_created_at AND l.id < p_cursor_id)
    )
  ORDER BY l.created_at DESC, l.id DESC
  LIMIT GREATEST(p_limit, 1);
$function$;

-- ── get_funnel_health_stage_leads — FORA DESTE LOTE, de propósito ─────────
-- O corpo de prod resolve `tm_id` por um COALESCE que encadeia TRÊS chaves de
-- atribuição (pré-venda, depois SDR, depois responsável): o anti-padrão R5 do
-- ADR-0017. Hoje ele vive no snapshot de baseline, que o lint isenta;
-- reemitir o corpo aqui a exporia ao gate pela primeira vez, e ele reprova —
-- corretamente. Tirar a cadeia MUDA quem é creditado pela reunião, e mudar
-- número é decisão do CTO, não carona de refatoração. Fica como está.

-- ── get_next_pipe_closer ───────────────────────────────────────────────────
-- Troca: a contagem de round-robin passa pela projeção. `closer_id IS NOT NULL`
-- na projeção é o mesmo predicado que `(metadata->>'closer_id')::uuid IS NOT NULL`.
CREATE OR REPLACE FUNCTION public.get_next_pipe_closer(p_pipe_type text, p_organization_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rule_id UUID;
  v_mode TEXT;
  v_assigned_to UUID;
  v_member_ids UUID[];
  v_count BIGINT;
  v_next_index INT;
BEGIN
  SELECT id, closer_mode, closer_assigned_to
    INTO v_rule_id, v_mode, v_assigned_to
  FROM public.pipe_distribution_rules
  WHERE organization_id = p_organization_id
    AND pipe_type = p_pipe_type
  LIMIT 1;

  IF v_rule_id IS NULL OR v_mode IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_mode = 'single' AND v_assigned_to IS NOT NULL THEN
    RETURN v_assigned_to;
  END IF;

  SELECT ARRAY_AGG(pdm.team_member_id ORDER BY pdm.created_at, pdm.team_member_id)
    INTO v_member_ids
  FROM public.pipe_distribution_members pdm
  WHERE pdm.rule_id = v_rule_id
    AND pdm.role = 'closer';

  IF v_member_ids IS NULL OR array_length(v_member_ids, 1) IS NULL OR array_length(v_member_ids, 1) = 0 THEN
    RETURN NULL;
  END IF;

  IF v_mode = 'random' THEN
    RETURN v_member_ids[1 + floor(random() * array_length(v_member_ids, 1))::int];
  END IF;

  IF v_mode = 'round_robin' THEN
    -- Count records with closer_id set in pipeline_entries for this pipe slug
    SELECT count(*) INTO v_count
    FROM public.negocio_projetado np
    WHERE np.funil_sistema = p_pipe_type
      AND np.organization_id = p_organization_id
      AND np.closer_id IS NOT NULL;

    v_next_index := (COALESCE(v_count, 0) % array_length(v_member_ids, 1)) + 1;
    RETURN v_member_ids[v_next_index];
  END IF;

  RETURN NULL;
END;
$function$;

-- ── get_pipeline_lead_ids ──────────────────────────────────────────────────
-- Troca: pipeline_entries+pipelines -> negocio_projetado; o filtro de
-- responsável passa pela projeção. Continua invoker-rights com search_path=''
-- (a projeção é security_invoker=on, então a RLS do chamador segue valendo).
-- ATENÇÃO: o filtro por slug aqui NÃO tem type='system' hoje — funil custom
-- entra. Mantido: usa pipeline_slug, não funil_sistema.
CREATE OR REPLACE FUNCTION public.get_pipeline_lead_ids(p_pipeline_id uuid DEFAULT NULL::uuid, p_pipeline_slug text DEFAULT NULL::text, p_stage_id uuid DEFAULT NULL::uuid, p_stage_key text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_responsible_id uuid DEFAULT NULL::uuid, p_tag_ids uuid[] DEFAULT NULL::uuid[], p_qualification_tier text[] DEFAULT NULL::text[], p_pre_qualification_tier text[] DEFAULT NULL::text[], p_origin text[] DEFAULT NULL::text[], p_organization_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT pe.lead_id
  FROM public.negocio_projetado pe
  JOIN public.leads l
    ON l.id = pe.lead_id
   AND l.deleted_at IS NULL
  WHERE pe.lead_id IS NOT NULL
    AND (p_pipeline_id IS NULL OR pe.pipeline_id = p_pipeline_id)
    AND (p_pipeline_slug IS NULL OR pe.pipeline_slug = p_pipeline_slug)
    -- Alvo obrigatório: sem id e sem slug não existe "público de tudo".
    AND (p_pipeline_id IS NOT NULL OR p_pipeline_slug IS NOT NULL)
    -- AUTORIZAÇÃO: orgs do chamador (helper) OU a org pedida quando master.
    AND (
      pe.organization_id IN (SELECT public.get_my_organization_ids())
      OR (p_organization_id IS NOT NULL
          AND public.is_master_user()
          AND pe.organization_id = p_organization_id)
    )
    -- ESCOPO (SCRUM-429): quem passou a org quer AQUELA org, não a união.
    AND (p_organization_id IS NULL OR pe.organization_id = p_organization_id)
    -- Recorte de etapa: uuid é canônico, key é o alias legado; NULL = funil todo.
    AND (p_stage_id IS NULL OR pe.stage_id = p_stage_id)
    AND (p_stage_key IS NULL OR pe.stage_key = p_stage_key)
    -- Search filter (mirrors get_pipeline_page: name / phone / company).
    AND (p_search IS NULL OR p_search = '' OR (
      l.name    ILIKE '%' || p_search || '%'
      OR l.phone   ILIKE '%' || p_search || '%'
      OR l.company ILIKE '%' || p_search || '%'
    ))
    -- Responsible filter (dual fields: projeção da entry + colunas do lead).
    AND (p_responsible_id IS NULL OR (
      pe.pre_sale_responsible_id = p_responsible_id
      OR pe.sale_responsible_id = p_responsible_id
      OR l.pre_sale_responsible_id = p_responsible_id
      OR l.sale_responsible_id = p_responsible_id
    ))
    -- Tag filter (intersection: lead must have ALL specified tags).
    AND (p_tag_ids IS NULL OR array_length(p_tag_ids, 1) IS NULL OR NOT EXISTS (
      SELECT unnest(p_tag_ids)
      EXCEPT
      SELECT lt.tag_id FROM public.lead_tags lt WHERE lt.lead_id = l.id
    ))
    -- Qualification tier (sale-side) — text membership, NULL/empty = all.
    AND (p_qualification_tier IS NULL OR array_length(p_qualification_tier, 1) IS NULL
      OR l.qualification_tier::text = ANY(p_qualification_tier))
    -- Pre-qualification tier — text membership, NULL/empty = all.
    AND (p_pre_qualification_tier IS NULL OR array_length(p_pre_qualification_tier, 1) IS NULL
      OR l.pre_qualification_tier::text = ANY(p_pre_qualification_tier))
    -- Origin — text membership, NULL/empty = all.
    AND (p_origin IS NULL OR array_length(p_origin, 1) IS NULL
      OR l.origin::text = ANY(p_origin));
$function$;

-- ── get_meeting_reminder_candidates ────────────────────────────────────────
-- Troca: a CTE `wf` passa pela projeção. `scheduled_date IS NOT NULL` na
-- projeção equivale ao `metadata->>'scheduled_date' IS NOT NULL` de hoje:
-- medido, 0 valores de scheduled_date vazios ou fora do formato timestamptz.
CREATE OR REPLACE FUNCTION public.get_meeting_reminder_candidates(p_organization_id uuid, p_stage_keys text[])
 RETURNS TABLE(lead_id uuid, whatsapp_stage text, meeting_date timestamp with time zone, last_inbound_at timestamp with time zone, last_outbound_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH wf AS (
    SELECT np.lead_id, np.stage_key, np.scheduled_date AS meeting_date
    FROM negocio_projetado np
    WHERE np.funil_sistema = 'whatsapp'
      AND np.organization_id = p_organization_id
      AND np.stage_key = ANY(p_stage_keys)
      AND np.scheduled_date IS NOT NULL
      AND np.scheduled_date > now()
  )
  SELECT w.lead_id, w.stage_key, w.meeting_date,
    (SELECT max(wm.timestamp) FROM whatsapp_messages wm
       WHERE wm.lead_id=w.lead_id AND wm.organization_id=p_organization_id AND wm.direction='incoming'),
    (SELECT max(wm.timestamp) FROM whatsapp_messages wm
       WHERE wm.lead_id=w.lead_id AND wm.organization_id=p_organization_id AND wm.direction='outgoing')
  FROM wf w;
$function$;

-- ── get_seller_activity_scores ─────────────────────────────────────────────
-- Troca: as 3 subconsultas de pipeline passam pela projeção (reuniões,
-- propostas enviadas, vendas fechadas). A âncora temporal
-- COALESCE(metrics_period_at, created_at|closed_at) é preservada como está —
-- corrigi-la é decisão de número, não de refatoração.
CREATE OR REPLACE FUNCTION public.get_seller_activity_scores(p_org_id uuid, p_start_date timestamp with time zone, p_end_date timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE result JSONB;
BEGIN
  PERFORM public.assert_org_access(p_org_id);
  WITH seller_metrics AS (
    SELECT tm.id, tm.name, tm.role, (tm.metric_type)::TEXT AS metric_type,
      (SELECT COUNT(*)
       FROM leads l
       WHERE l.organization_id = p_org_id
         AND (l.sdr_id = tm.id OR l.closer_id = tm.id)
         AND COALESCE(l.metrics_period_at, l.created_at) >= p_start_date
         AND COALESCE(l.metrics_period_at, l.created_at) <= p_end_date
      ) AS leads_movimentados,
      (SELECT COUNT(*)
       FROM follow_ups fu
       WHERE fu.organization_id = p_org_id
         AND fu.assigned_to = tm.id
         AND fu.completed_at IS NOT NULL
         AND fu.completed_at >= p_start_date
         AND fu.completed_at <= p_end_date
      ) AS followups_completos,
      (SELECT COUNT(*)
       FROM negocio_projetado np
       WHERE np.funil_sistema = 'confirmacao'
         AND np.organization_id = p_org_id
         AND (np.sdr_id = tm.id OR np.closer_id = tm.id)
         AND np.stage_key = 'compareceu'
         AND COALESCE(np.metrics_period_at, np.created_at) >= p_start_date
         AND COALESCE(np.metrics_period_at, np.created_at) <= p_end_date
      ) AS reunioes_realizadas,
      (SELECT COUNT(*)
       FROM negocio_projetado np
       WHERE np.funil_sistema = 'propostas'
         AND np.organization_id = p_org_id
         AND np.closer_id = tm.id
         AND COALESCE(np.metrics_period_at, np.created_at) >= p_start_date
         AND COALESCE(np.metrics_period_at, np.created_at) <= p_end_date
      ) AS propostas_enviadas,
      (SELECT COUNT(*)
       FROM negocio_projetado np
       WHERE np.funil_sistema = 'propostas'
         AND np.organization_id = p_org_id
         AND np.closer_id = tm.id
         AND np.stage_key = 'vendido'
         AND COALESCE(np.metrics_period_at, np.closed_at) >= p_start_date
         AND COALESCE(np.metrics_period_at, np.closed_at) <= p_end_date
      ) AS vendas_fechadas
    FROM team_members tm WHERE tm.organization_id = p_org_id AND tm.is_active = true
  ), scored AS (
    SELECT sm.*,
      (sm.leads_movimentados * 10 + sm.followups_completos * 15 + sm.reunioes_realizadas * 20 + sm.propostas_enviadas * 25 + sm.vendas_fechadas * 30) AS score_bruto
    FROM seller_metrics sm
  )
  SELECT jsonb_agg(jsonb_build_object(
    'id', s.id, 'name', s.name, 'role', s.role, 'metricType', s.metric_type,
    'leads', s.leads_movimentados, 'followups', s.followups_completos,
    'reunioes', s.reunioes_realizadas, 'propostas', s.propostas_enviadas,
    'vendas', s.vendas_fechadas, 'scoreBruto', s.score_bruto,
    'scoreNormalizado', CASE WHEN (SELECT MAX(score_bruto) FROM scored) > 0
      THEN ROUND((s.score_bruto::NUMERIC / (SELECT MAX(score_bruto) FROM scored)) * 100) ELSE 0 END
  ) ORDER BY s.score_bruto DESC) INTO result FROM scored s;
  RETURN COALESCE(result, '[]'::jsonb);
END; $function$;
