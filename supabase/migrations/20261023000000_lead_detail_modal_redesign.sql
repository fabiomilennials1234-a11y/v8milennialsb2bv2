-- ============================================================================
-- Lead Detail Modal Redesign — schema support
--
-- 1. leads.avatar_url            → URL da foto do lead (populada por automação)
-- 2. leads.pre_qualification_tier→ Diamante/Ouro/Prata/Bronze/Desqualificado
-- 3. leads.qualification_tier    → idem (separação Pré-Venda × Venda)
-- 4. Backfill qualification_tier a partir de rating (legado mantido)
-- 5. lead_comments               → tabela nova de comentários (soft-delete)
--    + RLS via helpers SECURITY DEFINER (gotcha do CLAUDE.md raiz)
--
-- Idempotente. Revert preparada em arquivo paralelo se necessário.
-- ============================================================================

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. leads.avatar_url
-- ──────────────────────────────────────────────────────────────────────────
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS avatar_url text;

COMMENT ON COLUMN public.leads.avatar_url IS
  'URL da foto do lead. Populada por automações (Meta Ads, scraping, etc). Sem UI de upload manual em v1.';


-- ──────────────────────────────────────────────────────────────────────────
-- 2. leads.pre_qualification_tier + qualification_tier
-- ──────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'qualification_tier') THEN
    CREATE TYPE public.qualification_tier AS ENUM (
      'diamante', 'ouro', 'prata', 'bronze', 'desqualificado'
    );
  END IF;
END$$;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS pre_qualification_tier public.qualification_tier,
  ADD COLUMN IF NOT EXISTS qualification_tier     public.qualification_tier;

CREATE INDEX IF NOT EXISTS idx_leads_pre_qualification_tier
  ON public.leads(pre_qualification_tier);
CREATE INDEX IF NOT EXISTS idx_leads_qualification_tier
  ON public.leads(qualification_tier);

COMMENT ON COLUMN public.leads.pre_qualification_tier IS
  'Pré-Qualificação (etapa SDR). Diamante>Ouro>Prata>Bronze>Desqualificado. Manual.';
COMMENT ON COLUMN public.leads.qualification_tier IS
  'Qualificação (etapa Vendas). Mesma escala. Manual.';

-- Backfill: qualification_tier a partir de rating legado (1-10)
-- Diamante: 9-10 | Ouro: 7-8 | Prata: 4-6 | Bronze: 1-3 | <1: deixa NULL
UPDATE public.leads
SET qualification_tier = CASE
  WHEN rating >= 9 THEN 'diamante'::public.qualification_tier
  WHEN rating >= 7 THEN 'ouro'::public.qualification_tier
  WHEN rating >= 4 THEN 'prata'::public.qualification_tier
  WHEN rating >= 1 THEN 'bronze'::public.qualification_tier
  ELSE NULL
END
WHERE qualification_tier IS NULL AND rating IS NOT NULL;


-- ──────────────────────────────────────────────────────────────────────────
-- 3. lead_comments
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lead_comments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id               uuid NOT NULL REFERENCES public.leads(id)         ON DELETE CASCADE,
  author_user_id        uuid          REFERENCES auth.users(id)           ON DELETE SET NULL,
  author_team_member_id uuid          REFERENCES public.team_members(id)  ON DELETE SET NULL,
  body                  text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz,
  deleted_at            timestamptz,
  deleted_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_lead_comments_lead_id     ON public.lead_comments(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_comments_org_id      ON public.lead_comments(organization_id);
CREATE INDEX IF NOT EXISTS idx_lead_comments_created_at  ON public.lead_comments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_comments_active
  ON public.lead_comments(lead_id, created_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE public.lead_comments ENABLE ROW LEVEL SECURITY;

-- ── Policies ─────────────────────────────────────────────────────────────
-- Use helpers SECURITY DEFINER pra evitar recursão RLS (CLAUDE.md gotcha)
DROP POLICY IF EXISTS "lead_comments_select_by_org"           ON public.lead_comments;
DROP POLICY IF EXISTS "lead_comments_insert_by_org"           ON public.lead_comments;
DROP POLICY IF EXISTS "lead_comments_update_by_author_or_admin" ON public.lead_comments;

CREATE POLICY "lead_comments_select_by_org"
  ON public.lead_comments FOR SELECT
  USING (organization_id = public.get_user_organization_id());

CREATE POLICY "lead_comments_insert_by_org"
  ON public.lead_comments FOR INSERT
  WITH CHECK (
    organization_id = public.get_user_organization_id()
    AND author_user_id = auth.uid()
  );

-- UPDATE: autor edita seu próprio body OU admin marca soft-delete
CREATE POLICY "lead_comments_update_by_author_or_admin"
  ON public.lead_comments FOR UPDATE
  USING (
    organization_id = public.get_user_organization_id()
    AND (
      author_user_id = auth.uid()
      OR public.is_user_admin()
    )
  )
  WITH CHECK (
    organization_id = public.get_user_organization_id()
  );

GRANT SELECT, INSERT, UPDATE ON public.lead_comments TO authenticated;

COMMENT ON TABLE public.lead_comments IS
  'Comentários free-form em leads. Visíveis em toda a jornada do lead. Soft-delete via deleted_at. Autor edita; admin apaga qualquer.';


-- ──────────────────────────────────────────────────────────────────────────
-- 4. Trigger pra log em lead_history quando comentário é criado ou apagado
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_log_lead_comment_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.lead_history (
      lead_id, organization_id, action, description, source, metadata, created_by
    ) VALUES (
      NEW.lead_id, NEW.organization_id, 'comment_added',
      'Comentário adicionado',
      'manual',
      jsonb_build_object('comment_id', NEW.id, 'preview', left(NEW.body, 120)),
      NEW.author_user_id
    );
  ELSIF TG_OP = 'UPDATE' AND OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    INSERT INTO public.lead_history (
      lead_id, organization_id, action, description, source, metadata, created_by
    ) VALUES (
      NEW.lead_id, NEW.organization_id, 'comment_deleted',
      'Comentário apagado',
      'manual',
      jsonb_build_object('comment_id', NEW.id),
      NEW.deleted_by
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_lead_comment_event ON public.lead_comments;
CREATE TRIGGER trg_log_lead_comment_event
  AFTER INSERT OR UPDATE OF deleted_at ON public.lead_comments
  FOR EACH ROW EXECUTE FUNCTION public.fn_log_lead_comment_event();


-- ──────────────────────────────────────────────────────────────────────────
-- 5. Verificação
-- ──────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_cols int;
  v_table int;
  v_pol int;
BEGIN
  SELECT count(*) INTO v_cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'leads'
    AND column_name IN ('avatar_url', 'pre_qualification_tier', 'qualification_tier');

  SELECT count(*) INTO v_table
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'lead_comments';

  SELECT count(*) INTO v_pol
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'lead_comments';

  IF v_cols < 3 THEN RAISE EXCEPTION 'FAIL: leads missing new columns (%/3)', v_cols; END IF;
  IF v_table = 0 THEN RAISE EXCEPTION 'FAIL: lead_comments not created'; END IF;
  IF v_pol < 3 THEN RAISE EXCEPTION 'FAIL: lead_comments policies missing (%/3)', v_pol; END IF;

  RAISE NOTICE 'VALIDATION PASSED: lead_detail_modal_redesign migration complete.';
END$$;

COMMIT;
