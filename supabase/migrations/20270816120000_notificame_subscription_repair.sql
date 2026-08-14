-- ============================================================================
-- Migration: NotificaMe — ESTADO DA SUBSCRIPTION DE ENTRADA + fila de reparo
-- Data: 2027-08-16
-- Branch: feat/notificame-seamless
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  O DEFEITO QUE ESTA MIGRATION FECHA                                      ║
-- ║                                                                          ║
-- ║  `notificame-channel-finish` registrava a subscription de entrada e, ao   ║
-- ║  falhar, devolvia `subscription_pending: true` no JSON. NINGUÉM LIA esse  ║
-- ║  campo (`grep subscription_pending src/` = vazio). O desfecho real era:   ║
-- ║  o canal conecta, a UI diz SUCESSO, e o recebimento nunca é registrado —  ║
-- ║  mensagens simplesmente não chegam, sem erro em lugar nenhum.             ║
-- ║                                                                          ║
-- ║  É o modo de falha mais caro que existe: PARECE QUE FUNCIONOU. E o        ║
-- ║  sintoma ("o Instagram não recebe nada") é indistinguível de "ninguém     ║
-- ║  mandou mensagem" — some por semanas.                                    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- ─── POR QUE FILA DE RETENTATIVA, E NÃO AS OUTRAS DUAS SAÍDAS ───────────────
--
--   (a) FALHAR A CONEXÃO. Recusada, e a razão está no cabeçalho do finish: o
--       canal JÁ NASCEU no fornecedor quando este código roda — é FATURÁVEL e
--       IRREMOVÍVEL. Desfazer o vínculo fabrica a órfã permanente que a fatia 1.1
--       inteira existe para evitar, trocando um problema recuperável por um
--       irrecuperável.
--   (b) BOTÃO DE REPROCESSAR NA UI. Melhor que nada, mas exige um humano
--       PERCEBER — e a percepção é justamente o que falta: a tela diz "conectado".
--       Além disso, as duas rotas idempotentes do finish (sessão já fechada,
--       corrida perdida no índice único) devolvem 200 sem NUNCA reavaliar a
--       subscription: um usuário que "tenta de novo" recebe sucesso e continua
--       sem recebimento.
--   (c) FILA DE RETENTATIVA. ⇐ ESCOLHIDA. A causa dominante da falha é
--       TRANSITÓRIA (rede, 5xx do fornecedor) ou de CONFIGURAÇÃO
--       (`NOTIFICAME_WEBHOOK_SECRET` ausente). As duas se resolvem sozinhas com o
--       tempo ou com um `secrets set` — sem ninguém precisar notar nada. O que
--       sobra depois das retentativas fica CONTÁVEL numa coluna indexada.
--
-- (b) não some: com o estado nesta tabela — lida sob RLS por qualquer membro da
-- org — a UI pode mostrar "recebimento pendente" e chamar o reparo QUANDO houver
-- fatia de front. O que esta migration garante é que a recuperação NÃO DEPENDE
-- dessa fatia existir.
--
-- ─── COLUNAS, E NÃO `provider_config->'subscription'` ───────────────────────
--
-- A fatia anterior guardava o estado dentro do jsonb. Três razões para promovê-lo:
--
--   1. UM WORKER PRECISA ENCONTRAR AS LINHAS. `WHERE provider_config->'subscription'
--      ->>'status' = 'failed'` não usa índice e não tem CHECK — o vocabulário
--      derivaria em silêncio;
--   2. CONTAGEM É O QUE TRANSFORMA DETECÇÃO EM ALERTA. `SELECT count(*) ... WHERE
--      inbound_subscription_status <> 'active'` é uma pergunta que se faz num
--      painel. A mesma pergunta dentro de jsonb ninguém faz;
--   3. DOIS ESTADOS DIVERGEM. O `COMMENT` de `provider_config` já proíbe duplicar
--      o que é coluna (o caso do `subaccount_id`). Mantê-lo nos dois lugares
--      repetiria exatamente o defeito que aquele comentário nomeia.
--
-- Por isso o passo 2 MIGRA o que houver no jsonb e REMOVE a chave: uma fonte só.
--
-- ─── ORDEM DE APPLY ─────────────────────────────────────────────────────────
--
--   1º  `20270814093000_notificame_instagram_channel.sql`  (cria messaging_channels)
--   2º  `20270815104500_notificame_instagram_inbound.sql`  (webhook + fila de parking)
--   3º  ESTE ARQUIVO
--   4º  `supabase functions deploy notificame-subscription-repair`
--       `supabase functions deploy notificame-channel-finish`
--
-- Rodar este arquivo antes do 1º ABORTA limpo (`42P01 messaging_channels`), dentro
-- da transação do `db push` — erro barulhento, nada meio-aplicado.
--
-- ⚠️ INVERTER 3º e 4º é o único desfecho SUJO, e ele é BENIGNO aqui: o finish novo
-- sobre schema velho cai nas guardas de `notificame-schema-guard.ts` (o UPDATE das
-- colunas novas erra com 42703/PGRST204, é reconhecido pelo nome da coluna e não
-- derruba o vínculo). O canal é vinculado, o carimbo não acontece, e o reparo
-- retoma no minuto seguinte ao apply. Continua valendo MIGRATION PRIMEIRO.
--
-- ⚠️ `--db-url` EXPLÍCITO. `config.toml` aponta para PROD; `supabase db push` com
-- checkout linkado escreve em produção sem perguntar.
--
-- ROLLBACK: `supabase/migrations/rollback/20270816120000_notificame_subscription_repair.sql`
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. O estado do recebimento, promovido a colunas de primeira classe.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `ADD COLUMN ... NOT NULL DEFAULT` com default NÃO-VOLÁTIL é metadata-only no
-- PG11+ (`now()` é STABLE): as linhas existentes não são reescritas e todas
-- herdam o MESMO instante — o do ALTER. É exatamente o que se quer: todo canal
-- que já existia nasce 'pending' e VENCIDO, ou seja, entra no primeiro ciclo de
-- reparo. Um canal vinculado antes desta migration é precisamente o caso em que
-- ninguém sabe se a subscription existe.

ALTER TABLE public.messaging_channels
  ADD COLUMN IF NOT EXISTS inbound_subscription_status TEXT NOT NULL DEFAULT 'pending';

ALTER TABLE public.messaging_channels
  ADD COLUMN IF NOT EXISTS inbound_subscription_attempts INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.messaging_channels
  ADD COLUMN IF NOT EXISTS inbound_subscription_last_error TEXT;

ALTER TABLE public.messaging_channels
  ADD COLUMN IF NOT EXISTS inbound_subscription_last_attempt_at TIMESTAMPTZ;

ALTER TABLE public.messaging_channels
  ADD COLUMN IF NOT EXISTS inbound_subscription_next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.messaging_channels
  ADD COLUMN IF NOT EXISTS inbound_subscription_registered_at TIMESTAMPTZ;

-- VOCABULÁRIO FECHADO, com CHECK — ao contrário do `reason` da fila de parking,
-- que é fechado só no código. A diferença é o que se perde ao violar: lá, um
-- 23514 destruiria o corpo cru de um evento que não existe em mais lugar nenhum;
-- aqui, um 23514 só recusa um carimbo de estado que o worker refaz no próximo
-- ciclo. Onde a violação é barata, o CHECK é a guarda certa.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_messaging_channels_inbound_subscription_status'
  ) THEN
    ALTER TABLE public.messaging_channels
      ADD CONSTRAINT chk_messaging_channels_inbound_subscription_status
      CHECK (inbound_subscription_status IN ('pending', 'active', 'failed', 'not_applicable'));
  END IF;
END $$;

COMMENT ON COLUMN public.messaging_channels.inbound_subscription_status IS
  'O canal RECEBE mensagens? pending = ainda não registrado (nasce assim; o worker '
  'notificame-subscription-repair vai tentar) | active = POST /v1/subscriptions '
  'aceito, medido PELO CORPO da resposta e nunca por res.ok | failed = recusado, '
  'com backoff em inbound_subscription_next_attempt_at | not_applicable = tipo de '
  'canal sem subscription nesta rota. ⚠️ ISTO NÃO É status DA CONEXÃO: um canal '
  'pode estar status=connected (o vínculo existe, o cliente vê "conectado") e '
  'inbound_subscription_status<>active (nada chega). Foram exatamente esses dois '
  'estados colapsados num só que produziram o defeito desta migration.';

COMMENT ON COLUMN public.messaging_channels.inbound_subscription_attempts IS
  'Tentativas de registro que FALHARAM em sequência. Zera no sucesso. É o expoente '
  'do backoff e o gatilho de escalada (o worker grita em runtime_logs a partir do '
  'limiar dele). ⚠️ NÃO é incrementado quando a falha é de CONFIGURAÇÃO nossa '
  '(secret ausente): inflar o backoff por causa de um env faltando adiaria o '
  'reparo por horas depois de o env chegar — a espera puniria o conserto.';

COMMENT ON COLUMN public.messaging_channels.inbound_subscription_last_error IS
  'CÓDIGO NOSSO (Hub404, AUTHENTICATION_ERROR, subscription_transport_error, '
  'subaccount_unavailable, not_configured). JAMAIS a prosa do fornecedor: esta '
  'coluna é lida sob RLS por qualquer membro da org, e withErrorBoundary devolve '
  'error.message cru no corpo de um 500.';

COMMENT ON COLUMN public.messaging_channels.inbound_subscription_next_attempt_at IS
  'Quando o worker pode tentar de novo. É o RELÓGIO DA FILA — o índice parcial '
  'idx_messaging_channels_subscription_due ordena por ele. Default now() para que '
  'toda linha nasça (e toda linha pré-existente passe a ser) vencida.';

COMMENT ON COLUMN public.messaging_channels.inbound_subscription_registered_at IS
  'Quando o fornecedor aceitou o registro. Sobrevive a uma falha posterior de '
  'propósito: "já recebeu um dia" e "recebe agora" são perguntas diferentes.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Migra o estado que morava no jsonb e APAGA a chave — uma fonte só.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Na prática isto é no-op hoje (nenhum canal foi conectado ainda), mas escrever o
-- backfill custa cinco linhas e não escrevê-lo deixaria, num ambiente onde a
-- fatia 2-IG chegou a rodar, um canal ATIVO marcado como 'pending' — o worker
-- registraria uma SEGUNDA subscription no fornecedor e o inbox duplicaria.
UPDATE public.messaging_channels
   SET inbound_subscription_status =
         CASE provider_config -> 'subscription' ->> 'status'
           WHEN 'active' THEN 'active'
           WHEN 'failed' THEN 'failed'
           ELSE inbound_subscription_status
         END,
       inbound_subscription_last_error =
         provider_config -> 'subscription' ->> 'last_error_code',
       inbound_subscription_registered_at =
         CASE WHEN provider_config -> 'subscription' ->> 'status' = 'active'
              THEN (provider_config -> 'subscription' ->> 'registered_at')::timestamptz
              ELSE NULL
         END,
       provider_config = provider_config - 'subscription'
 -- `jsonb_exists(...)` e não o operador `?`: o ponto de interrogação é
 -- placeholder de parâmetro em vários drivers, e uma migration tem de sobreviver
 -- a qualquer caminho de apply (CLI, psql, MCP).
 WHERE jsonb_exists(provider_config, 'subscription');

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. O índice da fila: PARCIAL, porque o caminho feliz não é fila.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Um canal 'active' é a esmagadora maioria e nunca é lido por este predicado.
-- Índice total pagaria escrita por linha para indexar o que ninguém procura.
CREATE INDEX IF NOT EXISTS idx_messaging_channels_subscription_due
  ON public.messaging_channels (inbound_subscription_next_attempt_at)
  WHERE inbound_subscription_status IN ('pending', 'failed');

COMMENT ON INDEX public.idx_messaging_channels_subscription_due IS
  'Fila do notificame-subscription-repair. Também é a CONTAGEM que responde '
  '"quantos canais estão conectados sem receber?" — a pergunta que o defeito '
  'original tornava impossível de fazer.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. O gatilho automático: pg_cron → pg_net → edge function.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ⚠️ A URL NÃO É CHUMBADA. Precedentes neste repo (omie-sync-dispatch) escrevem o
-- ref do projeto de PROD no `cron_config`; aplicar aquele arquivo em DEV faz o
-- cron de dev bater na função de PROD. Aqui a URL é DERIVADA de uma entrada que
-- já exista no `cron_config` DAQUELE banco — logo, sempre do ambiente certo — e a
-- chave explícita `notificame_subscription_repair_url`, se presente, vence.
--
-- NO-OP HONESTO em três situações, todas silenciosas de propósito: sem fila
-- vencida, sem URL resolvível, sem pg_net. Nenhuma delas é erro — e uma exceção
-- num job de cron enche o log do banco a cada minuto sem consertar nada.

CREATE OR REPLACE FUNCTION public.invoke_notificame_subscription_repair()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url    TEXT;
  v_secret TEXT;
  v_due    INT;
BEGIN
  -- A fatia pode não estar aplicada neste banco.
  IF to_regclass('public.messaging_channels') IS NULL THEN
    RETURN;
  END IF;

  -- Só acorda a função quando há trabalho. Sem isto, um POST a cada 5 minutos
  -- para sempre, em todo ambiente, para não fazer nada.
  SELECT count(*) INTO v_due
    FROM public.messaging_channels
   WHERE status = 'connected'
     AND inbound_subscription_status IN ('pending', 'failed')
     AND inbound_subscription_next_attempt_at <= now();

  IF v_due = 0 THEN
    RETURN;
  END IF;

  SELECT value INTO v_secret FROM public.cron_config WHERE key = 'cron_secret';
  SELECT value INTO v_url
    FROM public.cron_config
   WHERE key = 'notificame_subscription_repair_url';

  -- Deriva do ambiente: qualquer URL de function já cadastrada NESTE banco dá a
  -- base certa. Trocar o último segmento é seguro porque o formato é fixo
  -- (`https://<ref>.supabase.co/functions/v1/<nome>`).
  IF v_url IS NULL OR v_url = '' THEN
    SELECT regexp_replace(value, '/functions/v1/.*$',
                          '/functions/v1/notificame-subscription-repair')
      INTO v_url
      FROM public.cron_config
     WHERE value LIKE 'https://%/functions/v1/%'
     ORDER BY key
     LIMIT 1;
  END IF;

  IF v_url IS NULL OR v_url = '' THEN
    -- RAISE LOG e não WARNING: só dispara quando HÁ fila vencida, então não é
    -- ruído — é a única pista de que o reparo está parado por configuração.
    RAISE LOG '[notificame-subscription-repair] % canal(is) aguardando registro de entrada e nenhuma URL resolvivel em cron_config (insira a chave notificame_subscription_repair_url)', v_due;
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-cron-secret', COALESCE(v_secret, '')
               ),
    body    := '{}'::jsonb
  );
EXCEPTION
  -- pg_net ausente (ambiente local), ou funções novas sobre schema velho.
  --
  -- ⚠️ `invalid_schema_name` É OBRIGATÓRIO e é o que os precedentes deste repo
  -- ESQUECEM (ver `invoke_omie_sync_dispatch`, que só trata `undefined_function`).
  -- Sem pg_net instalado, o Postgres não chega a procurar a FUNÇÃO: ele falha
  -- antes, no SCHEMA, com `3F000 schema "net" does not exist` — que `undefined_function`
  -- NÃO captura. MEDIDO num cluster limpo, não deduzido. O desfecho de errar é um
  -- job de cron gritando a cada 5 minutos em todo ambiente sem pg_net.
  WHEN invalid_schema_name THEN RETURN;
  WHEN undefined_function  THEN RETURN;
  WHEN undefined_column    THEN RETURN;
  WHEN undefined_table     THEN RETURN;
END;
$$;

COMMENT ON FUNCTION public.invoke_notificame_subscription_repair() IS
  'Cron do reparo de subscription de entrada do NotificaMe. No-op quando a fila '
  'está vazia. Resolve a URL a partir do proprio cron_config do ambiente — nunca '
  'com o ref do projeto chumbado, que faria o cron de dev bater em prod.';

-- ⚠️ CREATE OR REPLACE FUNCTION **RESETA GRANTS** — o default do schema public
-- devolve EXECUTE a PUBLIC, e uma SECURITY DEFINER executável por `anon` é um
-- disparador de webhook de graça para quem tiver a anon key.
REVOKE ALL ON FUNCTION public.invoke_notificame_subscription_repair() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.invoke_notificame_subscription_repair() FROM anon;
REVOKE ALL ON FUNCTION public.invoke_notificame_subscription_repair() FROM authenticated;

-- A cada 5 minutos. Não é frequência de fila quente: o volume esperado é ZERO na
-- maior parte do tempo, e o que importa é o TETO da janela em que um canal
-- recém-conectado fica sem receber — 5 minutos, e o backoff cresce a partir daí.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notificame-subscription-repair') THEN
      PERFORM cron.unschedule('notificame-subscription-repair');
    END IF;
    PERFORM cron.schedule(
      'notificame-subscription-repair',
      '*/5 * * * *',
      'SELECT public.invoke_notificame_subscription_repair();'
    );
  END IF;
END $$;
