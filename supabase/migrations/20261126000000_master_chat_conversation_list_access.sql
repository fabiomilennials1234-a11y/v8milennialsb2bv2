-- Hotfix: master (shadow) user não consegue listar conversas no chat de orgs cliente.
--
-- Causa: a V3 server-side list (RPC get_whatsapp_conversation_list, sobre
-- whatsapp_conversation_summary) gateia acesso por get_my_organization_ids(),
-- que é team_members-only. Master não é team_member de nenhuma org cliente →
-- guard dá RAISE 'forbidden' → useWhatsAppContacts engole o throw → lista vazia.
-- As tabelas-base (whatsapp_messages, conversations, whatsapp_conversations) já
-- têm policies master-ghost (is_master_user()); só a camada V3 (RPC + summary)
-- ficou cega. Afeta master em TODA org, não só a que disparou o report.
--
-- Fix: relaxar os guards das 2 RPCs do chat para também aceitar is_master_user()
-- e adicionar policy master-ghost de SELECT em whatsapp_conversation_summary
-- (consistência com as tabelas-irmãs; defense-in-depth — a RPC é SECURITY
-- DEFINER, mas a tabela deve seguir o mesmo padrão de acesso master).
--
-- SECURITY DEFINER + guard relaxado: o guard continua negando qualquer usuário
-- que não seja (a) team_member ativo da org OU (b) master ativo. Sem ampliação
-- de superfície cross-tenant para usuários comuns.

-- ─── 1. Lista de conversas (o sintoma reportado) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.get_whatsapp_conversation_list(
  p_org uuid,
  p_instance uuid,
  p_limit integer DEFAULT 50,
  p_before timestamp with time zone DEFAULT NULL::timestamp with time zone
)
 RETURNS TABLE(phone_number text, normalized_phone text, push_name text, last_message text, last_message_time timestamp with time zone, last_message_direction text, last_message_sent_source text, lead_id uuid, is_group boolean, conversation_id uuid, archived_at timestamp with time zone, unread_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 1000);
BEGIN
  -- Acesso: team_member ativo da org OU master ativo (ghost cross-org).
  IF p_org IS NULL OR (NOT (p_org IN (SELECT get_my_organization_ids())) AND NOT is_master_user()) THEN
    RAISE EXCEPTION 'forbidden: org not accessible' USING ERRCODE = '42501';
  END IF;
  IF p_instance IS NULL THEN
    RAISE EXCEPTION 'instance required' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH page AS (
    SELECT s.phone_number, s.normalized_phone, s.last_push_name, s.last_message, s.last_message_time,
           s.last_message_direction, s.last_message_sent_source, s.lead_id, s.is_group
    FROM whatsapp_conversation_summary s
    WHERE s.organization_id = p_org AND s.instance_id = p_instance
      AND (p_before IS NULL OR s.last_message_time < p_before)
    ORDER BY s.last_message_time DESC
    LIMIT v_limit
  ),
  read_state AS (
    SELECT split_part(rs.conversation_key, ':', 3) AS np, rs.last_read_at
    FROM conversation_read_state rs
    WHERE rs.organization_id = p_org AND rs.user_id = v_uid
      AND rs.conversation_key LIKE 'whatsapp:' || p_instance::text || ':%'
  ),
  conv AS (
    SELECT c.normalized_phone AS np, c.id, c.archived_at, c.deleted_at
    FROM whatsapp_conversations c
    WHERE c.organization_id = p_org AND c.instance_id = p_instance AND c.normalized_phone IS NOT NULL
  ),
  unread AS (
    SELECT m.normalized_phone AS np, count(*)::integer AS cnt
    FROM whatsapp_messages m
    LEFT JOIN read_state r ON r.np = m.normalized_phone
    WHERE m.organization_id = p_org AND m.instance_id = p_instance
      AND m.direction = 'incoming' AND m.deleted_at IS NULL AND m.is_group = false
      AND m."timestamp" > now() - interval '30 days'
      AND m."timestamp" > COALESCE(r.last_read_at, now() - interval '7 days')
    GROUP BY m.normalized_phone
  )
  SELECT p.phone_number, p.normalized_phone, p.last_push_name, p.last_message, p.last_message_time,
         p.last_message_direction, p.last_message_sent_source, p.lead_id, p.is_group,
         conv.id, conv.archived_at, coalesce(u.cnt, 0)
  FROM page p
  LEFT JOIN conv   ON conv.np = p.normalized_phone
  LEFT JOIN unread u ON u.np  = p.normalized_phone
  WHERE conv.deleted_at IS NULL
  ORDER BY p.last_message_time DESC;
END;
$function$;

-- ─── 2. Marcar conversa como lida (mesmo guard, mesmo gap) ────────────────────
CREATE OR REPLACE FUNCTION public.mark_conversation_read(
  p_instance_id uuid,
  p_normalized_phone text
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org uuid;
  v_key text := 'whatsapp:' || p_instance_id::text || ':' || p_normalized_phone;
BEGIN
  SELECT organization_id INTO v_org FROM whatsapp_instances WHERE id = p_instance_id;
  -- Acesso: team_member ativo da org OU master ativo (ghost cross-org).
  IF v_org IS NULL OR (NOT (v_org IN (SELECT get_my_organization_ids())) AND NOT is_master_user()) THEN
    RAISE EXCEPTION 'forbidden: instance not accessible' USING ERRCODE = '42501';
  END IF;

  INSERT INTO conversation_read_state
    (organization_id, user_id, conversation_key, last_read_at, updated_at)
  VALUES (v_org, auth.uid(), v_key, now(), now())
  ON CONFLICT (organization_id, user_id, conversation_key)
  DO UPDATE SET last_read_at = now(), updated_at = now();
END;
$function$;

-- ─── 3. Policy master-ghost de SELECT em whatsapp_conversation_summary ────────
-- Alinha a summary table com whatsapp_conversations / whatsapp_messages, que já
-- expõem leitura ao master. Read-only; nenhuma policy de write para master.
DROP POLICY IF EXISTS master_ghost_select_whatsapp_conversation_summary ON public.whatsapp_conversation_summary;
CREATE POLICY master_ghost_select_whatsapp_conversation_summary
  ON public.whatsapp_conversation_summary
  FOR SELECT
  USING ((SELECT is_master_user()));
