-- ═══════════════════════════════════════════════════════════════════════════
-- ENSAIO SCRUM-617 — DEPOIS: prova que os rollbacks (002000 e depois 001000)
-- devolvem o estado original e encerra com RAISE EXCEPTION 'ENSAIO_OK ...'
-- (aborta a transação de propósito, com as métricas na mensagem). O ROLLBACK
-- final do payload é cinto.
--
-- PERDA CONHECIDA (D-c da 002000): os stage_keys reparados (uuid → key real)
-- NÃO voltam — o depois assere que a divergência vs snapshot é EXATAMENTE o
-- conjunto reparado, nada além.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  c record;
  v_diff bigint;
  v_ent  bigint;
BEGIN
  SELECT * INTO c FROM _e617_counts;

  -- Estrutura revertida (a 001000 já asseriu a dela no próprio rollback).
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'pipeline_entries'
                AND column_name = 'stage_id') THEN
    RAISE EXCEPTION 'DEPOIS FALHOU: pipeline_entries.stage_id ainda existe após rollback';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger
              WHERE tgrelid = 'public.pipeline_entries'::regclass
                AND tgname = 'trg_pe_stage_mirror') THEN
    RAISE EXCEPTION 'DEPOIS FALHOU: trg_pe_stage_mirror ainda existe após rollback';
  END IF;
  IF (SELECT relkind FROM pg_class
       WHERE oid = to_regclass('public.custom_pipeline_stages')) IS DISTINCT FROM 'r' THEN
    RAISE EXCEPTION 'DEPOIS FALHOU: custom_pipeline_stages não voltou a ser tabela';
  END IF;

  -- Dados: mesmo conjunto de entries; stage_key diverge SÓ nos reparos uuid.
  SELECT count(*) INTO v_ent FROM public.pipeline_entries;
  IF v_ent <> c.total THEN
    RAISE EXCEPTION 'DEPOIS FALHOU: % entries vs % do snapshot', v_ent, c.total;
  END IF;

  SELECT count(*) INTO v_diff
  FROM _e617_pre p
  JOIN public.pipeline_entries pe ON pe.id = p.id
  WHERE pe.stage_key IS DISTINCT FROM p.stage_key;
  IF v_diff <> c.recuperaveis_uuid THEN
    RAISE EXCEPTION 'DEPOIS FALHOU: % stage_keys divergem do snapshot (esperado exatamente os % reparos uuid — perda documentada D-c)',
      v_diff, c.recuperaveis_uuid;
  END IF;

  -- Sucesso: aborta DE PROPÓSITO com as métricas do ensaio na mensagem.
  RAISE EXCEPTION
    'ENSAIO_OK SCRUM-617 — 20270906001000 + 20270906002000 e rollbacks provados contra prod: % entries · % resolvidos por key · % reparados por uuid-key · % órfãs (stage_key preservado, stage_id NULL) · espelho bidirecional OK (sonda direta + INSTEAD OF pipe_whatsapp + sync custom_pipe_entries) · nada foi aplicado (transação abortada)',
    c.total, c.resolviveis, c.recuperaveis_uuid, c.orfas;
END $$;

ROLLBACK;
