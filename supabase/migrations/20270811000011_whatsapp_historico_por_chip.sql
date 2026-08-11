-- =============================================================================
-- 20270811000011_whatsapp_historico_por_chip.sql
--
-- Passo 2 de 2. O histórico de WhatsApp passa a pertencer ao CHIP, não à
-- Instance.
--
-- DEPENDE de `20270811000010_whatsapp_messages_drop_instance_fk.sql`, que já
-- removeu a FK `whatsapp_messages_instance_id_fkey`. Aquele arquivo é separado
-- porque o `DROP CONSTRAINT` retém ACCESS EXCLUSIVE em `whatsapp_messages`
-- (2,3M linhas) até o COMMIT: juntar as duas coisas numa transação só faria o
-- inbox de ~30 orgs esperar por tudo que há aqui embaixo. Este arquivo não toca
-- `whatsapp_messages`.
--
-- O problema que isto resolve
-- ---------------------------
-- Enquanto existiu, a FK ON DELETE SET NULL zerava o vínculo de TODO o histórico
-- de uma Instance apagada, e o chat — que filtra por `instance_id = <instância
-- atual>` — perdia a conversa inteira de vista. Tirar a FK estanca a hemorragia,
-- mas não basta: a Instance nova do MESMO chip tem outro uuid, então o histórico
-- antigo continuaria invisível. É esse elo que este arquivo constrói.
--
-- O desenho
-- ---------
-- Soft-delete de Instance foi avaliado e REJEITADO: 86 call sites, e desligaria
-- o `trg_whatsapp_instance_reap` (BEFORE DELETE), que é quem remove a Instance
-- no provider — ressuscitaria o incidente de sessão órfã na Uazapi (2026-07-13).
-- A Instance continua sendo apagada fisicamente. O que muda é o significado da
-- coluna:
--
--   1. `instance_id` é uuid HISTÓRICO, imune ao ciclo de vida da Instance —
--      feito no passo 1 (20270811000000).
--   2. A lápide (`whatsapp_instance_reap_queue`) ganha `phone_number` e vira
--      ARQUIVO PERMANENTE: é o mapa chip → ids históricos.
--   3. O chat resolve por CHIP, via `whatsapp_chip_instance_ids()`. A chave da
--      thread continua sendo (org, chip, telefone do contato) — o chip NÃO sai
--      da chave: a Alamaster tem 55 chips departamentais e 87% das órfãs dela
--      vivem em thread tocada por 2+ chips. Sem o chip, FINANCEIRO e TÉCNICA
--      viram a mesma conversa.
--
-- O que esta migration NÃO faz
-- ----------------------------
-- Não recupera as 385.828 órfãs já existentes. Isso é SCRIPT de backfill (~43%
-- têm âncora), nunca migration — migration aqui é só schema. E o backfill roda
-- DEPOIS do deploy do `whatsapp-api-proxy`, que é manual: nada aqui pode assumir
-- estado que ainda não existe.
--
-- ROLLBACK (não há arquivo pareado; a receita é esta, na ordem inversa)
-- ---------------------------------------------------------------------
--   DROP TRIGGER IF EXISTS trg_whatsapp_reap_queue_no_purge
--     ON public.whatsapp_instance_reap_queue;
--   DROP FUNCTION IF EXISTS public.whatsapp_reap_queue_block_purge();
--   -- get_whatsapp_conversation_list e enqueue_whatsapp_instance_reap:
--   -- reaplicar as definições anteriores (`pg_get_functiondef` capturado antes
--   -- do apply).
--   DROP FUNCTION IF EXISTS public.whatsapp_chip_instance_ids(uuid, uuid);
--   DROP INDEX IF EXISTS public.idx_wa_reap_org_phone;
--   ALTER TABLE public.whatsapp_instance_reap_queue DROP COLUMN IF EXISTS phone_number;
--
-- Reverter este arquivo NÃO implica reverter o passo 1: a FK não deve ser
-- recriada em hipótese nenhuma (motivo no cabeçalho de 20270811000000). Com o
-- rollback aplicado o chat volta a enxergar só a Instance viva — o
-- comportamento de hoje —, e nenhuma linha de histórico é perdida.
-- =============================================================================

-- Teto de espera. Aqui ele cobre a lápide (7 linhas hoje, escrita por trigger e
-- pelo coletor a cada 5min) e a troca de definição das duas funções — não
-- `whatsapp_messages`, que este arquivo não toca. Barato, mas o coletor roda o
-- tempo todo e não há por que empilhar atrás dele.
SET lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. A lápide vira o mapa chip → ids históricos
--
-- `whatsapp_instance_reap_queue` já é gravada por trigger BEFORE DELETE e já
-- sobrevive ao CASCADE de organizations (#1475). Faltava a única coluna que
-- transforma a lápide em endereço: o número do chip.
-- ---------------------------------------------------------------------------
ALTER TABLE public.whatsapp_instance_reap_queue
  ADD COLUMN IF NOT EXISTS phone_number text;

COMMENT ON COLUMN public.whatsapp_instance_reap_queue.phone_number IS
  'Número do chip que a Instance morta atendia. É o que liga o histórico órfão à '
  'Instance nova do MESMO chip (whatsapp_chip_instance_ids). Sem ele a lápide '
  'prova o que morreu, mas não onde o histórico deve reaparecer.';

-- A resolução do chip roda a cada abertura do inbox. A tabela é pequena hoje
-- (7 linhas) e cresce uma linha por Instance apagada, mas o índice casa a
-- expressão EXATA usada pela função — normalização e índice não podem divergir.
CREATE INDEX IF NOT EXISTS idx_wa_reap_org_phone
  ON public.whatsapp_instance_reap_queue
     (organization_id, (regexp_replace(phone_number, '[^0-9]', '', 'g')))
  WHERE phone_number IS NOT NULL;

-- 1a. Trigger do lado da Instance — agora carimba o chip -------------------
--
-- Recriação FIEL de 20260808153357: continua lendo uazapi_token/uazapi_instance_id
-- do segredo e continua fazendo upsert por instance_id, porque a ordem do CASCADE
-- (Instance × segredo) não é garantida. Quebrar esta função significa não remover
-- a Instance no provider — o incidente de sessão órfã de 2026-07-13. A única
-- mudança é `phone_number`.
--
-- O trigger irmão (`enqueue_whatsapp_secret_reap`) NÃO precisa mudar: ele não
-- conhece o número, e seu `DO UPDATE` não lista `phone_number`, então nunca
-- sobrescreve o que este aqui gravou — chegue ele antes ou depois.
CREATE OR REPLACE FUNCTION public.enqueue_whatsapp_instance_reap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $fn$
DECLARE
  v_token       text;
  v_provider_id text;
BEGIN
  -- Pode não achar nada, se o CASCADE já levou o segredo. Nesse caso o trigger
  -- do segredo é quem gravou (ou vai gravar) o token.
  SELECT s.uazapi_token, s.uazapi_instance_id
    INTO v_token, v_provider_id
    FROM public.whatsapp_instance_secrets s
   WHERE s.instance_id = OLD.id;

  INSERT INTO public.whatsapp_instance_reap_queue (
    organization_id, instance_id, instance_name, provider,
    provider_instance_id, provider_token, phone_number
  ) VALUES (
    OLD.organization_id, OLD.id, OLD.instance_name, OLD.provider,
    COALESCE(v_provider_id, OLD.instance_id), v_token, OLD.phone_number
  )
  ON CONFLICT (instance_id) DO UPDATE SET
    organization_id      = COALESCE(whatsapp_instance_reap_queue.organization_id,
                                    EXCLUDED.organization_id),
    instance_name        = COALESCE(EXCLUDED.instance_name,
                                    whatsapp_instance_reap_queue.instance_name),
    provider             = COALESCE(EXCLUDED.provider,
                                    whatsapp_instance_reap_queue.provider),
    provider_instance_id = COALESCE(whatsapp_instance_reap_queue.provider_instance_id,
                                    EXCLUDED.provider_instance_id),
    -- Nunca sobrescreve token já capturado com NULL.
    provider_token       = COALESCE(whatsapp_instance_reap_queue.provider_token,
                                    EXCLUDED.provider_token),
    -- A Instance é a única fonte do número; o lado do segredo não o conhece.
    phone_number         = COALESCE(EXCLUDED.phone_number,
                                    whatsapp_instance_reap_queue.phone_number);

  RETURN OLD;
END;
$fn$;

-- CREATE OR REPLACE preserva o proacl, mas CREATE (primeira vez, ou depois de um
-- DROP) reconcede EXECUTE a PUBLIC por default — e o Supabase reconcede a anon
-- via ALTER DEFAULT PRIVILEGES. Função DEFINER que escreve numa tabela deny-all
-- com token de terceiro não fica chamável por anon nem por authenticated.
--
-- Revogar de `authenticated` NÃO quebra o trigger: o Postgres checa EXECUTE da
-- função de trigger no CREATE TRIGGER, não a cada disparo. E a política
-- `members_can_delete_whatsapp_instances` deixa um admin `authenticated` apagar
-- a Instance direto — prod já roda assim, com o proacl sem authenticated.
REVOKE ALL ON FUNCTION public.enqueue_whatsapp_instance_reap() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_whatsapp_instance_reap() FROM anon;
REVOKE ALL ON FUNCTION public.enqueue_whatsapp_instance_reap() FROM authenticated;

-- Verificação, não confiança: o REVOKE de função já falhou silenciosamente neste
-- repo por causa do grant via PUBLIC (Tier A, PR #1015).
DO $verify$
BEGIN
  IF has_function_privilege(
       'anon', 'public.enqueue_whatsapp_instance_reap()', 'EXECUTE') THEN
    RAISE EXCEPTION
      'enqueue_whatsapp_instance_reap: anon ainda tem EXECUTE — o REVOKE não pegou';
  END IF;

  IF has_function_privilege(
       'authenticated', 'public.enqueue_whatsapp_instance_reap()', 'EXECUTE') THEN
    RAISE EXCEPTION
      'enqueue_whatsapp_instance_reap: authenticated ainda tem EXECUTE — o REVOKE não pegou';
  END IF;
END;
$verify$;

-- 1b. A lápide deixa de ser fila e vira arquivo ----------------------------
--
-- `whatsapp-instance-reaper/index.ts` purga lápides confirmadas há mais de 7
-- dias (CONFIRMED_RETENTION_DAYS), a cada 5 minutos. Aquilo fazia sentido
-- enquanto a lápide era só um envelope com o token: apagar a linha encurtava a
-- janela do segredo em repouso. Agora a linha é o MAPA do chip — purgá-la
-- reabre o buraco 7 dias depois de cada exclusão, e em silêncio.
--
-- O motivo original está preservado sem a purga: o coletor zera `provider_token`
-- no instante da confirmação, então a linha arquivada não guarda segredo nenhum.
--
-- Guarda no banco e não no código porque a purga tem duas mãos (o coletor hoje,
-- qualquer housekeeping amanhã) e um DELETE distraído não pode custar o
-- histórico. BEFORE DELETE devolvendo NULL cancela a linha sem erro: o coletor
-- segue rodando e reporta `purged: 0`. Escape deliberado para quem realmente
-- quiser apagar:
--
--   SET LOCAL app.reap_queue_purge_ok = 'on';
CREATE OR REPLACE FUNCTION public.whatsapp_reap_queue_block_purge()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = 'public'
AS $fn$
BEGIN
  IF COALESCE(current_setting('app.reap_queue_purge_ok', true), '') = 'on' THEN
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$fn$;

COMMENT ON FUNCTION public.whatsapp_reap_queue_block_purge() IS
  'Converte DELETE na lápide em no-op: a linha é o mapa chip → instance_ids '
  'históricos do chat. Escape: SET LOCAL app.reap_queue_purge_ok = ''on''.';

-- Mesmo raciocínio do REVOKE acima, e mesma garantia de que não quebra o
-- trigger. `service_role` mantém o grant explícito do ALTER DEFAULT PRIVILEGES
-- — não porque o disparo precise dele, mas porque não há motivo para tirar.
REVOKE ALL ON FUNCTION public.whatsapp_reap_queue_block_purge() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.whatsapp_reap_queue_block_purge() FROM anon;
REVOKE ALL ON FUNCTION public.whatsapp_reap_queue_block_purge() FROM authenticated;

DO $verify$
BEGIN
  IF has_function_privilege(
       'anon', 'public.whatsapp_reap_queue_block_purge()', 'EXECUTE') THEN
    RAISE EXCEPTION
      'whatsapp_reap_queue_block_purge: anon ainda tem EXECUTE — o REVOKE não pegou';
  END IF;

  IF has_function_privilege(
       'authenticated', 'public.whatsapp_reap_queue_block_purge()', 'EXECUTE') THEN
    RAISE EXCEPTION
      'whatsapp_reap_queue_block_purge: authenticated ainda tem EXECUTE — o REVOKE não pegou';
  END IF;
END;
$verify$;

DROP TRIGGER IF EXISTS trg_whatsapp_reap_queue_no_purge
  ON public.whatsapp_instance_reap_queue;
CREATE TRIGGER trg_whatsapp_reap_queue_no_purge
  BEFORE DELETE ON public.whatsapp_instance_reap_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.whatsapp_reap_queue_block_purge();

-- ---------------------------------------------------------------------------
-- 2. Resolução do chip
--
-- Devolve os instance_ids que representam o MESMO chip: o atual mais as lápides
-- do mesmo número na mesma org. É o tradutor entre "Instance", que é descartável,
-- e "chip", que é o que o cliente entende por conversa.
--
-- Conservadora por desenho: sem número (29 das 138 instâncias têm phone_number
-- NULL), sem vínculo — devolve só a Instance recebida. Inventar vínculo aqui
-- funde histórico de chips diferentes, que é dano pior do que o que se corrige.
--
-- Comparação por dígitos (não por igualdade crua) porque o formato pode variar
-- entre a Instance velha e a nova, e o piso de 10 dígitos impede que dois
-- valores-lixo ('0', '55') casem entre si e fundam chips distintos. Hoje o dado
-- é homogêneo (medido: 12 ou 13 dígitos, só numérico, nas 109 instâncias com
-- número) — normalizar é seguro contra o amanhã, não remendo do hoje.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.whatsapp_chip_instance_ids(
  p_org      uuid,
  p_instance uuid
)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $fn$
DECLARE
  v_digits text;
  v_ids    uuid[];
BEGIN
  -- Gate de CHAMADOR. Esta função é chamada DIRETO do browser
  -- (`src/modules/communication/lib/chipInstanceIds.ts` faz `supabase.rpc` com
  -- `p_org` vindo do cliente), então `p_org` é entrada hostil: não há ninguém
  -- acima validando. SECURITY DEFINER, ela lê `whatsapp_instance_reap_queue`,
  -- que é RLS deny-all — sem este gate, qualquer usuário logado enumera as
  -- lápides de qualquer org passando o uuid dela.
  --
  -- Espelha o gate de `get_whatsapp_conversation_list`, com um escape a mais:
  -- edge functions chamam no papel `service_role`, para quem
  -- `get_my_organization_ids()` volta vazio e `auth.uid()` é NULL.
  --
  -- Três defesas contra NULL, e nenhuma é paranoia gratuita: aqui NULL não vira
  -- erro, vira gate ABERTO, porque `IF NULL THEN` não dispara.
  --
  --   1. `COALESCE(auth.role(), '')` — `auth.role()` é NULL fora de uma
  --      requisição PostgREST, e `NULL <> 'service_role'` propagaria NULL pelo
  --      AND inteiro. Com o COALESCE, conexão sem JWT é chamador comum, e barra.
  --   2. `NOT EXISTS (...)` em vez de `NOT (p_org IN (...))` — `IN` devolve NULL
  --      (não `false`) quando a lista tem um elemento NULL e nada casa, e
  --      `NOT NULL` é NULL. `team_members.organization_id` é NULLABLE em prod:
  --      hoje sem nenhuma linha NULL entre as ativas, então o furo é LATENTE —
  --      uma única linha dessas abriria a função para qualquer org. `EXISTS`
  --      devolve boolean sempre.
  --   3. `COALESCE(is_master_user(), false)` — mesma classe: a função devolve
  --      boolean, mas nada garante NOT NULL no retorno.
  IF p_org IS NULL
     OR (COALESCE(auth.role(), '') <> 'service_role'
         AND NOT EXISTS (
               SELECT 1 FROM public.get_my_organization_ids() AS g(org_id)
                WHERE g.org_id = p_org)
         AND NOT COALESCE(is_master_user(), false))
  THEN
    RAISE EXCEPTION 'forbidden: org not accessible' USING ERRCODE = '42501';
  END IF;

  -- Gate de tenancy do argumento: a Instance tem que ser DA org pedida. Sem este
  -- filtro, um membro legítimo da org A leria o número de uma Instance da org B.
  SELECT regexp_replace(w.phone_number, '[^0-9]', '', 'g')
    INTO v_digits
    FROM public.whatsapp_instances w
   WHERE w.id = p_instance
     AND w.organization_id = p_org;

  IF v_digits IS NULL OR length(v_digits) < 10 THEN
    RETURN ARRAY[p_instance];
  END IF;

  SELECT array_agg(DISTINCT s.id)
    INTO v_ids
    FROM (
      SELECT p_instance AS id
      UNION
      SELECT q.instance_id
        FROM public.whatsapp_instance_reap_queue q
       WHERE q.organization_id = p_org
         AND q.phone_number IS NOT NULL
         AND regexp_replace(q.phone_number, '[^0-9]', '', 'g') = v_digits
    ) s;

  RETURN COALESCE(v_ids, ARRAY[p_instance]);
END;
$fn$;

COMMENT ON FUNCTION public.whatsapp_chip_instance_ids(uuid, uuid) IS
  'Instance atual + instance_ids históricos do mesmo chip (mesmo phone_number, '
  'mesma org) segundo whatsapp_instance_reap_queue. Valida que o CHAMADOR '
  'pertence a p_org (membro, master ou service_role) antes de ler qualquer '
  'coisa. Devolve apenas uuids — nunca número nem token. Sem número conhecido, '
  'devolve só a Instance recebida.';

-- ALTER DEFAULT PRIVILEGES do Supabase concede EXECUTE a PUBLIC no schema
-- public, então "REVOKE FROM anon" é no-op: tem que ser FROM PUBLIC, e depois
-- GRANT explícito. Erro já cometido neste repo (Tier A, PR #1015).
REVOKE ALL ON FUNCTION public.whatsapp_chip_instance_ids(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.whatsapp_chip_instance_ids(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.whatsapp_chip_instance_ids(uuid, uuid)
  TO authenticated, service_role;

-- Verificação, não confiança: o REVOKE acima já falhou antes por causa do grant
-- via PUBLIC, e o sintoma é silencioso.
DO $verify$
BEGIN
  IF has_function_privilege(
       'anon', 'public.whatsapp_chip_instance_ids(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION
      'whatsapp_chip_instance_ids: anon ainda tem EXECUTE — o REVOKE não pegou';
  END IF;

  IF NOT has_function_privilege(
       'authenticated', 'public.whatsapp_chip_instance_ids(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION
      'whatsapp_chip_instance_ids: authenticated sem EXECUTE — a lista do inbox quebraria';
  END IF;

  -- O escape de service_role no gate não vale nada se o papel não puder chamar.
  IF NOT has_function_privilege(
       'service_role', 'public.whatsapp_chip_instance_ids(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION
      'whatsapp_chip_instance_ids: service_role sem EXECUTE — as edge functions quebrariam';
  END IF;
END;
$verify$;

-- ---------------------------------------------------------------------------
-- 3. A lista do inbox passa a enxergar o chip inteiro
--
-- Recriação de `get_whatsapp_conversation_list` com a definição de prod como
-- base. Assinatura, nomes e ordem dos parâmetros, tipo de retorno, gate de org e
-- todos os filtros ficam IDÊNTICOS — é a lista de todo mundo. CREATE OR REPLACE
-- (não DROP+CREATE) preserva o `proacl` atual, que já não inclui anon.
--
-- Muda o alcance: onde havia `instance_id = p_instance`, passa a haver
-- `= ANY(chip)`. São três lugares, e cada um exigiu um cuidado próprio contra
-- duplicata — expandir o filtro sem colapsar por telefone transformaria "a
-- conversa some" em "a conversa aparece duas vezes", que é troca ruim:
--
--   * `whatsapp_conversation_summary` tem PK (org, instance, telefone) → o mesmo
--     contato tem UMA linha por Instance do chip. `DISTINCT ON` fica com a mais
--     recente, e é ela que os filtros avaliam: "aguardando", "não lida" e
--     "origem" descrevem o estado ATUAL da thread, não o de uma Instance morta.
--   * `conversation_read_state` guarda a chave por Instance
--     ('whatsapp:<instance>:<telefone>') → `max(last_read_at)` colapsa as leituras
--     do chip. Sem o colapso, o LEFT JOIN da CTE `unread` multiplicaria a
--     contagem de não lidas pelo número de Instances do chip.
--   * `whatsapp_conversations` é UNIQUE por (instance_id, phone_number) → também
--     rende uma linha por Instance. `conv_pick` escolhe a da Instance atual e,
--     na falta dela, a mais recente; `conv` continua inteira para o filtro de
--     tags, que deve casar tag posta em qualquer Instance do chip.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_whatsapp_conversation_list(
  p_org uuid,
  p_instance uuid,
  p_limit integer DEFAULT 50,
  p_before timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_funnels uuid[] DEFAULT NULL::uuid[],
  p_stages text[] DEFAULT NULL::text[],
  p_tags uuid[] DEFAULT NULL::uuid[],
  p_tiers text[] DEFAULT NULL::text[],
  p_vendor_id uuid DEFAULT NULL::uuid,
  p_unassigned boolean DEFAULT NULL::boolean,
  p_lead_presence text DEFAULT NULL::text,
  p_needs_human boolean DEFAULT NULL::boolean,
  p_unread boolean DEFAULT NULL::boolean,
  p_waiting boolean DEFAULT NULL::boolean,
  p_source text DEFAULT NULL::text
)
RETURNS TABLE(
  phone_number text,
  normalized_phone text,
  push_name text,
  last_message text,
  last_message_time timestamp with time zone,
  last_message_direction text,
  last_message_sent_source text,
  lead_id uuid,
  is_group boolean,
  conversation_id uuid,
  archived_at timestamp with time zone,
  unread_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 1000);
  -- Instances do chip: a atual mais as já apagadas do mesmo número.
  v_ids uuid[];
  -- Mesmos ids em texto: a chave de leitura é string, não uuid.
  v_keys text[];
BEGIN
  -- Acesso: team_member ativo da org OU master ativo (ghost cross-org).
  --
  -- O `NOT EXISTS`/`COALESCE` aqui é endurecimento DELIBERADO de um gate que já
  -- existia (esta função é reescrita por esta migration, então o furo passaria a
  -- ser nosso): `NOT (x IN (lista com NULL))` devolve NULL, e `IF NULL THEN` não
  -- dispara — gate aberto em vez de erro. Mesma correção aplicada em
  -- `whatsapp_chip_instance_ids`, onde o risco é maior por guardar uma tabela
  -- RLS deny-all. Comportamento inalterado para qualquer entrada não-NULL.
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
  IF p_lead_presence IS NOT NULL AND p_lead_presence NOT IN ('com', 'sem') THEN
    RAISE EXCEPTION 'invalid lead presence' USING ERRCODE = '22023';
  END IF;
  IF p_source IS NOT NULL AND p_source NOT IN ('ia', 'humano') THEN
    RAISE EXCEPTION 'invalid source' USING ERRCODE = '22023';
  END IF;

  -- Depois do gate: a resolução do chip só roda para org já autorizada. O gate
  -- interno de whatsapp_chip_instance_ids reavalia o mesmo `p_org` no mesmo
  -- contexto de sessão (auth.uid()/auth.role() não mudam ao entrar numa função
  -- SECURITY DEFINER), então quem passou aqui passa lá — a checagem dobrada é
  -- redundância deliberada, não risco de falso negativo.
  v_ids  := whatsapp_chip_instance_ids(p_org, p_instance);
  v_keys := ARRAY(SELECT t.id::text FROM unnest(v_ids) AS t(id));

  RETURN QUERY
  WITH read_state AS (
    SELECT split_part(rs.conversation_key, ':', 3) AS np,
           max(rs.last_read_at) AS last_read_at
    FROM conversation_read_state rs
    WHERE rs.organization_id = p_org AND rs.user_id = v_uid
      AND rs.conversation_key LIKE 'whatsapp:%'
      AND split_part(rs.conversation_key, ':', 2) = ANY(v_keys)
    GROUP BY 1
  ),
  unread AS (
    SELECT m.normalized_phone AS np, count(*)::integer AS cnt
    FROM whatsapp_messages m
    LEFT JOIN read_state r ON r.np = m.normalized_phone
    WHERE m.organization_id = p_org AND m.instance_id = ANY(v_ids)
      AND m.direction = 'incoming' AND m.deleted_at IS NULL AND m.is_group = false
      AND m."timestamp" > now() - interval '30 days'
      AND m."timestamp" > COALESCE(r.last_read_at, now() - interval '7 days')
    GROUP BY m.normalized_phone
  ),
  conv AS (
    SELECT c.normalized_phone AS np, c.id, c.archived_at, c.deleted_at,
           c.instance_id, c.created_at
    FROM whatsapp_conversations c
    WHERE c.organization_id = p_org AND c.instance_id = ANY(v_ids)
      AND c.normalized_phone IS NOT NULL
  ),
  -- Uma linha por telefone. Prioriza a Instance viva: arquivar/apagar a thread
  -- é ato do usuário no chip de hoje, e é essa decisão que deve valer.
  conv_pick AS (
    SELECT DISTINCT ON (c2.np) c2.np, c2.id, c2.archived_at, c2.deleted_at
    FROM conv c2
    ORDER BY c2.np, (c2.instance_id = p_instance) DESC,
             c2.created_at DESC NULLS LAST, c2.id
  ),
  -- O chip inteiro, colapsado por telefone antes de qualquer filtro.
  chip AS (
    SELECT DISTINCT ON (s.normalized_phone)
           s.phone_number, s.normalized_phone, s.last_push_name, s.last_message,
           s.last_message_time, s.last_message_direction, s.last_message_sent_source,
           s.lead_id, s.is_group
    FROM whatsapp_conversation_summary s
    WHERE s.organization_id = p_org AND s.instance_id = ANY(v_ids)
    ORDER BY s.normalized_phone, s.last_message_time DESC
  ),
  -- Pré-filtro ANTES do LIMIT: é isto que faz o filtro enxergar a base inteira.
  page AS (
    SELECT s.phone_number, s.normalized_phone, s.last_push_name, s.last_message, s.last_message_time,
           s.last_message_direction, s.last_message_sent_source, s.lead_id, s.is_group
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
        OR (p_lead_presence = 'com' AND s.lead_id IS NOT NULL)
        OR (p_lead_presence = 'sem' AND s.lead_id IS NULL)
      )

      AND (
        p_unread IS NOT TRUE
        OR EXISTS (SELECT 1 FROM unread u WHERE u.np = s.normalized_phone AND u.cnt > 0)
      )

      AND (
        p_needs_human IS NOT TRUE
        OR (s.lead_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM conversations cv
              WHERE cv.organization_id = p_org AND cv.lead_id = s.lead_id
                AND cv.state = 'WAITING_HUMAN'))
      )

      -- `qualification_tier` é ENUM: o cast pro texto permite comparar com o
      -- array de strings da UI — valor desconhecido vira "não casa", não erro.
      AND (
        p_tiers IS NULL
        OR (s.lead_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM leads l
              WHERE l.id = s.lead_id AND l.organization_id = p_org
                AND l.qualification_tier::text = ANY(p_tiers)))
      )

      AND (
        p_unassigned IS NOT TRUE
        OR s.lead_id IS NULL
        OR EXISTS (
              SELECT 1 FROM leads l
              WHERE l.id = s.lead_id AND l.organization_id = p_org
                AND l.responsible_id IS NULL)
      )
      AND (
        p_vendor_id IS NULL
        OR (s.lead_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM leads l
              WHERE l.id = s.lead_id AND l.organization_id = p_org
                AND l.responsible_id = p_vendor_id))
      )

      AND (
        p_funnels IS NULL
        OR (s.lead_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM pipeline_entries pe
              WHERE pe.organization_id = p_org AND pe.lead_id = s.lead_id
                AND pe.pipeline_id = ANY(p_funnels)))
      )

      AND (
        p_stages IS NULL
        OR (s.lead_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM pipeline_entries pe
              WHERE pe.organization_id = p_org AND pe.lead_id = s.lead_id
                AND pe.stage_key = ANY(p_stages)
                AND (p_funnels IS NULL OR pe.pipeline_id = ANY(p_funnels))))
      )

      AND (
        p_tags IS NULL
        OR (s.lead_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM lead_tags lt
              WHERE lt.lead_id = s.lead_id AND lt.tag_id = ANY(p_tags)))
        OR EXISTS (
              SELECT 1 FROM conv c3
              JOIN whatsapp_conversation_tags ct ON ct.conversation_id = c3.id
              WHERE c3.np = s.normalized_phone AND ct.tag_id = ANY(p_tags))
      )
    ORDER BY s.last_message_time DESC
    LIMIT v_limit
  )
  SELECT p.phone_number, p.normalized_phone, p.last_push_name, p.last_message, p.last_message_time,
         p.last_message_direction, p.last_message_sent_source, p.lead_id, p.is_group,
         conv.id, conv.archived_at, coalesce(u.cnt, 0)
  FROM page p
  LEFT JOIN conv_pick conv ON conv.np = p.normalized_phone
  LEFT JOIN unread u ON u.np  = p.normalized_phone
  WHERE conv.deleted_at IS NULL
  ORDER BY p.last_message_time DESC;
END;
$function$;

-- CREATE OR REPLACE preserva o proacl, mas a garantia é barata e o histórico
-- deste repo justifica: 20260727140438 existe porque uma recriação devolveu
-- EXECUTE a anon sem ninguém notar.
DO $verify$
BEGIN
  IF has_function_privilege(
       'anon',
       'public.get_whatsapp_conversation_list(uuid, uuid, integer, timestamptz, uuid[], text[], uuid[], text[], uuid, boolean, text, boolean, boolean, boolean, text)',
       'EXECUTE') THEN
    RAISE EXCEPTION
      'get_whatsapp_conversation_list: anon voltou a ter EXECUTE após o REPLACE';
  END IF;
END;
$verify$;

RESET lock_timeout;
