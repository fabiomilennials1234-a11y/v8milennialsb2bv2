-- 20261119000012_whatsapp_conversation_list_unread_rpcs.sql
--
-- V3 reform: lista de conversas + unread server-side (substituem o .limit(8000)
-- + dedup-em-JS de useWhatsAppContacts e o full-scan de incoming do badge).
--
-- Pré-requisitos (já aplicados em prod via CONCURRENTLY, fora desta migration):
--   idx_whatsapp_msgs_convlist (org, instance, normalized_phone, timestamp DESC) WHERE deleted_at IS NULL
--   idx_whatsapp_msgs_unread_cover (org, instance, timestamp DESC) INCLUDE(normalized_phone)
--       WHERE direction='incoming' AND deleted_at IS NULL AND is_group=false
--
-- Correções aplicadas (verificação adversarial do design):
--   - push_name = último push_name NÃO-NULO de incoming (não o do último registro,
--     que vira telefone cru quando a última msg é outgoing).
--   - keyset com tie-breaker (timestamp, normalized_phone) — sem ele conversa some na paginação.
--   - multi-org: org via get_my_organization_ids() (não get_user_organization_id single-org).
--   - COALESCE(last_read_at, now()-7d) — sem isso badge explode no D0 (read_state vazio).
--   - mark_conversation_read deriva org da instância (whatsapp_instances), não do user.
--
-- Todas SECURITY DEFINER (RLS bypassa) → enforçam org do caller manualmente.
-- Frontend só passa a chamar atrás de feature flag; criar a função tem impacto zero
-- em runtime até ser chamada (lock só de catálogo pg_proc).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Lista de conversas server-side
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_whatsapp_conversation_list(
  p_org      uuid,
  p_instance uuid,
  p_limit    integer     DEFAULT 50,
  p_before   timestamptz DEFAULT NULL
)
RETURNS TABLE (
  phone_number              text,
  normalized_phone          text,
  push_name                 text,
  last_message              text,
  last_message_time         timestamptz,
  last_message_direction    text,
  last_message_sent_source  text,
  lead_id                   uuid,
  is_group                  boolean,
  conversation_id           uuid,
  archived_at               timestamptz,
  unread_count              integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
BEGIN
  IF p_org IS NULL OR NOT (p_org IN (SELECT get_my_organization_ids())) THEN
    RAISE EXCEPTION 'forbidden: org not accessible' USING ERRCODE = '42501';
  END IF;
  IF p_instance IS NULL THEN
    RAISE EXCEPTION 'instance required' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  -- Fase 1: skip-scan (loose index scan) — distinct normalized_phone.
  WITH RECURSIVE phones AS (
    (
      SELECT m.normalized_phone AS np
      FROM whatsapp_messages m
      WHERE m.organization_id = p_org AND m.instance_id = p_instance
        AND m.deleted_at IS NULL AND m.normalized_phone IS NOT NULL
      ORDER BY m.normalized_phone LIMIT 1
    )
    UNION ALL
    SELECT (
      SELECT m.normalized_phone
      FROM whatsapp_messages m
      WHERE m.organization_id = p_org AND m.instance_id = p_instance
        AND m.deleted_at IS NULL AND m.normalized_phone IS NOT NULL
        AND m.normalized_phone > ph.np
      ORDER BY m.normalized_phone LIMIT 1
    )
    FROM phones ph WHERE ph.np IS NOT NULL
  ),
  -- Fase 2: última msg por phone (1 descida index+heap).
  last_msg AS (
    SELECT lm.*
    FROM phones ph
    CROSS JOIN LATERAL (
      SELECT m.phone_number, m.normalized_phone AS np, m.content, m."timestamp" AS ts,
             m.direction, m.sent_source, m.lead_id, m.is_group
      FROM whatsapp_messages m
      WHERE m.organization_id = p_org AND m.instance_id = p_instance
        AND m.normalized_phone = ph.np AND m.deleted_at IS NULL
      ORDER BY m."timestamp" DESC LIMIT 1
    ) lm
    WHERE ph.np IS NOT NULL
  ),
  conv AS (
    SELECT c.normalized_phone AS np, c.id, c.archived_at, c.deleted_at
    FROM whatsapp_conversations c
    WHERE c.organization_id = p_org AND c.instance_id = p_instance
      AND c.normalized_phone IS NOT NULL
  ),
  read_state AS (
    SELECT split_part(rs.conversation_key, ':', 3) AS np, rs.last_read_at
    FROM conversation_read_state rs
    WHERE rs.organization_id = p_org AND rs.user_id = v_uid
      AND rs.conversation_key LIKE 'whatsapp:' || p_instance::text || ':%'
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
  SELECT
    lm.phone_number,
    lm.np,
    -- push_name: último não-nulo de incoming (correção: não o do último registro)
    (
      SELECT m2.push_name FROM whatsapp_messages m2
      WHERE m2.organization_id = p_org AND m2.instance_id = p_instance
        AND m2.normalized_phone = lm.np AND m2.direction = 'incoming'
        AND m2.push_name IS NOT NULL AND m2.deleted_at IS NULL
      ORDER BY m2."timestamp" DESC LIMIT 1
    ),
    lm.content, lm.ts, lm.direction, lm.sent_source, lm.lead_id, lm.is_group,
    conv.id, conv.archived_at,
    coalesce(u.cnt, 0)
  FROM last_msg lm
  LEFT JOIN conv   ON conv.np = lm.np
  LEFT JOIN unread u ON u.np  = lm.np
  WHERE conv.deleted_at IS NULL
    AND (p_before IS NULL OR lm.ts < p_before)
  ORDER BY lm.ts DESC, lm.np DESC          -- tie-breaker estável p/ keyset
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.get_whatsapp_conversation_list(uuid, uuid, integer, timestamptz) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_whatsapp_conversation_list(uuid, uuid, integer, timestamptz) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Unread por telefone (server-side, sem localStorage)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_unread_counts(p_instance_ids uuid[])
RETURNS TABLE (instance_id uuid, normalized_phone text, unread integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT m.instance_id, m.normalized_phone, count(*)::int AS unread
  FROM public.whatsapp_messages m
  LEFT JOIN public.conversation_read_state rs
    ON  rs.organization_id = m.organization_id
    AND rs.user_id         = auth.uid()
    AND rs.conversation_key = 'whatsapp:' || m.instance_id::text || ':' || m.normalized_phone
  WHERE m.organization_id IN (SELECT get_my_organization_ids())     -- multi-org safe
    AND m.instance_id = ANY (p_instance_ids)
    AND m.direction = 'incoming' AND m.deleted_at IS NULL AND m.is_group = false
    AND m."timestamp" > now() - interval '30 days'
    AND m."timestamp" > COALESCE(rs.last_read_at, now() - interval '7 days')
  GROUP BY m.instance_id, m.normalized_phone;
$$;

REVOKE ALL ON FUNCTION public.get_unread_counts(uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_unread_counts(uuid[]) TO authenticated;

-- 2b) Total (badge global) — inlined count, payload mínimo.
CREATE OR REPLACE FUNCTION public.get_unread_total(p_instance_ids uuid[])
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT count(*)::int
  FROM public.whatsapp_messages m
  LEFT JOIN public.conversation_read_state rs
    ON  rs.organization_id = m.organization_id
    AND rs.user_id         = auth.uid()
    AND rs.conversation_key = 'whatsapp:' || m.instance_id::text || ':' || m.normalized_phone
  WHERE m.organization_id IN (SELECT get_my_organization_ids())
    AND m.instance_id = ANY (p_instance_ids)
    AND m.direction = 'incoming' AND m.deleted_at IS NULL AND m.is_group = false
    AND m."timestamp" > now() - interval '30 days'
    AND m."timestamp" > COALESCE(rs.last_read_at, now() - interval '7 days');
$$;

REVOKE ALL ON FUNCTION public.get_unread_total(uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_unread_total(uuid[]) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Marcar conversa como lida (read-state por usuário, server-side)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_conversation_read(
  p_instance_id      uuid,
  p_normalized_phone text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_key text := 'whatsapp:' || p_instance_id::text || ':' || p_normalized_phone;
BEGIN
  -- org derivada da instância (correção multi-org): garante match no read-state join.
  SELECT organization_id INTO v_org FROM whatsapp_instances WHERE id = p_instance_id;
  IF v_org IS NULL OR NOT (v_org IN (SELECT get_my_organization_ids())) THEN
    RAISE EXCEPTION 'forbidden: instance not accessible' USING ERRCODE = '42501';
  END IF;

  INSERT INTO conversation_read_state
    (organization_id, user_id, conversation_key, last_read_at, updated_at)
  VALUES (v_org, auth.uid(), v_key, now(), now())
  ON CONFLICT (organization_id, user_id, conversation_key)
  DO UPDATE SET last_read_at = now(), updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.mark_conversation_read(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(uuid, text) TO authenticated;
