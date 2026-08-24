-- ============================================================================
-- Master enxerga as chaves de API de qualquer organização.
--
-- O buraco, medido em produção: das políticas de `api_keys`, o DELETE e o UPDATE
-- já aceitavam `is_master_user()`, o INSERT também — só o SELECT não. Master com
-- vínculo inativo na organização criava a chave, podia editá-la e apagá-la, e
-- não conseguia VER nenhuma. A tela de Chaves de API aparecia vazia, e a chave
-- recém-criada sumia da lista no instante em que o diálogo fechava.
--
-- Isto é a mesma classe de defeito já catalogada em outras tabelas org-scoped:
-- o papel de master é implementado política a política, e onde alguém esquece,
-- o master vira cego naquela tabela — sem erro, sem aviso, só ausência.
--
-- POR QUE SELECT E NÃO "tudo de novo": as outras três operações já estão
-- corretas. Reescrever as quatro seria mexer no que funciona para consertar uma.
--
-- O QUE ISTO NÃO MUDA: quem não é master continua vendo apenas as chaves das
-- organizações de que participa (`get_my_organization_ids()`). Master é papel de
-- operação do produto, e já enxerga a base inteira por outras portas.
-- ============================================================================

DROP POLICY IF EXISTS "Org members can view own org api_keys" ON public.api_keys;

CREATE POLICY "Org members can view own org api_keys"
  ON public.api_keys
  FOR SELECT
  USING (
    (SELECT public.is_master_user())
    OR organization_id IN (SELECT public.get_my_organization_ids())
  );
