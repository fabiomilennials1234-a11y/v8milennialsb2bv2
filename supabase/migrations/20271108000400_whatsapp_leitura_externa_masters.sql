-- Chamado 6ebb4b73-0e8e-4b63-ada0-b67cf2ffc8b2 — leitura externa também para masters que usam o chat da org.
--
-- 20271108000200 marca a conversa como lida para os `team_members` ativos da org. Conta
-- master não tem linha em `team_members`: quem opera a org como master (suporte, e quem
-- abriu o Chamado) continuava vendo 267 de 270 conversas respondidas fora do Torque como
-- não lidas, porque a não-lida é POR USUÁRIO (`conversation_read_state` do auth.uid()).
--
-- Decisão de produto (CTO, 2026-10-08, opção A): além da equipe, recebem a marca os
-- masters ATIVOS que já usaram o chat daquela org, isto é, que já têm alguma linha em
-- `conversation_read_state` nela. Master que nunca abriu o chat da org não ganha linha:
-- 6 masters × 100+ orgs seria escrita sem leitor.
--
-- O que NÃO muda: só service_role; escopo org+instância dentro da função; marca d'água
-- = timestamp da mensagem lida; last_read_at só avança; marked_unread intacto; só
-- incoming 1:1. Só o conjunto de destinatários cresce (UNION: quem é membro E master
-- continua com uma linha só).
--
-- Custo: a leitura é um EXISTS por master ativo (~6) sobre a PK
-- (organization_id, user_id, conversation_key). Nenhuma RPC quente de lista/contagem muda.
--
-- Deploy: só esta migration. A edge `whatsapp-webhook` já chama a RPC; não precisa de deploy.

CREATE OR REPLACE FUNCTION public.apply_external_conversation_read(
  p_org uuid,
  p_instance uuid,
  p_message_ids text[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rows integer := 0;
BEGIN
  IF p_org IS NULL OR p_instance IS NULL OR coalesce(cardinality(p_message_ids), 0) = 0 THEN
    RETURN 0;
  END IF;

  WITH marks AS (
    SELECT m.normalized_phone, max(m."timestamp") AS read_up_to
    FROM public.whatsapp_messages m
    WHERE m.organization_id = p_org
      AND m.instance_id = p_instance
      AND m.message_id = ANY (p_message_ids)
      AND m.direction = 'incoming'
      AND m.is_group = false
      AND m.deleted_at IS NULL
      AND m.normalized_phone IS NOT NULL
      AND m.normalized_phone <> ''
    GROUP BY m.normalized_phone
  ),
  readers AS (
    SELECT tm.user_id
    FROM public.team_members tm
    WHERE tm.organization_id = p_org
      AND tm.is_active
      AND tm.user_id IS NOT NULL
    UNION
    SELECT mu.user_id
    FROM public.master_users mu
    WHERE mu.is_active
      AND mu.user_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.conversation_read_state used
        WHERE used.organization_id = p_org
          AND used.user_id = mu.user_id
      )
  )
  INSERT INTO public.conversation_read_state AS s
    (organization_id, user_id, conversation_key, last_read_at, updated_at)
  SELECT p_org,
         readers.user_id,
         'whatsapp:' || p_instance::text || ':' || marks.normalized_phone,
         marks.read_up_to,
         now()
  FROM marks
  CROSS JOIN readers
  -- Ordem estável de lock: dois recibos concorrentes não se cruzam em deadlock.
  ORDER BY readers.user_id, marks.normalized_phone
  ON CONFLICT (organization_id, user_id, conversation_key)
  DO UPDATE SET last_read_at = EXCLUDED.last_read_at,
                updated_at   = now()
  WHERE s.last_read_at < EXCLUDED.last_read_at;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

COMMENT ON FUNCTION public.apply_external_conversation_read(uuid, uuid, text[]) IS
  'Chamado 6ebb4b73: leitura no WhatsApp (ReadReceipt IsFromMe=true) marca a conversa 1:1 como lida até a mensagem lida para a equipe ativa da org e para masters ativos que já usaram o chat dela. Só service_role; escopo por org+instância dentro da função; nunca recua last_read_at nem toca marked_unread.';

-- CREATE OR REPLACE preserva a ACL, mas repetir é barato e blinda contra GRANT TO PUBLIC.
REVOKE ALL ON FUNCTION public.apply_external_conversation_read(uuid, uuid, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_external_conversation_read(uuid, uuid, text[]) TO service_role;
