-- ============================================================================
-- Migration: meta_message_templates — Meta WhatsApp Cloud message TEMPLATES
-- Date: 2026-12-19
-- Branch: feat/meta-cloud/templates (Slice 6, ADR-0009)
-- ============================================================================
-- WHY: Meta blocks free-form WhatsApp messages outside the 24h customer-service
-- window. Only pre-approved TEMPLATES may be sent to (re)open a conversation.
-- This table is the org-scoped registry of templates: created locally (status
-- 'pending'), submitted to Meta's Graph API (POST /{waba_id}/message_templates),
-- then polled for approval. INERT until the `meta_cloud` feature flag is enabled.
--
-- RLS NOTE: tenant scope via SECURITY DEFINER helpers public.get_my_organization_ids()
-- (read) / public.get_my_admin_organization_ids() (write) + a public.is_master_user()
-- branch (master-ghost). auth.org_id() does NOT exist on this project.
-- 🔴 NEVER inline `SELECT ... FROM team_members` in a policy — under Realtime
-- apply_rls() that recurses infinitely (documented gotcha). The helpers are
-- SECURITY DEFINER STABLE and bypass RLS, so they are recursion-safe.
--
-- The WABA access token is NOT in this table — it lives in
-- whatsapp_instance_secrets (RLS deny-all) and is reached only by service_role
-- via the get_meta_cloud_credentials RPC (migration 20261217000000).
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS public.meta_message_templates CASCADE;
--   -- (drops table, indexes, policies, grants, and the updated_at trigger)
-- ============================================================================

-- ── 1. Table ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.meta_message_templates (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Which Meta Cloud instance (WABA) this template belongs to. Nullable: a
  -- template may be drafted before an instance binding exists.
  instance_id       uuid        REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  name              text        NOT NULL,
  language          text        NOT NULL DEFAULT 'pt_BR',
  category          text        NOT NULL
                                CHECK (category IN ('MARKETING','UTILITY','AUTHENTICATION')),
  -- Graph component array (HEADER/BODY/FOOTER/BUTTONS). Frozen at submit time.
  components        jsonb       NOT NULL DEFAULT '[]'::jsonb,
  -- The id Meta assigns to the submitted template (Graph node id). Set after a
  -- successful POST; used to poll status.
  meta_template_id  text,
  status            text        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','approved','rejected','paused','disabled')),
  rejection_reason  text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- A template is keyed by (name, language) within an org (Meta's own uniqueness).
  CONSTRAINT meta_message_templates_unique_name_lang
    UNIQUE (organization_id, name, language)
);

COMMENT ON TABLE public.meta_message_templates IS
  'Org-scoped registry of Meta WhatsApp Cloud message templates (Slice 6, '
  'ADR-0009). Created locally as pending, submitted to Graph, polled for '
  'approval. INERT until the meta_cloud feature flag is enabled. The WABA token '
  'never lives here — see whatsapp_instance_secrets + get_meta_cloud_credentials.';

-- ── 2. Indexes ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_meta_message_templates_org
  ON public.meta_message_templates (organization_id);

-- The sync poller scans templates still awaiting Meta's verdict.
CREATE INDEX IF NOT EXISTS idx_meta_message_templates_pending
  ON public.meta_message_templates (status)
  WHERE status = 'pending' AND meta_template_id IS NOT NULL;

-- ── 3. RLS ─────────────────────────────────────────────────────────────────--
ALTER TABLE public.meta_message_templates ENABLE ROW LEVEL SECURITY;

-- Tenant read: any member of the owning org sees its templates.
DROP POLICY IF EXISTS "meta_templates_select_org" ON public.meta_message_templates;
CREATE POLICY "meta_templates_select_org" ON public.meta_message_templates
  FOR SELECT
  USING (organization_id IN (SELECT public.get_my_organization_ids()));

-- Tenant write (INSERT/UPDATE/DELETE): admins of the owning org only. Both USING
-- (visibility of the existing row) and WITH CHECK (the new/updated row) are
-- pinned to the admin's orgs — prevents an admin re-homing a template to another
-- tenant (privilege escalation).
DROP POLICY IF EXISTS "meta_templates_write_admin" ON public.meta_message_templates;
CREATE POLICY "meta_templates_write_admin" ON public.meta_message_templates
  FOR ALL
  USING (organization_id IN (SELECT public.get_my_admin_organization_ids()))
  WITH CHECK (organization_id IN (SELECT public.get_my_admin_organization_ids()));

-- Master-ghost: master users are global (no team_members row in a shadowed org).
-- is_master_user() is SECURITY DEFINER STABLE — no inline team_members subquery,
-- so it does NOT trigger the Realtime apply_rls() recursion gotcha. PERMISSIVE
-- policies combine via OR, so the org-member/admin policies keep working
-- unchanged for non-master users.
DROP POLICY IF EXISTS "master_ghost_select_meta_templates" ON public.meta_message_templates;
CREATE POLICY "master_ghost_select_meta_templates" ON public.meta_message_templates
  FOR SELECT USING (public.is_master_user());

DROP POLICY IF EXISTS "master_ghost_all_meta_templates" ON public.meta_message_templates;
CREATE POLICY "master_ghost_all_meta_templates" ON public.meta_message_templates
  FOR ALL USING (public.is_master_user()) WITH CHECK (public.is_master_user());

-- ── 4. Grants ──────────────────────────────────────────────────────────────--
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meta_message_templates TO authenticated;
GRANT ALL ON public.meta_message_templates TO service_role;
-- Never expose to anon (cross-tenant leak hardening — 2026-06-01 anon-leak incident).
REVOKE ALL ON public.meta_message_templates FROM anon;

-- ── 5. updated_at trigger ────────────────────────────────────────────────────
-- Reuse the repo's shared trigger fn if present; otherwise define a local one.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at' AND pronamespace = 'public'::regnamespace
  ) THEN
    CREATE FUNCTION public.set_updated_at()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = ''
    AS $fn$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $fn$;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_meta_message_templates_updated_at ON public.meta_message_templates;
CREATE TRIGGER trg_meta_message_templates_updated_at
  BEFORE UPDATE ON public.meta_message_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
