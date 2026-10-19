-- Chamado 793f4b05 · PR4a/5 — co-donos veem e respondem a conversa do lead.
--
-- Decisão do CTO (07-08/10): o lead tem N donos; o principal (colunas
-- canônicas) segue sendo o dono para comissão, round-robin e métricas, e o
-- co-dono (lead_owners, role='co') enxerga o lead e a conversa. O PR1 (#2288)
-- deu o ramo `rls_lead_co_owned` às policies de `leads`; esta migration o leva
-- às cinco funções SECURITY DEFINER que recortam o chat por dono e, por serem
-- DEFINER, NÃO herdam a policy:
--
--   get_whatsapp_conversation_list_multi          lista da caixa (isolamento por responsável)
--   get_conversations_awaiting_human_reply_multi  fila "aguardando resposta" (isolamento + escopo do Comando)
--   can_link_or_read_lead                         espelho da policy SELECT de leads, usado pela lista social
--   voip_can_see_call                             fronteira de lead da leitura de voip_calls
--   oraculo_chat_scope_allows                     escopo do Oráculo (chamada por service_role)
--
-- ── BASE DAS DEFINIÇÕES ───────────────────────────────────────────────────
-- Cada corpo é a definição vigente em origin/main (última migration que a
-- recria) com o ramo de co-dono acrescentado, e NADA além disso. Conferido
-- contra pg_proc de produção em 19/10: md5(prosrc) dos cinco corpos do repo ==
-- md5 de prod, depois de normalizar CRLF e `private.` -> `public.`.
-- ATENÇÃO: em prod os corpos referenciam as views `private.leads`,
-- `private.whatsapp_messages` e `private.whatsapp_conversation_summary`
-- (security_invoker, aplicadas fora do repo). O repo não tem o schema
-- `private` dessas views (um `supabase db reset` falharia ao criar
-- can_link_or_read_lead, LANGUAGE sql), então a migration segue a forma do
-- repo (`public.*`, a tabela base): o DEFINER lê as mesmas linhas como owner.
-- Se o time quiser manter `private.*` em prod, troque o prefixo nos cinco
-- corpos antes de aplicar.
--
-- ── RAMO NOVO ─────────────────────────────────────────────────────────────
--   * can_link_or_read_lead e voip_can_see_call: DEFINER chamadas por
--     authenticated, então usam o mesmo ramo da policy de leads:
--     rls_lead_co_owned(lead, (SELECT rls_my_team_member_ids(false))::uuid[]).
--     O argumento é subquery não correlacionada (initplan), como na policy.
--   * get_whatsapp_conversation_list_multi / get_conversations_awaiting_...:
--     rls_lead_co_owned(l.id, ARRAY[v_iso_tm]) / ARRAY[v_me]. O membro já está
--     resolvido UMA vez por chamada e na org pedida: mais estreito do que
--     "todas as minhas orgs" e sem subquery por linha. O ramo só roda quando o
--     isolamento está ligado e o usuário não é bypass, depois de o OR com as
--     colunas canônicas falhar.
--   * get_conversations_awaiting_human_reply_multi tem um SEGUNDO recorte, o
--     escopo do Comando ("guarde a linha a não ser que o lead tenha dono e
--     esse dono não seja eu"): co-dono também conta como "eu". O rótulo do dono
--     na fila (owner_team_member_id) continua sendo o PRINCIPAL.
--   * oraculo_chat_scope_allows roda como service_role: sem auth.uid(),
--     rls_lead_co_owned devolveria sempre false. Usa EXISTS direto em
--     lead_owners com o team_member_id do argumento, restrito à org.
--   Sem linha role='co' (toda org sem a flag lead_owners_n_donos) o ramo é
--   sempre falso: comportamento idêntico ao de hoje.
--
-- ── O QUE NÃO MUDA ────────────────────────────────────────────────────────
--   * `private.chat_scope_for_recipient` / `can_see_chat_scope` (a RLS de
--     whatsapp_messages com chat_restrict_to_owner ou strict_lead_owner_access):
--     fora do escopo desta fatia; as duas flags estão desligadas na Café
--     Jurerê. Ver o PR.
--   * Assinaturas, SECURITY DEFINER e search_path de cada função, e os GRANTs:
--     CREATE OR REPLACE preserva a ACL (nunca DROP).
--
-- Sem dependência de front nem de edge fn. Rollback em
-- supabase/migrations/rollback/20271125000000_co_donos_na_conversa.sql.

BEGIN;
SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.get_whatsapp_conversation_list_multi(p_org uuid, p_instances uuid[] DEFAULT NULL::uuid[], p_limit integer DEFAULT 50, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_funnels uuid[] DEFAULT NULL::uuid[], p_stages text[] DEFAULT NULL::text[], p_tags uuid[] DEFAULT NULL::uuid[], p_tiers text[] DEFAULT NULL::text[], p_vendor_id uuid DEFAULT NULL::uuid, p_unassigned boolean DEFAULT NULL::boolean, p_lead_presence text DEFAULT NULL::text, p_needs_human boolean DEFAULT NULL::boolean, p_unread boolean DEFAULT NULL::boolean, p_waiting boolean DEFAULT NULL::boolean, p_source text DEFAULT NULL::text, p_include_groups boolean DEFAULT false, p_before_box uuid DEFAULT NULL::uuid, p_before_phone text DEFAULT NULL::text)
 RETURNS TABLE(instance_id uuid, phone_number text, normalized_phone text, push_name text, last_message text, last_message_time timestamp with time zone, last_message_direction text, last_message_sent_source text, lead_id uuid, is_group boolean, conversation_id uuid, archived_at timestamp with time zone, unread_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid    := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 1000);
  -- As caixas que o usuário pode de fato ler, já cruzadas com o pedido.
  v_boxes   uuid[];
  -- O mapa uuid-do-chip → CAIXA, materializado como DOIS arrays paralelos.
  -- Existe para que `whatsapp_chip_instance_ids` seja chamada UMA vez por
  -- requisição, e não duas: antes ela rodava aqui e DE NOVO dentro da CTE
  -- `boxes` do RETURN QUERY, com os mesmos argumentos e em statements
  -- separados — sem reuso de plano, portanto trabalho jogado fora.
  -- MEDIDO com EXPLAIN ANALYZE em prod, como membro ativo da Alamaster:
  -- expandir as 57 caixas custa 49,1 ms (59,5 ms como master), porque cada
  -- chamada é uma plpgsql DEFINER que reavalia `get_my_organization_ids()` e
  -- `is_master_user()` antes de olhar a reap_queue. Duas rodadas eram ~98 ms
  -- por lista, com ~49 ms de desperdício — a mesma ordem de grandeza da
  -- consulta de dados inteira (30-112 ms). No caso comum (1 a 2 caixas, 60 das
  -- 62 orgs) a diferença é ~2 ms e nenhuma das duas formas importa.
  v_box_of    uuid[];
  v_member_of uuid[];
  -- Todos os uuids de todos os chips das caixas acima, achatados. Serve só
  -- para pré-filtrar leitura; o mapeamento uuid → caixa é o par acima.
  v_members uuid[];
  v_keys    text[];
  -- Isolamento por responsável (#1629). Resolvido UMA vez, não por linha.
  v_iso_on       boolean;
  v_iso_bypass   boolean;
  v_iso_tm       uuid;
  v_iso_unassign boolean;
BEGIN
  -- Gate de org, forma canônica. Ver comentário em
  -- whatsapp_readable_instance_ids sobre `NOT EXISTS` e `COALESCE`.
  IF p_org IS NULL
     OR (NOT EXISTS (
           SELECT 1 FROM public.get_my_organization_ids() AS g(org_id)
            WHERE g.org_id = p_org)
         AND NOT COALESCE(is_master_user(), false)) THEN
    RAISE EXCEPTION 'forbidden: org not accessible' USING ERRCODE = '42501';
  END IF;

  -- NÃO existe gate `instance required` aqui: aceitar o conjunto vazio como
  -- "tudo que eu posso ler" é o ponto desta função.
  IF p_lead_presence IS NOT NULL AND p_lead_presence NOT IN ('com', 'sem') THEN
    RAISE EXCEPTION 'invalid lead presence' USING ERRCODE = '22023';
  END IF;
  IF p_source IS NOT NULL AND p_source NOT IN ('ia', 'humano') THEN
    RAISE EXCEPTION 'invalid source' USING ERRCODE = '22023';
  END IF;

  -- ── Interseção de acesso (D4) ──────────────────────────────────────────
  v_boxes := public.whatsapp_readable_instance_ids(p_org, p_instances);

  -- Conjunto vazio devolve lista vazia, NÃO exceção. Aqui vazio é resposta de
  -- verdade e não sintoma: o gate de org já barrou quem não é da org, e a
  -- interseção só pode esvaziar quando a pessoa pediu caixas que perdeu o
  -- direito de ler. Levantar erro faria uma seleção salva ficar venenosa
  -- depois de uma mudança de permissão, quebrando a tela em vez de mostrá-la
  -- vazia. Instance de outra org também cai aqui — e isso é deliberado: quem
  -- decide o que é acessível é a função, não o argumento.
  IF cardinality(v_boxes) = 0 THEN
    RETURN;
  END IF;

  -- Expansão dos chips, UMA vez. `whatsapp_chip_instance_ids` é o mapa
  -- Instance → uuids históricos do MESMO NÚMERO, e degrada em silêncio por
  -- desenho (número desconhecido devolve o singleton) — a tolerância é
  -- mantida aqui de propósito, porque o front sobe antes da migration.
  --
  -- O `DISTINCT ON (member)` garante PARTIÇÃO: cada uuid pertence a exatamente
  -- uma caixa, então nenhuma conversa é contada duas vezes se dois chips se
  -- sobrepuserem. Medido: hoje isso não acontece — as 36 linhas de
  -- `whatsapp_instance_reap_queue` nunca são Instances vivas, e o único par de
  -- Instances vivas que divide número (Basic4u, "Bruna Basic4u" e "bruna 2",
  -- 554797890485) tem chips singleton e disjuntos. A guarda é para o dia em
  -- que isso mudar, e custa uma ordenação sobre no máximo 57 linhas.
  -- O desempate prefere a caixa que É o próprio uuid, depois a menor.
  SELECT array_agg(x.box ORDER BY x.member), array_agg(x.member ORDER BY x.member)
    INTO v_box_of, v_member_of
    FROM (
      SELECT DISTINCT ON (mm.member) b.box, mm.member
        FROM unnest(v_boxes) AS b(box)
        CROSS JOIN LATERAL unnest(public.whatsapp_chip_instance_ids(p_org, b.box)) AS mm(member)
       ORDER BY mm.member, (mm.member = b.box) DESC, b.box
    ) x;

  -- `array_agg` de zero linhas devolve NULL. Aqui isso só aconteceria se a
  -- função de chip devolvesse vazio para TODAS as caixas — impossível pelo
  -- corpo dela, que devolve ao menos o singleton, mas NULL viraria mapa vazio e
  -- lista vazia, e vazio pareceria resposta. A identidade é o fallback correto.
  IF v_member_of IS NULL THEN
    v_box_of    := v_boxes;
    v_member_of := v_boxes;
  END IF;

  v_members := v_member_of;
  v_keys    := ARRAY(SELECT t.m::text FROM unnest(v_members) AS t(m));

  -- ── Isolamento por responsável ─────────────────────────────────────────
  -- Bloco copiado da função viva, com a mesma semântica — com UMA divergência
  -- deliberada, documentada no lugar dela, algumas linhas abaixo. Esta função é
  -- SECURITY DEFINER, então o RLS de whatsapp_messages NÃO se aplica aqui: sem
  -- este bloco a política fica decorativa — a tabela fecha e a LISTA, que é o
  -- que o usuário vê, continua mostrando tudo.
  --
  -- Nota de cobertura: medido em produção, as DUAS únicas orgs com
  -- `chat_restrict_to_owner = true` (Goletric Perdizes e Goletric Pinheiros)
  -- têm ZERO whatsapp_instances. Nenhuma org exercita este bloco hoje, o que
  -- significa que ele não tem cobertura viva — mais uma razão para copiá-lo
  -- literalmente em vez de "melhorá-lo" aqui.
  SELECT COALESCE(o.chat_restrict_to_owner, false) INTO v_iso_on
  FROM public.organizations o WHERE o.id = p_org;

  IF v_iso_on THEN
    SELECT tm.id INTO v_iso_tm
    FROM public.team_members tm
    WHERE tm.user_id = auth.uid()
      AND tm.organization_id = p_org
      AND tm.is_active = true
    LIMIT 1;

    -- DIVERGÊNCIA DELIBERADA da função viva, e é a única do bloco: ela usa
    -- `is_user_admin()`, que é ORG-AGNÓSTICA (corpo vivo:
    -- `EXISTS(user_roles WHERE user_id=auth.uid() AND role='admin')` OR
    -- `EXISTS(team_members WHERE user_id=auth.uid() AND role='admin' AND
    -- is_active)` — sem `organization_id` em nenhum dos dois ramos). Com ela,
    -- quem é admin em QUALQUER org derrubaria o recorte por responsável de uma
    -- org onde é membro raso. O cabeçalho desta migration argumenta contra isso
    -- 280 linhas acima, e usá-la aqui deixaria o arquivo incoerente consigo.
    -- Exposição hoje é ZERO, medida nas duas pontas: das 147 linhas
    -- `user_roles.role='admin'`, nenhuma é de alguém que seja membro não-admin
    -- de alguma org; e das 2 orgs com `chat_restrict_to_owner`, nenhuma tem
    -- whatsapp_instance. É latente, não vivo — e a irmã nasce sem ele.
    -- `is_org_admin(p_org)` já embute o master e já exige `is_active`.
    v_iso_bypass :=
      public.is_org_admin(p_org)
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
  -- Mapa uuid-do-chip → CAIXA. É este `box` que sai no retorno: a caixa que a
  -- pessoa marcou na tela, NUNCA um uuid histórico do chip — a linha tem que
  -- dizer por qual número ela vai responder, e um uuid de instância já
  -- excluída não é resposta.
  --
  -- A partição já foi calculada acima, com UMA passada por
  -- `whatsapp_chip_instance_ids`. Aqui ela só é desempacotada.
  WITH boxes AS (
    SELECT u.box, u.member
    FROM unnest(v_box_of, v_member_of) AS u(box, member)
  ),
  -- Leitura por (caixa, telefone). A chave é `whatsapp:<instance>:<telefone>`
  -- — confirmado em prod: 19.038 linhas nesse namespace, segmento 2 sempre um
  -- uuid de 36 chars, sobre 188 Instances distintas.
  -- `max(last_read_at)` colapsa o CHIP (ter lido no número antigo conta), mas
  -- NUNCA colapsa caixas diferentes: agrupa por `box`. A função atual agrupa
  -- só por telefone, o que com uma caixa só dá no mesmo e com várias faria a
  -- leitura de uma caixa zerar o contador de outra.
  read_state AS (
    SELECT bx.box AS box,
           split_part(rs.conversation_key, ':', 3) AS np,
           max(rs.last_read_at) AS last_read_at
    FROM public.conversation_read_state rs
    JOIN boxes bx ON bx.member::text = split_part(rs.conversation_key, ':', 2)
    WHERE rs.organization_id = p_org AND rs.user_id = v_uid
      AND rs.conversation_key LIKE 'whatsapp:%'
      AND split_part(rs.conversation_key, ':', 2) = ANY(v_keys)
    GROUP BY 1, 2
  ),
  -- Uma linha de `whatsapp_conversations` por (caixa, telefone), para o
  -- `conversation_id` / `archived_at` / `deleted_at`. O desempate prefere a
  -- Instance viva da própria caixa: arquivar ou apagar a thread é ato do
  -- usuário no chip de hoje, e é essa decisão que deve valer.
  conv AS (
    SELECT bx.box AS box, c.normalized_phone AS np, c.id, c.archived_at,
           c.deleted_at, c.instance_id AS inst, c.created_at
    FROM public.whatsapp_conversations c
    JOIN boxes bx ON bx.member = c.instance_id
    WHERE c.organization_id = p_org
      AND c.instance_id = ANY(v_members)
      AND c.normalized_phone IS NOT NULL
  ),
  conv_pick AS (
    SELECT DISTINCT ON (c2.box, c2.np)
           c2.box, c2.np, c2.id, c2.archived_at, c2.deleted_at
    FROM conv c2
    ORDER BY c2.box, c2.np, (c2.inst = c2.box) DESC,
             c2.created_at DESC NULLS LAST, c2.id
  ),
  -- O conjunto inteiro, colapsado por (CAIXA, telefone) antes de qualquer
  -- filtro. `whatsapp_conversation_summary` já tem PK
  -- (organization_id, instance_id, normalized_phone), então dentro de uma
  -- Instance a linha é única; o que este DISTINCT ON colapsa são os uuids
  -- HISTÓRICOS do chip, ficando com a mensagem mais recente do número.
  chip AS (
    SELECT DISTINCT ON (bx.box, s.normalized_phone)
           bx.box AS box,
           s.phone_number, s.normalized_phone, s.last_push_name, s.last_message,
           s.last_message_time, s.last_message_direction, s.last_message_sent_source,
           s.lead_id AS lid, s.is_group AS grp
    FROM public.whatsapp_conversation_summary s
    JOIN boxes bx ON bx.member = s.instance_id
    WHERE s.organization_id = p_org
      AND s.instance_id = ANY(v_members)
      -- Grupo é 978.756 de 2.472.395 mensagens (40%): o recorte fica AQUI,
      -- antes do LIMIT e antes de trafegar.
      AND (p_include_groups OR s.is_group = false)
      -- Mesma regra do predicado can_see_chat_scope, escrita aqui para caber
      -- num único EXISTS por conversa em vez de três lookups por linha.
      AND (
        v_iso_bypass
        -- GRUPO NÃO TEM DONO: o EXISTS abaixo casa por
        -- `leads.normalized_phone`, e jid de grupo nunca é telefone de lead.
        -- Quem vê não-atribuído vê grupo; quem não vê, não vê.
        OR (s.is_group AND COALESCE(v_iso_unassign, false))
        OR EXISTS (
          SELECT 1 FROM public.leads l
          WHERE l.organization_id  = p_org
            AND l.normalized_phone = s.normalized_phone
            AND l.deleted_at IS NULL
            AND (
              COALESCE(v_iso_tm IN (
                l.pre_sale_responsible_id, l.sale_responsible_id,
                l.sdr_id, l.closer_id
              ), false)
              -- Co-dono (lead_owners, role='co'): Chamado 793f4b05 · PR4a/5.
              OR COALESCE(v_iso_tm IS NOT NULL
                          AND public.rls_lead_co_owned(l.id, ARRAY[v_iso_tm]), false)
              OR (
                COALESCE(
                  l.pre_sale_responsible_id, l.sale_responsible_id,
                  l.sdr_id, l.closer_id
                ) IS NULL
                AND v_iso_unassign
              )
            )
        )
      )
    ORDER BY bx.box, s.normalized_phone, s.last_message_time DESC
  ),
  -- Pré-filtro ANTES do LIMIT: é isto que faz o filtro enxergar a base inteira.
  -- O LIMIT é GLOBAL sobre o conjunto (D3) — a ordenação por recência é sobre
  -- a união das caixas, não por caixa.
  page AS (
    SELECT s.box, s.phone_number, s.normalized_phone, s.last_push_name,
           s.last_message, s.last_message_time, s.last_message_direction,
           s.last_message_sent_source, s.lid, s.grp
    FROM chip s
      -- CURSOR COMPOSTO — ver bloco (B) do cabeçalho. `<` estrito sobre
      -- `last_message_time` sozinho apaga conversa real na borda da página
      -- quando há empate, e sobre o CONJUNTO empate é regime, não cauda:
      -- medido, 22 conversas somem para sempre na rolagem da Alamaster.
      -- A tupla é comparada NA MESMA ORDEM e na MESMA DIREÇÃO do ORDER BY.
      -- Cursor PARCIAL (só `p_before`, o contrato antigo) devolve o empate
      -- inteiro de novo em vez de perdê-lo: repetir é visível, sumir não.
    WHERE (
        p_before IS NULL
        OR s.last_message_time < p_before
        OR (s.last_message_time = p_before
            AND (p_before_box IS NULL
                 OR p_before_phone IS NULL
                 OR (s.box, s.normalized_phone) < (p_before_box, p_before_phone)))
      )

      AND (p_waiting IS NOT TRUE OR s.last_message_direction = 'incoming')
      AND (
        p_source IS NULL
        OR (p_source = 'humano' AND s.last_message_sent_source = 'manual')
        OR (p_source = 'ia' AND s.last_message_sent_source IN ('copilot', 'workflow'))
      )
      AND (
        p_lead_presence IS NULL
        OR (p_lead_presence = 'com' AND s.lid IS NOT NULL)
        OR (p_lead_presence = 'sem' AND s.lid IS NULL)
      )

      -- FILTRO de não-lida: `EXISTS`, não contagem. Ver bloco (C) no cabeçalho
      -- — 22 ms contra 5,8 s do agregado, porque curto-circuita na primeira
      -- mensagem e deixa o planner parar no LIMIT.
      AND (
        p_unread IS NOT TRUE
        OR public.is_conversation_marked_unread(p_org, s.box, s.normalized_phone)
        OR EXISTS (
             SELECT 1
             FROM public.whatsapp_messages m
             LEFT JOIN read_state r ON r.box = s.box AND r.np = s.normalized_phone
             WHERE m.organization_id  = p_org
               -- SÓ o chip DESTA caixa, nunca `= ANY(v_members)`: v_members é o
               -- achatado de TODOS os chips, e um telefone que fala com duas
               -- caixas passaria no filtro por causa da mensagem da OUTRA.
               AND m.instance_id IN (SELECT bb.member FROM boxes bb WHERE bb.box = s.box)
               AND m.normalized_phone = s.normalized_phone
               AND m.direction        = 'incoming'
               AND m.deleted_at IS NULL
               AND (p_include_groups OR m.is_group = false)
               AND m."timestamp" > now() - interval '30 days'
               AND m."timestamp" > COALESCE(r.last_read_at, now() - interval '7 days')
           )
      )

      AND (
        p_needs_human IS NOT TRUE
        OR (s.lid IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.conversations cv
              WHERE cv.organization_id = p_org AND cv.lead_id = s.lid
                AND cv.state = 'WAITING_HUMAN'))
      )

      -- `qualification_tier` é ENUM: o cast pro texto permite comparar com o
      -- array de strings da UI — valor desconhecido vira "não casa", não erro.
      AND (
        p_tiers IS NULL
        OR (s.lid IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.leads l
              WHERE l.id = s.lid AND l.organization_id = p_org
                AND l.qualification_tier::text = ANY(p_tiers)))
      )

      AND (
        p_unassigned IS NOT TRUE
        OR s.lid IS NULL
        OR EXISTS (
              SELECT 1 FROM public.leads l
              WHERE l.id = s.lid AND l.organization_id = p_org
                AND l.responsible_id IS NULL)
      )
      AND (
        p_vendor_id IS NULL
        OR (s.lid IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.leads l
              WHERE l.id = s.lid AND l.organization_id = p_org
                AND l.responsible_id = p_vendor_id))
      )

      AND (
        p_funnels IS NULL
        OR (s.lid IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.pipeline_entries pe
              WHERE pe.organization_id = p_org AND pe.lead_id = s.lid
                AND pe.pipeline_id = ANY(p_funnels)))
      )

      AND (
        p_stages IS NULL
        OR (s.lid IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.pipeline_entries pe
              WHERE pe.organization_id = p_org AND pe.lead_id = s.lid
                AND pe.stage_key = ANY(p_stages)
                AND (p_funnels IS NULL OR pe.pipeline_id = ANY(p_funnels))))
      )

      -- A tag da CONVERSA é procurada dentro da MESMA caixa (`c3.box = s.box`).
      -- Sem isso, a etiqueta posta numa caixa faria a conversa homônima de
      -- outra caixa aparecer no filtro.
      AND (
        p_tags IS NULL
        OR (s.lid IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.lead_tags lt
              WHERE lt.lead_id = s.lid AND lt.tag_id = ANY(p_tags)))
        OR EXISTS (
              SELECT 1 FROM conv c3
              JOIN public.whatsapp_conversation_tags ct ON ct.conversation_id = c3.id
              WHERE c3.box = s.box AND c3.np = s.normalized_phone
                AND ct.tag_id = ANY(p_tags))
      )
    -- ORDEM TOTAL. `(box, normalized_phone)` é a chave do DISTINCT ON de `chip`,
    -- logo é única, logo esta ordenação não tem empate — e é ela que torna o
    -- cursor composto acima uma posição, e não um grupo. As três colunas DESC.
    ORDER BY s.last_message_time DESC, s.box DESC, s.normalized_phone DESC
    LIMIT v_limit
  )
  SELECT p.box, p.phone_number, p.normalized_phone, p.last_push_name, p.last_message,
         p.last_message_time, p.last_message_direction, p.last_message_sent_source,
         p.lid, p.grp, cp.id, cp.archived_at, GREATEST(COALESCE(u.cnt, 0)::integer, CASE WHEN public.is_conversation_marked_unread(p_org, p.box, p.normalized_phone) THEN 1 ELSE 0 END)
  FROM page p
  LEFT JOIN conv_pick cp ON cp.box = p.box AND cp.np = p.normalized_phone
  -- CONTAGEM de não-lida: só para as linhas da página, depois do LIMIT.
  -- Ver bloco (C) no cabeçalho — 112 ms a quente para 50 conversas nas 57
  -- caixas da Alamaster, contra 5,8 s do agregado sobre o conjunto inteiro.
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS cnt
    FROM public.whatsapp_messages m
    LEFT JOIN read_state r ON r.box = p.box AND r.np = p.normalized_phone
    WHERE m.organization_id  = p_org
      -- SÓ o chip DESTA caixa. `= ANY(v_members)` somaria as não-lidas de
      -- TODAS as caixas na linha de cada uma: o contato que fala com duas
      -- caixas mostraria o mesmo total inflado nas duas linhas.
      AND m.instance_id IN (SELECT bb.member FROM boxes bb WHERE bb.box = p.box)
      AND m.normalized_phone = p.normalized_phone
      AND m.direction        = 'incoming'
      AND m.deleted_at IS NULL
      AND (p_include_groups OR m.is_group = false)
      AND m."timestamp" > now() - interval '30 days'
      AND m."timestamp" > COALESCE(r.last_read_at, now() - interval '7 days')
  ) u ON true
  WHERE cp.deleted_at IS NULL
  -- Mesma ordem TOTAL do CTE `page`: é desta última linha que o cliente tira o
  -- cursor da página seguinte, então as duas ordenações têm que coincidir.
  ORDER BY p.last_message_time DESC, p.box DESC, p.normalized_phone DESC;
END;
$function$;

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

CREATE OR REPLACE FUNCTION public.oraculo_chat_scope_allows(
  p_organization_id uuid,
  p_team_member_id uuid,
  p_lead_id uuid,
  p_instance_id uuid
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.leads l
    JOIN public.whatsapp_instances wi
      ON wi.id = p_instance_id AND wi.organization_id = p_organization_id
    WHERE l.id = p_lead_id
      AND l.organization_id = p_organization_id
      AND (
        p_team_member_id IS NULL
        OR (
          (
            p_team_member_id IN (l.sdr_id, l.closer_id, l.pre_sale_responsible_id, l.sale_responsible_id)
            -- Co-dono (PR4a/5). Chamada por service_role, sem auth.uid():
            -- rls_lead_co_owned não serve aqui, o membro vem no argumento.
            OR EXISTS (
              SELECT 1 FROM public.lead_owners o
              WHERE o.lead_id = l.id
                AND o.organization_id = p_organization_id
                AND o.role = 'co'
                AND o.team_member_id = p_team_member_id
            )
          )
          AND (
            EXISTS (
              SELECT 1 FROM public.whatsapp_instance_allowed_members a
              WHERE a.whatsapp_instance_id = p_instance_id
                AND a.team_member_id = p_team_member_id
                AND EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.id=p_team_member_id AND tm.organization_id=p_organization_id AND tm.is_active)
            )
          )
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_link_or_read_lead(p_lead_id uuid, p_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM public.leads l
     WHERE l.id = p_lead_id
       AND l.organization_id = p_org
       AND l.deleted_at IS NULL
       AND (
         COALESCE(public.is_master_user(), false)
         OR COALESCE(public.is_user_admin(), false)
         OR public.has_feature_permission('leads.view_all', l.organization_id)
         OR public.is_user_responsible(l.pre_sale_responsible_id, l.sale_responsible_id)
         OR public.can_see_lead_by_permissions(l.sdr_id, l.closer_id)
         OR public.is_user_responsible_in_any_pipe(l.id)
         OR public.rls_lead_co_owned(l.id, (SELECT public.rls_my_team_member_ids(false))::uuid[])
       )
  );
$fn$;

CREATE OR REPLACE FUNCTION public.voip_can_see_call(p_lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_lead_id IS NULL THEN true
    ELSE COALESCE(
      (SELECT (public.can_see_lead_by_permissions(l.pre_sale_responsible_id, l.sale_responsible_id)
              OR public.rls_lead_co_owned(l.id, (SELECT public.rls_my_team_member_ids(false))::uuid[]))
         FROM public.leads l
        WHERE l.id = p_lead_id),
      false)
  END
$$;

COMMIT;
