-- Vendedores que podem responder no chat por número (instância WhatsApp)
-- Admin define, por instância, quais vendedores podem responder naquele número.
-- Se nenhum for selecionado, todos da organização podem responder.
-- Data: 2026-02-07

CREATE TABLE IF NOT EXISTS public.whatsapp_instance_allowed_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  whatsapp_instance_id UUID NOT NULL REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  team_member_id UUID NOT NULL REFERENCES public.team_members(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(whatsapp_instance_id, team_member_id)
);

COMMENT ON TABLE public.whatsapp_instance_allowed_members IS 'Vendedores autorizados a responder no chat desta instância/número. Vazio = todos da org podem responder.';

CREATE INDEX IF NOT EXISTS idx_whatsapp_instance_allowed_members_instance
  ON public.whatsapp_instance_allowed_members(whatsapp_instance_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_instance_allowed_members_member
  ON public.whatsapp_instance_allowed_members(team_member_id);

ALTER TABLE public.whatsapp_instance_allowed_members ENABLE ROW LEVEL SECURITY;

-- Qualquer membro da org pode ler (para saber se pode responder)
CREATE POLICY "allowed_members_select_own_org"
  ON public.whatsapp_instance_allowed_members FOR SELECT
  USING (
    whatsapp_instance_id IN (
      SELECT id FROM public.whatsapp_instances
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

-- Apenas admin pode inserir/atualizar/deletar
CREATE POLICY "allowed_members_insert_admin"
  ON public.whatsapp_instance_allowed_members FOR INSERT
  WITH CHECK (
    whatsapp_instance_id IN (
      SELECT wi.id FROM public.whatsapp_instances wi
      JOIN public.team_members tm ON tm.organization_id = wi.organization_id
      JOIN public.user_roles ur ON ur.user_id = tm.user_id
      WHERE tm.user_id = auth.uid() AND ur.role = 'admin'
    )
  );

CREATE POLICY "allowed_members_update_admin"
  ON public.whatsapp_instance_allowed_members FOR UPDATE
  USING (
    whatsapp_instance_id IN (
      SELECT wi.id FROM public.whatsapp_instances wi
      JOIN public.team_members tm ON tm.organization_id = wi.organization_id
      JOIN public.user_roles ur ON ur.user_id = tm.user_id
      WHERE tm.user_id = auth.uid() AND ur.role = 'admin'
    )
  );

CREATE POLICY "allowed_members_delete_admin"
  ON public.whatsapp_instance_allowed_members FOR DELETE
  USING (
    whatsapp_instance_id IN (
      SELECT wi.id FROM public.whatsapp_instances wi
      JOIN public.team_members tm ON tm.organization_id = wi.organization_id
      JOIN public.user_roles ur ON ur.user_id = tm.user_id
      WHERE tm.user_id = auth.uid() AND ur.role = 'admin'
    )
  );
