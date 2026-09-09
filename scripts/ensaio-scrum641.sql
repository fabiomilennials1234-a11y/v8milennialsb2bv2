-- ═══════════════════════════════════════════════════════════════════════════
-- ENSAIO SCRUM-641 — ANTES: abre a transação e grava o retrato pré-migration
-- (orgs, orgs com funil, slug 'vendas' inexistente, trigger ausente).
--
-- Payload montado por scripts/ensaio-scrum641.sh:
--   ensaio-scrum641.sql (BEGIN + controle)
--     → supabase/migrations/20270918000000_org_nova_nasce_com_funil_de_vendas.sql
--       (ARQUIVO DE VERDADE — inclui a própria org sintética criada→verificada
--       →apagada no bloco de verificação)
--     → scripts/ensaio-scrum641-depois.sql (asserções de não-mudança +
--       RAISE 'ENSAIO_OK' que ABORTA) → ROLLBACK
--
-- NADA é aplicado. Autorização vigente do CTO para ensaios que abortam sozinhos.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TEMP TABLE _e641_antes (
  orgs bigint,
  orgs_com_funil bigint,
  pipelines_total bigint,
  stages_total bigint,
  defaults_preenchidos bigint
) ON COMMIT DROP;

INSERT INTO _e641_antes
SELECT (SELECT count(*) FROM public.organizations),
       (SELECT count(DISTINCT organization_id) FROM public.pipelines),
       (SELECT count(*) FROM public.pipelines),
       (SELECT count(*) FROM public.pipeline_stages),
       (SELECT count(*) FROM public.organizations WHERE default_pipeline_id IS NOT NULL);

DO $$
DECLARE v _e641_antes%ROWTYPE;
BEGIN
  SELECT * INTO v FROM _e641_antes;
  IF v.orgs = 0 THEN
    RAISE EXCEPTION 'CONTROLE: zero orgs — isto não é prod.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pipelines WHERE slug = 'vendas') THEN
    RAISE EXCEPTION 'CONTROLE: já existe funil slug=vendas — premissa do seed caiu, reavaliar.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_seed_default_funnel') THEN
    RAISE EXCEPTION 'CONTROLE: trg_seed_default_funnel já existe — migration já aplicada?';
  END IF;
  RAISE NOTICE 'retrato antes: % orgs, % com funil, % pipelines, % etapas, % defaults.',
    v.orgs, v.orgs_com_funil, v.pipelines_total, v.stages_total, v.defaults_preenchidos;
END $$;
