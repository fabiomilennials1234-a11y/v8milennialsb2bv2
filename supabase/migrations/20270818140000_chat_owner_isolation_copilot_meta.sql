-- ============================================================================
-- O gate de isolamento alcanca Copilot e Meta (PRD #1629, fatia #1634)
--
-- O chat vaza por QUATRO portas, nao uma. Fechar so whatsapp_messages deixa o
-- vendedor lendo a conversa do colega pelo painel do agente IA numa tarde.
--
-- Estado antes, medido em producao 2026-08-17:
--   conversations          2.759 linhas -- policies permissivas em OR; a
--                          restritiva depende de assigned_to, preenchida em
--                          0 de 2.759
--   conversation_messages 20.753 linhas -- herda de conversations; e o
--                          historico do agente IA com o lead, mesmo conteudo
--                          do chat
--   channel_messages      10.992 linhas -- policy unica org-wide
--                          (organization_id IN get_my_organization_ids())
--
-- Mesma regra, mesmo predicado. Muda so a chave de entrada: aqui a conversa
-- aponta para o lead por lead_id, entao nao precisa passar por telefone.
--
-- NO-OP com a politica desligada, como no inbox.
-- ============================================================================

-- ============================================================
-- 1) O nucleo do predicado, com as duas chaves de entrada
-- ============================================================
-- can_see_chat(org, phone) da fatia #1633 passa a ser um invólucro fino sobre
-- este nucleo, para que a regra viva num lugar so. Um predicado que diverge
-- entre tabelas e um predicado que vai divergir.
CREATE OR REPLACE FUNCTION public.can_see_chat_scope(
  p_org_id           uuid,
  p_lead_id          uuid,
  p_normalized_phone text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_member_id uuid;
  v_restricted     boolean;
BEGIN
  IF public.is_master_user() THEN RETURN true; END IF;
  IF p_org_id IS NULL THEN RETURN false; END IF;

  SELECT id INTO v_team_member_id
  FROM public.team_members
  WHERE user_id = auth.uid()
    AND organization_id = p_org_id
    AND is_active = true
  LIMIT 1;

  IF v_team_member_id IS NULL THEN RETURN false; END IF;

  IF public.is_user_admin() THEN RETURN true; END IF;

  SELECT chat_restrict_to_owner INTO v_restricted
  FROM public.organizations WHERE id = p_org_id;

  -- Politica desligada: comportamento identico ao de antes.
  IF COALESCE(v_restricted, false) = false THEN RETURN true; END IF;

  -- Excecao nominal: com a politica ligada o default_value do catalogo GLOBAL
  -- deixa de valer, so override EXPLICITO abre.
  IF EXISTS (
    SELECT 1 FROM public.member_feature_permissions
    WHERE team_member_id = v_team_member_id
      AND feature_key = 'leads.view_all'
      AND enabled
  ) THEN
    RETURN true;
  END IF;

  IF p_lead_id IS NULL AND p_normalized_phone IS NULL THEN RETURN false; END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.leads l
    WHERE l.organization_id = p_org_id
      AND l.deleted_at IS NULL
      AND (
        (p_lead_id IS NOT NULL AND l.id = p_lead_id)
        OR (p_lead_id IS NULL AND l.normalized_phone = p_normalized_phone)
      )
      AND (
        COALESCE(
          v_team_member_id IN (
            l.pre_sale_responsible_id,
            l.sale_responsible_id,
            l.sdr_id,
            l.closer_id
          ), false)
        OR (
          COALESCE(
            l.pre_sale_responsible_id,
            l.sale_responsible_id,
            l.sdr_id,
            l.closer_id
          ) IS NULL
          AND EXISTS (
            SELECT 1 FROM public.member_feature_permissions
            WHERE team_member_id = v_team_member_id
              AND feature_key = 'leads.view_unassigned'
              AND enabled
          )
        )
      )
  );
END;
$$;

COMMENT ON FUNCTION public.can_see_chat_scope(uuid, uuid, text) IS
  'Nucleo do isolamento de chat. Resolve o dono pelo lead_id quando ha um, senao pelo normalized_phone. can_see_chat() e can_see_chat_lead() sao invólucros finos sobre ele.';

REVOKE ALL ON FUNCTION public.can_see_chat_scope(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_chat_scope(uuid, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_see_chat(p_org_id uuid, p_normalized_phone text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_see_chat_scope(p_org_id, NULL, p_normalized_phone)
$$;

-- CREATE OR REPLACE reseta grants para PUBLIC. Reaplicar sempre.
REVOKE ALL ON FUNCTION public.can_see_chat(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_chat(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_see_chat_lead(p_org_id uuid, p_lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_see_chat_scope(p_org_id, p_lead_id, NULL)
$$;

REVOKE ALL ON FUNCTION public.can_see_chat_lead(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_chat_lead(uuid, uuid) TO authenticated, service_role;

-- conversation_messages so conhece a conversa. Resolver org e lead aqui dentro,
-- e nao na expressao da policy: subquery direta em `conversations` dentro de uma
-- policy faz o Postgres avaliar a RLS de conversations, o que reabre a recursao.
CREATE OR REPLACE FUNCTION public.can_see_conversation(p_conversation_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org  uuid;
  v_lead uuid;
BEGIN
  IF p_conversation_id IS NULL THEN RETURN false; END IF;

  SELECT organization_id, lead_id INTO v_org, v_lead
  FROM public.conversations WHERE id = p_conversation_id;

  IF NOT FOUND THEN RETURN false; END IF;

  RETURN public.can_see_chat_scope(v_org, v_lead, NULL);
END;
$$;

COMMENT ON FUNCTION public.can_see_conversation(uuid) IS
  'Aplica o isolamento de chat a uma conversa do Copilot pelo id. Resolve org e lead por dentro para nao referenciar conversations na expressao da policy (recursao de RLS).';

REVOKE ALL ON FUNCTION public.can_see_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_conversation(uuid) TO authenticated, service_role;

-- ============================================================
-- 2) conversations (Copilot)
-- ============================================================
DROP POLICY IF EXISTS "conversations_select_org"             ON public.conversations;
DROP POLICY IF EXISTS "conversations_select_by_responsibility" ON public.conversations;

CREATE POLICY "conversations_select_by_owner"
  ON public.conversations FOR SELECT
  USING (
    organization_id IN (SELECT public.get_my_organization_ids())
    AND public.can_see_chat_lead(organization_id, lead_id)
  );

DROP POLICY IF EXISTS "conversations_update_by_responsibility" ON public.conversations;

CREATE POLICY "conversations_update_by_owner"
  ON public.conversations FOR UPDATE
  USING (
    organization_id IN (SELECT public.get_my_organization_ids())
    AND public.can_see_chat_lead(organization_id, lead_id)
  )
  WITH CHECK (
    organization_id IN (SELECT public.get_my_organization_ids())
    AND public.can_see_chat_lead(organization_id, lead_id)
  );

-- ============================================================
-- 3) conversation_messages
-- ============================================================
DROP POLICY IF EXISTS "conv_messages_select_org"                    ON public.conversation_messages;
DROP POLICY IF EXISTS "conversation_messages_select_by_conversation" ON public.conversation_messages;

CREATE POLICY "conversation_messages_select_by_owner"
  ON public.conversation_messages FOR SELECT
  USING (public.can_see_conversation(conversation_id));

-- ============================================================
-- 4) channel_messages (Meta / Instagram)
-- ============================================================
-- channel_messages nao tem coluna normalizada; quando nao ha lead_id, o
-- telefone bruto passa por normalize_brazilian_phone, que devolve o mesmo
-- formato de leads.normalized_phone.
DROP POLICY IF EXISTS "channel_messages_org_access" ON public.channel_messages;

CREATE POLICY "channel_messages_select_by_owner"
  ON public.channel_messages FOR SELECT
  USING (
    organization_id IN (SELECT public.get_my_organization_ids())
    AND public.can_see_chat_scope(
      organization_id,
      lead_id,
      public.normalize_brazilian_phone(phone_number)
    )
  );
