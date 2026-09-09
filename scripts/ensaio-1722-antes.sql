-- ═══════════════════════════════════════════════════════════════════════════
-- ENSAIO 1721+1722 — ANTES: abre a transação, mede o estado e prova o vermelho.
--
-- As duas migrations são ensaiadas JUNTAS, na ordem real de apply, porque
-- medimos contra produção em 2026-08-24 e NENHUMA das duas está aplicada:
--   claimed_at = ausente · blast_plans.template = ausente · claim_* = ausente
-- E o índice do claim (#1722) depende de claimed_at (#1721). Ensaiar a de cima
-- sozinha provaria uma sequência que ninguém vai executar.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── CONTROLE VAZIO ────────────────────────────────────────────────────────
-- Tabela sem linha nenhuma torna "a contagem não mudou" verdadeiro por vacuidade.
-- Se não há o que preservar, o ensaio não prova preservação: aborta.
DO $$
DECLARE n BIGINT;
BEGIN
  SELECT count(*) INTO n FROM public.blast_plan_recipients;
  IF n = 0 THEN
    RAISE EXCEPTION 'CONTROLE VAZIO: blast_plan_recipients tem 0 linhas — o ensaio não teria o que preservar';
  END IF;
  RAISE NOTICE 'controle vazio OK: % destinatários vivos', n;
END $$;

-- ─── SONDA QUEBRADA ────────────────────────────────────────────────────────
-- Se o instrumento recusasse tudo, todo vermelho abaixo seria falso vermelho.
-- `pending` TEM de ser aceito hoje. Se não for, o problema é a sonda, não o alvo.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.blast_plan_recipients (plan_id, status)
    SELECT id, 'pending' FROM public.blast_plans LIMIT 1;
    RAISE EXCEPTION 'sonda_ok';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM <> 'sonda_ok' THEN RAISE; END IF;
      RAISE NOTICE 'sonda quebrada OK: o instrumento aceita pending';
    WHEN check_violation THEN
      RAISE EXCEPTION 'SONDA QUEBRADA: pending foi RECUSADO — o instrumento está recusando tudo';
  END;
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

-- ─── VERMELHO PROVADO ──────────────────────────────────────────────────────
-- Cada objeto que as migrations criam TEM de estar ausente agora. Se algum já
-- existisse, o verde correspondente viria do ambiente e não da migration.
DO $$
DECLARE achados TEXT := '';
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='blast_plan_recipients' AND column_name='claimed_at')
    THEN achados := achados || ' claimed_at(#1721) já existe;'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='blast_plans' AND column_name='template')
    THEN achados := achados || ' blast_plans.template já existe;'; END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_blast_plan_recipients_claim')
    THEN achados := achados || ' idx_..._claim já existe;'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public' AND p.proname IN ('claim_blast_recipients','invoke_process_blast_recipients'))
    THEN achados := achados || ' função de claim já existe;'; END IF;

  IF achados <> '' THEN
    RAISE EXCEPTION 'VERMELHO NÃO PROVADO — o alvo já está parcialmente aplicado:%', achados;
  END IF;
  RAISE NOTICE 'vermelho OK: nenhum objeto das duas migrations existe ainda';
END $$;

-- E o CHECK de hoje TEM de recusar `delivered`. Se aceitasse, o #1721 já teria
-- entrado por outro caminho e o verde seria do ambiente.
DO $$
BEGIN
  BEGIN
    INSERT INTO public.blast_plan_recipients (plan_id, status)
    SELECT id, 'delivered' FROM public.blast_plans LIMIT 1;
    RAISE EXCEPTION 'VERMELHO NÃO PROVADO: delivered foi ACEITO antes da migration';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'vermelho OK: delivered estoura 23514 hoje, como esperado';
  END;
END $$;

