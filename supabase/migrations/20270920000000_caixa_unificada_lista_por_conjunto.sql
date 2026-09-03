-- ============================================================================
-- CAIXA DE ENTRADA UNIFICADA — as listas de conversa passam a aceitar um
-- CONJUNTO de Instances (SCRUM-649 / W1 do épico SCRUM-648)
--
-- Hoje as duas funções de lista exigem UMA Instance não nula (recusam com
-- `22023 instance required`) e não dizem de qual Instance a linha veio. Quem
-- tem mais de uma caixa não tem visão do que está chegando: precisa lembrar de
-- trocar de caixa, e escolher a errada é indistinguível de "ninguém falou
-- comigo".
--
-- Medido em produção em 2026-09-03:
--   42 Organizations com 1 Instance, 18 com 2 a 4, uma com 6, a Alamaster
--   (636776d8-6282-48bc-b190-764d42785a5b) com 57.
--   Membro não-admin da Alamaster enxerga de 8 a 16 caixas; admin, 57.
--   Em todas as outras orgs, 1 ou 2. O modo unificado é barato no caso comum.
--
-- Esta migration cria TRÊS funções NOVAS e não toca em nenhuma existente.
--
-- ⚠️ FUNÇÕES IRMÃS, NÃO ALTERAÇÃO DAS ATUAIS (decisão D2 do spec).
--    `get_whatsapp_conversation_list` tem 16 parâmetros e já sofreu `PGRST203`
--    por sobrecarga. Trocar `p_instance uuid` por `p_instances uuid[]` não é
--    `CREATE OR REPLACE` — é assinatura nova, logo `DROP` + `CREATE`, e neste
--    projeto o DROP já devolveu `EXECUTE` a `PUBLIC` em silêncio
--    (`20260727140438_inbox_filter_grants_tighten` documenta o episódio).
--    Aqui NÃO há DROP nenhum: as atuais seguem servindo a bolha, a command
--    palette e o mobile sem uma linha de mudança.
--
-- ⚠️ NENHUMA das três lê `src/integrations/supabase/types.ts` — o arquivo é
--    gerado de prod e esta migration ainda não está lá. Todo call-site nasce
--    precisando de cast, como já acontece em `useOfficialWhatsAppContacts.ts`.
--
-- Ordem de entrega: (1) esta migration, (2) deploy do front. Invertendo, o
-- front chama função que não existe e leva `PGRST202`.
-- ============================================================================


-- ============================================================================
-- 1. whatsapp_readable_instance_ids — a interseção de acesso (decisão D4)
-- ============================================================================
--
-- O cliente NUNCA é autoridade sobre o conjunto de caixas. O que ele pede é
-- cruzado aqui com o que a pessoa pode ler. Sem isto, a multi-seleção seria a
-- porta lateral do recorte por Instance que a Alamaster e a Café Jurerê usam.
--
-- Semântica, espelhando exatamente `useWhatsAppInstancesForUser` no front:
--   • master e admin DA ORGANIZATION veem todas as Instances dela;
--   • Instance SEM linha em `whatsapp_instance_allowed_members` é aberta à
--     Organization inteira (é o COMMENT da própria tabela: "Vazio = todos da
--     org podem responder");
--   • Instance COM lista é visível só a quem está na lista;
--   • Instance de outra Organization NUNCA entra, mesmo que pedida;
--   • conjunto vazio ou nulo significa "todas as que eu posso ler", não
--     "nenhuma" — é assim que a tela abre antes de a pessoa marcar nada.
--
-- ⚠️ PRECISA SER `SECURITY DEFINER`. `whatsapp_instance_allowed_members` tem
--    RLS ligada. Uma guarda não-DEFINER leria ZERO linhas por não conseguir
--    ler, concluiria "nenhuma Instance tem lista" e liberaria TODAS — vazio
--    pareceria resposta. O front tem exatamente esse defeito hoje: os dois
--    `select` de allowed_members descartam o `error`, e erro vira `[]`, que
--    vira "sem restrição". Fail-OPEN. Esta função é fail-closed.
--
-- ⚠️ O bypass usa `is_org_admin(p_org)`, NÃO `is_user_admin()`.
--    Medido: `is_user_admin()` é ORG-AGNÓSTICO — devolve true para quem é admin
--    em QUALQUER org (corpo vivo: `EXISTS (SELECT 1 FROM team_members WHERE
--    user_id = auth.uid() AND role = 'admin' AND is_active)`, sem
--    organization_id). Usá-lo aqui daria a um admin da org B acesso a todas as
--    Instances da org A onde ele é membro raso. `is_org_admin(p_org)` já
--    embute o master e já exige `is_active`.
--
-- ⚠️ O bypass de admin é LOAD-BEARING, não decoração. Medido na Alamaster:
--    pela regra de lista pura, o admin "Gabriel" veria 0 caixas (as 57 têm
--    lista e ele não está em nenhuma) e o "Alamaster Admin" veria 56 de 57.
--    Sem o bypass, esta função TIRARIA caixas de quem hoje as tem.
--
-- ⚠️ NÃO filtra `status <> 'error'`, que o seletor do front aplica. Aquele
--    filtro decide o que é OFERECÍVEL no seletor; este é um gate de ACESSO.
--    Uma caixa que entrasse em erro no meio do expediente sumiria da lista
--    junto com suas conversas. Medido: hoje nenhuma Instance está em 'error'
--    (123 connected, 28 disconnected), então a diferença é inerte na prática.
--
-- ⚠️ O master/gestor virtual do front tem `team_member.id` SINTÉTICO
--    (`master-virtual-*`, ADR-0021) que NÃO existe no banco. Nenhum
--    `team_member_id = ...` casaria com ele. Por isso o bypass sai de
--    `is_org_admin()`, nunca de um id de team_member.
CREATE OR REPLACE FUNCTION public.whatsapp_readable_instance_ids(
  p_org       uuid,
  p_instances uuid[] DEFAULT NULL::uuid[]
)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_bypass boolean;
  v_tm     uuid;
  v_out    uuid[];
BEGIN
  -- Gate de acesso à org, na forma canônica das irmãs. `NOT EXISTS` e não
  -- `NOT (x IN (...))`: `IN` com NULL na lista devolve NULL, e `IF NULL THEN`
  -- não dispara — gate ABERTO em vez de erro. `team_members.organization_id` é
  -- NULLABLE em prod, então a lista realmente pode conter NULL.
  IF p_org IS NULL
     OR (NOT EXISTS (
           SELECT 1 FROM public.get_my_organization_ids() AS g(org_id)
            WHERE g.org_id = p_org)
         AND NOT COALESCE(is_master_user(), false)) THEN
    RAISE EXCEPTION 'forbidden: org not accessible' USING ERRCODE = '42501';
  END IF;

  v_bypass := COALESCE(public.is_org_admin(p_org), false);
  v_tm     := public.my_team_member_id(p_org);

  SELECT array_agg(wi.id ORDER BY wi.id)
    INTO v_out
    FROM public.whatsapp_instances wi
   WHERE wi.organization_id = p_org
     -- Conjunto vazio/nulo = "todas as que eu posso ler". `cardinality` e não
     -- `array_length`, que devolve NULL para array vazio em vez de 0.
     AND (p_instances IS NULL
          OR cardinality(p_instances) = 0
          OR wi.id = ANY(p_instances))
     AND (
       v_bypass
       OR NOT EXISTS (
            SELECT 1 FROM public.whatsapp_instance_allowed_members a
             WHERE a.whatsapp_instance_id = wi.id)
       OR (v_tm IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.whatsapp_instance_allowed_members a
             WHERE a.whatsapp_instance_id = wi.id
               AND a.team_member_id = v_tm))
     );

  -- `array_agg` de zero linhas devolve NULL, e `x = ANY(NULL)` é NULL, que num
  -- WHERE se comporta como false — funcionaria por acidente. Devolver `'{}'`
  -- torna a ausência explícita para quem lê o retorno.
  RETURN COALESCE(v_out, ARRAY[]::uuid[]);
END;
$function$;

COMMENT ON FUNCTION public.whatsapp_readable_instance_ids(uuid, uuid[]) IS
  'Interseção de acesso da Caixa de Entrada Unificada (SCRUM-649). Recebe as '
  'Instances pedidas pelo cliente e devolve as que o chamador pode de fato ler. '
  'Instance sem linha em whatsapp_instance_allowed_members é aberta à org; com '
  'lista, só a quem está nela; admin da org e master passam por cima; Instance '
  'de outra org nunca entra. Conjunto vazio/nulo = todas as legíveis. '
  'SECURITY DEFINER porque allowed_members tem RLS: sem isso leria vazio e '
  'liberaria tudo.';


-- ============================================================================
-- 2. get_whatsapp_conversation_list_multi — a irmã do Chip
-- ============================================================================
--
-- Mesmos 15 filtros da atual, mesma forma de retorno MAIS `instance_id`: a
-- caixa de origem da linha. Três diferenças de mecanismo, todas medidas:
--
-- ⚠️ (A) O `DISTINCT ON` é por (CHIP, TELEFONE), nunca só por telefone.
--    Um "chip" é o conjunto de uuids que já pertenceram àquele NÚMERO:
--    instância excluída e recriada mantém histórico, e
--    `whatsapp_chip_instance_ids` expande isso. Colapsar por telefone através
--    de chips DIFERENTES funde conversas departamentais distintas.
--    MEDIDO NA ALAMASTER: as 57 caixas somam 10.141 Conversas do Lead
--    (não-grupo) sobre 5.688 telefones distintos. Um `DISTINCT ON` só por
--    telefone apagaria 4.453 conversas reais da tela, sem sinal nenhum — o
--    orçamento pedido no comercial e o chamado aberto na técnica virariam uma
--    linha só. Lá os 57 números são distintos entre si, então chip e Instance
--    são 1:1; a distinção só aparece quando há histórico de chip.
--    Isto É o modelo, não efeito colateral: o glossário define Conversa do
--    Lead como o par (Lead ↔ inbox), e um Lead mantém várias ao mesmo tempo.
--
-- ⚠️ (B) O limite é GLOBAL sobre o conjunto, aplicado DEPOIS da união.
--    Limite por caixa com ordenação no cliente faz a paginação mentir:
--    conversa real some da lista sem sinal. O cursor `p_before` continua sendo
--    o mecanismo de paginação — e vale notar que ele existe na função atual e
--    NENHUM call-site do front o manda hoje. A irmã nasce com ele exercitado.
--
-- ⚠️ (C) A não-lida NÃO é mais um agregado sobre o conjunto inteiro.
--    MEDIDO, e é a razão de a função ter esta forma: agregar
--    `whatsapp_messages` por (instance, telefone) nas 57 caixas da Alamaster
--    custa 37 s a quente / 75 s a frio na janela de 30 dias, e 5,8 s a quente
--    já com o piso real de 7 dias — 22.288 linhas lidas com 22.292 heap
--    fetches, porque o visibility map desta tabela nunca está limpo (ela
--    recebe escrita o tempo todo, o "Index Only Scan" é índice + heap
--    completo). A tela morreria de timeout na maior org do produto.
--    A função atual escapa disso só porque agrega UMA Instance.
--    Duas formas substituem o agregado, e cada uma foi medida:
--      • CONTAGEM devolvida: `LATERAL` por linha da PÁGINA, depois do LIMIT.
--        Calcular 3.353 contadores para mostrar 50 é desperdício.
--        Página de 50 nas 57 caixas, já com o recorte por caixa do parágrafo
--        seguinte: 112 ms a quente, 5,3 s no primeiro toque a frio.
--      • FILTRO `p_unread`: `EXISTS` por conversa candidata, ANTES do LIMIT —
--        precisa ser antes, senão o filtro não enxerga a base. `EXISTS`
--        curto-circuita na primeira linha e deixa o planner parar cedo:
--        22 ms, avaliando 52 candidatas para devolver 50.
--    Nos DOIS caminhos a não-lida é contada só no CHIP DA PRÓPRIA CAIXA
--    (`m.instance_id IN (SELECT member FROM boxes WHERE box = <a caixa da
--    linha>)`), NUNCA em `v_members`, que é o achatado de todos os chips.
--    MEDIDO no telefone 21980295482 da Alamaster, que tem conversa viva em
--    duas caixas: com `v_members` as DUAS linhas mostram 19 não-lidas; com o
--    recorte por caixa, 19 numa e 0 na outra. O 0 é a verdade — aquela caixa
--    nunca recebeu essas mensagens. Sem o recorte, o badge manda a pessoa
--    abrir uma conversa vazia e a lista deixa de ser confiável.
--    Nenhum índice novo: os dois caminhos casam
--    `idx_whatsapp_msgs_org_phone_instance_ts`
--    (organization_id, normalized_phone, instance_id, "timestamp" DESC), que
--    já existe. Igualdade nas duas primeiras colunas torna a ordem delas
--    indiferente.
--
-- ⚠️ `leads.qualification_tier` é ENUM (diamante, ouro, prata, bronze,
--    desqualificado). O cast `::text` é obrigatório: sem ele,
--    `qualification_tier = ANY(text[])` levanta
--    `42883 operator does not exist: qualification_tier = text` — medido — e
--    quebraria só em runtime, quando alguém filtrasse por qualificação. Com o
--    cast, valor desconhecido vira "não casa", não erro.
--
-- ⚠️ Toda referência a coluna é QUALIFICADA. Os nomes do `RETURNS TABLE`
--    (`instance_id`, `lead_id`, `phone_number`, `is_group`, ...) viram
--    variáveis PL/pgSQL e sombreiam colunas homônimas. As CTEs usam nomes
--    próprios (`box`, `np`) exatamente para não depender disso.
CREATE OR REPLACE FUNCTION public.get_whatsapp_conversation_list_multi(
  p_org            uuid,
  p_instances      uuid[]      DEFAULT NULL::uuid[],
  p_limit          integer     DEFAULT 50,
  p_before         timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_funnels        uuid[]      DEFAULT NULL::uuid[],
  p_stages         text[]      DEFAULT NULL::text[],
  p_tags           uuid[]      DEFAULT NULL::uuid[],
  p_tiers          text[]      DEFAULT NULL::text[],
  p_vendor_id      uuid        DEFAULT NULL::uuid,
  p_unassigned     boolean     DEFAULT NULL::boolean,
  p_lead_presence  text        DEFAULT NULL::text,
  p_needs_human    boolean     DEFAULT NULL::boolean,
  p_unread         boolean     DEFAULT NULL::boolean,
  p_waiting        boolean     DEFAULT NULL::boolean,
  p_source         text        DEFAULT NULL::text,
  p_include_groups boolean     DEFAULT false
)
RETURNS TABLE(
  instance_id              uuid,
  phone_number             text,
  normalized_phone         text,
  push_name                text,
  last_message             text,
  last_message_time        timestamp with time zone,
  last_message_direction   text,
  last_message_sent_source text,
  lead_id                  uuid,
  is_group                 boolean,
  conversation_id          uuid,
  archived_at              timestamp with time zone,
  unread_count             integer
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid    := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 1000);
  -- As caixas que o usuário pode de fato ler, já cruzadas com o pedido.
  v_boxes   uuid[];
  -- Todos os uuids de todos os chips das caixas acima, achatados. Serve só
  -- para pré-filtrar leitura; o mapeamento uuid → caixa fica na CTE `boxes`.
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

  -- Achatado dos chips. `whatsapp_chip_instance_ids` é o mapa
  -- Instance → uuids históricos do MESMO NÚMERO, e degrada em silêncio por
  -- desenho (número desconhecido devolve o singleton) — a tolerância é
  -- mantida aqui de propósito, porque o front sobe antes da migration.
  SELECT array_agg(DISTINCT mm.member)
    INTO v_members
    FROM unnest(v_boxes) AS b(box)
    CROSS JOIN LATERAL unnest(public.whatsapp_chip_instance_ids(p_org, b.box)) AS mm(member);
  v_members := COALESCE(v_members, v_boxes);
  v_keys    := ARRAY(SELECT t.m::text FROM unnest(v_members) AS t(m));

  -- ── Isolamento por responsável ─────────────────────────────────────────
  -- Bloco COPIADO da função viva, com a mesma semântica, de propósito. Esta
  -- função é SECURITY DEFINER, então o RLS de whatsapp_messages NÃO se aplica
  -- aqui: sem este bloco a política fica decorativa — a tabela fecha e a
  -- LISTA, que é o que o usuário vê, continua mostrando tudo.
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
  -- Mapa uuid-do-chip → CAIXA. É este `box` que sai no retorno: a caixa que a
  -- pessoa marcou na tela, NUNCA um uuid histórico do chip — a linha tem que
  -- dizer por qual número ela vai responder, e um uuid de instância já
  -- excluída não é resposta.
  --
  -- O `DISTINCT ON (member)` garante PARTIÇÃO: cada uuid pertence a exatamente
  -- uma caixa, então nenhuma conversa é contada duas vezes se dois chips se
  -- sobrepuserem. Medido: hoje isso não acontece — as 36 linhas de
  -- `whatsapp_instance_reap_queue` nunca são Instances vivas, e o único par de
  -- Instances vivas que divide número (Basic4u, "Bruna Basic4u" e "bruna 2",
  -- 554797890485) tem chips singleton e disjuntos. A guarda é para o dia em
  -- que isso mudar, e custa uma ordenação sobre no máximo 57 linhas.
  WITH boxes AS (
    SELECT DISTINCT ON (x.member) x.box, x.member
    FROM (
      SELECT b.box, mm.member
      FROM unnest(v_boxes) AS b(box)
      CROSS JOIN LATERAL unnest(public.whatsapp_chip_instance_ids(p_org, b.box)) AS mm(member)
    ) x
    ORDER BY x.member, (x.member = x.box) DESC, x.box
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
    WHERE (p_before IS NULL OR s.last_message_time < p_before)

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
    ORDER BY s.last_message_time DESC
    LIMIT v_limit
  )
  SELECT p.box, p.phone_number, p.normalized_phone, p.last_push_name, p.last_message,
         p.last_message_time, p.last_message_direction, p.last_message_sent_source,
         p.lid, p.grp, cp.id, cp.archived_at, COALESCE(u.cnt, 0)::integer
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
  ORDER BY p.last_message_time DESC;
END;
$function$;

COMMENT ON FUNCTION public.get_whatsapp_conversation_list_multi(
  uuid, uuid[], integer, timestamptz, uuid[], text[], uuid[], text[], uuid,
  boolean, text, boolean, boolean, boolean, text, boolean) IS
  'Caixa de Entrada Unificada, lado Chip (SCRUM-649). Irmã de '
  'get_whatsapp_conversation_list: aceita um CONJUNTO de Instances, devolve a '
  'caixa de origem em cada linha, DISTINCT ON por (chip, telefone) e limite '
  'GLOBAL por recência sobre o conjunto. O conjunto pedido é cruzado com '
  'whatsapp_readable_instance_ids; o recorte por responsável segue por '
  'conversa. Não substitui a função de uma Instance, que segue intacta.';


-- ============================================================================
-- 3. get_official_whatsapp_conversation_list_multi — a irmã do Canal Oficial
-- ============================================================================
--
-- ⚠️ O `DISTINCT ON` é por (instance_id, contact_external_id) e o `ORDER BY`
--    repete essa ordem antes do `"timestamp" DESC`. Não é estilo: é o que casa
--    `idx_channel_messages_instance_thread`
--    (organization_id, instance_id, contact_external_id, "timestamp" DESC)
--    WHERE contact_external_id IS NOT NULL AND instance_id IS NOT NULL.
--    MEDIDO em prod (PostgreSQL 17.6): com essa ordem o plano é
--    `Index Scan using idx_channel_messages_instance_thread` SEM nó de Sort,
--    0,57 ms para o conjunto — o PG17 devolve resultado ordenado mesmo com
--    `= ANY(array)` na coluna do meio. Trocar a ordem das chaves reintroduz um
--    Sort sobre a tabela inteira. NENHUM índice novo é necessário.
--
-- ⚠️ Cada linha é UMA caixa. A função de uma Instance faz
--    `DISTINCT ON (contact_external_id)`; aqui o `instance_id` entra na chave,
--    senão o mesmo contato falando com duas caixas viraria uma linha só —
--    exatamente a fusão que a decisão D1 recusa.
--
-- ⚠️ TELEFONE CRU × CANÔNICO. `channel_messages.contact_external_id` é CRU:
--    medido no canal oficial da Chique (7312692e-…), 22 contatos, 17 com 13
--    dígitos e 5 com 12. `leads.normalized_phone` é canônico. A comparação é
--    por VARIANTES, nunca por igualdade direta — e a medição é categórica:
--      igualdade crua ................................ 0 de 22 contatos
--      normalize_brazilian_phone(contact_external_id) . 7 de 22
--      contact_external_id = ANY(fn_phone_match_forms(l.normalized_phone)) . 7 de 22
--    As duas formas de variante acham EXATAMENTE o mesmo conjunto. Fica a
--    `normalize_brazilian_phone`, e a razão é de plano, não de gosto: ela põe
--    a expressão do lado do ARGUMENTO, então a busca usa
--    `idx_leads_org_phone_unique` (organization_id, normalized_phone) como
--    igualdade; `fn_phone_match_forms` põe a expressão do lado da COLUNA e
--    nenhum índice de `leads` a serve, custando varredura por conversa.
--    É também a mesma função que produz `leads.normalized_phone`, então não há
--    duas normalizações para divergir no primeiro DDD de 8 dígitos.
--
-- ⚠️ `can_see_chat_scope` continua sendo chamada POR CONVERSA, com
--    `p_lead_id => NULL`: a resolução de dono cai no ramo por
--    `normalized_phone`, que é o caminho certo aqui.
--
-- ⚠️ Sem expansão por chip neste lado, igual à função de uma Instance:
--    `channel_messages` é escrita pela Instance viva e o Canal Oficial não tem
--    histórico de número (a Instance dele tem `phone_number` NULO — medido na
--    Chique: 1 das 2 Instances sem número, que é justamente a oficial).
CREATE OR REPLACE FUNCTION public.get_official_whatsapp_conversation_list_multi(
  p_org       uuid,
  p_instances uuid[]  DEFAULT NULL::uuid[],
  p_limit     integer DEFAULT 50,
  p_before    timestamp with time zone DEFAULT NULL::timestamp with time zone
)
RETURNS TABLE(
  instance_id            uuid,
  contact_external_id    text,
  sender_name            text,
  sender_profile_pic     text,
  contact_handle         text,
  last_message           text,
  last_message_time      timestamp with time zone,
  last_message_direction text,
  unread_count           integer,
  lead_id                uuid,
  lead_name              text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid    := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 1000);
  v_boxes uuid[];
BEGIN
  IF p_org IS NULL
     OR (NOT EXISTS (
           SELECT 1 FROM public.get_my_organization_ids() AS g(org_id)
            WHERE g.org_id = p_org)
         AND NOT COALESCE(is_master_user(), false)) THEN
    RAISE EXCEPTION 'forbidden: org not accessible' USING ERRCODE = '42501';
  END IF;

  -- A função de uma Instance tem um gate explícito
  -- `forbidden: instance not in org` para transformar silêncio em erro. Aqui
  -- esse gate está DENTRO de whatsapp_readable_instance_ids, que filtra por
  -- `wi.organization_id = p_org`: uuid de outra org simplesmente não entra no
  -- conjunto. A diferença é deliberada — com N caixas pedidas, uma única
  -- inválida não pode derrubar a lista inteira das válidas.
  v_boxes := public.whatsapp_readable_instance_ids(p_org, p_instances);

  IF cardinality(v_boxes) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH thread AS (
    -- Última mensagem de cada (caixa, interlocutor). Ordem casada com
    -- idx_channel_messages_instance_thread — ver ⚠️ no cabeçalho.
    --
    -- `m.lead_id` NÃO é lido: é CACHE, e cache que nasce nulo em toda linha
    -- nova apagaria o vínculo da tela a cada mensagem recebida. O vínculo sai
    -- do LATERAL contra `leads`, por telefone.
    SELECT DISTINCT ON (m.instance_id, m.contact_external_id)
           m.instance_id         AS inst,
           m.contact_external_id AS cid,
           m.content             AS body,
           m."timestamp"         AS ts,
           m.direction           AS dir
      FROM public.channel_messages m
     WHERE m.organization_id     = p_org
       AND m.instance_id         = ANY(v_boxes)
       AND m.contact_external_id IS NOT NULL
     ORDER BY m.instance_id, m.contact_external_id, m."timestamp" DESC
  ),
  contact_identity AS (
    -- NOME E AVATAR SAEM DA ÚLTIMA MENSAGEM **RECEBIDA**, NÃO DA ÚLTIMA.
    -- `sender_name`/`sender_profile_pic` descrevem QUEM MANDOU aquela linha:
    -- numa mensagem de SAÍDA são a NOSSA conta, e toda conversa já respondida
    -- apareceria com o nome da própria org. O envio pela caixa oficial já
    -- existe (#1640) e grava nesta mesma tabela, então o defeito não é
    -- latente: a primeira resposta do vendedor já o produziria.
    SELECT DISTINCT ON (m.instance_id, m.contact_external_id)
           m.instance_id         AS inst,
           m.contact_external_id AS cid,
           m.sender_name         AS s_name,
           m.sender_profile_pic  AS s_pic,
           m.contact_handle      AS s_handle
      FROM public.channel_messages m
     WHERE m.organization_id     = p_org
       AND m.instance_id         = ANY(v_boxes)
       AND m.contact_external_id IS NOT NULL
       AND m.direction           = 'incoming'
     ORDER BY m.instance_id, m.contact_external_id, m."timestamp" DESC
  ),
  unread AS (
    -- Chave de leitura MONTADA por CAIXA:
    -- `whatsapp_oficial:<instance_id>:<contact_external_id>`. Confirmado em
    -- prod (27 linhas nesse namespace). O namespace é `whatsapp_oficial:` e
    -- NÃO `whatsapp:`, porque aquele é fatiado por `split_part(...,3)` como se
    -- o segmento fosse telefone.
    -- `m.instance_id` na chave, não um escalar: com N caixas, a leitura de uma
    -- não pode zerar o contador de outra.
    SELECT m.instance_id AS inst, m.contact_external_id AS cid,
           count(*)::integer AS cnt
      FROM public.channel_messages m
      LEFT JOIN public.conversation_read_state rs
             ON rs.organization_id  = p_org
            AND rs.user_id          = v_uid
            AND rs.conversation_key = 'whatsapp_oficial:' || m.instance_id::text
                                      || ':' || m.contact_external_id
     WHERE m.organization_id     = p_org
       AND m.instance_id         = ANY(v_boxes)
       AND m.contact_external_id IS NOT NULL
       AND m.direction           = 'incoming'
       AND m."timestamp" > COALESCE(rs.last_read_at, now() - interval '7 days')
     GROUP BY 1, 2
  )
  SELECT t.inst,
         t.cid,
         ci.s_name,
         ci.s_pic,
         ci.s_handle,
         t.body,
         t.ts,
         t.dir,
         COALESCE(u.cnt, 0)::integer,
         l.id,
         l.name
    FROM thread t
    LEFT JOIN contact_identity ci ON ci.inst = t.inst AND ci.cid = t.cid
    LEFT JOIN unread u            ON u.inst  = t.inst AND u.cid  = t.cid
    -- Vínculo por TELEFONE, com a expressão do lado do argumento para usar
    -- idx_leads_org_phone_unique — ver ⚠️ de telefone cru no cabeçalho.
    -- LATERAL com LIMIT 1 porque telefone repetido em dois leads é estado
    -- possível; sem ele a mesma conversa sairia duplicada.
    -- `can_link_or_read_lead`: esta RPC é DEFINER, então sem o predicado o
    -- JOIN entregaria o NOME de um lead que a RLS esconde deste usuário.
    LEFT JOIN LATERAL (
      SELECT l2.id, l2.name
        FROM public.leads l2
       WHERE l2.organization_id  = p_org
         AND l2.deleted_at IS NULL
         AND l2.normalized_phone = public.normalize_brazilian_phone(t.cid)
         AND public.can_link_or_read_lead(l2.id, p_org)
       ORDER BY l2.created_at NULLS LAST, l2.id
       LIMIT 1
    ) l ON true
   -- p_before é cursor sobre a CONVERSA (a última mensagem dela), aplicado
   -- FORA do DISTINCT ON: dentro, mudaria QUAL mensagem é a última de cada
   -- thread em vez de paginar. O limite é GLOBAL sobre o conjunto (D3).
   WHERE (p_before IS NULL OR t.ts < p_before)
     -- Isolamento por responsável (#1629), por CONVERSA. Devolve true de saída
     -- quando a política está desligada, que é o caso de todas as orgs com
     -- canal oficial hoje.
     AND public.can_see_chat_scope(p_org, NULL, public.normalize_brazilian_phone(t.cid))
   ORDER BY t.ts DESC
   LIMIT v_limit;
END;
$function$;

COMMENT ON FUNCTION public.get_official_whatsapp_conversation_list_multi(
  uuid, uuid[], integer, timestamptz) IS
  'Caixa de Entrada Unificada, lado Canal Oficial (SCRUM-649). Irmã de '
  'get_official_whatsapp_conversation_list: aceita um CONJUNTO de Instances, '
  'devolve a caixa de origem em cada linha, DISTINCT ON por '
  '(instance_id, contact_external_id) e limite GLOBAL por recência. Mantém '
  'can_see_chat_scope por conversa e a comparação de telefone por variantes. '
  'Não substitui a função de uma Instance, que segue intacta.';


-- ============================================================================
-- 4. Índices
-- ============================================================================
--
-- NENHUM ÍNDICE NOVO. Não é omissão — foi medido em produção, caixa a caixa,
-- no pior caso do produto (Alamaster, 57 Instances, 10.141 conversas):
--
--   • Lista por conjunto, `whatsapp_conversation_summary`:
--     `Bitmap Index Scan on whatsapp_conversation_summary_pkey`
--     (organization_id, instance_id, normalized_phone) + top-N heapsort.
--     9.383 candidatas, ~100 ms a frio, ~30 ms a quente, para LIMIT 50.
--     Um índice (organization_id, "timestamp" DESC) serviria a ordenação
--     global sem sort, mas pioraria o caso COMUM (1 a 2 caixas), onde o pkey
--     recorta primeiro e ordena quase nada — e o caso comum são 60 das 62
--     orgs com Instance. Trocado por medição, não por intuição.
--
--   • Não-lida, `whatsapp_messages`: `idx_whatsapp_msgs_org_phone_instance_ts`
--     (organization_id, normalized_phone, instance_id, "timestamp" DESC)
--     WHERE deleted_at IS NULL AND normalized_phone IS NOT NULL já serve os
--     dois caminhos, porque as duas primeiras colunas entram por IGUALDADE e
--     aí a ordem delas é indiferente. `EXISTS` do filtro: 22 ms. `LATERAL` da
--     contagem: 44 ms a quente para 50 conversas.
--     O que NÃO serve é o agregado sobre o conjunto — e a cura foi mudar a
--     FORMA da consulta (bloco (C) da função), não criar índice: um índice
--     não conserta 22.292 heap fetches num visibility map que nunca fica limpo.
--
--   • Canal oficial, `channel_messages`: `idx_channel_messages_instance_thread`
--     serve o `= ANY(array)` com Index Scan ORDENADO, sem nó de Sort, em
--     0,57 ms — desde que o DISTINCT ON respeite a ordem das chaves do índice.
--
-- Por não haver índice novo, também não há `ANALYZE` a rodar aqui.


-- ============================================================================
-- 5. Grants
-- ============================================================================
--
-- Não houve DROP em função nenhuma, então o problema não é grant perdido: é o
-- DEFAULT do schema. `CREATE FUNCTION` concede EXECUTE a PUBLIC (default do
-- Postgres) e o Supabase tem default privilege para `anon` no schema public.
-- Não é vazamento — as três são SECURITY DEFINER com gate de org, então `anon`
-- só receberia 42501 — mas EXECUTE para quem nunca passa do gate é superfície
-- gratuita: qualquer regressão futura no gate vira exploração sem autenticação.
-- Mesma lição de `20260727140438_inbox_filter_grants_tighten`.
--
-- `service_role` entra porque as três irmãs atuais o têm em prod
-- (`get_whatsapp_conversation_list`, `get_official_whatsapp_conversation_list`
-- e `whatsapp_chip_instance_ids` têm todas
-- `{postgres=X, authenticated=X, service_role=X}`), e edge function que
-- precise da lista tem que poder chamá-la sem virar mais uma exceção.

REVOKE ALL     ON FUNCTION public.whatsapp_readable_instance_ids(uuid, uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.whatsapp_readable_instance_ids(uuid, uuid[]) FROM anon;
GRANT  EXECUTE ON FUNCTION public.whatsapp_readable_instance_ids(uuid, uuid[]) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_whatsapp_conversation_list_multi(
  uuid, uuid[], integer, timestamptz, uuid[], text[], uuid[], text[], uuid,
  boolean, text, boolean, boolean, boolean, text, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_whatsapp_conversation_list_multi(
  uuid, uuid[], integer, timestamptz, uuid[], text[], uuid[], text[], uuid,
  boolean, text, boolean, boolean, boolean, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_whatsapp_conversation_list_multi(
  uuid, uuid[], integer, timestamptz, uuid[], text[], uuid[], text[], uuid,
  boolean, text, boolean, boolean, boolean, text, boolean) TO authenticated, service_role;

REVOKE ALL     ON FUNCTION public.get_official_whatsapp_conversation_list_multi(uuid, uuid[], integer, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_official_whatsapp_conversation_list_multi(uuid, uuid[], integer, timestamptz) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_official_whatsapp_conversation_list_multi(uuid, uuid[], integer, timestamptz) TO authenticated, service_role;

-- ── Conferência pós-apply ───────────────────────────────────────────────────
-- Rodar à mão. `role_table_grants` mente por omissão; a fonte é `pg_proc.proacl`.
--
--   SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.proacl
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.proname IN ('whatsapp_readable_instance_ids',
--                        'get_whatsapp_conversation_list_multi',
--                        'get_official_whatsapp_conversation_list_multi');
--
-- GRANTEES ESPERADOS, nas TRÊS, exatamente estes e nenhum a mais:
--   {postgres=X/postgres, authenticated=X/postgres, service_role=X/postgres}
-- Ou seja: PUBLIC sem EXECUTE (nenhuma entrada `=X/postgres` sem grantee à
-- esquerda) e `anon` sem EXECUTE.
--
-- Ponto a ponto:
--   SELECT has_function_privilege('authenticated',
--            'public.get_whatsapp_conversation_list_multi(uuid,uuid[],integer,timestamptz,uuid[],text[],uuid[],text[],uuid,boolean,text,boolean,boolean,boolean,text,boolean)',
--            'EXECUTE');  -- esperado: true
--   SELECT has_function_privilege('anon', '<mesma assinatura>', 'EXECUTE');
--                         -- esperado: false
--
-- E que as FUNÇÕES ANTIGAS sigam intactas — esta migration não as tocou:
--   SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'get_whatsapp_conversation_list';
-- Esperado: 1 (sobrecarga sobrevivente devolve PGRST203 na tela).
