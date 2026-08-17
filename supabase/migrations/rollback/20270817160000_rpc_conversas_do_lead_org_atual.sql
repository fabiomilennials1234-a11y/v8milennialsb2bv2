-- Rollback de 20270817160000_rpc_conversas_do_lead_org_atual.sql
--
-- ⚠️ Voltar atrás REINTRODUZ o defeito: a versão de um argumento recortava por
-- todas as orgs do usuário, e em produção há conta com 14 orgs / 69 caixas.
-- O seletor volta a listar caixa de org alheia.
--
-- Só faz sentido se o front tiver sido revertido junto para a chamada de um
-- argumento — senão a UI passa a chamar uma assinatura que não existe.

DROP FUNCTION IF EXISTS public.get_conversas_do_lead(text, uuid);

CREATE OR REPLACE FUNCTION public.get_conversas_do_lead(p_phone text)
RETURNS TABLE (
  instance_id uuid, instance_name text, instance_status text,
  last_message_at timestamptz, last_message_content text, last_message_direction text
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
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
  WHERE i.organization_id IN (SELECT get_my_organization_ids())
    AND i.status <> 'error'
  ORDER BY u."timestamp" DESC NULLS LAST, i.instance_name;
$$;

REVOKE ALL ON FUNCTION public.get_conversas_do_lead(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_conversas_do_lead(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_conversas_do_lead(text) TO authenticated;
