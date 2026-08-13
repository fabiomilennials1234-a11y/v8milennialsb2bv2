-- 20270806000000_restore_whatsapp_conversation.sql
--
-- Desfazer a exclusão de conversa do chat.
-- ROLLBACK pareado: rollback/20270806000000_restore_whatsapp_conversation.sql
--
-- O PROBLEMA
-- ----------
-- `soft_delete_whatsapp_conversation` marca `deleted_at`, e
-- `get_whatsapp_conversation_list` termina com `WHERE conv.deleted_at IS NULL`.
-- Só que NADA no sistema devolve esse campo para NULL: não existe desfazer na
-- UI (o `useUnarchiveConversation` mexe em `archived_at`, outro campo) e o
-- `whatsapp-webhook` não toca em `whatsapp_conversations`. Excluir era, na
-- prática, irreversível — e escondia também as mensagens que chegassem DEPOIS,
-- porque o webhook segue gravando em `whatsapp_messages` normalmente.
--
-- Medido em prod (2026-08-06): 12 conversas nesse estado, 4 orgs, 897 mensagens
-- invisíveis. Na Chique Distribuidora eram 5 conversas / 709 mensagens — entre
-- elas a do próprio admin que abriu o chamado, com 504 mensagens recebidas
-- depois da exclusão. A única saída era um UPDATE manual pela Management API.
--
-- POR QUE UMA RPC, E NÃO UM UPDATE DIRETO DO FRONT
-- ------------------------------------------------
-- A política `whatsapp_conversations_update_archive` é permissiva por coluna:
-- ela autoriza QUALQUER membro da org a dar UPDATE em QUALQUER campo da linha,
-- inclusive `deleted_at`. Um `.update({ deleted_at: null })` no front
-- funcionaria hoje — e deixaria restaurar mais barato do que excluir, que é
-- gated por `is_user_admin()` dentro de `soft_delete_whatsapp_conversation`.
-- Portão assimétrico é buraco de permissão, então a restauração nasce com o
-- MESMO portão da exclusão, no servidor, e o front chama a RPC.
--
-- (Que a policy permita isso continua sendo uma folga real de enforcement, mas
-- fechá-la é mudança de política com blast radius próprio — ticket separado.)

CREATE OR REPLACE FUNCTION public.restore_whatsapp_conversation(
  p_conversation_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id UUID;
BEGIN
  -- Mesmo portão de `soft_delete_whatsapp_conversation`.
  IF NOT public.is_user_admin() THEN
    RAISE EXCEPTION 'Apenas administradores podem restaurar conversas';
  END IF;

  -- SECURITY DEFINER bypassa RLS: o escopo de org tem que ser explícito aqui,
  -- senão um admin de uma org restaura conversa de outra passando o uuid.
  SELECT organization_id INTO v_org_id
    FROM public.whatsapp_conversations
   WHERE id = p_conversation_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Conversa não encontrada';
  END IF;

  IF v_org_id NOT IN (SELECT public.get_my_organization_ids()) THEN
    RAISE EXCEPTION 'Conversa não encontrada';  -- mesma mensagem: não revela existência
  END IF;

  UPDATE public.whatsapp_conversations
     SET deleted_at = NULL,
         deleted_by = NULL
   WHERE id = p_conversation_id;

  RETURN p_conversation_id;
END;
$function$;

COMMENT ON FUNCTION public.restore_whatsapp_conversation(uuid) IS
  'Desfaz o soft delete de uma conversa do chat. Admin da org, espelhando soft_delete_whatsapp_conversation.';

REVOKE ALL ON FUNCTION public.restore_whatsapp_conversation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.restore_whatsapp_conversation(uuid) TO authenticated;
