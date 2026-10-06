-- Chamado 6ebb4b73-0e8e-4b63-ada0-b67cf2ffc8b2 — "lido no WhatsApp → lido no Torque".
--
-- Quando o operador lê uma conversa 1:1 no WhatsApp Web/celular de um chip Uazapi,
-- o provedor manda um ReadReceipt do próprio número (Type=Read|Played, IsFromMe=true)
-- com os ids das mensagens recebidas que foram lidas. Até aqui o webhook descartava
-- esse recibo, e `conversation_read_state` (não-lida POR USUÁRIO) só avançava ao abrir
-- a conversa no Torque.
--
-- Decisão de produto (CTO, 2026-10-06): o WhatsApp não diz QUEM leu, então a leitura
-- vale para toda a equipe ativa da org daquele número.
--
-- Contrato:
--   * só service_role (o webhook). Nada de PUBLIC/anon/authenticated. service_role
--     tem BYPASSRLS em prod, então o escopo de tenant é feito AQUI: toda leitura e
--     escrita filtra por p_org, e as mensagens também por p_instance.
--   * marca d'água = timestamp da mensagem lida (nunca now()): incoming que chegou
--     depois da leitura continua não lida.
--   * last_read_at só avança (GREATEST): recibo atrasado/replay é no-op idempotente.
--   * NÃO toca marked_unread: "marcar como não lida" manual é preservado.
--   * só incoming, 1:1 (is_group=false), não apagada; ids sem par → 0 linhas.
--   * aditiva: nenhuma RPC quente de contagem/lista é alterada.
--
-- Deploy: aplicar ESTA migration ANTES da edge `whatsapp-webhook` que a chama.

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
  team AS (
    SELECT DISTINCT tm.user_id
    FROM public.team_members tm
    WHERE tm.organization_id = p_org
      AND tm.is_active
      AND tm.user_id IS NOT NULL
  )
  INSERT INTO public.conversation_read_state AS s
    (organization_id, user_id, conversation_key, last_read_at, updated_at)
  SELECT p_org,
         team.user_id,
         'whatsapp:' || p_instance::text || ':' || marks.normalized_phone,
         marks.read_up_to,
         now()
  FROM marks
  CROSS JOIN team
  -- Ordem estável de lock: dois recibos concorrentes não se cruzam em deadlock.
  ORDER BY team.user_id, marks.normalized_phone
  ON CONFLICT (organization_id, user_id, conversation_key)
  DO UPDATE SET last_read_at = EXCLUDED.last_read_at,
                updated_at   = now()
  WHERE s.last_read_at < EXCLUDED.last_read_at;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

COMMENT ON FUNCTION public.apply_external_conversation_read(uuid, uuid, text[]) IS
  'Chamado 6ebb4b73: leitura no WhatsApp (ReadReceipt IsFromMe=true) marca a conversa 1:1 como lida até a mensagem lida para toda a equipe ativa da org. Só service_role; escopo por org+instância dentro da função; nunca recua last_read_at nem toca marked_unread.';

-- GRANT TO PUBLIC (default de função) dá EXECUTE ao anon: REVOKE FROM PUBLIC é obrigatório.
REVOKE ALL ON FUNCTION public.apply_external_conversation_read(uuid, uuid, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_external_conversation_read(uuid, uuid, text[]) TO service_role;
