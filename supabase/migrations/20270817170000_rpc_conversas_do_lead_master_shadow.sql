-- `get_conversas_do_lead` — o gate precisa reconhecer o MASTER em shadow.
--
-- ── O DEFEITO (visto em produção, 2026-08-17, minutos após a migration anterior)
--
-- A migration 20270817160000 passou a exigir que `p_organization_id` estivesse
-- em `get_my_organization_ids()`. Isso quebrou o master: ele NÃO é team_member
-- da org que está olhando em shadow, então o gate negava e o seletor mostrava
-- "Nenhum número de WhatsApp disponível nesta organização" — numa org que tem
-- quatro caixas.
--
-- O sinal estava na mesa e eu não liguei os pontos: ao validar a migration
-- anterior, testei a conta do CTO contra a Milennials e recebi `access_denied`.
-- Interpretei como "essa conta não é dessa org, tudo bem" em vez de "master em
-- shadow não passa pelo meu gate".
--
-- É a mesma armadilha que este repo já documentou pelo lado oposto: RLS
-- org-scoped escrita sem cláusula de master deixa o master cego. Aqui eu
-- escrevi um gate sem cláusula de master e ceguei o master.
--
-- ── O GATE, AGORA COM AS TRÊS PORTAS LEGÍTIMAS ───────────────────────────────
--
--   1. membro ativo da org           → get_my_organization_ids()
--   2. gestor de portfólio           → idem (o helper já faz UNION)
--   3. master (inclusive em shadow)  → is_master_user()
--
-- `SECURITY INVOKER` continua sendo a trava de fundo: as políticas de RLS de
-- `whatsapp_instances` e `whatsapp_messages` já têm cláusula de master
-- (`master_all_*`), então o master vê o que deve e ninguém mais herda nada.
--
-- Org nula continua sendo erro, não lista vazia: sem org não há recorte, e
-- recorte é o ponto desta função.

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
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = 'P0001';
  END IF;

  IF NOT (
       p_organization_id IN (SELECT get_my_organization_ids())
    OR is_master_user()
  ) THEN
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
  'Por caixa da org INFORMADA, a ultima mensagem trocada com p_phone. Gate: '
  'membro ativo da org, gestor, OU master (inclusive em shadow). INVOKER mantem '
  'a RLS valendo por baixo.';

REVOKE ALL ON FUNCTION public.get_conversas_do_lead(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_conversas_do_lead(text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_conversas_do_lead(text, uuid) TO authenticated;
