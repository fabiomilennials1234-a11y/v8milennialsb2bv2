-- 20270824000000_blast_official_worker.sql
--
-- O motor do Disparo pelo Canal Oficial: Template no plano, reivindicação por
-- linha e o cron que move a fila (#1722, ADR-0028).
--
-- O #1721 deu a FORMA da linha do destinatário (entrega, custo, reivindicação).
-- Esta migration dá o que faz a fila andar:
--
--   1. `blast_plans.template`  — o Template aprovado, congelado no plano
--   2. índice parcial          — a consulta da reivindicação (dívida do #1721)
--   3. `claim_blast_recipients`— o claim atômico, que É a idempotência
--   4. cron                    — worker sem agendamento é código morto
--
-- SÓ SCHEMA. ZERO DML: nenhum INSERT/UPDATE/DELETE/TRUNCATE/COPY sobre dado de
-- cliente. Um alvo errado vira erro de schema recuperável, nunca dado mudado.

-- ─── 1. O Template mora no plano ────────────────────────────────────────────
--
-- `blast_plans.message` é NOT NULL e continua sendo escrito: recebe o corpo do
-- Template aprovado, que é literalmente o texto que a pessoa recebe. Não é
-- duplicação — é o registro do que FOI enviado, e ele tem de sobreviver ao dia
-- em que a Meta reclassificar ou pausar o Template lá do lado dela.

ALTER TABLE public.blast_plans
  ADD COLUMN IF NOT EXISTS template JSONB;

COMMENT ON COLUMN public.blast_plans.template IS
  'Template aprovado congelado no plano, quando o Disparo é pelo Canal Oficial: '
  '{name, language, components, previewText, buttonLabels}. NULL em plano de Chip, '
  'que manda texto livre (`message`). Congelado de propósito: a Meta pode pausar ou '
  'reclassificar o Template a qualquer momento, e o Disparo em curso não pode mudar '
  'de conteúdo no meio (ADR-0029).';

-- ─── 2. O índice que a reivindicação usa ────────────────────────────────────
--
-- Dívida registrada no HANDOFF do #1721: `claimed_at` entrou sem índice que
-- sustentasse a consulta do worker, e a fatia do worker paga a conta. Paga
-- barato: produção inteira são 235 linhas (medido 2026-08-23).
--
-- NÃO concorrente, pela mesma razão do #1721: a tabela é minúscula e o lock é de
-- milissegundos. Se ela crescer antes do apply, reavaliar — a reavaliação é uma
-- contagem.

CREATE INDEX IF NOT EXISTS idx_blast_plan_recipients_claim
  ON public.blast_plan_recipients (plan_id, lot_index, created_at)
  WHERE status = 'pending' AND claimed_at IS NULL;

COMMENT ON INDEX public.idx_blast_plan_recipients_claim IS
  'Sustenta claim_blast_recipients: as pendentes ainda não reivindicadas, na ordem '
  'em que o worker as consome (#1722).';

-- ─── 3. O claim atômico ─────────────────────────────────────────────────────
--
-- ⚠️ ESTA FUNÇÃO É A IDEMPOTÊNCIA DO DISPARO OFICIAL.
--
-- O NotificaMe não oferece chave de idempotência (ADR-0028 §5): reprocessar um
-- lote parcialmente enviado duplica envio, e a duplicata é COBRADA. A garantia
-- de envio único não pode morar no worker — dois tiques do cron são dois
-- processos. Ela mora aqui, no `UPDATE ... RETURNING` sob `FOR UPDATE SKIP
-- LOCKED`: quem reivindicou, levou; quem não conseguiu o lock, segue adiante em
-- vez de esperar.
--
-- Molde: `claim_pending_ai_actions` (baseline:2382-2408), que é o claim vivo
-- deste repo.
--
-- A linha reivindicada continua `pending` — o que muda é `claimed_at`. É o
-- worker que a move para `sent`/`failed` depois de saber o que o fornecedor
-- respondeu. Reivindicada há mais de 10 minutos e ainda `pending` significa
-- worker morto no meio: volta para a fila, porque a alternativa é a linha ficar
-- presa para sempre.

CREATE OR REPLACE FUNCTION public.claim_blast_recipients(
  batch_size  INT DEFAULT 20,
  per_org_cap INT DEFAULT 5
)
RETURNS SETOF public.blast_plan_recipients
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH elegivel AS (
    SELECT
      r.id,
      ROW_NUMBER() OVER (
        PARTITION BY p.organization_id
        ORDER BY r.lot_index, r.created_at
      ) AS rn_org
    FROM public.blast_plan_recipients r
    JOIN public.blast_plans       p ON p.id = r.plan_id
    JOIN public.whatsapp_instances i ON i.id = p.instance_id
    WHERE r.status = 'pending'
      -- Ainda não reivindicada, ou reivindicada por um worker que morreu.
      AND (r.claimed_at IS NULL OR r.claimed_at < now() - INTERVAL '10 minutes')
      -- Só lote JÁ liberado. `lots_released` é o índice do PRÓXIMO lote a
      -- liberar (blast-plan.ts:617), então liberado é `lot_index` menor que ele.
      -- Sem isto o worker atropelaria o fatiamento diário do Plano de Disparo.
      AND r.lot_index < p.lots_released
      -- Pausar é o worker parar de reivindicar (ADR-0028 §2). É aqui que isso
      -- acontece, e é por isso que pausar não depende do fornecedor.
      AND p.status = 'active'
      -- Regime OFICIAL. O Chip continua no motor do fornecedor: se esta linha
      -- sumisse, o worker passaria a disputar destinatários com a Uazapi.
      AND p.template IS NOT NULL
      AND i.provider = 'notificame'
  ),
  -- Teto por organização: uma org grande não pode esfomear as outras dentro do
  -- mesmo tique.
  limitado AS (
    SELECT id FROM elegivel WHERE rn_org <= per_org_cap
  ),
  escolhido AS (
    SELECT r.id
      FROM public.blast_plan_recipients r
     WHERE r.id IN (SELECT id FROM limitado)
     ORDER BY r.lot_index, r.created_at
     LIMIT batch_size
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.blast_plan_recipients r
     SET claimed_at = now()
   WHERE r.id IN (SELECT id FROM escolhido)
  RETURNING r.*;
$$;

COMMENT ON FUNCTION public.claim_blast_recipients(INT, INT) IS
  'Reivindica destinatários pendentes de Disparos pelo Canal Oficial, atomicamente '
  '(FOR UPDATE SKIP LOCKED). A reivindicação É a idempotência do envio: o fornecedor '
  'não oferece chave, e a duplicata é cobrada (ADR-0028 §5). Só service_role.';

-- `CREATE OR REPLACE FUNCTION` RESETA os grants e o default do schema public
-- devolve EXECUTE a PUBLIC. Sem estas quatro linhas, qualquer usuário
-- autenticado poderia reivindicar destinatários de QUALQUER organização — a
-- função é SECURITY DEFINER e varre todos os tenants por desenho, porque é um
-- worker de cron.
REVOKE ALL     ON FUNCTION public.claim_blast_recipients(INT, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_blast_recipients(INT, INT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_blast_recipients(INT, INT) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.claim_blast_recipients(INT, INT) TO service_role;

-- ─── 4. O cron ──────────────────────────────────────────────────────────────
--
-- Worker sem agendamento é código morto, e job criado fora do ledger é como o
-- buraco se abriu: produção tem 53 jobs e o repo versiona 12. Este vai
-- versionado.
--
-- A URL é DERIVADA do `cron_config` do próprio ambiente, nunca chumbada — cron
-- de um ambiente batendo em outro é o acidente que o ref chumbado produz.
-- Padrão vivo: `20270821140000_toth_cron_sync.sql`, `20270816120000_notificame_subscription_repair.sql`.

CREATE OR REPLACE FUNCTION public.invoke_process_blast_recipients()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url    TEXT;
  v_secret TEXT;
BEGIN
  IF to_regclass('public.blast_plan_recipients') IS NULL THEN
    RETURN;
  END IF;

  SELECT value INTO v_secret FROM public.cron_config WHERE key = 'cron_secret';

  SELECT regexp_replace(value, '/functions/v1/.*$', '/functions/v1/process-blast-recipients')
    INTO v_url
    FROM public.cron_config
   WHERE value LIKE 'https://%/functions/v1/%'
   ORDER BY key
   LIMIT 1;

  IF v_url IS NULL OR v_url = '' THEN
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
  -- `invalid_schema_name` é obrigatório: sem pg_net o Postgres falha no SCHEMA
  -- (3F000 schema "net" does not exist) ANTES de procurar a função, e
  -- `undefined_function` não captura isso.
  WHEN invalid_schema_name THEN RETURN;
  WHEN undefined_function  THEN RETURN;
  WHEN undefined_column    THEN RETURN;
  WHEN undefined_table     THEN RETURN;
END;
$$;

COMMENT ON FUNCTION public.invoke_process_blast_recipients() IS
  'Acorda o worker da fila do Disparo pelo Canal Oficial (#1722). Resolve a URL a '
  'partir do cron_config do próprio ambiente.';

REVOKE ALL     ON FUNCTION public.invoke_process_blast_recipients() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.invoke_process_blast_recipients() FROM anon;
REVOKE EXECUTE ON FUNCTION public.invoke_process_blast_recipients() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.invoke_process_blast_recipients() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('process-blast-recipients')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-blast-recipients');

    -- A cada minuto. O ritmo real é do worker, não do cron: ele reivindica um
    -- lote pequeno e envia em passo fixo e conservador. O ritmo ADAPTATIVO
    -- (sobe em entrega limpa, recua em 5xx) é #1728 — e o cron de um minuto é o
    -- que dá a ele granularidade para existir depois, sem mudar o agendamento.
    PERFORM cron.schedule(
      'process-blast-recipients', '* * * * *',
      $cron$SELECT public.invoke_process_blast_recipients();$cron$
    );
  END IF;
END $$;
