-- ============================================================================
-- Resolvers de público do Disparo — `p_organization_id` passa a ESCOPAR, e não
-- só a autorizar (SCRUM-429)
-- ============================================================================
-- BUG. Os 5 resolvers de público gateiam tenancy com um `OR`:
--
--     AND (
--       x.organization_id IN (SELECT public.get_my_organization_ids())
--       OR (p_organization_id IS NOT NULL
--           AND public.is_master_user()
--           AND x.organization_id = p_organization_id)
--     )
--
-- O cabeçalho de `archive/20261228000000` afirma o contrário do que esse código
-- faz: *"o ramo master é escopado à org pedida (p_organization_id) e NÃO a
-- 'todas as orgs' — master operando UMA org recebe só aquela org, nunca
-- cross-org"*. Mas `OR` não substitui o primeiro ramo, **soma** a ele. Como
-- `get_my_organization_ids()` tem branch de master, master pedindo a org B
-- recebe **B mais todas as outras**.
--
-- Não é escalonamento de privilégio — master já enxerga tudo. É erro de
-- **escopo**, e o efeito é externo e irreversível: o DisparoWizard operado por
-- master monta o público com estas RPCs, e mensagem de WhatsApp enviada não
-- volta.
--
-- O mesmo `OR` atinge um caso não-master que ninguém tinha olhado: usuário
-- membro de DUAS orgs, com a org A na tela, recebia o público de A **e** de B.
-- Os cinco call-sites do frontend passam `organizationId` do contexto — ou seja,
-- todos já dizem qual org querem, e nenhum queria a união.
--
-- REPRODUÇÃO (já estava no CI, vermelha):
--   tests/integration/get-stage-lead-ids.test.ts, caso (f).
--   master.rpc('get_stage_lead_ids', { …, p_organization_id: ORG_B })
--   → esperado: só a lead de B.
--   → obtido:   expected [ …(3) ] to not include '…001001'  (lead da org A).
--
-- ── O FIX, e por que ele é aditivo ──────────────────────────────────────────
-- O predicado de OR **não muda** — ele é o gate de AUTORIZAÇÃO e está correto.
-- Acrescenta-se um segundo predicado, de ESCOPO:
--
--     AND (p_organization_id IS NULL OR x.organization_id = p_organization_id)
--
-- Separar as duas perguntas é o ponto. "Pode ver?" continua respondida pelo
-- helper + ramo master. "Quer ver o quê?" passa a ser respondida pelo parâmetro.
-- Um predicado que só **restringe** não pode abrir acesso novo — é a propriedade
-- que torna esta migration segura de revisar linha a linha:
--
--   * master + p_organization_id = B  → autorizado pelo ramo master, escopado a
--     B. Cross-org acaba. ✅
--   * não-master membro de A e B, pedindo A → autorizado pelo helper, escopado
--     a A. Deixa de vazar B para a tela de A. ✅
--   * não-master forjando a org C (sem acesso) → o gate de autorização já
--     derrubava; o escopo derruba de novo. Nenhum acesso novo. ✅
--   * `p_organization_id IS NULL` → o predicado é no-op. Comportamento
--     IDÊNTICO ao de hoje, byte a byte. ✅ (é o caminho de quem não passa o
--     parâmetro; nenhum call-site do repo faz isso, mas a RPC é pública a
--     `authenticated` e a compatibilidade importa.)
--
-- ── Onde ele entra ──────────────────────────────────────────────────────────
-- Cinco funções, SEIS predicados — `get_all_funnels_lead_ids` tem os dois ramos
-- da união (`pipeline_entries` e `custom_pipe_entries`), e **esquecer um dos
-- dois vaza**, exatamente como o cabeçalho de `20270814000000` já avisava para
-- o predicado de autorização.
--
-- Assinaturas INALTERADAS ⇒ `CREATE OR REPLACE` basta, sem `DROP` (que criaria
-- janela de RPC ausente) e sem overload novo. Corpo copiado VERBATIM do baseline
-- `20260101000000` (e de `20270814000000` para a de todos os funis); a única
-- diferença em cada uma é a linha do escopo. GRANTs sobrevivem ao REPLACE, então
-- nada é re-concedido aqui — em particular, o `GRANT … TO anon` que o baseline
-- carrega NÃO é ampliado nem revogado por esta migration (são SECURITY INVOKER:
-- anon esbarra na RLS de `leads` e recebe conjunto vazio).
--
-- SECURITY INVOKER + `SET search_path = ''` preservados. `is_master_user` e
-- `get_my_organization_ids` são SECURITY DEFINER e seguem qualificados com
-- `public.`.
--
-- Só schema — nenhum DML (guarda F4 do CLAUDE.md).
-- ============================================================================

-- ── 1. get_stage_lead_ids ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_stage_lead_ids(
  p_pipeline_type   TEXT,
  p_stage_key       TEXT,
  p_organization_id UUID DEFAULT NULL
)
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT pe.lead_id
  FROM public.pipeline_entries pe
  JOIN public.pipelines p
    ON p.id = pe.pipeline_id
   AND p.type = 'system' -- metric-lint-allow: resolver de PÚBLICO de disparo, não métrica — e o corpo é cópia VERBATIM do baseline 20260101000000, que já vivia com este predicado. O par type+slug seleciona O funil que o operador escolheu na tela; funil custom tem resolver próprio (get_custom_filtered_lead_ids), logo nenhum é cegado — que é o que a regra R3 protege.
   AND p.slug = p_pipeline_type
  JOIN public.leads l
    ON l.id = pe.lead_id
   AND l.deleted_at IS NULL
  WHERE pe.stage_key = p_stage_key
    AND pe.lead_id IS NOT NULL
    -- AUTORIZAÇÃO: orgs do chamador (helper) OU a org pedida quando master.
    AND (
      pe.organization_id IN (SELECT public.get_my_organization_ids())
      OR (p_organization_id IS NOT NULL
          AND public.is_master_user()
          AND pe.organization_id = p_organization_id)
    )
    -- ESCOPO (SCRUM-429): quem passou a org quer AQUELA org, não a união.
    AND (p_organization_id IS NULL OR pe.organization_id = p_organization_id);
$$;

COMMENT ON FUNCTION public.get_stage_lead_ids(TEXT, TEXT, UUID) IS
  'Disparos: lead_ids de UMA etapa de funil system. p_organization_id AUTORIZA (ramo master) e ESCOPA (SCRUM-429) — passar a org devolve só ela, nunca a união das orgs do chamador.';

-- ── 2. get_filtered_lead_ids ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_filtered_lead_ids(
  p_pipeline_type          TEXT,
  p_stage_key              TEXT   DEFAULT NULL,
  p_search                 TEXT   DEFAULT NULL,
  p_responsible_id         UUID   DEFAULT NULL,
  p_tag_ids                UUID[] DEFAULT NULL,
  p_qualification_tier     TEXT[] DEFAULT NULL,
  p_pre_qualification_tier TEXT[] DEFAULT NULL,
  p_origin                 TEXT[] DEFAULT NULL,
  p_organization_id        UUID   DEFAULT NULL
)
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT pe.lead_id
  FROM public.pipeline_entries pe
  JOIN public.pipelines p
    ON p.id = pe.pipeline_id
   AND p.type = 'system' -- metric-lint-allow: resolver de PÚBLICO de disparo, não métrica — e o corpo é cópia VERBATIM do baseline 20260101000000, que já vivia com este predicado. O par type+slug seleciona O funil que o operador escolheu na tela; funil custom tem resolver próprio (get_custom_filtered_lead_ids), logo nenhum é cegado — que é o que a regra R3 protege.
   AND p.slug = p_pipeline_type
  JOIN public.leads l
    ON l.id = pe.lead_id
   AND l.deleted_at IS NULL
  WHERE pe.lead_id IS NOT NULL
    -- AUTORIZAÇÃO: orgs do chamador (helper) OU a org pedida quando master.
    AND (
      pe.organization_id IN (SELECT public.get_my_organization_ids())
      OR (p_organization_id IS NOT NULL
          AND public.is_master_user()
          AND pe.organization_id = p_organization_id)
    )
    -- ESCOPO (SCRUM-429): quem passou a org quer AQUELA org, não a união.
    AND (p_organization_id IS NULL OR pe.organization_id = p_organization_id)
    -- Optional stage scope: NULL = whole pipeline (every stage).
    AND (p_stage_key IS NULL OR pe.stage_key = p_stage_key)
    -- Search filter (mirrors get_pipeline_page: name / phone / company).
    AND (p_search IS NULL OR p_search = '' OR (
      l.name    ILIKE '%' || p_search || '%'
      OR l.phone   ILIKE '%' || p_search || '%'
      OR l.company ILIKE '%' || p_search || '%'
    ))
    -- Responsible filter (dual fields: entry metadata + lead columns).
    AND (p_responsible_id IS NULL OR (
      (pe.metadata->>'pre_sale_responsible_id')::UUID = p_responsible_id
      OR (pe.metadata->>'sale_responsible_id')::UUID = p_responsible_id
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
$$;

COMMENT ON FUNCTION public.get_filtered_lead_ids(TEXT, TEXT, TEXT, UUID, UUID[], TEXT[], TEXT[], TEXT[], UUID) IS
  'Disparos: lead_ids de um funil system com as condições do wizard. p_organization_id AUTORIZA (ramo master) e ESCOPA (SCRUM-429).';

-- ── 3. get_custom_filtered_lead_ids ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_custom_filtered_lead_ids(
  p_pipeline_id            UUID,
  p_stage_id               UUID   DEFAULT NULL,
  p_search                 TEXT   DEFAULT NULL,
  p_responsible_id         UUID   DEFAULT NULL,
  p_tag_ids                UUID[] DEFAULT NULL,
  p_qualification_tier     TEXT[] DEFAULT NULL,
  p_pre_qualification_tier TEXT[] DEFAULT NULL,
  p_origin                 TEXT[] DEFAULT NULL,
  p_organization_id        UUID   DEFAULT NULL
)
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT ce.lead_id
  FROM public.custom_pipe_entries ce
  JOIN public.leads l
    ON l.id = ce.lead_id
   AND l.deleted_at IS NULL
  WHERE ce.lead_id IS NOT NULL
    AND ce.pipeline_id = p_pipeline_id
    -- AUTORIZAÇÃO: orgs do chamador (helper) OU a org pedida quando master.
    AND (
      ce.organization_id IN (SELECT public.get_my_organization_ids())
      OR (p_organization_id IS NOT NULL
          AND public.is_master_user()
          AND ce.organization_id = p_organization_id)
    )
    -- ESCOPO (SCRUM-429): quem passou a org quer AQUELA org, não a união.
    AND (p_organization_id IS NULL OR ce.organization_id = p_organization_id)
    -- Optional stage scope: NULL = whole pipeline (every stage).
    AND (p_stage_id IS NULL OR ce.stage_id = p_stage_id)
    -- Search filter (mirrors get_filtered_lead_ids: name / phone / company).
    AND (p_search IS NULL OR p_search = '' OR (
      l.name    ILIKE '%' || p_search || '%'
      OR l.phone   ILIKE '%' || p_search || '%'
      OR l.company ILIKE '%' || p_search || '%'
    ))
    -- Responsible filter (lead columns only — see 20261123000001 header note).
    AND (p_responsible_id IS NULL OR (
      l.pre_sale_responsible_id = p_responsible_id
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
$$;

COMMENT ON FUNCTION public.get_custom_filtered_lead_ids(UUID, UUID, TEXT, UUID, UUID[], TEXT[], TEXT[], TEXT[], UUID) IS
  'Disparos: lead_ids de um funil CUSTOM com as condições do wizard. p_organization_id AUTORIZA (ramo master) e ESCOPA (SCRUM-429).';

-- ── 4. get_carteira_lead_ids ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_carteira_lead_ids(
  p_segments               TEXT[] DEFAULT NULL,
  p_search                 TEXT   DEFAULT NULL,
  p_tag_ids                UUID[] DEFAULT NULL,
  p_qualification_tier     TEXT[] DEFAULT NULL,
  p_pre_qualification_tier TEXT[] DEFAULT NULL,
  p_origin                 TEXT[] DEFAULT NULL,
  p_organization_id        UUID   DEFAULT NULL
)
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT uc.lead_id
  FROM public.upsell_clients uc
  JOIN public.leads l
    ON l.id = uc.lead_id
   AND l.deleted_at IS NULL
  WHERE uc.is_active = true
    AND uc.lead_id IS NOT NULL
    -- AUTORIZAÇÃO: orgs do chamador (helper) OU a org pedida quando master.
    AND (
      uc.organization_id IN (SELECT public.get_my_organization_ids())
      OR (p_organization_id IS NOT NULL
          AND public.is_master_user()
          AND uc.organization_id = p_organization_id)
    )
    -- ESCOPO (SCRUM-429): quem passou a org quer AQUELA org, não a união.
    AND (p_organization_id IS NULL OR uc.organization_id = p_organization_id)
    -- Optional segment scope: NULL/empty = all segments.
    AND (p_segments IS NULL OR array_length(p_segments, 1) IS NULL
      OR uc.segment = ANY(p_segments))
    -- Search filter (mirrors the funnel RPCs: name / phone / company).
    AND (p_search IS NULL OR p_search = '' OR (
      l.name    ILIKE '%' || p_search || '%'
      OR l.phone   ILIKE '%' || p_search || '%'
      OR l.company ILIKE '%' || p_search || '%'
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
$$;

COMMENT ON FUNCTION public.get_carteira_lead_ids(TEXT[], TEXT, UUID[], TEXT[], TEXT[], TEXT[], UUID) IS
  'Disparos: lead_ids da Carteira (upsell_clients ativos). p_organization_id AUTORIZA (ramo master) e ESCOPA (SCRUM-429).';

-- ── 5. get_all_funnels_lead_ids — DOIS ramos, DOIS escopos ──────────────────
-- Esquecer um dos dois ramos vaza, exatamente como no predicado de autorização
-- (ver o cabeçalho de 20270814000000).
CREATE OR REPLACE FUNCTION public.get_all_funnels_lead_ids(
  p_tag_ids                UUID[] DEFAULT NULL,
  p_qualification_tier     TEXT[] DEFAULT NULL,
  p_pre_qualification_tier TEXT[] DEFAULT NULL,
  p_origin                 TEXT[] DEFAULT NULL,
  p_organization_id        UUID   DEFAULT NULL
)
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH entry_leads AS (
    -- Ramo 1: funis system (pipeline_entries + pipelines).
    SELECT pe.lead_id
    FROM public.pipeline_entries pe
    JOIN public.pipelines p
      ON p.id = pe.pipeline_id
     AND p.type = 'system' -- metric-lint-allow: resolver de PÚBLICO de disparo, não métrica — a união inclui custom_pipe_entries explicitamente no ramo 2, então nenhum funil custom é cegado (o que a regra R3 protege). O par type+slug delimita os 3 pipes que a tela oferece.
     AND p.slug IN ('whatsapp', 'confirmacao', 'propostas')
    WHERE pe.lead_id IS NOT NULL
      -- AUTORIZAÇÃO: orgs do chamador (helper) OU a org pedida quando master.
      AND (
        pe.organization_id IN (SELECT public.get_my_organization_ids())
        OR (p_organization_id IS NOT NULL
            AND public.is_master_user()
            AND pe.organization_id = p_organization_id)
      )
      -- ESCOPO (SCRUM-429) — ramo 1.
      AND (p_organization_id IS NULL OR pe.organization_id = p_organization_id)

    UNION

    -- Ramo 2: funis custom (custom_pipe_entries). Sem join em pipelines — a
    -- entrada custom já carrega organization_id e pipeline_id próprios.
    SELECT ce.lead_id
    FROM public.custom_pipe_entries ce
    WHERE ce.lead_id IS NOT NULL
      -- AUTORIZAÇÃO: orgs do chamador (helper) OU a org pedida quando master.
      AND (
        ce.organization_id IN (SELECT public.get_my_organization_ids())
        OR (p_organization_id IS NOT NULL
            AND public.is_master_user()
            AND ce.organization_id = p_organization_id)
      )
      -- ESCOPO (SCRUM-429) — ramo 2. Precisa existir nos DOIS.
      AND (p_organization_id IS NULL OR ce.organization_id = p_organization_id)
  )
  SELECT el.lead_id
  FROM entry_leads el
  JOIN public.leads l
    ON l.id = el.lead_id
   AND l.deleted_at IS NULL
  WHERE
    -- Tag filter (intersection: lead must have ALL specified tags).
    (p_tag_ids IS NULL OR array_length(p_tag_ids, 1) IS NULL OR NOT EXISTS (
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
$$;

COMMENT ON FUNCTION public.get_all_funnels_lead_ids(UUID[], TEXT[], TEXT[], TEXT[], UUID) IS
  'Disparos: união DEDUPLICADA (UNION) dos leads com membership em qualquer funil — 3 pipes system (whatsapp/confirmacao/propostas) + todos os custom — recortada pelas condições do wizard. Tenancy e ESCOPO (SCRUM-429) replicados nos DOIS ramos da união. Não inclui lead sem funil (não é "base inteira").';
