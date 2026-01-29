-- Migration: user_creation_key e pending_org_invites
-- Descrição: Chave por organização para validar criação de usuários (evita JWT inválido);
--            Tabela de emails pré-cadastrados para vincular usuário à org no signup da página inicial.
-- Data: 2026-02-03

-- ============================================
-- 1. user_creation_key em organizations
-- ============================================
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS user_creation_key UUID UNIQUE DEFAULT gen_random_uuid();

-- Garantir que organizações existentes tenham chave
UPDATE public.organizations
SET user_creation_key = gen_random_uuid()
WHERE user_creation_key IS NULL;

-- Índice para lookup por chave (usado pela Edge Function)
CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_user_creation_key
  ON public.organizations(user_creation_key)
  WHERE user_creation_key IS NOT NULL;

-- ============================================
-- 2. Tabela pending_org_invites (pré-cadastro de email)
-- ============================================
CREATE TABLE IF NOT EXISTS public.pending_org_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'sdr', 'closer', 'member')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(email)
);

CREATE INDEX IF NOT EXISTS idx_pending_org_invites_email ON public.pending_org_invites(email);
CREATE INDEX IF NOT EXISTS idx_pending_org_invites_org ON public.pending_org_invites(organization_id);

COMMENT ON TABLE public.pending_org_invites IS 'Emails pré-cadastrados por admin; ao se cadastrar na página inicial com esse email, o usuário entra na organização.';

ALTER TABLE public.pending_org_invites ENABLE ROW LEVEL SECURITY;

-- Apenas membros da org (admins) podem ver/inserir; service_role para Edge Functions
CREATE POLICY "pending_org_invites_select_own_org"
  ON public.pending_org_invites FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members
      WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "pending_org_invites_insert_admin"
  ON public.pending_org_invites FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT tm.organization_id FROM public.team_members tm
      JOIN public.user_roles ur ON ur.user_id = tm.user_id
      WHERE tm.user_id = auth.uid() AND ur.role = 'admin'
    )
  );

CREATE POLICY "pending_org_invites_delete_admin"
  ON public.pending_org_invites FOR DELETE
  USING (
    organization_id IN (
      SELECT tm.organization_id FROM public.team_members tm
      JOIN public.user_roles ur ON ur.user_id = tm.user_id
      WHERE tm.user_id = auth.uid() AND ur.role = 'admin'
    )
  );

-- Service role precisa ler e deletar (Edge Function attach-to-org-by-pending-invite)
CREATE POLICY "pending_org_invites_service_role"
  ON public.pending_org_invites FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
