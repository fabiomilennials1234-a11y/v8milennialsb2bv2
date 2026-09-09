-- ═══════════════════════════════════════════════════════════════════════════
-- APPLY 1721+1722 — ANTES. Somente leitura: reconfere as precondições e congela
-- o estado. Diferente do ensaio, aqui NÃO há sonda que escreve: numa transação
-- que vai COMMITAR, escrita de sonda é coragem guardada no lugar errado.
--
-- Qualquer precondição que falhe aborta a transação — e transação abortada não
-- aplica nada. O modo de falha deste arquivo é seguro por construção.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── CONTROLE VAZIO ────────────────────────────────────────────────────────
DO $$
DECLARE n BIGINT;
BEGIN
  SELECT count(*) INTO n FROM public.blast_plan_recipients;
  IF n = 0 THEN
    RAISE EXCEPTION 'CONTROLE VAZIO: blast_plan_recipients tem 0 linhas — não haveria o que preservar';
  END IF;
  RAISE NOTICE 'controle vazio OK: % destinatários vivos', n;
END $$;

-- ─── ESTADO ANTES, congelado para comparação ───────────────────────────────
CREATE TEMP TABLE _antes AS
SELECT
  (SELECT count(*) FROM public.blast_plans)            AS planos,
  (SELECT count(*) FROM public.blast_plan_recipients)  AS destinatarios,
  (SELECT count(*) FROM public.blast_plan_recipients WHERE status = 'pending') AS pendentes;

CREATE TEMP TABLE _antes_dist AS
SELECT status, count(*) AS n FROM public.blast_plan_recipients GROUP BY status;

CREATE TEMP TABLE _antes_idx AS
SELECT indexname, indexdef FROM pg_indexes
WHERE schemaname = 'public' AND tablename IN ('blast_plan_recipients', 'blast_plans');

-- ─── PRECONDIÇÃO 1: nada disto pode existir ────────────────────────────────
-- Se algum objeto já existisse, alguém aplicou por outro caminho e este apply
-- estaria pisando por cima às cegas.
DO $$
DECLARE achados TEXT := '';
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='blast_plan_recipients' AND column_name='claimed_at')
    THEN achados := achados || ' claimed_at(#1721);'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='blast_plans' AND column_name='template')
    THEN achados := achados || ' blast_plans.template;'; END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_blast_plan_recipients_claim')
    THEN achados := achados || ' idx_..._claim;'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public' AND p.proname IN ('claim_blast_recipients','invoke_process_blast_recipients'))
    THEN achados := achados || ' função de claim;'; END IF;

  IF achados <> '' THEN
    RAISE EXCEPTION 'PRECONDIÇÃO FALHOU — o alvo já está parcialmente aplicado:%. Pare e investigue antes de aplicar.', achados;
  END IF;
  RAISE NOTICE 'precondição OK: nenhum objeto das duas migrations existe';
END $$;

-- ─── PRECONDIÇÃO 2: o ledger não pode já conter as duas versões ────────────
-- Ledger com a versão e schema sem o objeto significa apply que passou fora do
-- ledger, ou ledger escrito sem apply. Os dois casos pedem gente, não script.
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM supabase_migrations.schema_migrations
   WHERE version IN ('20270823000000', '20270824000000');
  IF n <> 0 THEN
    RAISE EXCEPTION 'PRECONDIÇÃO FALHOU: o ledger já contém % das duas versões, mas o schema não tem os objetos', n;
  END IF;
  RAISE NOTICE 'precondição OK: o ledger não contém nenhuma das duas versões';
END $$;
