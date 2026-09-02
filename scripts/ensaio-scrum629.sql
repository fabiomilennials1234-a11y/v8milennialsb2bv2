-- ═══════════════════════════════════════════════════════════════════════════
-- ENSAIO SCRUM-629 — ANTES: abre a transação, grava o retrato pré-migration e
-- EXERCITA o dispatch de sistema com o trigger ANTIGO (metade "antes" da
-- sonda de paridade — system tem de disparar igual depois).
--
-- Payload montado por scripts/ensaio-scrum629.sh:
--   ensaio-scrum629.sql (BEGIN + controle + exercício pré)
--     → supabase/migrations/20270908008000_disparo_por_etapa_em_funil_custom.sql
--       (ARQUIVO DE VERDADE)
--     → scripts/ensaio-scrum629-depois.sql (4 sondas D11 + paridade +
--       RAISE 'ENSAIO_OK' que ABORTA) → ROLLBACK
--
-- NADA é aplicado. Autorização vigente do CTO para ensaios que abortam
-- sozinhos. Escritas de trigger (fila, net.http_request_queue, eventos) são
-- todas transacionais — o ROLLBACK desfaz tudo, e o worker do pg_net só lê
-- linha commitada: nenhum HTTP real escapa.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- Contexto do ensaio (sobrevive até o ROLLBACK final; sem savepoints no meio).
CREATE TEMP TABLE _e629 (
  org uuid,
  sys_pipe uuid,
  sys_stage uuid,
  sys_stage_key text,
  sys_rule uuid,
  l1 uuid,          -- lead do exercício system PRÉ-migration
  l2 uuid,          -- lead do exercício system PÓS-migration
  card1 uuid,       -- card system pré
  n1 int            -- enfileirados pelo card1 com o trigger ANTIGO
) ON COMMIT DROP;

-- ─── Controle: a migration ainda não rodou ──────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public'
                AND (table_name, column_name) IN (('pipelines','stage_dispatch_enabled'),
                                                  ('pipe_dispatch_rules','pipeline_id'),
                                                  ('scheduled_pipe_messages','pipeline_id'))) THEN
    RAISE EXCEPTION 'CONTROLE: coluna da 008000 JÁ EXISTE — a migration já rodou? Ensaio não prova nada.';
  END IF;
  IF (SELECT p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'trigger_pipeline_entries_dispatch')
     NOT LIKE '%pip.type = ''system''%' THEN
    RAISE EXCEPTION 'CONTROLE: dispatch de prod sem o early-return de sistema — estado inesperado.';
  END IF;
  RAISE NOTICE 'controle OK: colunas ausentes, early-return de sistema vivo.';
END $$;

-- ─── Seleção determinística: a regra REAL de prod + funil + 2 leads ─────────
-- Usa a regra viva (lead_added, com step) para a paridade — nada sintético do
-- lado de sistema. Leads existentes da org, sem card no funil alvo.
DO $$
DECLARE
  v_org uuid; v_rule uuid; v_pipe uuid; v_stage uuid; v_stage_key text;
  v_l1 uuid; v_l2 uuid;
BEGIN
  SELECT r.organization_id, r.id INTO v_org, v_rule
    FROM public.pipe_dispatch_rules r
   WHERE r.is_active AND r.trigger_type = 'lead_added'
     AND EXISTS (SELECT 1 FROM public.pipe_dispatch_rule_steps s WHERE s.rule_id = r.id)
   ORDER BY r.created_at
   LIMIT 1;
  IF v_rule IS NULL THEN
    RAISE EXCEPTION 'CONTROLE: nenhuma regra lead_added ativa com steps em prod — sonda de paridade sem matéria.';
  END IF;

  SELECT p.id INTO v_pipe
    FROM public.pipelines p
   WHERE p.organization_id = v_org AND p.slug = (
           SELECT pipe_type FROM public.pipe_dispatch_rules WHERE id = v_rule)
     AND p.type = 'system';
  IF v_pipe IS NULL THEN
    RAISE EXCEPTION 'CONTROLE: regra % sem funil de sistema correspondente.', v_rule;
  END IF;

  SELECT ps.id, ps.stage_key INTO v_stage, v_stage_key
    FROM public.pipeline_stages ps
   WHERE ps.pipeline_id = v_pipe AND ps.is_active = true
   ORDER BY ps.position
   LIMIT 1;
  IF v_stage IS NULL THEN
    RAISE EXCEPTION 'CONTROLE: funil de sistema % sem etapa ativa.', v_pipe;
  END IF;

  SELECT l.id INTO v_l1
    FROM public.leads l
   WHERE l.organization_id = v_org AND l.deleted_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.pipeline_entries pe
                      WHERE pe.lead_id = l.id AND pe.pipeline_id = v_pipe)
   ORDER BY l.created_at DESC
   LIMIT 1;
  SELECT l.id INTO v_l2
    FROM public.leads l
   WHERE l.organization_id = v_org AND l.deleted_at IS NULL AND l.id <> v_l1
     AND NOT EXISTS (SELECT 1 FROM public.pipeline_entries pe
                      WHERE pe.lead_id = l.id AND pe.pipeline_id = v_pipe)
   ORDER BY l.created_at DESC
   LIMIT 1;
  IF v_l1 IS NULL OR v_l2 IS NULL THEN
    RAISE EXCEPTION 'CONTROLE: org % sem 2 leads livres do funil % para a sonda.', v_org, v_pipe;
  END IF;

  INSERT INTO _e629 (org, sys_pipe, sys_stage, sys_stage_key, sys_rule, l1, l2)
  VALUES (v_org, v_pipe, v_stage, v_stage_key, v_rule, v_l1, v_l2);

  RAISE NOTICE 'seleção OK: org=% funil=% regra=% leads=%/%', v_org, v_pipe, v_rule, v_l1, v_l2;
END $$;

-- ─── Paridade, metade ANTES: card entra no funil de sistema com o trigger
--     ANTIGO e a regra real enfileira ───────────────────────────────────────
DO $$
DECLARE c _e629%ROWTYPE; v_card uuid; v_n int;
BEGIN
  SELECT * INTO c FROM _e629;

  INSERT INTO public.pipeline_entries
    (organization_id, pipeline_id, lead_id, stage_id, stage_key, entered_at, stage_changed_at)
  VALUES (c.org, c.sys_pipe, c.l1, c.sys_stage, c.sys_stage_key, now(), now())
  RETURNING id INTO v_card;

  SELECT count(*) INTO v_n FROM public.scheduled_pipe_messages WHERE pipe_record_id = v_card;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'CONTROLE: trigger antigo não enfileirou nada para a regra real — sonda de paridade sem dente.';
  END IF;

  UPDATE _e629 SET card1 = v_card, n1 = v_n;
  RAISE NOTICE 'paridade/antes OK: card % enfileirou % item(ns) com o trigger antigo.', v_card, v_n;
END $$;
