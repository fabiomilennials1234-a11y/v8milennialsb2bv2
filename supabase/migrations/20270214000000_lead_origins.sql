-- ============================================================================
-- Origens de lead: de ENUM global → texto + tabela lead_origins por org.
--
-- Pedido do cliente: editar a origem de um lead + criar origens próprias, em
-- todas as orgs. Bloqueador real: leads.origin era um ENUM (lead_origin), que
-- só aceita valores pré-definidos no tipo — logo, criar origem = ALTER TYPE
-- (global, via migration), nunca self-service por org.
--
-- Solução (aprovada):
--   1. Remover esboço órfão global de lead_origins (só existia no DEV).
--   2. Converter leads.origin de enum → text (recriando a view leads_compat).
--      Default deixa de ser 'outro' e passa a NULL — ataca a poluição de
--      métricas (15k+ leads "outro" vinham de default + import forçado).
--   3. Criar lead_origins por org (vocabulário gerenciável) + seed + backfill.
--
-- Auditoria (PROD): nenhuma função faz cast ::lead_origin; única view dependente
-- é leads_compat (security_invoker, sem triggers/rules/dependentes). Enum
-- lead_origin fica órfão (não dropado — inofensivo).
--
-- Idempotente. Transacional.
-- ============================================================================

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────
-- 0. Remover esboço órfão anterior (catálogo GLOBAL, organization_id NULL, sem
--    is_active, não referenciado por código nem presente em PROD). Só dropa a
--    variante antiga — identificada pela ausência da coluna is_active. No-op em
--    PROD (tabela não existe) e em re-runs (após esta migration, is_active existe).
-- ──────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema='public' AND table_name='lead_origins'
     )
     AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='lead_origins' AND column_name='is_active'
     )
  THEN
    DROP TABLE public.lead_origins CASCADE;
    RAISE NOTICE 'Dropped orphan global lead_origins (pre-per-org draft).';
  END IF;
END$$;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. leads.origin: ENUM → text
--    A view leads_compat depende da coluna → drop + recreate (fiel, com
--    security_invoker=on e os mesmos grants).
-- ──────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_udt text;
BEGIN
  SELECT udt_name INTO v_udt
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='leads' AND column_name='origin';

  IF v_udt = 'lead_origin' THEN
    DROP VIEW IF EXISTS public.leads_compat;

    ALTER TABLE public.leads ALTER COLUMN origin DROP DEFAULT;
    ALTER TABLE public.leads ALTER COLUMN origin TYPE text USING origin::text;
    -- Default deixa de existir: insert sem origin → NULL (não mais 'outro').

    CREATE VIEW public.leads_compat
      WITH (security_invoker=on) AS
      SELECT l.id, l.name, l.company, l.email, l.phone,
             l.utm_campaign, l.utm_source, l.utm_medium, l.utm_content, l.utm_term,
             l.rating, l.faturamento, l.urgency, l.segment,
             l.sdr_id, l.closer_id, l.notes, l.created_at, l.updated_at,
             l.compromisso_date, l.organization_id, l.pipe_whatsapp,
             l.normalized_phone, l.ai_disabled, l.ai_disabled_at, l.ai_disabled_by,
             l.metrics_period_at, l.origin, l.is_shadow, l.qualification_score,
             l.responsible_id, l.meta_campaign_id, l.meta_adset_id, l.meta_ad_id,
             l.pre_sale_responsible_id, l.sale_responsible_id,
             l.contact_id, l.company_entity_id,
             c.job_title AS contact_job_title,
             c.linkedin_url AS contact_linkedin,
             co.domain AS company_domain,
             co.industry AS company_industry,
             co.size_range AS company_size,
             co.revenue_range AS company_revenue,
             co.website AS company_website
      FROM public.leads l
        LEFT JOIN public.contacts c ON l.contact_id = c.id
        LEFT JOIN public.companies co ON l.company_entity_id = co.id
      WHERE l.deleted_at IS NULL;

    GRANT ALL    ON public.leads_compat TO authenticated, postgres, service_role;
    GRANT SELECT ON public.leads_compat TO mcp_readonly;

    RAISE NOTICE 'leads.origin converted enum->text; leads_compat recreated.';
  END IF;
END$$;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Tabela lead_origins (por org)
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lead_origins (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  slug            text NOT NULL CHECK (length(btrim(slug)) BETWEEN 1 AND 60),
  color           text NOT NULL DEFAULT '#6B7280',
  is_active       boolean NOT NULL DEFAULT true,
  sort_order      int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz,
  UNIQUE (organization_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_lead_origins_org        ON public.lead_origins(organization_id);
CREATE INDEX IF NOT EXISTS idx_lead_origins_org_active ON public.lead_origins(organization_id, is_active);

COMMENT ON TABLE public.lead_origins IS
  'Origens de lead gerenciáveis por org. slug é o valor gravado em leads.origin (usado pelas métricas de aquisição). name é o rótulo exibido.';

-- ── RLS: read = membros da org (dropdowns), write = admin/master ────────────
ALTER TABLE public.lead_origins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lead_origins_select_by_org" ON public.lead_origins;
DROP POLICY IF EXISTS "lead_origins_insert_admin"  ON public.lead_origins;
DROP POLICY IF EXISTS "lead_origins_update_admin"  ON public.lead_origins;
DROP POLICY IF EXISTS "lead_origins_delete_admin"  ON public.lead_origins;

CREATE POLICY "lead_origins_select_by_org" ON public.lead_origins
  FOR SELECT
  USING (
    organization_id IN (SELECT public.get_my_organization_ids())
    OR (SELECT public.is_master_user())
  );

CREATE POLICY "lead_origins_insert_admin" ON public.lead_origins
  FOR INSERT
  WITH CHECK (
    (organization_id IN (SELECT public.get_my_organization_ids()) AND public.is_user_admin())
    OR (SELECT public.is_master_user())
  );

CREATE POLICY "lead_origins_update_admin" ON public.lead_origins
  FOR UPDATE
  USING (
    (organization_id IN (SELECT public.get_my_organization_ids()) AND public.is_user_admin())
    OR (SELECT public.is_master_user())
  )
  WITH CHECK (
    organization_id IN (SELECT public.get_my_organization_ids())
    OR (SELECT public.is_master_user())
  );

CREATE POLICY "lead_origins_delete_admin" ON public.lead_origins
  FOR DELETE
  USING (
    (organization_id IN (SELECT public.get_my_organization_ids()) AND public.is_user_admin())
    OR (SELECT public.is_master_user())
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_origins TO authenticated;

-- ── Seed do catálogo por org (herdado do rascunho global) ───────────────────
INSERT INTO public.lead_origins (organization_id, name, slug, color, sort_order)
SELECT o.id, d.name, d.slug, d.color, d.sort_order
FROM public.organizations o
CROSS JOIN (VALUES
  ('WhatsApp',          'whatsapp',         '#25D366',  1),
  ('Meta Ads',          'meta_ads',         '#1877F2',  2),
  ('Instagram',         'instagram',        '#E1306C',  3),
  ('Tiktok',            'tiktok',           '#010101',  4),
  ('Google Ads',        'google_ads',       '#EA4335',  5),
  ('Site',              'site',             '#6366F1',  6),
  ('Landing Page',      'landing_page',     '#0EA5E9',  7),
  ('Remarketing',       'remarketing',      '#F59E0B',  8),
  ('Indicação',         'indicacao',        '#10B981',  9),
  ('Evento',            'evento',           '#8B5CF6', 10),
  ('Prospecção Ativa',  'prospeccao_ativa', '#F97316', 11),
  ('Cal.com',           'cal',              '#292929', 12),
  ('Outro',             'outro',            '#64748B', 99)
) AS d(name, slug, color, sort_order)
ON CONFLICT (organization_id, slug) DO NOTHING;

-- ── Backfill: origins já usadas em leads mas fora do catálogo (ex. web,
--    messenger, disparo_planilha, valores livres) — pra terem rótulo/entrada.
INSERT INTO public.lead_origins (organization_id, name, slug, color, sort_order)
SELECT DISTINCT l.organization_id, btrim(l.origin), btrim(l.origin), '#6B7280', 50
FROM public.leads l
WHERE l.origin IS NOT NULL
  AND btrim(l.origin) <> ''
  AND l.organization_id IS NOT NULL
ON CONFLICT (organization_id, slug) DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Verificação
-- ──────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_udt text;
  v_table int;
  v_pol   int;
BEGIN
  SELECT udt_name INTO v_udt FROM information_schema.columns
    WHERE table_schema='public' AND table_name='leads' AND column_name='origin';
  SELECT count(*) INTO v_table FROM information_schema.tables
    WHERE table_schema='public' AND table_name='lead_origins';
  SELECT count(*) INTO v_pol FROM pg_policies
    WHERE schemaname='public' AND tablename='lead_origins';

  IF v_udt <> 'text' THEN RAISE EXCEPTION 'FAIL: leads.origin still % (esperado text)', v_udt; END IF;
  IF v_table = 0 THEN RAISE EXCEPTION 'FAIL: lead_origins not created'; END IF;
  IF v_pol < 4 THEN RAISE EXCEPTION 'FAIL: lead_origins policies missing (%/4)', v_pol; END IF;

  RAISE NOTICE 'VALIDATION PASSED: origin=text, lead_origins ready (% policies).', v_pol;
END$$;

COMMIT;
