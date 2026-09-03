-- ═══════════════════════════════════════════════════════════════════════════
-- ENSAIO SCRUM-641b — ANTES: abre a transação e confere o controle para o par
-- 20270918000000 (seed do Funil de Vendas) + 20270918000010 (reunião por papel).
--
-- Payload montado por scripts/ensaio-scrum641b.sh:
--   este arquivo (BEGIN + controle)
--     → 20270918000000 (seed — inclui a própria org sintética dele)
--     → 20270918000010 (captura por papel)
--     → ensaio-scrum641b-depois.sql (sonda end-to-end de reunião em org nova
--       + não-mudança + RAISE 'ENSAIO_OK' que ABORTA) → ROLLBACK
--
-- NADA é aplicado. Autorização vigente do CTO para ensaios que abortam sozinhos.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TEMP TABLE _e641b_antes (
  meeting_events bigint,
  pipelines_total bigint
) ON COMMIT DROP;

INSERT INTO _e641b_antes
SELECT (SELECT count(*) FROM public.meeting_events),
       (SELECT count(*) FROM public.pipelines);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_seed_default_funnel') THEN
    RAISE EXCEPTION 'CONTROLE: trg_seed_default_funnel já existe — 000000 já aplicada?';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'fn_capture_meeting_event'
      AND pg_get_functiondef(p.oid) LIKE '%v_role_new%'
  ) THEN
    RAISE EXCEPTION 'CONTROLE: fn_capture_meeting_event já generalizada — 000010 já aplicada?';
  END IF;
END $$;
