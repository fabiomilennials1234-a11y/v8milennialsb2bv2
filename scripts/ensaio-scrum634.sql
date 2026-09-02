-- ============================================================================
-- ENSAIO ABORTÁVEL — SCRUM-634 saved_views por pipeline_id (2026-09-02).
-- prod tem 0 linhas em saved_views (medido): o ensaio SEMEIA linhas sintéticas
-- dentro da transação, roda a migration, assere, roda o rollback, assere, e
-- desfaz TUDO no ROLLBACK final. Nada persiste.
-- ============================================================================
BEGIN;

-- Seed sintético: 2 views migráveis (org Milennials, tem os funis de sistema),
-- 1 órfã (AUTOTEK, sem funil de sistema), 1 "leads" (não pode ser tocada).
INSERT INTO public.saved_views (organization_id, owner_id, name, entity_type)
SELECT v.org, (SELECT id FROM auth.users LIMIT 1), v.nome, v.et
FROM (VALUES
  ('6030520a-2ca7-477d-be89-55758e2cd808'::uuid, 'ensaio-634-wa',    'pipe_whatsapp'),
  ('6030520a-2ca7-477d-be89-55758e2cd808'::uuid, 'ensaio-634-prop',  'pipe_propostas'),
  ('c0e31702-25a6-482f-af94-0cee0628e921'::uuid, 'ensaio-634-orfa',  'pipe_confirmacao'),
  ('6030520a-2ca7-477d-be89-55758e2cd808'::uuid, 'ensaio-634-leads', 'leads')
) AS v(org, nome, et);

-- ── MIGRATION (cópia literal de 20270909001000) ─────────────────────────────
DO $$
DECLARE
  v_origem   integer;
  v_migradas integer;
  v_orfas    integer;
BEGIN
  SELECT count(*) INTO v_origem
    FROM public.saved_views
   WHERE entity_type IN ('pipe_whatsapp', 'pipe_confirmacao', 'pipe_propostas');

  UPDATE public.saved_views sv
     SET entity_type = 'pipeline:' || p.id,
         updated_at  = now()
    FROM public.pipelines p
   WHERE sv.entity_type IN ('pipe_whatsapp', 'pipe_confirmacao', 'pipe_propostas')
     AND p.organization_id = sv.organization_id
     AND p.type = 'system'
     AND p.slug = substring(sv.entity_type FROM 'pipe_(.*)');
  GET DIAGNOSTICS v_migradas = ROW_COUNT;

  SELECT count(*) INTO v_orfas
    FROM public.saved_views
   WHERE entity_type IN ('pipe_whatsapp', 'pipe_confirmacao', 'pipe_propostas');

  IF v_migradas <> v_origem - v_orfas THEN
    RAISE EXCEPTION
      'saved_views: contabilidade não fecha — migradas % <> origem % - órfãs %',
      v_migradas, v_origem, v_orfas;
  END IF;

  IF v_orfas > 0 THEN
    RAISE WARNING
      'saved_views: % view(s) órfã(s) mantida(s) com slug legado (org sem funil de sistema correspondente)',
      v_orfas;
  END IF;

  RAISE NOTICE
    'saved_views → pipeline:{uuid}: origem=% migradas=% órfãs=%',
    v_origem, v_migradas, v_orfas;
END $$;

-- ── ASSERÇÕES pós-migração ──────────────────────────────────────────────────
DO $$
DECLARE v int;
BEGIN
  -- 2 migradas, apontando pro funil de sistema CERTO da org certa
  SELECT count(*) INTO v
    FROM public.saved_views sv
    JOIN public.pipelines p
      ON sv.entity_type = 'pipeline:' || p.id
     AND p.organization_id = sv.organization_id
     AND p.type = 'system'
   WHERE sv.name IN ('ensaio-634-wa', 'ensaio-634-prop')
     AND ((sv.name = 'ensaio-634-wa'   AND p.slug = 'whatsapp')
       OR (sv.name = 'ensaio-634-prop' AND p.slug = 'propostas'));
  IF v <> 2 THEN RAISE EXCEPTION 'FALHA: migradas com destino certo = % (esperado 2)', v; END IF;

  -- órfã intacta com slug legado
  SELECT count(*) INTO v FROM public.saved_views
   WHERE name = 'ensaio-634-orfa' AND entity_type = 'pipe_confirmacao';
  IF v <> 1 THEN RAISE EXCEPTION 'FALHA: órfã AUTOTEK não ficou como estava'; END IF;

  -- "leads" intacta
  SELECT count(*) INTO v FROM public.saved_views
   WHERE name = 'ensaio-634-leads' AND entity_type = 'leads';
  IF v <> 1 THEN RAISE EXCEPTION 'FALHA: view leads foi tocada'; END IF;

  RAISE NOTICE 'ASSERT pós-migração OK';
END $$;

-- ── Idempotência: rodar de novo não muda nada e a asserção fecha ────────────
DO $$
DECLARE
  v_origem integer; v_migradas integer; v_orfas integer;
BEGIN
  SELECT count(*) INTO v_origem FROM public.saved_views
   WHERE entity_type IN ('pipe_whatsapp', 'pipe_confirmacao', 'pipe_propostas');
  UPDATE public.saved_views sv
     SET entity_type = 'pipeline:' || p.id, updated_at = now()
    FROM public.pipelines p
   WHERE sv.entity_type IN ('pipe_whatsapp', 'pipe_confirmacao', 'pipe_propostas')
     AND p.organization_id = sv.organization_id AND p.type = 'system'
     AND p.slug = substring(sv.entity_type FROM 'pipe_(.*)');
  GET DIAGNOSTICS v_migradas = ROW_COUNT;
  SELECT count(*) INTO v_orfas FROM public.saved_views
   WHERE entity_type IN ('pipe_whatsapp', 'pipe_confirmacao', 'pipe_propostas');
  IF v_migradas <> 0 OR v_migradas <> v_origem - v_orfas THEN
    RAISE EXCEPTION 'FALHA idempotência: migradas=% origem=% órfãs=%', v_migradas, v_origem, v_orfas;
  END IF;
  RAISE NOTICE 'ASSERT idempotência OK (2ª execução migrou 0)';
END $$;

-- ── ROLLBACK PAREADO (cópia literal de rollback/20270909001000) ─────────────
DO $$
DECLARE
  v_revertidas integer;
BEGIN
  UPDATE public.saved_views sv
     SET entity_type = 'pipe_' || p.slug,
         updated_at  = now()
    FROM public.pipelines p
   WHERE sv.entity_type = 'pipeline:' || p.id
     AND p.type = 'system'
     AND p.slug IN ('whatsapp', 'confirmacao', 'propostas');
  GET DIAGNOSTICS v_revertidas = ROW_COUNT;

  RAISE NOTICE 'saved_views rollback: % view(s) revertida(s) pra slug legado', v_revertidas;
END $$;

-- ── ASSERÇÕES pós-reverso: estado inicial restaurado ────────────────────────
DO $$
DECLARE v int;
BEGIN
  SELECT count(*) INTO v FROM public.saved_views
   WHERE (name = 'ensaio-634-wa'    AND entity_type = 'pipe_whatsapp')
      OR (name = 'ensaio-634-prop'  AND entity_type = 'pipe_propostas')
      OR (name = 'ensaio-634-orfa'  AND entity_type = 'pipe_confirmacao')
      OR (name = 'ensaio-634-leads' AND entity_type = 'leads');
  IF v <> 4 THEN RAISE EXCEPTION 'FALHA reverso: % de 4 linhas no estado original', v; END IF;
  SELECT count(*) INTO v FROM public.saved_views WHERE entity_type LIKE 'pipeline:%';
  IF v <> 0 THEN RAISE EXCEPTION 'FALHA reverso: sobrou % linha(s) pipeline:%%', v; END IF;
  RAISE NOTICE 'ASSERT reverso OK — ENSAIO_OK';
END $$;

ROLLBACK;
