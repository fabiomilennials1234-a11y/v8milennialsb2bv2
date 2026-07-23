-- Usuários com permissão de visualização por campanha (podem ser adicionados/removidos após criação).
-- Se uma campanha não tiver nenhum viewer em campanha_allowed_viewers, todos os membros da org podem ver.
-- Se tiver, apenas admins e os team_members listados podem ver.

CREATE TABLE IF NOT EXISTS public.campanha_allowed_viewers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id UUID NOT NULL REFERENCES public.campanhas(id) ON DELETE CASCADE,
  team_member_id UUID NOT NULL REFERENCES public.team_members(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(campanha_id, team_member_id)
);

CREATE INDEX IF NOT EXISTS idx_campanha_allowed_viewers_campanha
  ON public.campanha_allowed_viewers(campanha_id);
CREATE INDEX IF NOT EXISTS idx_campanha_allowed_viewers_team_member
  ON public.campanha_allowed_viewers(team_member_id);

COMMENT ON TABLE public.campanha_allowed_viewers IS 'Usuários (team_members) com permissão de visualização da campanha. Vazio = todos da org veem. Preenchido = só admins e listados veem.';

ALTER TABLE public.campanha_allowed_viewers ENABLE ROW LEVEL SECURITY;

-- SELECT: ver viewers da campanha se o usuário puder ver a campanha (será checado via campanhas)
DROP POLICY IF EXISTS "campanha_allowed_viewers_select" ON public.campanha_allowed_viewers;
CREATE POLICY "campanha_allowed_viewers_select"
  ON public.campanha_allowed_viewers FOR SELECT
  TO authenticated
  USING (
    campanha_id IN (
      SELECT id FROM public.campanhas
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

-- INSERT/DELETE: apenas admins da org da campanha
DROP POLICY IF EXISTS "campanha_allowed_viewers_insert" ON public.campanha_allowed_viewers;
CREATE POLICY "campanha_allowed_viewers_insert"
  ON public.campanha_allowed_viewers FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_user_admin()
    AND campanha_id IN (
      SELECT id FROM public.campanhas
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "campanha_allowed_viewers_delete" ON public.campanha_allowed_viewers;
CREATE POLICY "campanha_allowed_viewers_delete"
  ON public.campanha_allowed_viewers FOR DELETE
  TO authenticated
  USING (
    public.is_user_admin()
    AND campanha_id IN (
      SELECT id FROM public.campanhas
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

-- Atualizar política de SELECT em campanhas: ver se (org member) e (admin OU campanha sem viewers OU usuário está em allowed_viewers)
DROP POLICY IF EXISTS "campanhas_select_organization" ON public.campanhas;

CREATE POLICY "campanhas_select_organization"
  ON public.campanhas FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
    AND (
      public.is_user_admin()
      OR NOT EXISTS (
        SELECT 1 FROM public.campanha_allowed_viewers av
        WHERE av.campanha_id = campanhas.id
      )
      OR EXISTS (
        SELECT 1 FROM public.campanha_allowed_viewers av
        JOIN public.team_members tm ON tm.id = av.team_member_id AND tm.user_id = auth.uid()
        WHERE av.campanha_id = campanhas.id
      )
    )
  );
