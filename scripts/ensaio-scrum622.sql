-- ═══════════════════════════════════════════════════════════════════════════
-- ENSAIO SCRUM-622 — ANTES: abre a transação, controle vazio e _param com
-- TODAS as orgs do recorte (Milennials primeiro, depois por volume).
--
-- Payload montado por scripts/ensaio-scrum622.sh:
--   ensaio-scrum622.sql (BEGIN + controle + _param)
--     → [--com-621: supabase/migrations/20270908001000_inversao_do_silo_custom.sql,
--        o ARQUIVO DE VERDADE — prova o estado pós-inversão]
--     → supabase/migrations/20270908002000_procedencia_backfill_funil_custom.sql
--     → scripts/scrum622-backfill-negocios.sql (o ARQUIVO DE VERDADE do dado)
--     → scripts/ensaio-scrum622-depois.sql (sonda de procedência +
--       RAISE 'ENSAIO_OK' que ABORTA) → ROLLBACK
--
-- NADA é aplicado. Autorização vigente do CTO para ensaios que abortam sozinhos.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── CONTROLE VAZIO ─────────────────────────────────────────────────────────
DO $$
DECLARE v_total bigint; v_mil bigint;
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE pe.organization_id = '6030520a-2ca7-477d-be89-55758e2cd808')
    INTO v_total, v_mil
  FROM public.pipeline_entries pe
  JOIN public.pipelines p ON p.id = pe.pipeline_id AND p.type = 'custom'
  WHERE pe.deal_id IS NULL;
  IF v_total = 0 THEN
    RAISE EXCEPTION 'CONTROLE VAZIO: 0 cards custom sem Negócio — sem massa, o ensaio não prova nada.';
  END IF;
  RAISE NOTICE 'controle vazio OK: % card(s) no recorte, % da Milennials.', v_total, v_mil;
END $$;

-- ─── _param: as orgs do recorte, Milennials ord=1, resto por volume ─────────
CREATE TEMP TABLE _param (org uuid NOT NULL, ord int NOT NULL) ON COMMIT DROP;
INSERT INTO _param (org, ord)
SELECT pe.organization_id,
       row_number() OVER (
         ORDER BY (pe.organization_id <> '6030520a-2ca7-477d-be89-55758e2cd808'),
                  count(*) DESC)
FROM public.pipeline_entries pe
JOIN public.pipelines p ON p.id = pe.pipeline_id AND p.type = 'custom'
WHERE pe.deal_id IS NULL
GROUP BY pe.organization_id;

DO $$
BEGIN
  RAISE NOTICE '_param populada: % org(s), ord=1 é %.',
    (SELECT count(*) FROM _param),
    (SELECT o.name FROM _param p JOIN public.organizations o ON o.id = p.org WHERE p.ord = 1);
END $$;
