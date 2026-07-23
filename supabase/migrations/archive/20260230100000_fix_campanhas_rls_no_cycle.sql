-- Corrige carregamento de campanhas: remove dependência circular entre campanhas e campanha_allowed_viewers.
-- A política anterior fazia SELECT em campanha_allowed_viewers (que por sua vez referenciava campanhas), causando ciclo no RLS.
-- Volta à regra simples: todos os membros da organização veem todas as campanhas.
-- A tabela campanha_allowed_viewers continua existindo para a UI (lista de quem tem visualização); a restrição por viewers pode ser aplicada depois via função SECURITY DEFINER se necessário.

DROP POLICY IF EXISTS "campanhas_select_organization" ON public.campanhas;

CREATE POLICY "campanhas_select_organization"
  ON public.campanhas FOR SELECT
  TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );
