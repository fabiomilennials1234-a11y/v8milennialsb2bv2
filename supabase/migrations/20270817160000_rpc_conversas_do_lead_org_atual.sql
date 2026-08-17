-- `get_conversas_do_lead` — recorta pela org ATUAL, não por todas as do usuário.
--
-- ── O DEFEITO (visto em produção, 2026-08-17) ────────────────────────────────
--
-- A primeira versão filtrava `organization_id IN (SELECT get_my_organization_ids())`.
-- Esse helper devolve TODAS as orgs em que o usuário é team_member ativo — e em
-- produção existe conta com **14 orgs**, o que rendia **69 caixas** no seletor.
--
-- O resto do app não trabalha assim: ele recorta por
-- `useCurrentTeamMember().organization_id`, que é UMA org e acompanha o shadow
-- do master. A RPC ignorava essa escolha e devolvia a união.
--
-- O sintoma delatava a causa: toda caixa estranha aparecia como "Sem acesso a
-- este número", porque a lista de escrita vem do hook (recortado na org atual)
-- e a lista de caixas vinha da RPC (não recortada). As duas fontes discordavam.
--
-- ── POR QUE ORG POR PARÂMETRO, DESTA VEZ, É SEGURO ───────────────────────────
--
-- Este repo já pagou caro por `SECURITY DEFINER` + org por parâmetro sem gate
-- (24 funções auditadas, 14 revogadas). Aqui há DUAS travas, não uma:
--
--   1. `SECURITY INVOKER` — a RLS do chamador continua valendo. Mesmo que o
--      gate abaixo falhasse, o usuário não veria linha de org alheia.
--   2. Gate explícito: `p_organization_id` tem de estar em
--      `get_my_organization_ids()`. Fora disso, `access_denied` — erro, não
--      lista vazia, porque vazio silencioso é indistinguível de "não tem
--      conversa" e esconderia o problema.
--
-- O parâmetro é NECESSÁRIO: só o cliente sabe qual org o shadow selecionou.
-- Derivar no servidor foi exatamente o erro que esta migration corrige.

DROP FUNCTION IF EXISTS public.get_conversas_do_lead(text);

CREATE OR REPLACE FUNCTION public.get_conversas_do_lead(
  p_phone           text,
  p_organization_id uuid
)
RETURNS TABLE (
  instance_id            uuid,
  instance_name          text,
  instance_status        text,
  last_message_at        timestamptz,
  last_message_content   text,
  last_message_direction text
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF p_organization_id IS NULL
     OR p_organization_id NOT IN (SELECT get_my_organization_ids()) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    i.id,
    i.instance_name,
    i.status,
    u."timestamp",
    u.content,
    u.direction
  FROM whatsapp_instances i
  LEFT JOIN LATERAL (
    SELECT m.content, m."timestamp", m.direction
    FROM whatsapp_messages m
    WHERE m.organization_id  = i.organization_id
      AND m.instance_id      = i.id
      AND m.normalized_phone = normalize_brazilian_phone(p_phone)
      AND m.deleted_at IS NULL
    ORDER BY m."timestamp" DESC
    LIMIT 1
  ) u ON true
  WHERE i.organization_id = p_organization_id
    AND i.status <> 'error'
  ORDER BY u."timestamp" DESC NULLS LAST, i.instance_name;
END;
$$;

COMMENT ON FUNCTION public.get_conversas_do_lead(text, uuid) IS
  'Por caixa da org INFORMADA, a ultima mensagem trocada com p_phone. A org vem '
  'por parametro porque so o cliente sabe qual o shadow selecionou; o gate exige '
  'que ela esteja em get_my_organization_ids(), e INVOKER mantem a RLS valendo.';

-- REVOKE de `anon` é explícito: ALTER DEFAULT PRIVILEGES do schema concede
-- EXECUTE a anon em toda função nova, e REVOKE ... FROM PUBLIC não desfaz grant
-- nominal de role.
REVOKE ALL ON FUNCTION public.get_conversas_do_lead(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_conversas_do_lead(text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_conversas_do_lead(text, uuid) TO authenticated;
