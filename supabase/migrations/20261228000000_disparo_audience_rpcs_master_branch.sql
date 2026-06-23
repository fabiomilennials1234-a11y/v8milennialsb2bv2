-- ============================================================================
-- Disparo audience resolvers — master-ghost fix (add p_organization_id branch)
-- ============================================================================
-- BUG: o DisparoWizard mostrava "Nenhum lead neste estágio com essas condições"
-- mesmo com lead no estágio certo, quando o operador é MASTER atuando numa org
-- da qual NÃO é team_member (ex.: org de teste sem nenhum membro).
--
-- Os 4 resolvers de público do disparo gateiam tenancy SÓ por
-- get_my_organization_ids() (derivado de team_members do auth.uid()). Em prod
-- esse helper não tem branch master (drift vs. 20261033000000), então para um
-- master sem membership na org o conjunto retorna vazio -> 0 leads -> erro de
-- público vazio. O Kanban mostra o lead porque usa caminho master-aware
-- (policies master_ghost_* / RLS por organization_id), os resolvers não.
--
-- FIX (aditivo e seguro — NÃO altera comportamento de não-master):
--   * Cada RPC ganha um parâmetro OPCIONAL p_organization_id (trailing, default
--     NULL). O frontend já conhece a org corrente (useOrganization) e a passa.
--   * O predicado de tenancy passa a aceitar, ADICIONALMENTE, a org pedida
--     QUANDO o chamador é comprovadamente master:
--         organization_id IN (SELECT get_my_organization_ids())
--         OR (p_organization_id IS NOT NULL
--             AND is_master_user()
--             AND organization_id = p_organization_id)
--   * Esses RPCs não têm escopo por org (agregam pelo helper); por isso o ramo
--     master é escopado à org pedida (p_organization_id) e NÃO a "todas as orgs"
--     — master operando UMA org recebe só aquela org, nunca cross-org.
--   * Não-master que passe p_organization_id de outra org: is_master_user() é
--     false -> ramo master inerte -> só o helper vale -> nenhum acesso novo.
--     Mesma postura do resolve_org_for_rpc (20261221000000).
--
-- Mudar a assinatura cria OVERLOAD no Postgres (PostgREST não desambigua
-- candidatos que diferem só por arg defaultado). Por isso DROP da assinatura
-- antiga + CREATE da nova em cada função. Toda a lógica de filtro é preservada
-- VERBATIM; só o predicado de tenancy muda e o parâmetro é acrescentado.
--
-- SECURITY (inalterada no resto): SECURITY INVOKER + leads RLS backstop (INNER
-- join esconde cross-tenant / soft-deleted), SET search_path = ''. is_master_user
-- e get_my_organization_ids são SECURITY DEFINER e já qualificados com public.
-- ============================================================================

-- ── 1. get_stage_lead_ids ───────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_stage_lead_ids(TEXT, TEXT);

CREATE FUNCTION public.get_stage_lead_ids(
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
   AND p.type = 'system'
   AND p.slug = p_pipeline_type
  JOIN public.leads l
    ON l.id = pe.lead_id
   AND l.deleted_at IS NULL
  WHERE pe.stage_key = p_stage_key
    AND pe.lead_id IS NOT NULL
    -- Tenancy: orgs do chamador (helper) OU a org pedida quando master.
    AND (
      pe.organization_id IN (SELECT public.get_my_organization_ids())
      OR (p_organization_id IS NOT NULL
          AND public.is_master_user()
          AND pe.organization_id = p_organization_id)
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_stage_lead_ids(TEXT, TEXT, UUID) TO authenticated;

-- ── 2. get_filtered_lead_ids ────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_filtered_lead_ids(TEXT, TEXT, TEXT, UUID, UUID[], TEXT[], TEXT[], TEXT[]);

CREATE FUNCTION public.get_filtered_lead_ids(
  p_pipeline_type          TEXT,
  p_stage_key              TEXT    DEFAULT NULL,
  p_search                 TEXT    DEFAULT NULL,
  p_responsible_id         UUID    DEFAULT NULL,
  p_tag_ids                UUID[]  DEFAULT NULL,
  p_qualification_tier     TEXT[]  DEFAULT NULL,
  p_pre_qualification_tier TEXT[]  DEFAULT NULL,
  p_origin                 TEXT[]  DEFAULT NULL,
  p_organization_id        UUID    DEFAULT NULL
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
   AND p.type = 'system'
   AND p.slug = p_pipeline_type
  JOIN public.leads l
    ON l.id = pe.lead_id
   AND l.deleted_at IS NULL
  WHERE pe.lead_id IS NOT NULL
    -- Tenancy: orgs do chamador (helper) OU a org pedida quando master.
    AND (
      pe.organization_id IN (SELECT public.get_my_organization_ids())
      OR (p_organization_id IS NOT NULL
          AND public.is_master_user()
          AND pe.organization_id = p_organization_id)
    )
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

GRANT EXECUTE ON FUNCTION public.get_filtered_lead_ids(
  TEXT, TEXT, TEXT, UUID, UUID[], TEXT[], TEXT[], TEXT[], UUID
) TO authenticated;

-- ── 3. get_custom_filtered_lead_ids ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_custom_filtered_lead_ids(UUID, UUID, TEXT, UUID, UUID[], TEXT[], TEXT[], TEXT[]);

CREATE FUNCTION public.get_custom_filtered_lead_ids(
  p_pipeline_id            UUID,
  p_stage_id               UUID    DEFAULT NULL,
  p_search                 TEXT    DEFAULT NULL,
  p_responsible_id         UUID    DEFAULT NULL,
  p_tag_ids                UUID[]  DEFAULT NULL,
  p_qualification_tier     TEXT[]  DEFAULT NULL,
  p_pre_qualification_tier TEXT[]  DEFAULT NULL,
  p_origin                 TEXT[]  DEFAULT NULL,
  p_organization_id        UUID    DEFAULT NULL
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
    -- Tenancy: orgs do chamador (helper) OU a org pedida quando master.
    AND (
      ce.organization_id IN (SELECT public.get_my_organization_ids())
      OR (p_organization_id IS NOT NULL
          AND public.is_master_user()
          AND ce.organization_id = p_organization_id)
    )
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

GRANT EXECUTE ON FUNCTION public.get_custom_filtered_lead_ids(
  UUID, UUID, TEXT, UUID, UUID[], TEXT[], TEXT[], TEXT[], UUID
) TO authenticated;

-- ── 4. get_carteira_lead_ids ────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_carteira_lead_ids(TEXT[], TEXT, UUID[], TEXT[], TEXT[], TEXT[]);

CREATE FUNCTION public.get_carteira_lead_ids(
  p_segments               TEXT[]  DEFAULT NULL,
  p_search                 TEXT    DEFAULT NULL,
  p_tag_ids                UUID[]  DEFAULT NULL,
  p_qualification_tier     TEXT[]  DEFAULT NULL,
  p_pre_qualification_tier TEXT[]  DEFAULT NULL,
  p_origin                 TEXT[]  DEFAULT NULL,
  p_organization_id        UUID    DEFAULT NULL
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
    -- Tenancy: orgs do chamador (helper) OU a org pedida quando master.
    AND (
      uc.organization_id IN (SELECT public.get_my_organization_ids())
      OR (p_organization_id IS NOT NULL
          AND public.is_master_user()
          AND uc.organization_id = p_organization_id)
    )
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

GRANT EXECUTE ON FUNCTION public.get_carteira_lead_ids(
  TEXT[], TEXT, UUID[], TEXT[], TEXT[], TEXT[], UUID
) TO authenticated;
