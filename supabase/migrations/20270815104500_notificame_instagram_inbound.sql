-- ============================================================================
-- Migration: NotificaMe — RECEBIMENTO de Instagram (Fatia 2-IG, "a mensagem entra")
-- Data: 2027-08-15
-- Branch: feat/notificame-seamless
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  ⛔ ORDEM DE APPLY — TRÊS PASSOS, NESTA ORDEM, SEM PULAR NENHUM.          ║
-- ║                                                                          ║
-- ║      1º  `20270814093000_notificame_instagram_channel.sql` (fatia 1.1);  ║
-- ║      2º  ESTE ARQUIVO;                                                   ║
-- ║      3º  `supabase functions deploy notificame-webhook`                  ║
-- ║          `supabase functions deploy notificame-channel-finish`.          ║
-- ║                                                                          ║
-- ║  TUDO com `--db-url` EXPLÍCITO no passo 1 e 2. Ver o aviso no fim deste  ║
-- ║  cabeçalho.                                                              ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- ─── POR QUE 1º ANTES DE 2º (dependência DURA, não estilo) ──────────────────
--
--   O bloco 1 declara `channel_messages.messaging_channel_id UUID REFERENCES
--   public.messaging_channels(id)`. `messaging_channels` NASCE em …093000, e essa
--   migration NÃO ESTÁ APLICADA EM PROD (declarado no cabeçalho dela). Rodar este
--   arquivo antes NÃO degrada em silêncio: aborta com
--
--       ERROR: 42P01: relation "messaging_channels" does not exist
--
--   e como `supabase db push` roda a migration em UMA transação, o arquivo inteiro
--   volta atrás — nada aqui fica meio-aplicado. É um erro barulhento e limpo, e é
--   por isso que ele é o desfecho ACEITÁVEL de errar a ordem entre 1º e 2º.
--
-- ─── POR QUE 2º ANTES DE 3º (aqui o desfecho de errar NÃO é limpo) ──────────
--
--   `notificame-webhook` nasce escrevendo QUATRO objetos que só existem depois
--   deste arquivo: `channel_messages.messaging_channel_id`,
--   `channel_messages.contact_external_id`, a tabela `notificame_webhook_events` e
--   a RPC `get_social_conversation_list`. Objeto ausente no PostgREST não devolve
--   nulo — devolve ERRO —, e o caminho de erro desta função é justamente o que
--   GUARDA o corpo cru:
--
--     a) o INSERT em `channel_messages` erra (coluna inexistente) ⇒ a função tenta
--        PARKAR o evento em `notificame_webhook_events`, que TAMBÉM não existe ⇒
--        park falha ⇒ a função responde 5xx e o corpo cru se perde do nosso lado;
--     b) `NÃO TEMOS PAYLOAD REAL DE ENTRADA`. Cada evento perdido nessa janela é um
--        exemplar do formato que ninguém neste projeto viu ainda — o ativo que a
--        fila inteira existe para capturar. Perder o PRIMEIRO evento real é perder
--        a única coisa que ensina o formato;
--     c) se o fornecedor NÃO reentregar depois de 5xx (não verificado — ver
--        `nao_verificado` do plano), o evento não volta nunca.
--
--   Ou seja: inverter 1º↔2º custa um erro de sintaxe; inverter 2º↔3º custa DADO
--   que não se recupera. As duas ordens são obrigatórias, por razões diferentes.
--
-- ─── E NA ORDEM CERTA (schema novo sob funções velhas)? SEGURO ──────────────
--
--   Entre o passo 2 e o passo 3 o banco fica com duas colunas sempre NULL, uma
--   tabela vazia e uma RPC sem chamador. NENHUM código no ar escreve
--   `messaging_channel_id` (o `meta-webhook` e os demais writers de
--   `channel_messages` não conhecem a coluna), e a RPC nova não é chamada por
--   front nenhum até o deploy do front. Nada quebra. É por isso que a ordem é
--   esta, e não a inversa.
--
--   ⚠️ ÚNICA EXCEÇÃO, e ela é do bloco 7: o REVOKE em `channel_messages` vale a
--   partir do COMMIT deste arquivo, não a partir do deploy. Ele é seguro porque
--   nenhum caminho legítimo escreve nessa tabela com o JWT do usuário — verificado
--   um a um, lista no bloco 7.
--
-- ─── ROLLBACK: A MESMA REGRA, DE TRÁS PARA A FRENTE ─────────────────────────
--
--   Desfazer é FUNÇÕES PRIMEIRO (remover/reverter `notificame-webhook`), MIGRATION
--   DEPOIS. Rodar o rollback com a função no ar reproduz exatamente o (a)/(b)/(c)
--   acima. Ver `supabase/migrations/rollback/20270815104500_notificame_instagram_inbound.sql`.
--
-- ─── O QUE FAZ ──────────────────────────────────────────────────────────────
--   1. `channel_messages.messaging_channel_id` — de qual canal social a linha veio;
--   2. `channel_messages.contact_external_id` — QUEM é o interlocutor, independente
--      de direção;
--   3. índice PARCIAL da thread social (as 10.982 linhas de WhatsApp não pagam);
--   4. `notificame_webhook_events` — a FILA do que não deu para interpretar, com o
--      corpo cru INTEGRAL;
--   5. `get_social_conversation_list` — a lista de conversas do inbox de Instagram;
--   6. grants da RPC (CREATE reseta para PUBLIC/anon);
--   7. REVOKE de escrita em `channel_messages` para `authenticated`.
--
-- ─── O QUE ESTA MIGRATION NÃO TOCA, DE PROPÓSITO ────────────────────────────
--   - `ALTER PUBLICATION supabase_realtime ADD TABLE channel_messages`: MEDIDO EM
--     PROD HOJE (2026-08-13) — a tabela JÁ ESTÁ na publicação. Reexecutar devolve
--     `42710 relation is already member of publication` e ABORTA a transação
--     inteira, derrubando os blocos 1-7 junto. Não é redundância inofensiva;
--   - o UNIQUE `(external_id, channel, organization_id)`: continua EXATAMENTE como
--     está. Ele é a guarda de reentrega e o `onConflict` que o `meta-webhook` já
--     usa em prod. Incluir `messaging_channel_id` nele só cobriria "mesmo mid em
--     dois canais", que não existe (o mid da Meta é global), ao custo de alterar
--     constraint de tabela viva sob um writer em produção;
--   - `channel_type` (o enum): `'instagram'` já é membro dele desde o baseline
--     (linha 285), então NÃO há `ALTER TYPE` aqui. ⚠️ As 10.982 linhas são 100%
--     `'whatsapp'` — esse valor do enum NUNCA foi exercido em prod. Conferir antes
--     do apply: `SELECT unnest(enum_range(NULL::public.channel_type));`
--   - `channel_messages_direction_check`: continua `('incoming','outgoing')`. É por
--     isso que o writer novo grava `'incoming'` e NUNCA `'inbound'` — `'inbound'`
--     VIOLA o CHECK, e é o motivo de `useIncomingMessageToast` estar morto hoje;
--   - `whatsapp_conversation_summary` e seu trigger: a lista social sai de
--     `DISTINCT ON` direto na tabela (bloco 5). Tabela-resumo + trigger é mecanismo
--     que precisa estar CERTO antes de existir tráfego que o ensine, e o tráfego
--     de IG hoje é ZERO;
--   - `leads`: nenhuma coluna de identidade social nasce aqui.
--     `channel_messages.lead_id` fica NULL no caminho de Instagram, por decisão.
--
-- ⚠️ APPLY — SEMPRE com `--db-url` EXPLÍCITO. `supabase/config.toml` aponta para
--   PROD; `db push --linked` sem alvo explícito já escreveu em prod sem
--   autorização neste repo. Apply em prod exige autorização do CTO na sessão.
--
-- ⚠️ TIMESTAMP — …104500 é posterior à última do repo (20270814093000) e está FORA
--   de slot redondo. CONFERIDO em 2026-08-13 contra `origin/main`, TODAS as
--   branches remotas e locais, e os arquivos NÃO-COMMITADOS dos 60 worktrees desta
--   máquina: nenhum `20270814*` ou `20270815*` em lugar nenhum. Isso vale para o
--   momento da escrita, NÃO para o momento do apply — colisão de timestamp faz o
--   CLI PULAR a migration em silêncio e o ledger dar falso verde, e a guarda de
--   cada branch (`scripts/check-migration-versions.sh`) só olha o próprio
--   checkout + a base: os dois CIs passam e a colisão só existe depois do merge.
--   RECONFERIR contra as branches em voo NO MOMENTO DO APPLY.
--
-- ROLLBACK: `supabase/migrations/rollback/20270815104500_notificame_instagram_inbound.sql`
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. De qual CANAL SOCIAL a linha veio.
--
--    ON DELETE SET NULL, e não RESTRICT, e a razão é de ORDEM ENTRE TABELAS
--    IRMÃS: `organizations → messaging_channels` é ON DELETE CASCADE. Com RESTRICT
--    aqui, apagar uma org tentaria apagar os canais dela e esbarraria nas linhas de
--    `channel_messages` que ainda apontam para eles — 23503 no meio de um CASCADE,
--    e a exclusão de org trava sem que ninguém entenda por quê. Com SET NULL, canal
--    desconectado deixa histórico legível-mas-órfão: estado degradado e HONESTO, e
--    a linha nunca é confundida com uma linha da rota Graph (que tem esta coluna
--    NULL desde sempre — ver o COMMENT).
--
--    ADD COLUMN nullable e sem DEFAULT é metadata-only no PG (não reescreve as
--    10.982 linhas). A FK nova pede um scan de validação, trivial nesse volume.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.channel_messages
  ADD COLUMN IF NOT EXISTS messaging_channel_id UUID
    REFERENCES public.messaging_channels(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.channel_messages.messaging_channel_id IS
  'Canal social (messaging_channels) que originou a linha. NULL em TODA linha '
  'escrita pela rota Meta/Graph (meta-webhook, send-meta-message) e em toda linha '
  'de WhatsApp — e essa assimetria é o ISOLAMENTO: o inbox social filtra por esta '
  'coluna, então uma linha da Graph com channel=''instagram'' é invisível para ele. '
  'Sem duplicidade e sem segunda verdade, e é POR ISSO que o guard que descarta o '
  'inbound de Instagram no meta-webhook pode esperar. ON DELETE SET NULL (não '
  'RESTRICT) porque organizations→messaging_channels é CASCADE: RESTRICT aqui '
  'travaria a exclusão de org por ordem entre tabelas irmãs.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. QUEM é o interlocutor — independente de direção.
--
--    Duas colunas e não uma. `sender_id` já existe e NÃO serve: ele é quem MANDOU,
--    então numa mensagem de SAÍDA ele é a nossa conta, não o contato. É exatamente
--    o defeito de `chat-meta` (`useMetaMessages` casa a thread por
--    `sender_id = conv.external_user_id`), e o sintoma é a mensagem enviada nunca
--    aparecer na conversa.
--
--    Por que agora, se o outbound é a fatia 3: se o agrupamento nascesse em
--    `sender_id`, a coluna MUDARIA DE SIGNIFICADO quando o outbound chegasse, e
--    toda linha escrita até lá ficaria errada — retrofit em dados de conversa, com
--    o histórico do cliente no meio. Custa uma coluna NULL hoje.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.channel_messages
  ADD COLUMN IF NOT EXISTS contact_external_id TEXT;

COMMENT ON COLUMN public.channel_messages.contact_external_id IS
  'O INTERLOCUTOR da conversa, independente de direção: no inbound é quem mandou, '
  'no outbound (fatia 3) é quem recebe. NÃO é sender_id — sender_id é quem MANDOU, '
  'e numa mensagem de saída ele é a nossa conta. Agrupar por sender_id é o defeito '
  'vivo de useMetaMessages (chat-meta), onde a mensagem enviada nunca aparece na '
  'thread. Em Instagram este campo é o IGSID do interlocutor. ⚠️ Assume que o id '
  'do usuário é ESTÁVEL por (app, usuário); se o fornecedor devolver id efêmero '
  'por conversa, cada mensagem vira um contato novo na lista — sintoma óbvio no '
  'primeiro evento real, e o agrupamento está num lugar só (a RPC do bloco 5).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. A leitura quente da thread social.
--
--    PARCIAL (`WHERE messaging_channel_id IS NOT NULL`) por medida, não por
--    elegância: hoje são 10.982 linhas, 100% WhatsApp, e 100% delas teriam esta
--    coluna NULL. Índice total cobraria escrita e espaço das 10.982 para servir
--    ZERO leitura. Parcial, o índice nasce vazio.
--
--    A ordem das colunas é a do `DISTINCT ON` do bloco 5
--    (`ORDER BY contact_external_id, "timestamp" DESC` dentro de org+canal).
--    Sem CONCURRENTLY de propósito: `db push` roda a migration em transação, e
--    CREATE INDEX CONCURRENTLY não pode rodar dentro de uma.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_channel_messages_social_thread
  ON public.channel_messages (
    organization_id,
    messaging_channel_id,
    contact_external_id,
    "timestamp" DESC
  )
  WHERE messaging_channel_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. A FILA do que não deu para interpretar.
--
--    NÃO TEMOS PAYLOAD REAL DE ENTRADA. Nenhum canal foi conectado; zero eventos.
--    Tudo o que o receptor sabe sobre o formato é DERIVADO DE DOC — e a doc do
--    fornecedor já se provou errada uma vez (dois hosts, duas versões). Então o
--    receptor tem TRÊS estados, não dois:
--
--      (a) INTERPRETÁVEL      → linha em channel_messages, raw_payload integral, 200;
--      (b) NÃO-INTERPRETÁVEL  → linha AQUI com status='parked' + reason, 200
--                               (200 significa "está guardado" — a lição do
--                               enqueueDlq, incidente 2026-08-06);
--      (c) NEM GUARDOU        → 5xx, para o fornecedor reentregar.
--
--    FILA e não só log, e a diferença é operacional: fila tem CONTAGEM
--    (`SELECT count(*) ... WHERE status='parked'`, servida pelo índice parcial
--    abaixo) e log não tem leitor — `runtime_logs` NÃO É LIDO neste produto, e
--    "detectar não é alertar" morde exatamente aqui.
--
--    ⚠️ SEM CHECK EM `reason`, DE PROPÓSITO. O vocabulário é fechado no código
--    (invalid_json | oversized_body | missing_subaccount_segment |
--    unknown_subaccount | unresolved_channel | ambiguous_channel |
--    channel_org_mismatch | channel_type_mismatch | missing_external_id |
--    missing_contact_id | unreadable_direction | unhandled_event |
--    insert_failed), mas travá-lo AQUI inverteria o desenho: um
--    reason novo no receptor faria o INSERT do park FALHAR (23514), a função cairia
--    no estado (c), e o corpo cru — a única coisa que esta tabela existe para
--    guardar — se perderia. Um CHECK que faz perder o dado que ele protege é pior
--    que nenhum. `status` TEM CHECK porque o vocabulário dele é operacional nosso,
--    tem DEFAULT, e o caminho de escrita pode simplesmente omiti-lo.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notificame_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_ip TEXT,

  -- ⚠️ REDIGIDO. O secret vive num SEGMENTO DE PATH desta URL e é credencial de
  -- portador. Gravar a URL crua aqui reproduziria em coluna de banco o vazamento
  -- que `redactWebhookUrl` existe para impedir em log de proxy.
  url_path TEXT,

  -- NULL quando o evento parkou ANTES de resolver a org (missing_subaccount_segment,
  -- unknown_subaccount, invalid_json). CASCADE: evento parkado de uma org apagada
  -- não tem dono nem leitor.
  organization_id UUID
    REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- SET NULL e não CASCADE: o evento parkado é a EVIDÊNCIA de que algo deu errado
  -- com aquele canal. Apagar a evidência junto com o canal destrói justamente o
  -- que se vai querer ler depois.
  messaging_channel_id UUID
    REFERENCES public.messaging_channels(id) ON DELETE SET NULL,

  external_id TEXT,
  event_type TEXT,

  status TEXT NOT NULL DEFAULT 'parked'
    CHECK (status IN ('parked', 'processed', 'failed')),

  -- Sem CHECK — ver o bloco de comentário acima.
  reason TEXT NOT NULL,

  -- O CORPO CRU INTEGRAL. É o ativo desta tabela.
  payload JSONB NOT NULL,

  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  last_error TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.notificame_webhook_events IS
  'Fila de eventos do NotificaMe que o receptor NÃO conseguiu interpretar. Existe '
  'porque o formato do evento é derivado de DOC e nunca foi visto: o primeiro '
  'evento real é lido DAQUI, com o corpo inteiro na mão, e os pickers de '
  '_shared/notificame-inbound.ts são ajustados a partir dele. Fila e não log '
  'porque fila tem CONTAGEM e runtime_logs não tem leitor neste produto. '
  'Responder 200 ao fornecedor significa "está guardado" — se nem a linha aqui '
  'nasceu, o receptor devolve 5xx para o evento ser reentregue (lição do '
  'enqueueDlq, incidente 2026-08-06). ⚠️ payload é PII de TERCEIRO e NÃO é '
  'redigido: service_role only, anon e authenticated sem grant nenhum.';

COMMENT ON COLUMN public.notificame_webhook_events.payload IS
  'Corpo cru INTEGRAL do webhook, sem recorte e sem redação. Quando nem o JSON '
  'parseou (inclusive corpo VAZIO), entra como {"raw_text": "<texto cru '
  'truncado>", "truncated": bool}. Quando o corpo é JSON mas NÃO é objeto ("" | '
  'null | 3 | [...]), entra embrulhado em {"raw_json": <valor>, "raw_kind": '
  '"<tipo>"} — sem o embrulho o PostgREST manda uma string vazia para esta coluna '
  'e o Postgres '
  'devolve 22P05, o park falha e o corpo se perde. Quando o corpo estourou o teto '
  'de 2 MB, entra só a CABEÇA (64 KB) com reason=oversized_body. E quando o '
  'conteúdo tem byte nulo (jsonb recusa mesmo escapado), o receptor REPETE o '
  'insert com tudo serializado como texto e marca park_degraded. NUNCA vai para '
  'runtime_logs: redactSecrets de _shared/logger.ts redige por NOME DE CHAVE, e '
  'um JSON.stringify do payload sob uma chave nossa não casa chave nenhuma e '
  'atravessa token inteiro para uma tabela lida por humanos (o que '
  'whatsapp-webhook L1470 faz com raw_truncated). No log vão só escalares nossos.';

COMMENT ON COLUMN public.notificame_webhook_events.reason IS
  'Por que parkou. Vocabulário fechado NO CÓDIGO, deliberadamente SEM CHECK aqui: '
  'um reason novo faria o INSERT falhar e o corpo cru se perderia — o dado que '
  'esta tabela existe para guardar. Valores: invalid_json, oversized_body, '
  'missing_subaccount_segment, unknown_subaccount, unresolved_channel, '
  'ambiguous_channel, channel_org_mismatch, channel_type_mismatch, '
  'missing_external_id, missing_contact_id, unreadable_direction, '
  'unhandled_event, insert_failed. ⚠️ missing_external_id (id da MENSAGEM) e '
  'missing_contact_id (id do INTERLOCUTOR) são motivos DIFERENTES de propósito: '
  'apontam para pickers diferentes, e um rótulo só mandaria o operador ajustar o '
  'alias errado. ambiguous_channel carrega os canais candidatos em last_error.';

COMMENT ON COLUMN public.notificame_webhook_events.url_path IS
  'Path do webhook com o SEGMENTO DO SECRET SUBSTITUÍDO por <redacted> '
  '(redactWebhookUrl). O secret é credencial de portador — gravá-lo aqui seria '
  'reproduzir em banco o vazamento que a redação existe para impedir em log.';

COMMENT ON COLUMN public.notificame_webhook_events.organization_id IS
  'NULL quando o evento parkou ANTES de a org ser resolvida (invalid_json, '
  'missing_subaccount_segment, unknown_subaccount). A org NUNCA sai do corpo: sai '
  'do uuid da subconta no PATH, que somos nós que geramos e registramos.';

-- A CONTAGEM da fila é uma query, não um grep de log. Índice parcial: com zero
-- eventos esperados até o primeiro tráfego real, ele nasce vazio.
CREATE INDEX IF NOT EXISTS idx_notificame_webhook_events_parked
  ON public.notificame_webhook_events (received_at DESC)
  WHERE status = 'parked';

ALTER TABLE public.notificame_webhook_events ENABLE ROW LEVEL SECURITY;

-- POLICY ÚNICA: service_role. Não existe leitor legítimo pelo browser — `payload`
-- é corpo cru de terceiro, não redigido, e pode carregar token do fornecedor,
-- conteúdo de mensagem privada e PII de quem mandou. A leitura da fila é operação,
-- feita com service_role, não superfície de produto.
DROP POLICY IF EXISTS "Service role full access notificame_webhook_events"
  ON public.notificame_webhook_events;
CREATE POLICY "Service role full access notificame_webhook_events"
  ON public.notificame_webhook_events
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- GRANT de TABELA domina a policy: sem estes REVOKEs, o default privilege do
-- schema public deixa a tabela alcançável por authenticated ANTES de a RLS opinar.
-- (Foi assim que uma tabela de backup nasceu legível por anon neste repo.)
REVOKE ALL ON public.notificame_webhook_events FROM PUBLIC;
REVOKE ALL ON public.notificame_webhook_events FROM anon;
REVOKE ALL ON public.notificame_webhook_events FROM authenticated;
GRANT ALL ON public.notificame_webhook_events TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. A lista de conversas do inbox de Instagram.
--
--    RPC PRÓPRIA, e `get_whatsapp_conversation_list` NÃO É TOCADA. Ela tem 14
--    filtros, lê `whatsapp_conversation_summary` (tabela-resumo alimentada por
--    trigger AFTER INSERT em `whatsapp_messages`, que NUNCA verá uma linha de
--    `channel_messages`) e é o caminho de ~30 orgs em produção. Esticá-la para um
--    segundo modelo de dados seria mexer no caminho vivo para servir zero linhas.
--
--    SEM tabela-resumo e SEM trigger para o lado social: `DISTINCT ON` direto na
--    tabela, apoiado no índice parcial do bloco 3. Com ZERO linhas de IG hoje,
--    resumo+trigger é mecanismo caro que precisaria estar CERTO antes de existir
--    tráfego que o ensine.
--
--    SECURITY DEFINER com DOIS gates, não um:
--      (i)  a org tem que ser acessível a quem chama (team_member ativo ou master);
--      (ii) `p_channel` tem que PERTENCER a `p_org`.
--    O (ii) é o que impede o vetor já catalogado neste repo: RPC DEFINER que
--    recorta por parâmetro do cliente sem verificar o parâmetro entrega dado
--    cross-tenant a um usuário legítimo de outra org.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_social_conversation_list(
  p_org uuid,
  p_channel uuid,
  p_limit integer DEFAULT 50,
  p_before timestamptz DEFAULT NULL
)
RETURNS TABLE(
  contact_external_id text,
  sender_name text,
  sender_profile_pic text,
  last_message text,
  last_message_time timestamptz,
  last_message_direction text,
  unread_count integer,
  lead_id uuid
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 1000);
BEGIN
  -- Gate 1 — acesso: team_member ativo da org OU master ativo (ghost cross-org).
  -- Forma idêntica à de get_whatsapp_conversation_list (20270811000011).
  IF p_org IS NULL
     OR (NOT EXISTS (
           SELECT 1 FROM public.get_my_organization_ids() AS g(org_id)
            WHERE g.org_id = p_org)
         AND NOT COALESCE(is_master_user(), false)) THEN
    RAISE EXCEPTION 'forbidden: org not accessible' USING ERRCODE = '42501';
  END IF;

  IF p_channel IS NULL THEN
    RAISE EXCEPTION 'channel required' USING ERRCODE = '22023';
  END IF;

  -- Gate 2 — tenancy DO ARGUMENTO: o canal tem que ser DA org pedida. Sem este
  -- gate, um membro legítimo da org A leria a caixa de Instagram da org B só
  -- passando o uuid do canal dela. `messaging_channels` é lida aqui sob DEFINER
  -- (bypassa a RLS dela), então a verificação tem que ser explícita.
  IF NOT EXISTS (
    SELECT 1 FROM public.messaging_channels mc
     WHERE mc.id = p_channel AND mc.organization_id = p_org
  ) THEN
    RAISE EXCEPTION 'forbidden: channel not in org' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH thread AS (
    -- A última mensagem de cada interlocutor. Casa exatamente com
    -- idx_channel_messages_social_thread.
    SELECT DISTINCT ON (m.contact_external_id)
           m.contact_external_id  AS cid,
           m.content              AS body,
           m."timestamp"          AS ts,
           m.direction            AS dir,
           m.lead_id              AS lid
      FROM public.channel_messages m
     WHERE m.organization_id      = p_org
       AND m.messaging_channel_id = p_channel
       AND m.contact_external_id IS NOT NULL
     ORDER BY m.contact_external_id, m."timestamp" DESC
  ),
  contact_identity AS (
    -- ⚠️ NOME E AVATAR SAEM DA ÚLTIMA MENSAGEM **RECEBIDA**, NÃO DA ÚLTIMA
    -- MENSAGEM. `sender_name`/`sender_profile_pic` descrevem QUEM MANDOU aquela
    -- linha: numa mensagem de SAÍDA eles são a NOSSA conta. Tirar a identidade do
    -- contato da última mensagem faria toda conversa JÁ RESPONDIDA aparecer na
    -- lista com o nome e o avatar da própria org — a mesma classe de defeito que
    -- `contact_external_id` existe para evitar no agrupamento (ver o COMMENT da
    -- coluna e o defeito vivo de useMetaMessages).
    --
    -- Hoje isso é LATENTE: esta fatia é inbound-only, então a última mensagem é
    -- sempre `incoming` e as duas leituras coincidem. Ele acorda no dia em que o
    -- outbound da fatia 3 gravar a primeira linha — e aí seria retrofit em dado de
    -- conversa. Custa um CTE agora.
    --
    -- Thread só-outbound (fatia 3, quando NÓS iniciamos): devolve NULL, e NULL é a
    -- resposta honesta. O front já cai para o handle do canal e, na falta dele,
    -- para 'Instagram <últimos 6 do id>' — nunca para o nome da org.
    SELECT DISTINCT ON (m.contact_external_id)
           m.contact_external_id  AS cid,
           m.sender_name          AS s_name,
           m.sender_profile_pic   AS s_pic
      FROM public.channel_messages m
     WHERE m.organization_id      = p_org
       AND m.messaging_channel_id = p_channel
       AND m.contact_external_id IS NOT NULL
       AND m.direction            = 'incoming'
     ORDER BY m.contact_external_id, m."timestamp" DESC
  ),
  unread AS (
    -- Chave de leitura MONTADA, não fatiada. get_whatsapp_conversation_list usa
    -- `split_part(conversation_key, ':', 3)`, que só é seguro lá porque telefone
    -- não contém ':'. Um id de usuário de rede social é opaco: montar a chave e
    -- comparar inteira é correto mesmo se o id tiver ':' no meio.
    SELECT m.contact_external_id AS cid, count(*)::integer AS cnt
      FROM public.channel_messages m
      LEFT JOIN public.conversation_read_state rs
             ON rs.organization_id  = p_org
            AND rs.user_id          = v_uid
            AND rs.conversation_key = 'instagram:' || p_channel::text || ':'
                                      || m.contact_external_id
     WHERE m.organization_id      = p_org
       AND m.messaging_channel_id = p_channel
       AND m.contact_external_id IS NOT NULL
       AND m.direction            = 'incoming'
       AND m."timestamp" > COALESCE(rs.last_read_at, now() - interval '7 days')
     GROUP BY m.contact_external_id
  )
  SELECT t.cid,
         ci.s_name,
         ci.s_pic,
         t.body,
         t.ts,
         t.dir,
         COALESCE(u.cnt, 0)::integer,
         t.lid
    FROM thread t
    LEFT JOIN contact_identity ci ON ci.cid = t.cid
    LEFT JOIN unread u ON u.cid = t.cid
   -- p_before é cursor sobre a CONVERSA (a última mensagem dela), não filtro sobre
   -- as mensagens: aplicado dentro do DISTINCT ON, ele mudaria QUAL mensagem é a
   -- última de cada thread em vez de paginar a lista.
   WHERE p_before IS NULL OR t.ts < p_before
   ORDER BY t.ts DESC
   LIMIT v_limit;
END;
$function$;

COMMENT ON FUNCTION public.get_social_conversation_list(uuid, uuid, integer, timestamptz) IS
  'Lista de conversas de um canal social (Instagram) para o inbox. Caminho '
  'PARALELO ao de WhatsApp: get_whatsapp_conversation_list, '
  'whatsapp_conversation_summary e o trigger que a alimenta ficam byte-a-byte '
  'intactos. DOIS gates: org acessível (42501) e p_channel pertencente a p_org '
  '(42501) — o segundo é o que fecha o vetor de RPC DEFINER com recorte por '
  'parâmetro do cliente. Sem os 14 filtros do irmão de WhatsApp de propósito: o '
  'front oculta esses controles na caixa de IG em vez de mostrá-los inertes. '
  'sender_name/sender_profile_pic saem da última mensagem RECEBIDA, não da última '
  'mensagem: numa linha de saída esses campos são a nossa conta, e a lista '
  'mostraria o nome da própria org em toda conversa já respondida.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Grants da RPC.
--
--    `CREATE [OR REPLACE] FUNCTION` reconcede EXECUTE a PUBLIC (default do
--    Postgres) e a `anon` (default privilege do Supabase no schema public). Já
--    aconteceu neste repo — 20260727140438 existe exatamente por isso. O gate é
--    SECURITY DEFINER e `anon` só levaria 42501, mas EXECUTE concedido a quem
--    nunca passa do gate é superfície de graça: qualquer regressão futura no gate
--    vira explorável SEM autenticação.
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.get_social_conversation_list(uuid, uuid, integer, timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_social_conversation_list(uuid, uuid, integer, timestamptz)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_social_conversation_list(uuid, uuid, integer, timestamptz)
  TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. `channel_messages` deixa de ser ESCREVÍVEL pelo browser.
--
--    O FURO: o baseline dá `GRANT ALL ON TABLE channel_messages TO authenticated`
--    (linha 44513) e a policy `channel_messages_org_access` é `FOR ALL` SEM
--    `WITH CHECK` explícito. GRANT de tabela domina, e uma policy permissiva sem
--    WITH CHECK usa o USING como WITH CHECK — resultado: um MEMBRO comum da org
--    pode INSERIR linha em `channel_messages` pelo PostgREST, com o
--    `organization_id` dele.
--
--    POR QUE SÓ AGORA: hoje isso é inócuo porque NADA renderiza essa tabela — o
--    inbox nem a lê. A partir desta fatia ela vira a fonte do inbox de Instagram, e
--    o furo passa a ler-se como "membro forja mensagem recebida no inbox". Um
--    endpoint sem autenticidade de conteúdo (o fornecedor não assina o corpo) já é
--    a superfície fraca; deixar UM SEGUNDO caminho de escrita aberto, esse
--    autenticado e sem nenhuma verificação, é gratuito.
--
--    VERIFICADO ANTES DE REVOGAR — todo writer de channel_messages usa
--    service_role, que NÃO é afetado por este REVOKE:
--      meta-webhook, send-meta-message, agent-message (+batch-helpers),
--      copilot-batch-processor, quick-blast-create/run.ts (supabaseAdmin),
--      carteira-bulk-message L203 (supabaseAdmin — a função tem os dois clients,
--      o de usuário NÃO toca esta tabela), _shared/quick-blast/*,
--      _shared/send-governor/io.ts.
--    Em `src/` não há UM escritor: `useMetaMessages` faz SELECT,
--    `useMetaRealtime` e `useIncomingMessageToast` só escutam. `useSocialMessages`
--    (fatia 2-IG) também só lê.
--
--    FORMA: `REVOKE ALL` + `GRANT SELECT`, e não o revoke verbo-a-verbo, pelo
--    mesmo motivo de messaging_channels (…093000 L259-261): `GRANT ALL` também
--    concedeu TRUNCATE e TRIGGER a `authenticated`. Nenhum dos dois é alcançável
--    pelo PostgREST hoje, mas o net de privilégio reachable é idêntico ao pedido
--    (só SELECT sobra) e não deixa nada de fora para o próximo leitor conferir.
--    `mcp_readonly` (SELECT) e `service_role` (ALL) não são tocados.
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON public.channel_messages FROM authenticated;
GRANT SELECT ON public.channel_messages TO authenticated;

-- `anon` não tem grant nenhum nesta tabela no baseline. Defensivo e idempotente:
-- default privilege de schema já concedeu a anon por descuido neste repo antes.
REVOKE ALL ON public.channel_messages FROM anon;
