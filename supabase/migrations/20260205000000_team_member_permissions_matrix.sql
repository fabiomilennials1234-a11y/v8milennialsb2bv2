-- Migration: Permissões por usuário (matriz recurso x ação)
-- Descrição: Tabela team_member_permissions para admin aprovar/desabilitar por usuário:
--            Criar, Ver, Editar, Excluir, Exportar para Leads, Funis, Tarefas, Produtos, etc.
-- Data: 2026-02-05

-- =====================================================
-- TABELA team_member_permissions
-- =====================================================

CREATE TABLE IF NOT EXISTS public.team_member_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_member_id UUID NOT NULL REFERENCES public.team_members(id) ON DELETE CASCADE,
  resource_key TEXT NOT NULL CHECK (resource_key IN (
    'leads',
    'contatos',
    'empresas',
    'tarefas',
    'produtos',
    'pipe_whatsapp',
    'pipe_confirmacao',
    'pipe_propostas',
    'campanhas'
  )),
  action_key TEXT NOT NULL CHECK (action_key IN ('create', 'view', 'edit', 'delete', 'export')),
  value TEXT NOT NULL DEFAULT 'denied' CHECK (value IN ('denied', 'allowed', 'if_responsible', 'team_access')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(team_member_id, resource_key, action_key)
);

COMMENT ON TABLE public.team_member_permissions IS 'Permissões por usuário (matriz): recurso x ação (criar, ver, editar, excluir, exportar). value: denied, allowed, if_responsible, team_access.';

CREATE INDEX IF NOT EXISTS idx_team_member_permissions_team_member
  ON public.team_member_permissions(team_member_id);

ALTER TABLE public.team_member_permissions ENABLE ROW LEVEL SECURITY;

-- Apenas membros da org podem ler (para admin ver a matriz); apenas admins podem alterar
CREATE POLICY "team_member_permissions_select_own_org"
  ON public.team_member_permissions FOR SELECT
  USING (
    team_member_id IN (
      SELECT id FROM public.team_members
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "team_member_permissions_insert_admin"
  ON public.team_member_permissions FOR INSERT
  WITH CHECK (
    team_member_id IN (
      SELECT tm2.id FROM public.team_members tm2
      JOIN public.team_members tm ON tm.organization_id = tm2.organization_id
      JOIN public.user_roles ur ON ur.user_id = tm.user_id
      WHERE tm.user_id = auth.uid() AND ur.role = 'admin'
    )
  );

CREATE POLICY "team_member_permissions_update_admin"
  ON public.team_member_permissions FOR UPDATE
  USING (
    team_member_id IN (
      SELECT tm2.id FROM public.team_members tm2
      JOIN public.team_members tm ON tm.organization_id = tm2.organization_id
      JOIN public.user_roles ur ON ur.user_id = tm.user_id
      WHERE tm.user_id = auth.uid() AND ur.role = 'admin'
    )
  );

CREATE POLICY "team_member_permissions_delete_admin"
  ON public.team_member_permissions FOR DELETE
  USING (
    team_member_id IN (
      SELECT tm2.id FROM public.team_members tm2
      JOIN public.team_members tm ON tm.organization_id = tm2.organization_id
      JOIN public.user_roles ur ON ur.user_id = tm.user_id
      WHERE tm.user_id = auth.uid() AND ur.role = 'admin'
    )
  );
