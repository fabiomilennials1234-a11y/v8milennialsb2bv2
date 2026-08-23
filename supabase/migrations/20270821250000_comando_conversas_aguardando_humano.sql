-- ============================================================================
-- Comando — "Clientes aguardando resposta" (bloco 1 da central de trabalho)
--
-- POR QUE NAO DEU PARA REUSAR `get_whatsapp_conversation_list(p_waiting => true)`
--
-- Aquele predicado e `last_message_direction = 'incoming'` (migration
-- 20270819100000, linha 186): ele responde "a ULTIMA mensagem da thread veio do
-- lead". Serve para o chip do inbox e nao serve aqui, por duas razoes medidas:
--
--   1. Org com Copilot ligado. A IA responde em segundos, a ultima mensagem
--      passa a ser 'outgoing' e a conversa SOME da fila -- mesmo sem nenhum
--      humano ter lido. Nas orgs mais movimentadas o card nasceria vazio, que e
--      o pior desfecho possivel: parece "esta tudo em dia".
--   2. O pedido e mostrar "a ultima mensagem enviada PELO CLIENTE". Quando a IA
--      respondeu por ultimo, `whatsapp_conversation_summary.last_message` guarda
--      o texto DA IA. O texto do cliente so existe em `whatsapp_messages`.
--
-- Entao o predicado aqui e outro, e mais estrito:
--
--     existe mensagem do cliente  E  nenhum HUMANO falou depois dela
--
-- "Humano" e `sent_source = 'manual'`, exatamente como o `p_source = 'humano'`
-- da RPC irma. Resposta da IA ('copilot'/'workflow'/qualquer outro) NAO tira a
-- conversa da fila -- ela volta marcada com `ai_replied`, e a tela mostra o selo.
-- Foi decisao de produto (21/08): a IA atendeu, mas quem decide se aquilo fecha
-- o assunto e o vendedor.
--
-- ISOLAMENTO: esta funcao e SECURITY DEFINER, entao a RLS de whatsapp_messages
-- NAO se aplica dentro dela. O bloco de `chat_restrict_to_owner` abaixo e copia
-- fiel do da 20270819100000 -- e a razao de ele existir la esta escrita no
-- cabecalho daquela migration: "com a tabela fechada e o RPC aberto, a politica
-- ficava DECORATIVA". Omitir aqui reencenaria o mesmo incidente por outra porta.
--
-- CUSTO: a varredura de `whatsapp_messages` e limitada a 30 dias (mesma janela
-- que a CTE `unread` da RPC irma ja usa) e cai no indice
-- `idx_whatsapp_msgs_org_instance_ts (organization_id, instance_id, timestamp DESC)`.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_conversations_awaiting_human_reply(
  p_org uuid,
  p_instance uuid,
  p_limit integer DEFAULT 10,
  p_window_days integer DEFAULT 30
)
RETURNS TABLE(
  phone_number text,
  normalized_phone text,
  push_name text,
  lead_id uuid,
  conversation_id uuid,
  last_client_message text,
  last_client_message_at timestamp with time zone,
  ai_replied boolean,
  ai_replied_at timestamp with time zone,
  waiting_total integer
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_limit  integer := least(greatest(coalesce(p_limit, 10), 1), 200);
  v_days   integer := least(greatest(coalesce(p_window_days, 30), 1), 180);
  v_ids    uuid[];
  -- Isolamento por responsavel (#1629), resolvido UMA vez e nao por linha.
  v_iso_on       boolean;
  v_iso_bypass   boolean;
  v_iso_tm       uuid;
  v_iso_unassign boolean;
BEGIN
  -- Mesmo gate da RPC irma, com o mesmo endurecimento: `NOT (x IN (lista com
  -- NULL))` devolve NULL e `IF NULL THEN` nao dispara -- gate aberto em vez de
  -- erro. Por isso NOT EXISTS + COALESCE, e nao `NOT IN`.
  IF p_org IS NULL
     OR (NOT EXISTS (
           SELECT 1 FROM public.get_my_organization_ids() AS g(org_id)
            WHERE g.org_id = p_org)
         AND NOT COALESCE(is_master_user(), false)) THEN
    RAISE EXCEPTION 'forbidden: org not accessible' USING ERRCODE = '42501';
  END IF;

  IF p_instance IS NULL THEN
    RAISE EXCEPTION 'instance required' USING ERRCODE = '22023';
  END IF;

  -- Chip = instancia viva + as ja apagadas do mesmo numero.
  v_ids := whatsapp_chip_instance_ids(p_org, p_instance);

  SELECT COALESCE(o.chat_restrict_to_owner, false) INTO v_iso_on
  FROM public.organizations o WHERE o.id = p_org;

  IF v_iso_on THEN
    SELECT tm.id INTO v_iso_tm
    FROM public.team_members tm
    WHERE tm.user_id = auth.uid()
      AND tm.organization_id = p_org
      AND tm.is_active = true
    LIMIT 1;

    v_iso_bypass :=
      public.is_master_user()
      OR public.is_user_admin()
      OR (v_iso_tm IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.member_feature_permissions mfp
            WHERE mfp.team_member_id = v_iso_tm
              AND mfp.feature_key = 'leads.view_all'
              AND mfp.enabled));

    v_iso_unassign := v_iso_tm IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.member_feature_permissions mfp
      WHERE mfp.team_member_id = v_iso_tm
        AND mfp.feature_key = 'leads.view_unassigned'
        AND mfp.enabled);
  ELSE
    v_iso_bypass := true;
  END IF;

  RETURN QUERY
  WITH janela AS (
    SELECT m.normalized_phone AS np,
           max(m."timestamp") FILTER (WHERE m.direction = 'incoming') AS last_in,
           max(m."timestamp") FILTER (
             WHERE m.direction = 'outgoing' AND m.sent_source = 'manual'
           ) AS last_human_out,
           max(m."timestamp") FILTER (
             WHERE m.direction = 'outgoing' AND m.sent_source <> 'manual'
           ) AS last_ai_out
    FROM whatsapp_messages m
    WHERE m.organization_id = p_org
      AND m.instance_id = ANY(v_ids)
      AND m.deleted_at IS NULL
      -- Grupo saiu do produto (#1632) e e 40% das mensagens.
      AND m.is_group = false
      AND m.normalized_phone IS NOT NULL
      AND m."timestamp" > now() - make_interval(days => v_days)
    GROUP BY m.normalized_phone
  ),
  -- So as que esperam: o cliente falou e nenhum humano falou depois.
  esperando AS (
    SELECT j.np, j.last_in, j.last_ai_out
    FROM janela j
    WHERE j.last_in IS NOT NULL
      AND (j.last_human_out IS NULL OR j.last_in > j.last_human_out)
  ),
  -- Isolamento + dados do contato. Um EXISTS por conversa, contra `leads`,
  -- indexado por (organization_id, normalized_phone).
  visivel AS (
    SELECT e.np, e.last_in, e.last_ai_out
    FROM esperando e
    WHERE v_iso_bypass
       OR EXISTS (
            SELECT 1 FROM public.leads l
            WHERE l.organization_id  = p_org
              AND l.normalized_phone = e.np
              AND l.deleted_at IS NULL
              AND (
                COALESCE(v_iso_tm IN (
                  l.pre_sale_responsible_id, l.sale_responsible_id,
                  l.sdr_id, l.closer_id
                ), false)
                OR (
                  COALESCE(
                    l.pre_sale_responsible_id, l.sale_responsible_id,
                    l.sdr_id, l.closer_id
                  ) IS NULL
                  AND v_iso_unassign
                )
              )
          )
  ),
  -- A thread pode ter sido arquivada/apagada pelo usuario: respeitar.
  conv AS (
    SELECT DISTINCT ON (c.normalized_phone)
           c.normalized_phone AS np, c.id, c.archived_at, c.deleted_at
    FROM whatsapp_conversations c
    WHERE c.organization_id = p_org AND c.instance_id = ANY(v_ids)
      AND c.normalized_phone IS NOT NULL
    ORDER BY c.normalized_phone, (c.instance_id = p_instance) DESC,
             c.created_at DESC NULLS LAST, c.id
  ),
  elegivel AS (
    SELECT v.np, v.last_in, v.last_ai_out, cv.id AS conversation_id
    FROM visivel v
    LEFT JOIN conv cv ON cv.np = v.np
    WHERE cv.deleted_at IS NULL AND cv.archived_at IS NULL
  ),
  -- `waiting_total` viaja em toda linha: a tela precisa dizer "e mais N"
  -- sem uma segunda ida ao banco.
  contado AS (
    SELECT el.*, count(*) OVER ()::integer AS total
    FROM elegivel el
  ),
  topo AS (
    SELECT c.* FROM contado c
    ORDER BY c.last_in DESC
    LIMIT v_limit
  )
  -- O TEXTO do cliente so agora, e so para as linhas que sobreviveram ao LIMIT.
  SELECT s.phone_number,
         t.np,
         s.last_push_name,
         s.lead_id,
         t.conversation_id,
         msg.content,
         t.last_in,
         (t.last_ai_out IS NOT NULL AND t.last_ai_out > t.last_in),
         CASE WHEN t.last_ai_out > t.last_in THEN t.last_ai_out END,
         t.total
  FROM topo t
  LEFT JOIN LATERAL (
    SELECT DISTINCT ON (x.normalized_phone) x.phone_number, x.last_push_name, x.lead_id
    FROM whatsapp_conversation_summary x
    WHERE x.organization_id = p_org
      AND x.instance_id = ANY(v_ids)
      AND x.normalized_phone = t.np
    ORDER BY x.normalized_phone, x.last_message_time DESC
  ) s ON true
  LEFT JOIN LATERAL (
    SELECT w.content
    FROM whatsapp_messages w
    WHERE w.organization_id = p_org
      AND w.instance_id = ANY(v_ids)
      AND w.normalized_phone = t.np
      AND w.direction = 'incoming'
      AND w.deleted_at IS NULL
    ORDER BY w."timestamp" DESC
    LIMIT 1
  ) msg ON true
  ORDER BY t.last_in DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_conversations_awaiting_human_reply(uuid, uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_conversations_awaiting_human_reply(uuid, uuid, integer, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_conversations_awaiting_human_reply(uuid, uuid, integer, integer) IS
  'Comando/central de trabalho: conversas em que o cliente falou e nenhum HUMANO respondeu depois. Resposta da IA nao remove da fila, so marca ai_replied. Respeita chat_restrict_to_owner.';

-- Terminador explicito: `pg_get_functiondef` nao emite `;`. Sem ele o arquivo
-- funciona sozinho e QUEBRA quando concatenado com o proximo.
