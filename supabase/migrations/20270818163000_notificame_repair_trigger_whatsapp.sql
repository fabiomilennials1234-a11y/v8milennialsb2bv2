-- ============================================================================
-- Migration: o GATILHO do reparo também conta a fila de WhatsApp
-- Data: 2027-08-18
--
-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  O DEFEITO, MEDIDO EM PRODUÇÃO                                           ║
-- ║                                                                          ║
-- ║  A peça 5 da fatia de recebimento estendeu o WORKER                      ║
-- ║  (`notificame-subscription-repair`) para varrer as duas tabelas. O        ║
-- ║  GATILHO ficou para trás:                                                ║
-- ║                                                                          ║
-- ║      SELECT count(*) INTO v_due FROM public.messaging_channels ...       ║
-- ║      IF v_due = 0 THEN RETURN;   ← sai sem chamar a edge function        ║
-- ║                                                                          ║
-- ║  Sem canal SOCIAL na fila, a função nunca é invocada — e a instância de  ║
-- ║  WhatsApp esperando registro fica `pending` para sempre.                 ║
-- ║                                                                          ║
-- ║  Medido em 2026-08-18: instância da Chique `pending`, todos os           ║
-- ║  predicados batendo, cron `succeeded` às 18:45, e ZERO requisições na    ║
-- ║  edge function (`function_edge_logs` vazio). O `succeeded` do cron era   ║
-- ║  do RETURN antecipado, não de trabalho feito.                            ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- ─── POR QUE ISTO PASSOU ────────────────────────────────────────────────────
--
-- É a MESMA classe de defeito que esta fatia inteira vem consertando: a peça
-- existe e o gatilho não a alcança. O worker estava certo e testado; ninguém
-- perguntou quem o chama. Um `succeeded` no `cron.job_run_details` diz que o SQL
-- rodou — não que a função foi invocada, e muito menos que havia o que fazer.
--
-- ─── A CORREÇÃO ─────────────────────────────────────────────────────────────
--
-- O pré-filtro passa a somar as duas filas. Ele NÃO é redundante com o worker
-- (que refaz as queries): existe para não acordar uma edge function a cada 5
-- minutos quando não há nada a fazer — e é justamente por ser um atalho que ele
-- precisa enxergar tudo o que o worker enxerga.
--
-- `to_regclass` guarda cada tabela separadamente: num banco onde
-- `whatsapp_instances` ainda não tenha as colunas (migration 20270818150000 não
-- aplicada), a contagem social continua funcionando sozinha.

CREATE OR REPLACE FUNCTION public.invoke_notificame_subscription_repair()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_url    TEXT;
  v_secret TEXT;
  v_due    INT := 0;
  v_due_wa INT := 0;
BEGIN
  IF to_regclass('public.messaging_channels') IS NOT NULL THEN
    SELECT count(*) INTO v_due
      FROM public.messaging_channels
     WHERE status = 'connected'
       AND inbound_subscription_status IN ('pending', 'failed')
       AND inbound_subscription_next_attempt_at <= now();
  END IF;

  -- A fila do WhatsApp oficial. Bloco PRÓPRIO e tolerante: num banco sem a
  -- 20270818150000 as colunas não existem, e o `undefined_column` abaixo levaria
  -- a função inteira ao RETURN — matando também o reparo social, que funciona.
  IF to_regclass('public.whatsapp_instances') IS NOT NULL THEN
    BEGIN
      SELECT count(*) INTO v_due_wa
        FROM public.whatsapp_instances
       WHERE provider = 'notificame'
         AND status = 'connected'
         AND inbound_subscription_status IN ('pending', 'failed')
         AND inbound_subscription_next_attempt_at <= now();
    EXCEPTION
      WHEN undefined_column THEN v_due_wa := 0;
    END;
  END IF;

  IF (v_due + v_due_wa) = 0 THEN
    RETURN;
  END IF;

  SELECT value INTO v_secret FROM public.cron_config WHERE key = 'cron_secret';
  SELECT value INTO v_url
    FROM public.cron_config
   WHERE key = 'notificame_subscription_repair_url';

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
    RAISE LOG '[notificame-subscription-repair] % social + % whatsapp aguardando registro de entrada e nenhuma URL resolvivel em cron_config (insira a chave notificame_subscription_repair_url)', v_due, v_due_wa;
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
  WHEN invalid_schema_name THEN RETURN;
  WHEN undefined_function  THEN RETURN;
  WHEN undefined_column    THEN RETURN;
  WHEN undefined_table     THEN RETURN;
END;
$function$;

COMMENT ON FUNCTION public.invoke_notificame_subscription_repair() IS
  'Gatilho do cron de reparo. Conta as DUAS filas (messaging_channels e '
  'whatsapp_instances) — contar só uma fazia a outra esperar para sempre.';
