-- 20261119000016_seed_conversation_read_state.sql
--
-- V3 Fase 2 (badge): seed do read-state a partir do last-seen do localStorage.
-- Sem isto, flipar o badge p/ server-side com conversation_read_state vazio faria
-- o badge "explodir" (toda conversa com incoming recente vira não-lida).
--
-- O localStorage guarda last-seen por TELEFONE (não por instância). Esta RPC
-- recebe [{phone, t(epoch ms)}], mapeia cada telefone p/ as (org, instance) reais
-- via whatsapp_conversation_summary (nas orgs do caller) e faz upsert do read_state
-- com a key correta whatsapp:<instance>:<phone>. Idempotente (greatest no conflito).

CREATE OR REPLACE FUNCTION public.seed_conversation_read_state(p_entries jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_count integer := 0;
BEGIN
  IF v_uid IS NULL OR p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array' THEN
    RETURN 0;
  END IF;

  INSERT INTO conversation_read_state (organization_id, user_id, conversation_key, last_read_at, updated_at)
  SELECT s.organization_id,
         v_uid,
         'whatsapp:' || s.instance_id::text || ':' || s.normalized_phone,
         to_timestamp(((e->>'t')::numeric) / 1000.0),
         now()
  FROM jsonb_array_elements(p_entries) e
  JOIN whatsapp_conversation_summary s
    ON s.normalized_phone = (e->>'phone')
   AND s.organization_id IN (SELECT get_my_organization_ids())
  WHERE (e->>'t') ~ '^[0-9]+$'
  ON CONFLICT (organization_id, user_id, conversation_key)
  DO UPDATE SET
    last_read_at = greatest(conversation_read_state.last_read_at, EXCLUDED.last_read_at),
    updated_at   = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.seed_conversation_read_state(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.seed_conversation_read_state(jsonb) TO authenticated;
