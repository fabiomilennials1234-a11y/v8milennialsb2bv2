-- ═══════════════════════════════════════════════════════════════════════════
-- ENSAIO FATIA B — DEPOIS: com a migration aplicada (na transação, com as
-- asserções A1–A5 dela já verdes), mede os deltas e prova a resolução
-- id-first; ABORTA com ENSAIO_OK. ROLLBACK final: nada aplica.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  a record;
  v_camp_backfill integer;
  v_camp_sem_destino integer;
  v_bp_backfill integer;
  v_bp_pst_id integer;
  v_exemplo record;
BEGIN
  SELECT * INTO a FROM _efb_antes;

  SELECT count(*) INTO v_camp_backfill
    FROM public.campanhas WHERE target_pipeline_id IS NOT NULL;
  SELECT count(*) INTO v_camp_sem_destino
    FROM public.campanhas WHERE target_pipeline_id IS NULL;
  SELECT count(*) INTO v_bp_backfill
    FROM public.blast_plans WHERE pipeline_id IS NOT NULL;
  SELECT count(*) INTO v_bp_pst_id
    FROM public.blast_plans
   WHERE post_send_target IS NOT NULL AND post_send_target ? 'pipelineId';

  -- B1: partição fecha (backfillada + sem destino = total do baseline).
  IF v_camp_backfill + v_camp_sem_destino <> a.campanhas_total THEN
    RAISE EXCEPTION 'FAIL B1: partição campanhas não fecha (%+% <> %)',
      v_camp_backfill, v_camp_sem_destino, a.campanhas_total;
  END IF;

  -- B2: todo plano com post_send_target agora resolve id-first.
  IF v_bp_pst_id <> a.bp_com_destino THEN
    RAISE EXCEPTION 'FAIL B2: % de % post_send_target sem pipelineId',
      a.bp_com_destino - v_bp_pst_id, a.bp_com_destino;
  END IF;

  -- B3: prova de resolução id-first num exemplo real backfillado (o par
  -- (pipeline_id, target_stage_id) fecha com o que o formato legado diz).
  SELECT c.id AS cid, c.objective, p.slug, ps.stage_key
    INTO v_exemplo
    FROM public.campanhas c
    JOIN public.pipelines p ON p.id = c.target_pipeline_id
    JOIN public.pipeline_stages ps ON ps.id = c.target_stage_id
   WHERE c.objective = 'qualificacao'
   LIMIT 1;
  IF FOUND AND (v_exemplo.slug <> 'whatsapp' OR v_exemplo.stage_key <> 'novo') THEN
    RAISE EXCEPTION 'FAIL B3: campanha % (qualificacao) resolveu para %/%',
      v_exemplo.cid, v_exemplo.slug, v_exemplo.stage_key;
  END IF;

  RAISE EXCEPTION 'ENSAIO_OK FATIA-B · campanhas: total=%, com destino canônico=%, sem destino=% · blast_plans: total=%, pipeline_id backfillado=% (de % com funil único), post_send_target id-first=%/%',
    a.campanhas_total, v_camp_backfill, v_camp_sem_destino,
    a.bp_total, v_bp_backfill, a.bp_funil_unico,
    v_bp_pst_id, a.bp_com_destino;
END $$;

ROLLBACK;
