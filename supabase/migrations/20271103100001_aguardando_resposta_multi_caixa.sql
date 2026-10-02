-- ============================================================================
-- Comando · "Clientes aguardando resposta" em UMA chamada para todas as caixas
-- ============================================================================
--
-- ⚠️ VERSÃO PROVISÓRIA. O ledger de prod colide com frequência (memória
-- colisao-de-ledger-e-o-normal-agora): renumerar NA HORA de aplicar.
--
-- ─── O INCIDENTE ────────────────────────────────────────────────────────────
--
-- Prod caiu em 2026-10-02 12:46 UTC (2 vCPU, max_connections=90; `too many
-- clients` às 12:40). O card "aguardando resposta" do Comando fazia UMA RPC
-- `get_conversations_awaiting_human_reply` POR CHIP (`useQueries`): a Alamaster
-- tem 57 caixas → 57 chamadas por abertura do Comando, cada uma medida em
-- 12,4 s pelo auto_explain (org 636776d8, instance c39d6a92, p_limit 30,
-- janela de 30 d). A janela agregava TODAS as mensagens do chip em 30 dias
-- (entrada, saída humana, saída da IA) só para descobrir quem está esperando.
--
-- ─── O QUE ESTA FUNÇÃO MUDA ─────────────────────────────────────────────────
--
-- (1) Uma chamada, N caixas. Partição de chips IDÊNTICA à de
--     `get_whatsapp_conversation_list_multi`: `whatsapp_readable_instance_ids`
--     recorta o pedido pelo que a pessoa pode ler, `whatsapp_chip_instance_ids`
--     expande cada caixa para os uuids históricos do mesmo número, e
--     `DISTINCT ON (member)` garante que cada uuid pertence a UMA caixa só.
--     Cada linha sai com `instance_id` = a CAIXA (nunca um uuid histórico).
--
-- (2) Custo proporcional às conversas com cliente falando, não ao volume do
--     chip. A RPC antiga agregava todas as mensagens da janela. Aqui:
--       a. `entrada` — última mensagem do cliente por (caixa, telefone), lida
--          SÓ do índice parcial `idx_whatsapp_msgs_unread_cover`
--          (organization_id, instance_id, timestamp DESC) INCLUDE
--          (normalized_phone) WHERE incoming AND não apagada AND não grupo —
--          index-only scan, um por uuid de chip;
--       b. "algum humano respondeu depois?" vira um NOT EXISTS por candidata em
--          `idx_whatsapp_msgs_org_phone_instance_ts`, limitado a
--          `timestamp >= last_in` — para na primeira resposta humana;
--       c. "a IA respondeu depois?" idem, só sobre `timestamp > last_in`.
--     Equivalência com a janela agregada da RPC antiga, linha por linha:
--       - `last_in` = max(timestamp) das incoming da janela — o mesmo recorte
--         (deleted_at IS NULL, is_group = false, normalized_phone NOT NULL);
--       - antiga: espera ⇔ last_human_out IS NULL OR last_in > last_human_out,
--         com last_human_out = max das manuais na janela. Toda manual com
--         timestamp >= last_in já está na janela (last_in está), então espera
--         ⇔ NÃO existe manual com timestamp >= last_in. É o NOT EXISTS de (b);
--       - antiga: ai_replied ⇔ last_ai_out > last_in. O máximo global passa de
--         last_in ⇔ existe saída não-manual depois de last_in, e nesse caso os
--         dois máximos coincidem. É o (c).
--
-- (3) Janela padrão de 7 dias (era 30). Decisão delegada pelo CTO: o card
--     mostra o topo MAIS RECENTE da fila; o que encolhe é só o "e mais N".
--     `p_window_days` continua aceito (1..180) para quem precisar de mais.
--
-- ─── SEMÂNTICA POR LINHA: PRESERVADA ────────────────────────────────────────
--
-- Isolamento (`chat_restrict_to_owner`), escopo do Comando (admin vê a org;
-- os demais veem o que é seu ou de ninguém), thread arquivada/apagada fora,
-- `waiting_total` contado DEPOIS do recorte, dono pela MESMA ordem de COALESCE
-- do predicado de isolamento, último texto do cliente — tudo copiado da
-- definição VIVA de `get_conversations_awaiting_human_reply` (pg_get_functiondef
-- em prod, 2026-10-02), não do corpo do repo.
--
-- UMA divergência deliberada, e ela só ESTREITA: o bypass do isolamento usa
-- `is_org_admin(p_org)` (que já embute master e exige `is_active`) em vez de
-- `is_master_user() OR is_user_admin()`. `is_user_admin()` é org-agnóstica:
-- admin de QUALQUER org derrubaria o recorte por responsável de uma org onde é
-- membro raso. É a mesma correção que `get_whatsapp_conversation_list_multi` já
-- fez; a função nova nasce sem o furo.
--
-- ─── SEGURANÇA ──────────────────────────────────────────────────────────────
--
-- SECURITY DEFINER porque lê whatsapp_messages/leads atravessando RLS — por
-- isso o gate de org vem PRIMEIRO, e a lista de caixas nunca é a do argumento:
-- é a interseção que `whatsapp_readable_instance_ids` devolve (caixa de outra
-- org ou não liberada ao membro some em silêncio). `search_path = ''` com tudo
-- qualificado. EXECUTE só para `authenticated`: revogado de PUBLIC, anon e
-- service_role (default privileges dão grant NOMINAL a service_role, que
-- `REVOKE FROM PUBLIC` não alcança; sem `auth.uid()` o gate recusaria de todo
-- jeito — o grant só seria superfície).
--
-- Expand/contract: a RPC por chip fica INTACTA — front antigo em cache ainda a
-- chama. Aposentar numa migration futura, depois que o front novo assentar.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_conversations_awaiting_human_reply_multi(
  p_org         uuid,
  p_instances   uuid[]  DEFAULT NULL,
  p_limit       integer DEFAULT 30,
  p_window_days integer DEFAULT 7
)
RETURNS TABLE(
  instance_id            uuid,
  phone_number           text,
  normalized_phone       text,
  push_name              text,
  lead_id                uuid,
  conversation_id        uuid,
  last_client_message    text,
  last_client_message_at timestamptz,
  ai_replied             boolean,
  ai_replied_at          timestamptz,
  waiting_total          integer,
  owner_team_member_id   uuid,
  owner_name             text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
#variable_conflict use_column
DECLARE
  v_limit  integer := least(greatest(coalesce(p_limit, 30), 1), 200);
  v_days   integer := least(greatest(coalesce(p_window_days, 7), 1), 180);
  v_since  timestamptz;
  v_boxes     uuid[];
  v_box_of    uuid[];
  v_member_of uuid[];
  -- Isolamento por responsável (#1629), resolvido UMA vez e não por linha.
  v_iso_on       boolean;
  v_iso_bypass   boolean;
  v_iso_tm       uuid;
  v_iso_unassign boolean;
  -- Escopo do Comando.
  v_me         uuid;
  v_admin      boolean;
  v_scope_mine boolean;
BEGIN
  -- Gate de org, forma canônica: `NOT (x IN (lista com NULL))` devolve NULL e
  -- `IF NULL` não dispara — por isso NOT EXISTS + COALESCE.
  IF p_org IS NULL
     OR (NOT EXISTS (
           SELECT 1 FROM public.get_my_organization_ids() AS g(org_id)
            WHERE g.org_id = p_org)
         AND NOT COALESCE(public.is_master_user(), false)) THEN
    RAISE EXCEPTION 'forbidden: org not accessible' USING ERRCODE = '42501';
  END IF;

  v_since := now() - make_interval(days => v_days);

  -- Interseção de acesso: quem decide o que é legível é a função, não o
  -- argumento. NULL/vazio = "tudo que eu posso ler", como na lista multi.
  v_boxes := public.whatsapp_readable_instance_ids(p_org, p_instances);
  IF COALESCE(cardinality(v_boxes), 0) = 0 THEN
    RETURN;
  END IF;

  -- Partição caixa → uuids do chip, UMA passada. Cópia de
  -- get_whatsapp_conversation_list_multi: o desempate prefere a caixa que É o
  -- próprio uuid, depois a menor.
  SELECT array_agg(x.box ORDER BY x.member), array_agg(x.member ORDER BY x.member)
    INTO v_box_of, v_member_of
    FROM (
      SELECT DISTINCT ON (mm.member) b.box, mm.member
        FROM unnest(v_boxes) AS b(box)
        CROSS JOIN LATERAL unnest(public.whatsapp_chip_instance_ids(p_org, b.box)) AS mm(member)
       ORDER BY mm.member, (mm.member = b.box) DESC, b.box
    ) x;

  IF v_member_of IS NULL THEN
    v_box_of    := v_boxes;
    v_member_of := v_boxes;
  END IF;

  -- ── Escopo do Comando ─────────────────────────────────────────────────────
  -- `v_me` é NULL para master (não tem team_members); o recorte só liga quando
  -- NÃO é admin, e `is_org_admin` já é true para master.
  v_me         := public.my_team_member_id(p_org);
  v_admin      := COALESCE(public.is_org_admin(p_org), false);
  v_scope_mine := NOT v_admin;

  SELECT COALESCE(o.chat_restrict_to_owner, false) INTO v_iso_on
  FROM public.organizations o WHERE o.id = p_org;

  IF v_iso_on THEN
    v_iso_tm := v_me;

    -- Divergência deliberada (só estreita) — ver cabeçalho.
    v_iso_bypass :=
      v_admin
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
  WITH boxes AS (
    SELECT u.box, u.member
    FROM unnest(v_box_of, v_member_of) AS u(box, member)
  ),
  -- Os uuids de cada caixa como array: vira `instance_id = ANY(...)` dentro da
  -- condição de índice das sondas abaixo.
  caixa AS (
    SELECT bx.box, array_agg(bx.member) AS members
    FROM boxes bx
    GROUP BY bx.box
  ),
  -- (a) Última mensagem do cliente por (caixa, telefone). O LATERAL com
  -- GROUP BY não é achatável: força um index-only scan parametrizado por uuid
  -- no índice de cobertura, em vez de o planner varrer a janela da org.
  entrada AS (
    SELECT bx.box, e.np, max(e.last_in) AS last_in
    FROM boxes bx
    CROSS JOIN LATERAL (
      SELECT m.normalized_phone AS np, max(m."timestamp") AS last_in
      FROM public.whatsapp_messages m
      WHERE m.organization_id = p_org
        AND m.instance_id = bx.member
        AND m.direction = 'incoming'
        AND m.deleted_at IS NULL
        -- Grupo saiu do produto (#1632) e é 40% das mensagens.
        AND m.is_group = false
        AND m.normalized_phone IS NOT NULL
        AND m."timestamp" > v_since
      GROUP BY m.normalized_phone
    ) e
    GROUP BY bx.box, e.np
  ),
  -- (b) Só as que esperam: nenhum humano falou em `timestamp >= last_in`.
  -- (c) E a última resposta da IA depois do cliente, se houver.
  esperando AS (
    SELECT en.box, cx.members, en.np, en.last_in, ia.last_ai_out
    FROM entrada en
    JOIN caixa cx ON cx.box = en.box
    LEFT JOIN LATERAL (
      SELECT max(o."timestamp") AS last_ai_out
      FROM public.whatsapp_messages o
      WHERE o.organization_id = p_org
        AND o.normalized_phone = en.np
        AND o.instance_id = ANY(cx.members)
        AND o.deleted_at IS NULL
        AND o.is_group = false
        AND o.direction = 'outgoing'
        AND o.sent_source <> 'manual'
        AND o."timestamp" > en.last_in
    ) ia ON true
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.whatsapp_messages h
      WHERE h.organization_id = p_org
        AND h.normalized_phone = en.np
        AND h.instance_id = ANY(cx.members)
        AND h.deleted_at IS NULL
        AND h.is_group = false
        AND h.direction = 'outgoing'
        AND h.sent_source = 'manual'
        AND h."timestamp" >= en.last_in
    )
  ),
  -- Isolamento + escopo. Cópia literal da RPC por chip.
  visivel AS (
    SELECT e.box, e.members, e.np, e.last_in, e.last_ai_out
    FROM esperando e
    WHERE
      -- (1) Política de isolamento da ORG.
      (
        v_iso_bypass
        OR EXISTS (
             SELECT 1 FROM public.leads l
             WHERE l.organization_id  = p_org
               AND l.normalized_phone = e.np
               AND l.deleted_at IS NULL
               AND (
                 COALESCE(v_iso_tm IN (l.pre_sale_responsible_id, l.sale_responsible_id, l.sdr_id, l.closer_id), false) -- metric-lint-allow: visibilidade por responsavel, nao atribuicao de receita — R5 nao se aplica
                 OR (
                   COALESCE(l.pre_sale_responsible_id, l.sale_responsible_id, l.sdr_id, l.closer_id) IS NULL -- metric-lint-allow: teste de "lead sem dono", nao soma por membro
                   AND v_iso_unassign
                 )
               )
           )
      )
      -- (2) Escopo do Comando: só ESTREITA. "Guarde a linha, A NÃO SER QUE
      -- exista um lead deste telefone que TENHA dono e esse dono NÃO seja eu."
      AND (
        NOT v_scope_mine
        OR NOT EXISTS (
             SELECT 1 FROM public.leads l2
             WHERE l2.organization_id  = p_org
               AND l2.normalized_phone = e.np
               AND l2.deleted_at IS NULL
               AND COALESCE(l2.pre_sale_responsible_id, l2.sale_responsible_id, l2.sdr_id, l2.closer_id) IS NOT NULL -- metric-lint-allow: teste de "lead tem dono", nao soma por membro
               AND NOT COALESCE(v_me IN (l2.pre_sale_responsible_id, l2.sale_responsible_id, l2.sdr_id, l2.closer_id), false) -- metric-lint-allow: visibilidade por responsavel, nao atribuicao de receita
           )
      )
  ),
  -- A thread pode ter sido arquivada/apagada: respeitar. Mesma escolha do
  -- DISTINCT ON da RPC por chip (prefere a Instance viva da caixa), só que
  -- sondada por candidata em vez de materializar as conversas da org inteira.
  elegivel AS (
    SELECT v.box, v.members, v.np, v.last_in, v.last_ai_out, cv.id AS conversation_id
    FROM visivel v
    LEFT JOIN LATERAL (
      SELECT c.id, c.archived_at, c.deleted_at
      FROM public.whatsapp_conversations c
      WHERE c.organization_id  = p_org
        AND c.instance_id      = ANY(v.members)
        AND c.normalized_phone = v.np
      ORDER BY (c.instance_id = v.box) DESC, c.created_at DESC NULLS LAST, c.id
      LIMIT 1
    ) cv ON true
    WHERE cv.deleted_at IS NULL AND cv.archived_at IS NULL
  ),
  -- `waiting_total` viaja em toda linha e conta DEPOIS do recorte.
  contado AS (
    SELECT el.*, count(*) OVER ()::integer AS total
    FROM elegivel el
  ),
  -- LIMIT GLOBAL sobre a união das caixas: o card mostra o topo mais recente
  -- da fila inteira. Desempate total para a ordem não oscilar entre leituras.
  topo AS (
    SELECT c.* FROM contado c
    ORDER BY c.last_in DESC, c.box, c.np
    LIMIT v_limit
  )
  SELECT t.box,
         s.phone_number,
         t.np,
         s.last_push_name,
         s.lead_id,
         t.conversation_id,
         msg.content,
         t.last_in,
         (t.last_ai_out IS NOT NULL AND t.last_ai_out > t.last_in),
         CASE WHEN t.last_ai_out > t.last_in THEN t.last_ai_out END,
         t.total,
         dono.tm_id,
         tmo.name
  FROM topo t
  LEFT JOIN LATERAL (
    SELECT x.phone_number, x.last_push_name, x.lead_id
    FROM public.whatsapp_conversation_summary x
    WHERE x.organization_id  = p_org
      AND x.instance_id      = ANY(t.members)
      AND x.normalized_phone = t.np
    ORDER BY x.last_message_time DESC
    LIMIT 1
  ) s ON true
  -- O TEXTO do cliente só para as linhas que sobreviveram ao LIMIT.
  -- Uma sonda POR uuid do chip, cada uma com `ORDER BY timestamp DESC LIMIT 1`
  -- servida pela ordem do índice (org, telefone, instance, timestamp DESC).
  -- Com `instance_id = ANY(...)` direto o índice perde a ordem e o executor lê
  -- e ordena o histórico inteiro do telefone — medido: 523 linhas e 54 ms por
  -- conversa na Alamaster.
  LEFT JOIN LATERAL (
    SELECT ult.content
    FROM unnest(t.members) AS mem(id)
    CROSS JOIN LATERAL (
      SELECT w.content, w."timestamp" AS ts
      FROM public.whatsapp_messages w
      WHERE w.organization_id  = p_org
        AND w.normalized_phone = t.np
        AND w.instance_id      = mem.id
        AND w.direction        = 'incoming'
        AND w.deleted_at IS NULL
      ORDER BY w."timestamp" DESC
      LIMIT 1
    ) ult
    ORDER BY ult.ts DESC
    LIMIT 1
  ) msg ON true
  -- O dono: MESMA ordem do COALESCE do predicado de isolamento — o nome na
  -- tela é o mesmo que decide quem enxerga a linha.
  LEFT JOIN LATERAL (
    SELECT COALESCE(l3.pre_sale_responsible_id, l3.sale_responsible_id, l3.sdr_id, l3.closer_id) AS tm_id -- metric-lint-allow: rotulo de dono na UI, nao atribuicao de receita
    FROM public.leads l3
    WHERE l3.organization_id  = p_org
      AND l3.normalized_phone = t.np
      AND l3.deleted_at IS NULL
    LIMIT 1
  ) dono ON true
  LEFT JOIN public.team_members tmo ON tmo.id = dono.tm_id
  ORDER BY t.last_in DESC, t.box, t.np;
END;
$function$;

COMMENT ON FUNCTION public.get_conversations_awaiting_human_reply_multi(uuid, uuid[], integer, integer) IS
  'Comando: clientes aguardando resposta humana em N caixas numa chamada. Mesma semântica por linha de get_conversations_awaiting_human_reply; partição de chips de get_whatsapp_conversation_list_multi; janela padrão 7 d. Incidente 2026-10-02.';

REVOKE ALL ON FUNCTION public.get_conversations_awaiting_human_reply_multi(uuid, uuid[], integer, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_conversations_awaiting_human_reply_multi(uuid, uuid[], integer, integer) TO authenticated;
