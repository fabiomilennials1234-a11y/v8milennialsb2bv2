-- ============================================
-- MODULO OUTBOUND - Tipo de Organizacao
-- ============================================
-- Data: 2026-02-21
-- Descricao: Adiciona suporte a organizacoes do tipo OUTBOUND (agencias de prospeccao).
--            Cria enum org_type, estende app_role, tabelas de sidebar permissions e badges.
-- Referencia: docs/design-outbound-org-type.md
-- IMPACTO: Apenas cria objetos NOVOS + ADD COLUMN com default em organizations.
--          Nenhuma tabela existente e alterada destrutivamente.
-- ============================================

-- ============================================
-- 1. ENUM org_type + COLUNA em organizations
-- ============================================

DO $$ BEGIN CREATE TYPE org_type AS ENUM ('crm', 'outbound'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS org_type org_type NOT NULL DEFAULT 'crm';

CREATE INDEX IF NOT EXISTS idx_organizations_org_type ON organizations(org_type);

-- ============================================
-- 2. EXTENSAO DO ENUM app_role
-- ============================================
-- Roles CRM: admin, sdr, closer (existentes)
-- Roles OUTBOUND: agency, bdr, cliente (novos)
-- Mutuamente exclusivos por org_type (validacao no frontend)

ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'agency';
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'bdr';
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'cliente';

-- ============================================
-- 3. TABELA client_sidebar_permissions
-- ============================================
-- Controla quais itens da sidebar o CLIENTE ve em orgs OUTBOUND.
-- Configurado pelo AGENCY via checkboxes.

CREATE TABLE IF NOT EXISTS client_sidebar_permissions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sidebar_key     TEXT NOT NULL,
  is_visible      BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, sidebar_key)
);

-- Sidebar keys validos:
-- marketing, chat_whatsapp, funis, follow_ups, leads, performance, copilot
-- Items fixos NAO entram nesta tabela:
--   dashboard (sempre visivel), campanhas/equipe/config/comissoes/produtos/tv (nunca visiveis)

CREATE INDEX IF NOT EXISTS idx_client_sidebar_permissions_org ON client_sidebar_permissions(organization_id);

-- ============================================
-- 4. TABELA badges
-- ============================================
-- Definicao de badges (marcos) para gamificacao do CLIENTE.
-- is_system = true: badges pre-definidos pelo sistema
-- is_system = false: badges customizados criados pelo AGENCY

CREATE TABLE IF NOT EXISTS badges (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  icon            TEXT,
  criteria_type   TEXT NOT NULL,
  criteria_value  INTEGER NOT NULL DEFAULT 1,
  is_system       BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- criteria_type valores esperados:
-- leads_quentes, vendas_count, vendas_recorrentes, faturamento_total

CREATE INDEX IF NOT EXISTS idx_badges_org ON badges(organization_id);
CREATE INDEX IF NOT EXISTS idx_badges_system ON badges(organization_id, is_system);

-- ============================================
-- 5. TABELA user_badges
-- ============================================
-- Badges desbloqueados por cada team_member (CLIENTE).

CREATE TABLE IF NOT EXISTS user_badges (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  badge_id        UUID NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  team_member_id  UUID NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  unlocked_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(badge_id, team_member_id)
);

CREATE INDEX IF NOT EXISTS idx_user_badges_member ON user_badges(team_member_id);
CREATE INDEX IF NOT EXISTS idx_user_badges_badge ON user_badges(badge_id);

-- ============================================
-- 6. ROW LEVEL SECURITY
-- ============================================

ALTER TABLE client_sidebar_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_badges ENABLE ROW LEVEL SECURITY;

-- 6.1 client_sidebar_permissions
DROP POLICY IF EXISTS "client_sidebar_permissions_select_org" ON client_sidebar_permissions;
CREATE POLICY "client_sidebar_permissions_select_org" ON client_sidebar_permissions
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_organization_id());

DROP POLICY IF EXISTS "client_sidebar_permissions_insert_org" ON client_sidebar_permissions;
CREATE POLICY "client_sidebar_permissions_insert_org" ON client_sidebar_permissions
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_organization_id());

DROP POLICY IF EXISTS "client_sidebar_permissions_update_org" ON client_sidebar_permissions;
CREATE POLICY "client_sidebar_permissions_update_org" ON client_sidebar_permissions
  FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_organization_id())
  WITH CHECK (organization_id = public.get_user_organization_id());

DROP POLICY IF EXISTS "client_sidebar_permissions_delete_org" ON client_sidebar_permissions;
CREATE POLICY "client_sidebar_permissions_delete_org" ON client_sidebar_permissions
  FOR DELETE TO authenticated
  USING (organization_id = public.get_user_organization_id());

-- 6.2 badges
DROP POLICY IF EXISTS "badges_select_org" ON badges;
CREATE POLICY "badges_select_org" ON badges
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_organization_id());

DROP POLICY IF EXISTS "badges_insert_org" ON badges;
CREATE POLICY "badges_insert_org" ON badges
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_organization_id());

DROP POLICY IF EXISTS "badges_update_org" ON badges;
CREATE POLICY "badges_update_org" ON badges
  FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_organization_id())
  WITH CHECK (organization_id = public.get_user_organization_id());

DROP POLICY IF EXISTS "badges_delete_org" ON badges;
CREATE POLICY "badges_delete_org" ON badges
  FOR DELETE TO authenticated
  USING (organization_id = public.get_user_organization_id());

-- 6.3 user_badges
DROP POLICY IF EXISTS "user_badges_select" ON user_badges;
CREATE POLICY "user_badges_select" ON user_badges
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM badges
      WHERE badges.id = user_badges.badge_id
      AND badges.organization_id = public.get_user_organization_id()
    )
  );

DROP POLICY IF EXISTS "user_badges_insert" ON user_badges;
CREATE POLICY "user_badges_insert" ON user_badges
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM badges
      WHERE badges.id = user_badges.badge_id
      AND badges.organization_id = public.get_user_organization_id()
    )
  );

DROP POLICY IF EXISTS "user_badges_update" ON user_badges;
CREATE POLICY "user_badges_update" ON user_badges
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM badges
      WHERE badges.id = user_badges.badge_id
      AND badges.organization_id = public.get_user_organization_id()
    )
  );

DROP POLICY IF EXISTS "user_badges_delete" ON user_badges;
CREATE POLICY "user_badges_delete" ON user_badges
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM badges
      WHERE badges.id = user_badges.badge_id
      AND badges.organization_id = public.get_user_organization_id()
    )
  );

-- ============================================
-- 7. REALTIME
-- ============================================

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE client_sidebar_permissions; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE badges; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE user_badges; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================
-- 8. LOG
-- ============================================

DO $$
BEGIN
  RAISE NOTICE 'Outbound org type migration completed successfully';
  RAISE NOTICE 'Column added: organizations.org_type (default crm)';
  RAISE NOTICE 'Enum extended: app_role + agency, bdr, cliente';
  RAISE NOTICE 'Tables created: client_sidebar_permissions, badges, user_badges';
  RAISE NOTICE 'RLS enabled on all new tables';
END $$;
