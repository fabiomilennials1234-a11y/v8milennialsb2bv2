-- `get_conversas_do_lead` — por caixa, a última mensagem trocada com um telefone.
--
-- É o dado que alimenta o seletor de Conversa do Lead
-- (spec: .specs/features/conversa-do-lead/SPEC.md, mapa #1605).
--
-- ── POR QUE SECURITY INVOKER ─────────────────────────────────────────────────
--
-- A RLS de `whatsapp_messages` e `whatsapp_instances` já recorta por org. Com
-- INVOKER, esta função enxerga exatamente o que o chamador enxergaria — não há
-- superfície nova.
--
-- DEFINER com org por parâmetro é o vetor que este repo já teve (24 funções
-- auditadas, 14 revogadas em prod). Não há motivo para estreá-lo aqui: a org
-- não é parâmetro, sai de `get_my_organization_ids()`, que deriva de auth.uid().
--
-- ── POR QUE NÃO FILTRA A ALLOWLIST DE INSTÂNCIA ──────────────────────────────
--
-- `whatsapp_instance_allowed_members` governa **quem pode responder**, não quem
-- pode ler. A fronteira de leitura é a org, e a RLS cuida dela.
--
-- As decisões 5 e 6 do mapa mandam a caixa sem permissão APARECER, em modo
-- leitura, com o motivo — esconder reproduz o "cadê a conversa?" que originou
-- todo o esforço. Então a lista sai completa daqui e a UI rotula o que não dá
-- para escrever.
--
-- ── O FILTRO EXPLÍCITO DE ORG NÃO É REDUNDANTE ───────────────────────────────
--
-- `i.organization_id in (select get_my_organization_ids())` repete o que a RLS
-- já faz, de propósito: sem o predicado explícito o planner não usa
-- `idx_whatsapp_msgs_org_phone_instance_ts`, e a consulta volta a custar
-- O(mensagens do lead) — 618 ms medidos, contra 0,27 ms com o índice (#1610).

CREATE OR REPLACE FUNCTION public.get_conversas_do_lead(p_phone text)
RETURNS TABLE (
  instance_id            uuid,
  instance_name          text,
  instance_status        text,
  last_message_at        timestamptz,
  last_message_content   text,
  last_message_direction text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
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
    WHERE m.organization_id = i.organization_id
      AND m.instance_id     = i.id
      AND m.normalized_phone = normalize_brazilian_phone(p_phone)
      AND m.deleted_at IS NULL
    ORDER BY m."timestamp" DESC
    LIMIT 1
  ) u ON true
  WHERE i.organization_id IN (SELECT get_my_organization_ids())
    AND i.status <> 'error'
  -- Caixas com conversa primeiro, mais recente no topo; depois as sem conversa,
  -- em ordem estável. A UI reagrupa, mas a ordem já sai pronta daqui.
  ORDER BY u."timestamp" DESC NULLS LAST, i.instance_name;
$$;

COMMENT ON FUNCTION public.get_conversas_do_lead(text) IS
  'Por caixa da org do chamador, a última mensagem trocada com p_phone. '
  'Alimenta o seletor de Conversa do Lead. SECURITY INVOKER: a RLS recorta. '
  'Não filtra allowlist de instância — ela governa escrita, não leitura.';

-- `authenticated` apenas.
--
-- O REVOKE de `anon` é EXPLÍCITO e não é redundante: `ALTER DEFAULT PRIVILEGES`
-- do schema concede EXECUTE a anon/authenticated/service_role em toda função
-- nova, e `REVOKE ... FROM PUBLIC` NÃO desfaz grant nominal de role. Sem a
-- linha abaixo esta função nasceria executável por `anon` — provado pelo
-- assert (b) do pgTAP, que ficou vermelho antes dela existir.
--
-- O impacto seria limitado (INVOKER + RLS devolveriam lista vazia para anon),
-- mas superfície anônima em RPC nova é dívida que este repo já pagou caro.
REVOKE ALL ON FUNCTION public.get_conversas_do_lead(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_conversas_do_lead(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_conversas_do_lead(text) TO authenticated;
