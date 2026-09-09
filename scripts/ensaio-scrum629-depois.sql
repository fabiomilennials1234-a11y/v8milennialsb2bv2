-- ═══════════════════════════════════════════════════════════════════════════
-- ENSAIO SCRUM-629 — DEPOIS: as 4 sondas do D11 + paridade de sistema +
-- ENSAIO_OK que ABORTA.
--
-- Sondas (contrato do ticket):
--   S1  mover card custom com toggle OFF  → 0 enfileirado
--   S2  ligar toggle → mover card         → 1 enfileirado (com pipeline_id)
--   S3  card parado de antes da ativação  → 0; e item forjado com
--       created_at < enabled_at NÃO é clamado (corte temporal no choke)
--   S4  system continua disparando IGUAL  → contagem antes (trigger antigo,
--       no arquivo "antes") = contagem depois (trigger novo)
--   S5  bônus: desligar o toggle cancela a fila pendente do funil
--
-- Nota de relógio: now() é congelado na transação — enabled_at, created_at e
-- scheduled_at do ensaio coincidem. O gate usa >=, então item legítimo passa;
-- o item retroativo é forjado com created_at = now() - 1h para morder o corte.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Setup custom: funil + etapas + template + regra (eco à prova) ──────────
CREATE TEMP TABLE _e629c (
  pipe uuid, stage_a uuid, stage_b uuid, tpl uuid, rule uuid,
  card1 uuid, card2 uuid, forged uuid
) ON COMMIT DROP;

DO $$
DECLARE
  c _e629%ROWTYPE;
  v_pipe uuid; v_a uuid; v_b uuid; v_tpl uuid; v_rule uuid;
  v_eco text; v_enabled boolean; v_enabled_at timestamptz;
BEGIN
  SELECT * INTO c FROM _e629;

  INSERT INTO public.pipelines (organization_id, name, slug, type, is_active)
  VALUES (c.org, 'Ensaio 629', 'e629-ensaio', 'custom', true)
  RETURNING id INTO v_pipe;

  -- Freio 1: nasce DESLIGADO — direto do default, sem escrever a coluna.
  SELECT stage_dispatch_enabled, stage_dispatch_enabled_at
    INTO v_enabled, v_enabled_at
    FROM public.pipelines WHERE id = v_pipe;
  IF v_enabled OR v_enabled_at IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL S1: funil custom nasceu LIGADO (enabled=% at=%) — D11 exige OFF.', v_enabled, v_enabled_at;
  END IF;

  INSERT INTO public.pipeline_stages (organization_id, pipeline_id, stage_key, name, position, is_active)
  VALUES (c.org, v_pipe, 'e629_a', 'Etapa A', 0, true) RETURNING id INTO v_a;
  INSERT INTO public.pipeline_stages (organization_id, pipeline_id, stage_key, name, position, is_active)
  VALUES (c.org, v_pipe, 'e629_b', 'Etapa B', 1, true) RETURNING id INTO v_b;

  INSERT INTO public.campaign_templates (organization_id, name, content)
  VALUES (c.org, 'Ensaio 629', 'Olá {nome} — ensaio, nunca enviado.')
  RETURNING id INTO v_tpl;

  -- Regra por id com pipe_type ERRADO de propósito: o choke tem de ecoar o slug.
  INSERT INTO public.pipe_dispatch_rules
    (organization_id, pipe_type, pipeline_id, trigger_type, pipeline_stage_id, is_active)
  VALUES (c.org, 'slug-errado', v_pipe, 'lead_moved_to_stage', v_b, true)
  RETURNING id INTO v_rule;

  SELECT pipe_type INTO v_eco FROM public.pipe_dispatch_rules WHERE id = v_rule;
  IF v_eco <> 'e629-ensaio' THEN
    RAISE EXCEPTION 'FAIL eco: regra guardou pipe_type=%, esperado slug e629-ensaio.', v_eco;
  END IF;

  INSERT INTO public.pipe_dispatch_rule_steps (rule_id, action_type, template_id, delay_minutes, position)
  VALUES (v_rule, 'send_template', v_tpl, 0, 0);

  INSERT INTO _e629c (pipe, stage_a, stage_b, tpl, rule) VALUES (v_pipe, v_a, v_b, v_tpl, v_rule);
  RAISE NOTICE 'setup custom OK: funil=% (OFF de nascença, eco corrigido).', v_pipe;
END $$;

-- ─── S1: toggle OFF → mover card não enfileira nada ─────────────────────────
DO $$
DECLARE
  c _e629%ROWTYPE; cc _e629c%ROWTYPE; v_card1 uuid; v_card2 uuid; v_n int;
BEGIN
  SELECT * INTO c FROM _e629;
  SELECT * INTO cc FROM _e629c;

  -- card1 entra na etapa A; card2 entra DIRETO na etapa B (o "parado de antes")
  INSERT INTO public.pipeline_entries
    (organization_id, pipeline_id, lead_id, stage_id, stage_key, entered_at, stage_changed_at)
  VALUES (c.org, cc.pipe, c.l1, cc.stage_a, 'e629_a', now(), now())
  RETURNING id INTO v_card1;
  INSERT INTO public.pipeline_entries
    (organization_id, pipeline_id, lead_id, stage_id, stage_key, entered_at, stage_changed_at)
  VALUES (c.org, cc.pipe, c.l2, cc.stage_b, 'e629_b', now(), now())
  RETURNING id INTO v_card2;

  -- movimento com toggle OFF: A → B (a etapa da regra)
  UPDATE public.pipeline_entries
     SET stage_id = cc.stage_b, stage_key = 'e629_b'
   WHERE id = v_card1;

  SELECT count(*) INTO v_n FROM public.scheduled_pipe_messages
   WHERE pipe_record_id IN (v_card1, v_card2);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'FAIL S1: % item(ns) enfileirados com toggle OFF — freio 1 furou.', v_n;
  END IF;

  UPDATE _e629c SET card1 = v_card1, card2 = v_card2;
  RAISE NOTICE 'S1 OK: mover card custom com toggle OFF enfileirou 0.';
END $$;

-- ─── S2: liga o toggle (carimbo do servidor) → mover card enfileira 1 ───────
DO $$
DECLARE
  cc _e629c%ROWTYPE; v_at timestamptz; v_n int; v_pid uuid;
BEGIN
  SELECT * INTO cc FROM _e629c;

  UPDATE public.pipelines SET stage_dispatch_enabled = true WHERE id = cc.pipe;
  SELECT stage_dispatch_enabled_at INTO v_at FROM public.pipelines WHERE id = cc.pipe;
  IF v_at IS NULL THEN
    RAISE EXCEPTION 'FAIL S2: flip ON não carimbou stage_dispatch_enabled_at.';
  END IF;

  -- card1 sai e volta para a etapa B — movimento POSTERIOR à ativação.
  UPDATE public.pipeline_entries SET stage_id = cc.stage_a, stage_key = 'e629_a' WHERE id = cc.card1;
  UPDATE public.pipeline_entries SET stage_id = cc.stage_b, stage_key = 'e629_b' WHERE id = cc.card1;

  SELECT count(*) INTO v_n FROM public.scheduled_pipe_messages WHERE pipe_record_id = cc.card1;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'FAIL S2: esperado 1 item enfileirado após ligar, veio %.', v_n;
  END IF;

  SELECT pipeline_id INTO v_pid FROM public.scheduled_pipe_messages WHERE pipe_record_id = cc.card1;
  IF v_pid IS DISTINCT FROM cc.pipe THEN
    RAISE EXCEPTION 'FAIL S2: item da fila sem pipeline_id do funil (veio %).', v_pid;
  END IF;

  RAISE NOTICE 'S2 OK: toggle ON + movimento → 1 enfileirado, chaveado pelo funil.';
END $$;

-- ─── S3: corte temporal — parado de antes fica em 0; retroativo não é clamado ─
DO $$
DECLARE
  c _e629%ROWTYPE; cc _e629c%ROWTYPE; v_n int; v_forged uuid;
  v_claimed uuid[]; v_status text;
BEGIN
  SELECT * INTO c FROM _e629;
  SELECT * INTO cc FROM _e629c;

  -- card2 está parado na etapa B desde ANTES da ativação: nada pode aparecer.
  SELECT count(*) INTO v_n FROM public.scheduled_pipe_messages WHERE pipe_record_id = cc.card2;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'FAIL S3: card parado de antes da ativação ganhou % item(ns) — retroatividade.', v_n;
  END IF;

  -- Item FORJADO como se tivesse sido enfileirado 1h antes da ativação:
  -- o claim (freio 2, camada de leitura) tem de recusar.
  INSERT INTO public.scheduled_pipe_messages
    (organization_id, pipe_type, rule_id, pipe_record_id, lead_id, template_id,
     scheduled_at, status, action_type, step_position, created_at)
  VALUES (c.org, 'e629-ensaio', cc.rule, cc.card2, c.l2, cc.tpl,
          now(), 'scheduled', 'send_template', 0, now() - interval '1 hour')
  RETURNING id INTO v_forged;

  SELECT array_agg(claimed_id) INTO v_claimed
    FROM public.claim_pipe_dispatch_batch_by_pipeline(cc.pipe, 50);

  IF v_forged = ANY(COALESCE(v_claimed, '{}')) THEN
    RAISE EXCEPTION 'FAIL S3: claim entregou item criado ANTES da ativação — corte temporal furou.';
  END IF;
  IF NOT (SELECT id FROM public.scheduled_pipe_messages WHERE pipe_record_id = cc.card1) = ANY(COALESCE(v_claimed, '{}')) THEN
    RAISE EXCEPTION 'FAIL S3: claim NÃO entregou o item legítimo (pós-ativação) — gate apertado demais.';
  END IF;

  -- O legado (claim por pipe_type) respeita o mesmo corte.
  SELECT count(*) INTO v_n FROM public.claim_pipe_dispatch_batch('e629-ensaio', 50);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'FAIL S3: claim legado entregou % item(ns) retroativos.', v_n;
  END IF;
  SELECT status INTO v_status FROM public.scheduled_pipe_messages WHERE id = v_forged;
  IF v_status <> 'scheduled' THEN
    RAISE EXCEPTION 'FAIL S3: item forjado mudou para % sem ser clamado.', v_status;
  END IF;

  UPDATE _e629c SET forged = v_forged;
  RAISE NOTICE 'S3 OK: parado de antes = 0; retroativo barrado nos dois claims; legítimo passou.';
END $$;

-- ─── S5 (bônus): desligar cancela a fila pendente do funil ──────────────────
DO $$
DECLARE cc _e629c%ROWTYPE; v_status text; v_claimed_status text;
BEGIN
  SELECT * INTO cc FROM _e629c;

  UPDATE public.pipelines SET stage_dispatch_enabled = false WHERE id = cc.pipe;

  SELECT status INTO v_status FROM public.scheduled_pipe_messages WHERE id = cc.forged;
  IF v_status <> 'cancelled' THEN
    RAISE EXCEPTION 'FAIL S5: desligar o toggle deixou item scheduled como % — fila viva com funil OFF.', v_status;
  END IF;

  -- O item já clamado (processing) não é tocado — em voo é do worker.
  SELECT status INTO v_claimed_status FROM public.scheduled_pipe_messages WHERE pipe_record_id = cc.card1;
  IF v_claimed_status <> 'processing' THEN
    RAISE EXCEPTION 'FAIL S5: item em voo mudou para % — cancelamento passou do escopo.', v_claimed_status;
  END IF;

  RAISE NOTICE 'S5 OK: OFF cancelou o pendente e não tocou no item em voo.';
END $$;

-- ─── S4: paridade de sistema — o trigger novo enfileira IGUAL ao antigo ─────
DO $$
DECLARE c _e629%ROWTYPE; v_card uuid; v_n2 int; v_pid uuid;
BEGIN
  SELECT * INTO c FROM _e629;

  INSERT INTO public.pipeline_entries
    (organization_id, pipeline_id, lead_id, stage_id, stage_key, entered_at, stage_changed_at)
  VALUES (c.org, c.sys_pipe, c.l2, c.sys_stage, c.sys_stage_key, now(), now())
  RETURNING id INTO v_card;

  SELECT count(*) INTO v_n2 FROM public.scheduled_pipe_messages WHERE pipe_record_id = v_card;
  IF v_n2 <> c.n1 THEN
    RAISE EXCEPTION 'FAIL S4: trigger novo enfileirou % para sistema; o antigo enfileirava % — paridade quebrada.', v_n2, c.n1;
  END IF;

  -- Bônus: o item de sistema também sai chaveado pelo funil (choke resolve).
  SELECT pipeline_id INTO v_pid FROM public.scheduled_pipe_messages
   WHERE pipe_record_id = v_card LIMIT 1;
  IF v_pid IS DISTINCT FROM c.sys_pipe THEN
    RAISE EXCEPTION 'FAIL S4: item de sistema sem pipeline_id do funil (veio %).', v_pid;
  END IF;

  RAISE NOTICE 'S4 OK: sistema enfileira % antes e % depois — igual, agora com pipeline_id.', c.n1, v_n2;
END $$;

-- ─── ENSAIO_OK: aborta com o placar ─────────────────────────────────────────
DO $$
DECLARE v_n1 int;
BEGIN
  SELECT n1 INTO v_n1 FROM _e629;
  RAISE EXCEPTION 'ENSAIO_OK SCRUM-629 — freio triplo D11 provado: OFF de nascença (S1=0), ON dispara movimento novo (S2=1, chaveado por funil), corte temporal barra retroativo nos dois claims (S3), OFF cancela pendência sem tocar item em voo (S5), sistema dispara igual (S4: %=%).', v_n1, v_n1;
END $$;

ROLLBACK;
