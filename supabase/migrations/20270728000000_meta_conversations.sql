-- 20270728000000_meta_conversations.sql
--
-- Cria a tabela de conversas do inbox Meta (Messenger/Instagram).
--
-- Contexto: o módulo `chat-meta` (9 hooks, UI completa, página AtendimentoMeta,
-- edge fn meta-conversation-profile) consome `meta_conversations` desde
-- 2026-05-28, mas a tabela NUNCA foi criada em prod. Sintomas:
--   1. `Tables<"meta_conversations">` não resolve → 4 erros de tipo, e o TSC
--      ratchet reprova o CI de main desde 2026-07-22 (100 runs seguidos).
--   2. Em runtime toda a aba Atendimento Meta quebra com PGRST205
--      (relation does not exist).
-- Mesmo padrão do DUP-1 (find_duplicate_leads) e do password_reset_tokens:
-- feature shipada com a migration faltando.
--
-- O contrato abaixo foi DERIVADO dos consumidores existentes, não inventado:
--   useMetaConversations       → organization_id, meta_page_id, channel,
--                                archived_at, last_message_at, lead:leads(...)
--   useMetaMessages/useMetaSend→ external_user_id, channel, meta_page_id
--   meta-conversation-profile  → external_username, profile_pic_url,
--                                profile_pic_expires_at, updated_at
--   MetaConversationListItem   → last_message_preview, unread_count
--   MetaComposer/WindowWarning → last_inbound_at (janela de 24h da Meta)

CREATE TABLE public.meta_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  meta_page_id uuid NOT NULL REFERENCES public.meta_pages(id) ON DELETE CASCADE,

  -- Reusa o enum existente. O CHECK restringe aos dois canais Meta: o enum
  -- também carrega whatsapp/email/sms, que não pertencem a esta tabela.
  channel public.channel_type NOT NULL,

  -- PSID (Messenger) ou IGSID (Instagram) do interlocutor. É a chave que
  -- useMetaMessages usa pra casar com channel_messages.sender_id.
  external_user_id text NOT NULL,
  external_username text,
  profile_pic_url text,
  -- URLs de foto da Graph API expiram; a edge fn recacheia quando vence.
  profile_pic_expires_at timestamptz,

  -- Vínculo opcional com lead. ON DELETE SET NULL: apagar o lead não pode
  -- levar junto o histórico da conversa.
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,

  last_message_at timestamptz,
  last_message_preview text,
  -- Âncora da janela de 24h da Meta — só mensagem INBOUND reabre a janela.
  -- Fora dela a plataforma recusa envio livre (isWithin24hWindow no front).
  last_inbound_at timestamptz,

  unread_count integer NOT NULL DEFAULT 0,
  archived_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT meta_conversations_channel_chk
    CHECK (channel IN ('messenger'::public.channel_type, 'instagram'::public.channel_type)),
  CONSTRAINT meta_conversations_unread_chk CHECK (unread_count >= 0),

  -- Uma conversa por (página, interlocutor). É o alvo de ON CONFLICT do
  -- upsert idempotente que o webhook precisa fazer ao receber mensagem.
  CONSTRAINT meta_conversations_page_user_uniq UNIQUE (meta_page_id, external_user_id)
);

CREATE INDEX idx_meta_conversations_organization_id
  ON public.meta_conversations (organization_id);

-- Query canônica da lista: filtra org+página+canal, separa ativo/arquivado por
-- archived_at e ordena por last_message_at DESC.
CREATE INDEX idx_meta_conversations_inbox
  ON public.meta_conversations (organization_id, meta_page_id, channel, last_message_at DESC);

CREATE INDEX idx_meta_conversations_lead_id
  ON public.meta_conversations (lead_id)
  WHERE lead_id IS NOT NULL;

CREATE TRIGGER trg_meta_conversations_updated_at
  BEFORE UPDATE ON public.meta_conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── RLS ────────────────────────────────────────────────────────────────────
-- Espelha a policy canônica de `leads`. Isolamento SEMPRE via helper
-- SECURITY DEFINER: `SELECT ... FROM team_members` inline causa recursão
-- infinita quando o Realtime avalia apply_rls() — e esta tabela É assinada
-- via Realtime (useMetaRealtime), então o furo seria garantido.

ALTER TABLE public.meta_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "meta_conversations_select_own_org"
  ON public.meta_conversations FOR SELECT
  USING (
    organization_id IN (SELECT public.get_my_organization_ids())
    OR public.is_master_user(auth.uid())
  );

CREATE POLICY "meta_conversations_insert_own_org"
  ON public.meta_conversations FOR INSERT
  WITH CHECK (
    organization_id IN (SELECT public.get_my_organization_ids())
    OR public.is_master_user(auth.uid())
  );

CREATE POLICY "meta_conversations_update_own_org"
  ON public.meta_conversations FOR UPDATE
  USING (
    organization_id IN (SELECT public.get_my_organization_ids())
    OR public.is_master_user(auth.uid())
  )
  WITH CHECK (
    organization_id IN (SELECT public.get_my_organization_ids())
    OR public.is_master_user(auth.uid())
  );

CREATE POLICY "meta_conversations_delete_own_org"
  ON public.meta_conversations FOR DELETE
  USING (
    organization_id IN (SELECT public.get_my_organization_ids())
    OR public.is_master_user(auth.uid())
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meta_conversations TO authenticated;

-- ─── Realtime ───────────────────────────────────────────────────────────────
-- useMetaRealtime assina meta_conversations. Sem entrar na publicação, a
-- assinatura conecta e nunca recebe evento (falha silenciosa).
ALTER PUBLICATION supabase_realtime ADD TABLE public.meta_conversations;

-- ─── RPCs ───────────────────────────────────────────────────────────────────

-- Vincula uma conversa Meta a um lead. SECURITY INVOKER de propósito: a RLS
-- acima já barra conversa de outra org. O EXISTS impede o furo cross-tenant
-- que a RLS sozinha não pega — vincular a conversa DA MINHA org a um lead de
-- OUTRA org.
CREATE OR REPLACE FUNCTION public.link_meta_conversation_to_lead(
  p_conversation_id uuid,
  p_lead_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.meta_conversations c
     SET lead_id = p_lead_id
   WHERE c.id = p_conversation_id
     AND EXISTS (
       SELECT 1
         FROM public.leads l
        WHERE l.id = p_lead_id
          AND l.organization_id = c.organization_id
     );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'conversa ou lead inexistente na sua organização'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

-- Zera o contador de não-lidas. RLS restringe o alcance à org do chamador.
CREATE OR REPLACE FUNCTION public.mark_meta_conversation_read(
  p_conversation_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.meta_conversations
     SET unread_count = 0
   WHERE id = p_conversation_id;
END;
$$;

-- `REVOKE FROM anon` seria no-op: o EXECUTE chega via GRANT TO PUBLIC herdado
-- de ALTER DEFAULT PRIVILEGES. Tem que revogar de PUBLIC.
REVOKE ALL ON FUNCTION public.link_meta_conversation_to_lead(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_meta_conversation_read(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.link_meta_conversation_to_lead(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_meta_conversation_read(uuid) TO authenticated;

COMMENT ON TABLE public.meta_conversations IS
  'Conversas do inbox Meta (Messenger/Instagram). Uma linha por (página, interlocutor). '
  'Mensagens ficam em channel_messages, casadas por (page_id, sender_id, channel).';
COMMENT ON COLUMN public.meta_conversations.last_inbound_at IS
  'Última mensagem INBOUND. Âncora da janela de 24h da Meta — fora dela a plataforma recusa envio livre.';
