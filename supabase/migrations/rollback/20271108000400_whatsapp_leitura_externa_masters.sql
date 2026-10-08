-- Rollback of 20271108000400_whatsapp_leitura_externa_masters.sql (Chamado 6ebb4b73).
-- Restores the 20271108000200 body: only active team_members are written, masters are not.
-- Rows already written for masters are NOT removed (they only hold last_read_at marks).
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
  ORDER BY team.user_id, marks.normalized_phone
  ON CONFLICT (organization_id, user_id, conversation_key)
  DO UPDATE SET last_read_at = EXCLUDED.last_read_at,
                updated_at   = now()
  WHERE s.last_read_at < EXCLUDED.last_read_at;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_external_conversation_read(uuid, uuid, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_external_conversation_read(uuid, uuid, text[]) TO service_role;
