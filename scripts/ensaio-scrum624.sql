-- ═══════════════════════════════════════════════════════════════════════════
-- ENSAIO SCRUM-624 — ANTES: abre a transação e grava o retrato pré-migration
-- (orgs, orgs com funil 'whatsapp' ativo, coluna ainda inexistente).
--
-- Payload montado por scripts/ensaio-scrum624.sh:
--   ensaio-scrum624.sql (BEGIN + controle)
--     → supabase/migrations/20270908004000_funil_padrao_da_org.sql (ARQUIVO DE VERDADE)
--     → scripts/ensaio-scrum624-depois.sql (asserções + sondas +
--       RAISE 'ENSAIO_OK' que ABORTA) → ROLLBACK
--
-- NADA é aplicado. Autorização vigente do CTO para ensaios que abortam sozinhos.
-- A migration é independente das 20270908001000/002000/003000 (não referencia
-- nada que elas criam), então o ensaio standalone prova o estado real.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TEMP TABLE _e624_antes (orgs bigint, orgs_com_whatsapp bigint) ON COMMIT DROP;
INSERT INTO _e624_antes
SELECT (SELECT count(*) FROM public.organizations),
       (SELECT count(DISTINCT p.organization_id)
          FROM public.pipelines p
         WHERE p.slug = 'whatsapp'
           AND p.is_active IS DISTINCT FROM false);

DO $$
DECLARE v _e624_antes%ROWTYPE;
BEGIN
  SELECT * INTO v FROM _e624_antes;
  IF v.orgs = 0 THEN
    RAISE EXCEPTION 'CONTROLE VAZIO: 0 organizations — banco errado?';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'organizations'
                AND column_name = 'default_pipeline_id') THEN
    RAISE EXCEPTION 'CONTROLE: organizations.default_pipeline_id JÁ EXISTE — a migration já rodou? Ensaio não prova nada.';
  END IF;
  RAISE NOTICE 'controle OK: % org(s), % com funil whatsapp ativo.', v.orgs, v.orgs_com_whatsapp;
END $$;
