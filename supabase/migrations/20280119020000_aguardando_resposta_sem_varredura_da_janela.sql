-- ════════════════════════════════════════════════════════════════════════════
-- "Aguardando resposta" (get_conversations_awaiting_human_reply_multi) sem
-- varrer a janela inteira de mensagens e sem re-autorizar caixa por caixa
-- ════════════════════════════════════════════════════════════════════════════
--
-- SINTOMA: média de 2,2 s em pg_stat_statements. MEDIDO em prod em 16/11/2026,
-- como `authenticated` com claims reais, em transação com ROLLBACK:
--   Alamaster (org mais pesada: 24 mil recebidas em 7 dias, 60 caixas), admin ... 1,6 s
--   JR Tex (strict_lead_owner_access), membro ......................... 5,9–9,1 s
--
-- TRÊS CAUSAS, todas no corpo:
--  (A) Expansão de chips por chamada de função por caixa:
--      `whatsapp_chip_instance_ids` (plpgsql DEFINER) refaz o gate de org e
--      `whatsapp_readable_instance_ids` para CADA caixa — 11,6 ms × 60 = 700 ms
--      no EXPLAIN da Alamaster, só para re-autorizar o que `v_boxes` acabou de
--      autorizar. → A mesma regra em conjunto, uma consulta (cópia do (C) de
--      20280117000000).
--  (B) CTE `entrada` lê TODA mensagem recebida da janela pela view: 24 mil
--      linhas com acesso ao heap (~500 ms) só para tirar `max(timestamp)` por
--      (caixa, telefone).
--      → Candidatos pelo RESUMO: `whatsapp_conversation_summary.last_message_time`
--        é `greatest(...)` mantido por trigger AFTER INSERT síncrono, logo nunca
--        é menor que o timestamp de qualquer mensagem do (chip, telefone): sem
--        atividade depois do corte ⇒ sem recebida na janela. Para cada
--        candidato, a última recebida sai de UMA sonda `ORDER BY timestamp DESC
--        LIMIT 1` pela view, no índice idx_whatsapp_msgs_org_phone_instance_ts.
--        Medido em prod (16/11/2026), janela de 7 dias: 4.845 grupos (org,
--        chip, telefone) com recebida, 0 sem resumo, 0 com o resumo atrás da
--        mensagem. Mesmo invariante documentado em 20280117000000: quem criar
--        UPDATE que mova mensagem de (chip, telefone) ou adiante o
--        "timestamp" tem de atualizar o resumo junto ou remover esta poda.
--  (C) Em org com recorte strict, a view avalia `strict_phone_visible` POR
--      MENSAGEM (1.248 recebidas em 7 dias na JR Tex), e a sonda "LIMIT 1" de
--      (B) também — numa conversa INVISÍVEL ela percorre todas as linhas.
--      → Caminho strict: os grupos (chip, telefone, lead) da janela saem da
--        TABELA, sem recorte (o corpo é DEFINER), e a visibilidade é provada
--        com UMA sonda pela view na linha mais recente de cada grupo. O
--        predicado das views private.* depende só de (org, chip, lead,
--        telefone) — constante dentro do grupo —, então o grupo é visível ⇔
--        a linha mais recente dele é visível ⇔ alguma linha dele é. JR Tex:
--        270 sondas em vez de 1.248 avaliações.
--      Os dois caminhos devolvem o MESMO `entrada`; a escolha é só de
--      algoritmo. Se `private.strict_lead_member_orgs()` sumir, cai no
--      caminho (B), que continua passando pela view — mais lento, nunca mais
--      aberto.
--
-- O QUE NÃO MUDA: assinatura, RETURNS TABLE, gate de org (42501), interseção
-- de caixas legíveis, partição chip→caixa e seu desempate, isolamento por
-- responsável (#1629, co-donos), escopo do Comando, balcão Riofix, "humano
-- respondeu" (manual em timestamp >= última recebida), resposta da IA depois
-- do cliente, thread arquivada/apagada, waiting_total depois do recorte,
-- LIMIT global e desempate total, texto/dono só das linhas do LIMIT.
--
-- BASE: corpo VIVO de prod lido em 16/11/2026 com pg_get_functiondef. As
-- leituras SEM recorte (candidatos) usam o nome entre aspas —
-- public."whatsapp_messages" e public."whatsapp_conversation_summary" — para
-- o bloco DO do fim NÃO trocá-las para private.*: são candidatas, nunca
-- saída; toda linha que sai foi provada pela view. O balcão Riofix (só em
-- prod) entra por EXECUTE guardado; o bloco DO exige a função em prod e troca
-- a guarda por `true` — falha FECHADA, como no corpo vivo.
--
-- Só schema: CREATE OR REPLACE FUNCTION + ACL + troca de prefixo. Nenhum DML.
-- Rollback: supabase/migrations/rollback/20280119020000_aguardando_resposta_sem_varredura_da_janela.sql
-- NÃO APLICADA em nenhum banco remoto por esta entrega.

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
  -- `entrada` materializada: (caixa, telefone, última recebida visível).
  v_e_box  uuid[];
  v_e_np   text[];
  v_e_in   timestamptz[];
  v_strict boolean := false;
  v_balcao boolean := false;
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

  -- (A) Partição caixa → uuids do chip EM CONJUNTO, uma consulta só. Mesma
  -- regra de `whatsapp_chip_instance_ids`: a caixa é membro de si mesma; se o
  -- número dela tem 10+ dígitos, os uuids da `whatsapp_instance_reap_queue`
  -- com os mesmos dígitos (mesma org) também são. A autorização já está em
  -- `v_boxes`. Desempate igual ao de antes: prefere a caixa que É o próprio
  -- uuid, depois a menor.
  SELECT array_agg(x.box ORDER BY x.member), array_agg(x.member ORDER BY x.member)
    INTO v_box_of, v_member_of
    FROM (
      SELECT DISTINCT ON (mm.member) mm.box, mm.member
        FROM (
          SELECT b.box, b.box AS member
            FROM unnest(v_boxes) AS b(box)
          UNION ALL
          SELECT wi.id, q.instance_id
            FROM public.whatsapp_instances wi
            JOIN public.whatsapp_instance_reap_queue q
              ON q.organization_id = p_org
             AND q.phone_number IS NOT NULL
             AND regexp_replace(q.phone_number, '[^0-9]', '', 'g')
               = regexp_replace(wi.phone_number, '[^0-9]', '', 'g')
           WHERE wi.id = ANY(v_boxes)
             AND wi.organization_id = p_org
             AND length(regexp_replace(wi.phone_number, '[^0-9]', '', 'g')) >= 10
        ) mm
       ORDER BY mm.member, (mm.member = mm.box) DESC, mm.box
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

  -- Acesso compartilhado do balcão Riofix: limitado pelas relações private.*
  -- protegidas. Existe só em prod; chamado por EXECUTE guardado para a função
  -- seguir executável num banco montado só do repo. Em prod o bloco DO do fim
  -- troca a guarda por `true` (falha fechada: função ausente = erro).
  IF to_regprocedure('private.riofix_balcao_current_scope()') IS NOT NULL THEN
    EXECUTE 'SELECT private.riofix_balcao_current_scope() IS NOT NULL' INTO v_balcao;
  END IF;
  IF v_balcao THEN
    v_iso_bypass:=true; v_scope_mine:=false;
  END IF;

  -- Só escolhe o ALGORITMO de `entrada` (ver (C) no cabeçalho); a
  -- visibilidade é sempre provada pela view nos dois caminhos.
  IF to_regprocedure('private.strict_lead_member_orgs()') IS NOT NULL THEN
    EXECUTE 'SELECT $1 = ANY(private.strict_lead_member_orgs())' INTO v_strict USING p_org;
    v_strict := COALESCE(v_strict, false);
  END IF;

  -- ── entrada: última mensagem VISÍVEL do cliente por (caixa, telefone) ────
  IF v_strict THEN
    -- (C) Grupos (chip, telefone, lead) da janela na TABELA, sem recorte; uma
    -- sonda pela view na linha mais recente de cada grupo prova o grupo.
    SELECT array_agg(e.box), array_agg(e.np), array_agg(e.last_in)
      INTO v_e_box, v_e_np, v_e_in
      FROM (
        SELECT g.box, g.np, max(g.last_in) AS last_in
          FROM (
            SELECT u.box, u.member, gg.np, gg.lead, gg.last_in
              FROM unnest(v_box_of, v_member_of) AS u(box, member)
              CROSS JOIN LATERAL (
                SELECT m.normalized_phone AS np, m.lead_id AS lead,
                       max(m."timestamp") AS last_in
                  FROM public."whatsapp_messages" m
                 WHERE m.organization_id = p_org
                   AND m.instance_id = u.member
                   AND m.direction = 'incoming'
                   AND m.deleted_at IS NULL
                   -- Grupo saiu do produto (#1632) e é 40% das mensagens.
                   AND m.is_group = false
                   AND m.normalized_phone IS NOT NULL
                   AND m."timestamp" > v_since
                 GROUP BY m.normalized_phone, m.lead_id
              ) gg
          ) g
         WHERE EXISTS (
           SELECT 1
             FROM public.whatsapp_messages v
            WHERE v.organization_id  = p_org
              AND v.normalized_phone = g.np
              AND v.instance_id      = g.member
              AND v."timestamp"      = g.last_in
              AND v.lead_id IS NOT DISTINCT FROM g.lead
              AND v.direction = 'incoming'
              AND v.deleted_at IS NULL
              AND v.is_group = false)
         GROUP BY g.box, g.np
      ) e;
  ELSE
    -- (B) Candidatos pelo resumo (TABELA, condição necessária); a última
    -- recebida sai de uma sonda LIMIT 1 pela view, por (chip, telefone).
    SELECT array_agg(e.box), array_agg(e.np), array_agg(e.last_in)
      INTO v_e_box, v_e_np, v_e_in
      FROM (
        SELECT u.box, c.np, max(ult.ts) AS last_in
          FROM unnest(v_box_of, v_member_of) AS u(box, member)
          CROSS JOIN LATERAL (
            SELECT s.normalized_phone AS np
              FROM public."whatsapp_conversation_summary" s
             WHERE s.organization_id = p_org
               AND s.instance_id     = u.member
               AND s.normalized_phone IS NOT NULL
               AND s.last_message_time > v_since
          ) c
          CROSS JOIN LATERAL (
            SELECT m."timestamp" AS ts
              FROM public.whatsapp_messages m
             WHERE m.organization_id  = p_org
               AND m.normalized_phone = c.np
               AND m.instance_id      = u.member
               AND m.direction = 'incoming'
               AND m.deleted_at IS NULL
               AND m.is_group = false
               AND m."timestamp" > v_since
             ORDER BY m."timestamp" DESC
             LIMIT 1
          ) ult
         GROUP BY u.box, c.np
      ) e;
  END IF;

  IF v_e_box IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH caixa AS (
    SELECT u.box, array_agg(u.member) AS members
    FROM unnest(v_box_of, v_member_of) AS u(box, member)
    GROUP BY u.box
  ),
  entrada AS (
    SELECT e.box, e.np, e.last_in
    FROM unnest(v_e_box, v_e_np, v_e_in) AS e(box, np, last_in)
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
             SELECT 1 FROM public.leads l2
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
  -- A thread pode ter sido arquivada/apagada: respeitar. Prefere a Instance
  -- viva da caixa, sondada por candidata.
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
  -- LIMIT GLOBAL sobre a união das caixas. Desempate total para a ordem não
  -- oscilar entre leituras.
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
  -- O TEXTO do cliente só para as linhas que sobreviveram ao LIMIT. Uma sonda
  -- POR uuid do chip, cada uma servida pela ordem do índice (org, telefone,
  -- instance, timestamp DESC).
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
  -- O dono: MESMA ordem do COALESCE do predicado de isolamento.
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

REVOKE ALL ON FUNCTION public.get_conversations_awaiting_human_reply_multi(uuid, uuid[], integer, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_conversations_awaiting_human_reply_multi(uuid, uuid[], integer, integer) TO authenticated;

-- ── FORMA DE PROD: public.* → private.* nas 4 relações do recorte strict ──
-- Em prod o corpo lê as views `private.<relação>` (aplicadas fora do repo),
-- que aplicam o recorte strict_lead_owner_access pelo JWT. As leituras de
-- candidatos com o nome entre aspas (public."whatsapp_messages",
-- public."whatsapp_conversation_summary") NÃO são trocadas — de propósito.
--   * falha FECHADA: faltou view → RAISE; faltou a função do balcão Riofix →
--     RAISE; a guarda `to_regprocedure('private.riofix_balcao_current_scope()')
--     IS NOT NULL` vira `true` (exatamente 1 troca, conferida).
--   * a guarda de `strict_lead_member_orgs` NÃO é trocada: ela só escolhe o
--     algoritmo, e os dois provam a visibilidade pela view.
--   * esperado depois da troca: zero `public.<4 rels>` sem aspas e exatamente
--     14 ocorrências de `private.` no corpo (10 referências às 4 relações, 1 no
--     balcão Riofix, 2 na escolha do caminho strict, 1 em comentário).
DO $troca$
DECLARE
  v_sig regprocedure := 'public.get_conversations_awaiting_human_reply_multi(uuid,uuid[],integer,integer)'::regprocedure;
  v_rels text[] := ARRAY['leads', 'whatsapp_conversation_summary', 'whatsapp_conversations', 'whatsapp_messages'];
  v_esperado constant integer := 14;
  v_guarda constant text := 'to_regprocedure(''private.riofix_balcao_current_scope()'') IS NOT NULL';
  v_trocas integer;
  v_def text;
  v_rel text;
  v_faltando text[];
  v_sobra integer;
  v_private integer;
BEGIN
  IF to_regprocedure('private.strict_lead_member_orgs()') IS NULL THEN
    RETURN;
  END IF;

  SELECT array_agg(r ORDER BY r) INTO v_faltando
    FROM unnest(v_rels) AS r
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'private' AND c.relname = r AND c.relkind = 'v');
  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION 'forma de prod incompleta: strict instalado, mas faltam as views private.% — abortado para não ler sem o recorte',
      array_to_string(v_faltando, ', private.');
  END IF;

  IF to_regprocedure('private.riofix_balcao_current_scope()') IS NULL THEN
    RAISE EXCEPTION 'forma de prod incompleta: strict instalado, mas falta private.riofix_balcao_current_scope() — abortado para o escopo não mudar em silêncio';
  END IF;

  v_def := pg_get_functiondef(v_sig);
  v_trocas := (length(v_def) - length(replace(v_def, v_guarda, ''))) / length(v_guarda);
  IF v_trocas <> 1 THEN
    RAISE EXCEPTION 'forma de prod divergente: guarda do balcão Riofix aparece % vez(es) (esperado 1)', v_trocas;
  END IF;
  v_def := replace(v_def, v_guarda, 'true');
  FOREACH v_rel IN ARRAY v_rels LOOP
    v_def := regexp_replace(v_def, 'public\.' || v_rel || '\M', 'private.' || v_rel, 'g');
  END LOOP;
  EXECUTE v_def;

  v_def := pg_get_functiondef(v_sig);
  SELECT count(*) INTO v_sobra
    FROM regexp_matches(v_def, 'public\.(' || array_to_string(v_rels, '|') || ')\M', 'g');
  SELECT count(*) INTO v_private FROM regexp_matches(v_def, 'private\.', 'g');
  IF position(v_guarda IN v_def) > 0 THEN
    RAISE EXCEPTION 'forma de prod divergente: guarda do balcão Riofix sobreviveu à troca';
  END IF;
  IF v_sobra <> 0 OR v_private <> v_esperado THEN
    RAISE EXCEPTION 'forma de prod divergente: % referência(s) public.* às 4 relações e % private.* (esperado 0 e %)',
      v_sobra, v_private, v_esperado;
  END IF;
END
$troca$;

NOTIFY pgrst, 'reload schema';
