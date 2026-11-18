-- Rollback de 20280119020000_aguardando_resposta_sem_varredura_da_janela.sql
--
-- Restaura o corpo VIVO de prod lido em 16/11/2026 com pg_get_functiondef
-- (forma de prod: lê private.whatsapp_messages, private.leads,
-- private.whatsapp_conversations, private.whatsapp_conversation_summary e
-- chama private.riofix_balcao_current_scope()). O corpo vivo usa CRLF; aqui
-- está com LF — md5 do corpo sem CR conferido contra prod.
-- Mesma assinatura e mesmo retorno ⇒ CREATE OR REPLACE preserva a ACL.

CREATE OR REPLACE FUNCTION public.get_conversations_awaiting_human_reply_multi(p_org uuid, p_instances uuid[] DEFAULT NULL::uuid[], p_limit integer DEFAULT 30, p_window_days integer DEFAULT 7)
 RETURNS TABLE(instance_id uuid, phone_number text, normalized_phone text, push_name text, lead_id uuid, conversation_id uuid, last_client_message text, last_client_message_at timestamp with time zone, ai_replied boolean, ai_replied_at timestamp with time zone, waiting_total integer, owner_team_member_id uuid, owner_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
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

  -- Shared access is bounded by the protected private relations.
  IF private.riofix_balcao_current_scope() IS NOT NULL THEN
    v_iso_bypass:=true; v_scope_mine:=false;
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
      FROM private.whatsapp_messages m
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
      FROM private.whatsapp_messages o
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
      FROM private.whatsapp_messages h
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
             SELECT 1 FROM private.leads l
             WHERE l.organization_id  = p_org
               AND l.normalized_phone = e.np
               AND l.deleted_at IS NULL
               AND (
                 COALESCE(v_iso_tm IN (l.pre_sale_responsible_id, l.sale_responsible_id, l.sdr_id, l.closer_id), false) -- metric-lint-allow: visibilidade por responsavel, nao atribuicao de receita — R5 nao se aplica
                 -- Co-dono (lead_owners, role='co'): Chamado 793f4b05 · PR4a/5.
                 OR COALESCE(v_iso_tm IS NOT NULL
                             AND public.rls_lead_co_owned(l.id, ARRAY[v_iso_tm]), false)
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
             SELECT 1 FROM private.leads l2
             WHERE l2.organization_id  = p_org
               AND l2.normalized_phone = e.np
               AND l2.deleted_at IS NULL
               AND COALESCE(l2.pre_sale_responsible_id, l2.sale_responsible_id, l2.sdr_id, l2.closer_id) IS NOT NULL -- metric-lint-allow: teste de "lead tem dono", nao soma por membro
               AND NOT COALESCE(v_me IN (l2.pre_sale_responsible_id, l2.sale_responsible_id, l2.sdr_id, l2.closer_id), false) -- metric-lint-allow: visibilidade por responsavel, nao atribuicao de receita
               -- Co-dono (PR4a/5): quem é co-dono do lead também não é "dono de outro".
               AND NOT COALESCE(v_me IS NOT NULL
                                AND public.rls_lead_co_owned(l2.id, ARRAY[v_me]), false)
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
      FROM private.whatsapp_conversations c
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
    FROM private.whatsapp_conversation_summary x
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
      FROM private.whatsapp_messages w
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
    FROM private.leads l3
    WHERE l3.organization_id  = p_org
      AND l3.normalized_phone = t.np
      AND l3.deleted_at IS NULL
    LIMIT 1
  ) dono ON true
  LEFT JOIN public.team_members tmo ON tmo.id = dono.tm_id
  ORDER BY t.last_in DESC, t.box, t.np;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_conversations_awaiting_human_reply_multi(uuid, uuid[], integer, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_conversations_awaiting_human_reply_multi(uuid, uuid[], integer, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
