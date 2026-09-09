-- ═══════════════════════════════════════════════════════════════════════════
-- ENSAIO 1721+1722 — DEPOIS: os dois rollbacks acabaram de rodar acima.
--
-- CONTROLE NEGATIVO. Esta é a parte que impede o ensaio de mentir: se o verde
-- tivesse vindo do ambiente e não das migrations, o vermelho NÃO voltaria aqui.
-- Roda dentro da MESMA transação — não custa uma segunda ida a produção.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE sobrou TEXT := '';
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='blast_plans' AND column_name='template')
    THEN sobrou := sobrou || ' blast_plans.template;'; END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_blast_plan_recipients_claim')
    THEN sobrou := sobrou || ' idx_..._claim;'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public' AND p.proname IN ('claim_blast_recipients','invoke_process_blast_recipients'))
    THEN sobrou := sobrou || ' função de claim;'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='blast_plan_recipients' AND column_name='claimed_at')
    THEN sobrou := sobrou || ' claimed_at;'; END IF;

  IF sobrou <> '' THEN
    RAISE EXCEPTION 'ROLLBACK INCOMPLETO — sobrou:%', sobrou;
  END IF;
  RAISE NOTICE 'rollback OK: todos os objetos das duas migrations desapareceram';
END $$;

-- O cron tem de ter sido desagendado pelo rollback.
DO $$
DECLARE n INT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    SELECT count(*) INTO n FROM cron.job WHERE jobname='process-blast-recipients';
    IF n <> 0 THEN RAISE EXCEPTION 'ROLLBACK INCOMPLETO: job do cron ainda agendado (% ocorrência)', n; END IF;
    RAISE NOTICE 'rollback OK: cron desagendado';
  END IF;
END $$;

-- CONTROLE NEGATIVO PROPRIAMENTE DITO: `delivered` volta a estourar.
-- Se NÃO estourar aqui, o verde do meio veio do ambiente, não da migration.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.blast_plan_recipients (plan_id, status)
    SELECT id, 'delivered' FROM public.blast_plans LIMIT 1;
    RAISE EXCEPTION 'CONTROLE NEGATIVO FALHOU: delivered continuou aceito depois do rollback — o verde não era da migration';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'controle negativo OK: delivered voltou a estourar 23514';
  END;
END $$;

-- E os dados continuam onde estavam, depois de ida e volta.
DO $$
DECLARE a RECORD; p BIGINT; d BIGINT; div BIGINT;
BEGIN
  SELECT * INTO a FROM _antes;
  SELECT count(*) INTO p FROM public.blast_plans;
  SELECT count(*) INTO d FROM public.blast_plan_recipients;
  IF p <> a.planos OR d <> a.destinatarios THEN
    RAISE EXCEPTION 'FALHOU: contagem mudou depois da ida e volta — planos %->%, destinatários %->%',
      a.planos, p, a.destinatarios, d;
  END IF;
  SELECT count(*) INTO div FROM (
    SELECT status, count(*) n FROM public.blast_plan_recipients GROUP BY status
    EXCEPT SELECT status, n FROM _antes_dist
  ) x;
  IF div > 0 THEN RAISE EXCEPTION 'FALHOU: distribuição por status mudou depois da ida e volta'; END IF;
  RAISE NOTICE 'final OK: % planos e % destinatários, distribuição idêntica', p, d;
END $$;

-- ─── RELATÓRIO ─────────────────────────────────────────────────────────────
SELECT
  'ENSAIO 1721+1722 COMPLETO'                       AS resultado,
  (SELECT planos        FROM _antes)                AS planos,
  (SELECT destinatarios FROM _antes)                AS destinatarios,
  (SELECT pendentes     FROM _antes)                AS pendentes,
  'nada aplicado — a próxima instrução é ROLLBACK'  AS estado;

ROLLBACK;
