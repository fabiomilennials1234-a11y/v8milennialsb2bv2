-- ROLLBACK pareado da 20270921000000 (SCRUM-649).
--
-- Duas metades, e a segunda é a que importa:
--
--   1. As TRÊS funções novas são derrubadas. Nenhuma função existente foi
--      tocada pela migration (decisão D2: irmãs novas, sem DROP), então aqui
--      não há corpo a restaurar — só a remoção do que nasceu.
--
--   2. As três policies de ESCRITA de `whatsapp_instance_allowed_members`
--      voltam ao corpo VIVO DE PRODUÇÃO, baixado de `pg_policy` em 2026-09-03
--      antes da mudança. Elas exigiam apenas ser team_member da org da Instance
--      mais `can_manage_whatsapp_instances()` — que hoje devolve true para todo
--      membro ativo, porque `whatsapp.manage_instances` está
--      `is_admin_only = false, default_value = true` no catálogo.
--
-- ⚠️ Reverter a metade 2 REABRE o auto-serviço: com as funções fora, a
--    allowlist volta a não decidir acesso nenhum no servidor, então o risco
--    volta a ser o de antes — mas se as funções ficarem e as policies voltarem,
--    qualquer membro se põe na lista de qualquer caixa da própria org com um
--    POST. Reverter as duas metades JUNTAS, ou nenhuma.

DROP FUNCTION IF EXISTS public.get_whatsapp_conversation_list_multi(
  uuid, uuid[], integer, timestamptz, uuid[], text[], uuid[], text[], uuid,
  boolean, text, boolean, boolean, boolean, text, boolean, uuid, text);

DROP FUNCTION IF EXISTS public.get_official_whatsapp_conversation_list_multi(
  uuid, uuid[], integer, timestamptz, uuid, text);

DROP FUNCTION IF EXISTS public.whatsapp_readable_instance_ids(uuid, uuid[]);

-- ── Policies de escrita, corpo vivo pré-migration ───────────────────────────
DROP POLICY IF EXISTS members_can_insert_allowed_members ON public.whatsapp_instance_allowed_members;
CREATE POLICY members_can_insert_allowed_members
  ON public.whatsapp_instance_allowed_members
  FOR INSERT
  WITH CHECK (
    (whatsapp_instance_id IN (
      SELECT wi.id
        FROM public.whatsapp_instances wi
        JOIN public.team_members tm ON tm.organization_id = wi.organization_id
       WHERE tm.user_id = (SELECT auth.uid())))
    AND public.can_manage_whatsapp_instances()
  );

DROP POLICY IF EXISTS members_can_update_allowed_members ON public.whatsapp_instance_allowed_members;
CREATE POLICY members_can_update_allowed_members
  ON public.whatsapp_instance_allowed_members
  FOR UPDATE
  USING (
    (whatsapp_instance_id IN (
      SELECT wi.id
        FROM public.whatsapp_instances wi
        JOIN public.team_members tm ON tm.organization_id = wi.organization_id
       WHERE tm.user_id = (SELECT auth.uid())))
    AND public.can_manage_whatsapp_instances()
  );

DROP POLICY IF EXISTS members_can_delete_allowed_members ON public.whatsapp_instance_allowed_members;
CREATE POLICY members_can_delete_allowed_members
  ON public.whatsapp_instance_allowed_members
  FOR DELETE
  USING (
    (whatsapp_instance_id IN (
      SELECT wi.id
        FROM public.whatsapp_instances wi
        JOIN public.team_members tm ON tm.organization_id = wi.organization_id
       WHERE tm.user_id = (SELECT auth.uid())))
    AND public.can_manage_whatsapp_instances()
  );
