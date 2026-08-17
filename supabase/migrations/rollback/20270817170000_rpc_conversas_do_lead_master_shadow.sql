-- Rollback de 20270817170000_rpc_conversas_do_lead_master_shadow.sql
--
-- ⚠️ Voltar atrás CEGA O MASTER: sem a cláusula `is_master_user()`, o gate nega
-- a org que ele está olhando em shadow (ele não é team_member dela), e o seletor
-- volta a dizer "Nenhum número de WhatsApp disponível nesta organização" numa
-- org que tem caixas.
--
-- Rodar só se houver motivo forte; e nesse caso a UI do master fica sem seletor.

CREATE OR REPLACE FUNCTION public.get_conversas_do_lead(
  p_phone text, p_organization_id uuid
)
RETURNS TABLE (
  instance_id uuid, instance_name text, instance_status text,
  last_message_at timestamptz, last_message_content text, last_message_direction text
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
BEGIN
  IF p_organization_id IS NULL
     OR p_organization_id NOT IN (SELECT get_my_organization_ids()) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT i.id, i.instance_name, i.status, u."timestamp", u.content, u.direction
  FROM whatsapp_instances i
  LEFT JOIN LATERAL (
    SELECT m.content, m."timestamp", m.direction
    FROM whatsapp_messages m
    WHERE m.organization_id = i.organization_id
      AND m.instance_id = i.id
      AND m.normalized_phone = normalize_brazilian_phone(p_phone)
      AND m.deleted_at IS NULL
    ORDER BY m."timestamp" DESC LIMIT 1
  ) u ON true
  WHERE i.organization_id = p_organization_id AND i.status <> 'error'
  ORDER BY u."timestamp" DESC NULLS LAST, i.instance_name;
END;
$$;
