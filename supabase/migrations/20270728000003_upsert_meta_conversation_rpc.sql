-- 20270728000003_upsert_meta_conversation_rpc.sql
--
-- RPC que o meta-webhook chama pra manter meta_conversations viva.
--
-- Por que RPC e não upsert do PostgREST: o contador de não-lidas precisa de
-- incremento atômico (`unread_count + 1`), e upsert do PostgREST só sabe
-- SETar valor — read-modify-write no edge perderia mensagem em concorrência,
-- que é o caso normal do webhook (rajada de eventos da mesma conversa).
--
-- Idempotência: a Meta REENTREGA evento. O upsert de channel_messages já é
-- idempotente por (external_id, channel, organization_id), mas incremento não
-- é. Por isso `p_bump_unread` — o webhook só manda true quando a mensagem é
-- de fato nova.
--
-- Ordenação: webhook não garante ordem. Todo campo temporal só anda pra
-- FRENTE (GREATEST), e o preview só troca quando a mensagem é a mais recente.
-- Reentrega de evento antigo não pode rebobinar a conversa.
--
-- SECURITY INVOKER de propósito: o único chamador é o webhook com service_role
-- (que tem BYPASSRLS). Marcar DEFINER abriria a função pra qualquer chamador
-- mexer em contador de outra org. O grant abaixo restringe a service_role.

CREATE OR REPLACE FUNCTION public.upsert_meta_conversation(
  p_organization_id uuid,
  p_meta_page_id uuid,
  p_channel public.channel_type,
  p_external_user_id text,
  p_direction text,
  p_message_at timestamptz,
  p_preview text DEFAULT NULL,
  p_lead_id uuid DEFAULT NULL,
  p_bump_unread boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
  v_is_inbound boolean := (p_direction = 'incoming');
BEGIN
  INSERT INTO public.meta_conversations AS c (
    organization_id,
    meta_page_id,
    channel,
    external_user_id,
    last_message_at,
    last_message_preview,
    last_inbound_at,
    unread_count,
    lead_id
  )
  VALUES (
    p_organization_id,
    p_meta_page_id,
    p_channel,
    p_external_user_id,
    p_message_at,
    left(p_preview, 500),
    CASE WHEN v_is_inbound THEN p_message_at END,
    CASE WHEN v_is_inbound AND p_bump_unread THEN 1 ELSE 0 END,
    p_lead_id
  )
  ON CONFLICT (meta_page_id, external_user_id) DO UPDATE SET
    -- Só anda pra frente: reentrega fora de ordem não rebobina a conversa.
    last_message_at = GREATEST(c.last_message_at, EXCLUDED.last_message_at),
    last_inbound_at = GREATEST(c.last_inbound_at, EXCLUDED.last_inbound_at),

    -- Preview só troca se esta mensagem é a mais recente que já vimos.
    last_message_preview = CASE
      WHEN c.last_message_at IS NULL
        OR EXCLUDED.last_message_at >= c.last_message_at
      THEN EXCLUDED.last_message_preview
      ELSE c.last_message_preview
    END,

    -- Incremento atômico, e só quando o chamador garante que a mensagem é nova.
    unread_count = c.unread_count
      + CASE WHEN v_is_inbound AND p_bump_unread THEN 1 ELSE 0 END,

    -- Nunca desvincula um lead já vinculado por engano.
    lead_id = COALESCE(c.lead_id, EXCLUDED.lead_id)

    -- archived_at NÃO é tocado de propósito. Ressuscitar conversa arquivada
    -- quando chega inbound é decisão de produto, não de plumbing — se for pra
    -- fazer, é mudança explícita e testada.
  RETURNING c.id INTO v_id;

  RETURN v_id;
END;
$$;

-- Superfície mínima: só o webhook (service_role) chama.
-- Revoga de PUBLIC **e** de anon — o ALTER DEFAULT PRIVILEGES do Supabase
-- concede direto a anon/authenticated, e revoke em PUBLIC não alcança grant
-- direto. As duas metades são necessárias.
REVOKE ALL ON FUNCTION public.upsert_meta_conversation(uuid, uuid, public.channel_type, text, text, timestamptz, text, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_meta_conversation(uuid, uuid, public.channel_type, text, text, timestamptz, text, uuid, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.upsert_meta_conversation(uuid, uuid, public.channel_type, text, text, timestamptz, text, uuid, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_meta_conversation(uuid, uuid, public.channel_type, text, text, timestamptz, text, uuid, boolean) TO service_role;

COMMENT ON FUNCTION public.upsert_meta_conversation(uuid, uuid, public.channel_type, text, text, timestamptz, text, uuid, boolean) IS
  'Mantém meta_conversations a partir do meta-webhook. Campos temporais só avançam; unread_count incrementa atomicamente e só quando p_bump_unread=true (mensagem nova, não reentrega).';
