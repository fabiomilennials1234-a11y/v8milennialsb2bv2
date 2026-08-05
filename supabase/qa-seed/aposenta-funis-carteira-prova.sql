-- Prova semântica da 20270805000010 numa branch SEM DADO.
-- Tudo dentro de BEGIN/ROLLBACK: nada persiste, nem na branch.
BEGIN;

DO $$
DECLARE
  v_org uuid := '00000000-0000-4000-8000-0000000000aa';
  v_wa int; v_conf int; v_prop int; v_cart int;
  v_flag_wa boolean; v_flag_prop boolean;
  v_tgt_wa text; v_tgt_prop text;
  v_flag_controle boolean;
  v_etapas int; v_transicoes int;
BEGIN
  -- `fn_pipeline_stages_guard_money_role` recusa gravar stage_role won/lost sem
  -- admin/master/service_role — e as etapas padrão trazem `vendido`/`perdido`,
  -- cujo papel um trigger deriva. É como o provisionamento roda em produção.
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  INSERT INTO public.organizations (id, name, slug) VALUES (v_org, 'Prova T5', 'prova-t5-carteira');

  -- ══ PROVA 1: a torneira do banco não semeia mais Carteira ═════════════
  PERFORM public.create_default_pipeline_stages(v_org);

  SELECT count(*) FILTER (WHERE pipeline_type='whatsapp'),
         count(*) FILTER (WHERE pipeline_type='confirmacao'),
         count(*) FILTER (WHERE pipeline_type='propostas'),
         count(*) FILTER (WHERE pipeline_type IN ('upsell_base','upsell_gestao'))
    INTO v_wa, v_conf, v_prop, v_cart
    FROM public.pipeline_stages WHERE organization_id = v_org;

  IF v_cart <> 0 THEN
    RAISE EXCEPTION 'P1 FALHOU: a função ainda semeou % etapa(s) de carteira', v_cart;
  END IF;
  IF (v_wa, v_conf, v_prop) IS DISTINCT FROM (5, 9, 7) THEN
    RAISE EXCEPTION 'P1 FALHOU: os outros funis mudaram — whatsapp=%, confirmacao=%, propostas=% (esperado 5/9/7)',
      v_wa, v_conf, v_prop;
  END IF;
  RAISE NOTICE 'P1 OK: 0 etapas de carteira; whatsapp/confirmacao/propostas intactos em 5/9/7.';

  -- ══ PROVA 2: o CASE do passo 1 ════════════════════════════════════════
  -- Reproduz as 4 linhas reais de prod + 2 controles que NÃO podem ser tocados.
  INSERT INTO public.pipeline_stages
    (organization_id, pipeline_type, stage_key, name, position, is_active, is_final_positive, target_pipe_type, target_stage_key)
  VALUES
    (v_org, 'whatsapp',  'p_wa_carteira',   'Vendas',      90, true, true, 'upsell_base', '0-3m'),
    (v_org, 'propostas', 'p_prop_carteira', 'Vendido ✓',   91, true, true, 'upsell_base', '0-3m'),
    -- controle A: ganho de whatsapp apontando para confirmacao — NÃO é carteira
    (v_org, 'whatsapp',  'p_wa_controle',   'Agendado ✓',  92, true, true, 'confirmacao', 'reuniao_marcada');

  -- O statement do passo 1, literal.
  UPDATE public.pipeline_stages
     SET target_pipe_type  = NULL,
         target_stage_key  = NULL,
         is_final_positive = CASE
                               WHEN pipeline_type = 'whatsapp' THEN false
                               ELSE is_final_positive
                             END
   WHERE target_pipe_type LIKE 'upsell%';

  SELECT is_final_positive, target_pipe_type INTO v_flag_wa, v_tgt_wa
    FROM public.pipeline_stages WHERE organization_id=v_org AND stage_key='p_wa_carteira';
  SELECT is_final_positive, target_pipe_type INTO v_flag_prop, v_tgt_prop
    FROM public.pipeline_stages WHERE organization_id=v_org AND stage_key='p_prop_carteira';
  SELECT is_final_positive INTO v_flag_controle
    FROM public.pipeline_stages WHERE organization_id=v_org AND stage_key='p_wa_controle';

  IF v_tgt_wa IS NOT NULL OR v_tgt_prop IS NOT NULL THEN
    RAISE EXCEPTION 'P2 FALHOU: ponteiro de carteira sobreviveu (wa=%, prop=%)', v_tgt_wa, v_tgt_prop;
  END IF;
  IF v_flag_wa IS NOT false THEN
    RAISE EXCEPTION 'P2 FALHOU: etapa de whatsapp devia perder is_final_positive, veio %', v_flag_wa;
  END IF;
  IF v_flag_prop IS NOT true THEN
    RAISE EXCEPTION 'P2 FALHOU: etapa de propostas devia MANTER is_final_positive, veio %', v_flag_prop;
  END IF;
  IF v_flag_controle IS NOT true
     OR (SELECT target_pipe_type FROM public.pipeline_stages
          WHERE organization_id=v_org AND stage_key='p_wa_controle') <> 'confirmacao' THEN
    RAISE EXCEPTION 'P2 FALHOU: o UPDATE encostou numa etapa que não é de carteira';
  END IF;
  RAISE NOTICE 'P2 OK: ponteiros limpos; flag cai só em whatsapp; controle confirmacao intocado.';

  -- ══ PROVA 3: o passo 2 desativa, e o filtro `AND is_active` é idempotente ══
  INSERT INTO public.pipeline_stages
    (organization_id, pipeline_type, stage_key, name, position, is_active)
  VALUES
    (v_org, 'upsell_base',   '0-3m',      '0-3 meses',      0, true),
    (v_org, 'upsell_gestao', 'campeoes',  'Campeões',       0, true);

  UPDATE public.pipeline_stages SET is_active = false
   WHERE pipeline_type IN ('upsell_base','upsell_gestao') AND is_active;
  GET DIAGNOSTICS v_etapas = ROW_COUNT;
  IF v_etapas <> 2 THEN RAISE EXCEPTION 'P3 FALHOU: desativou % etapas, esperado 2', v_etapas; END IF;

  UPDATE public.pipeline_stages SET is_active = false
   WHERE pipeline_type IN ('upsell_base','upsell_gestao') AND is_active;
  GET DIAGNOSTICS v_etapas = ROW_COUNT;
  IF v_etapas <> 0 THEN RAISE EXCEPTION 'P3 FALHOU: reaplicar tocou % linhas — não é inerte', v_etapas; END IF;
  RAISE NOTICE 'P3 OK: desativa 2 na primeira passada, 0 na segunda (reaplicação inerte).';

  -- ══ PROVA 4: as asserções do bloco de prova seguem verdadeiras ════════
  SELECT count(*) INTO v_etapas FROM public.pipeline_stages
   WHERE pipeline_type IN ('upsell_base','upsell_gestao') AND is_active;
  SELECT count(*) INTO v_transicoes FROM public.pipeline_stages
   WHERE target_pipe_type LIKE 'upsell%';
  IF v_etapas <> 0 OR v_transicoes <> 0 THEN
    RAISE EXCEPTION 'P4 FALHOU: etapas ativas=%, transicoes=%', v_etapas, v_transicoes;
  END IF;
  RAISE NOTICE 'P4 OK: pós-estado limpo com dado presente, não por ausência de linhas.';

  -- ══ PROVA 5: a carteira em si não foi tocada ══════════════════════════
  IF to_regclass('public.upsell_clients') IS NULL OR to_regclass('public.upsell_orders') IS NULL THEN
    RAISE EXCEPTION 'P5 FALHOU: tabela de carteira sumiu';
  END IF;
  RAISE NOTICE 'P5 OK: upsell_clients e upsell_orders de pé.';

  RAISE NOTICE '════ P1..P5 PASSARAM ════';
END $$;

-- ══ PROVA 6: a guarda de exclusão do passo 2 REALMENTE dispara ═══════════
-- Uma guarda que nunca foi vista disparando não é guarda, é comentário.
-- Aqui existe regra de kanban de carteira; o bloco tem de abortar.
DO $$
DECLARE
  v_org   uuid := '00000000-0000-4000-8000-0000000000bb';
  v_agent uuid := '00000000-0000-4000-8000-0000000000cc';
  v_user  uuid := '00000000-0000-4000-8000-0000000000dd';
  v_regras int; v_move int;
  v_disparou boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  INSERT INTO public.organizations (id, name, slug) VALUES (v_org, 'Prova T5 b', 'prova-t5-carteira-b');
  -- `enforce_copilot_agent_limit` recusa com "Uso: 0/0" sem quota. `effective_limit`
  -- é GENERATED, então quem se mexe é `admin_adjustment`.
  INSERT INTO public.org_quotas (organization_id, resource_key, admin_adjustment)
  VALUES (v_org, 'max_copilot_agents', 1)
  ON CONFLICT (organization_id, resource_key) DO UPDATE SET admin_adjustment = 1;

  -- `copilot_agents.created_by` tem FK para auth.users.
  INSERT INTO auth.users (id, instance_id, aud, role, email)
  VALUES (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'prova-t5@torque.local');

  INSERT INTO public.copilot_agents (id, organization_id, created_by, name, main_objective)
  VALUES (v_agent, v_org, v_user, 'Agente Prova', 'provar a guarda');
  INSERT INTO public.copilot_agent_kanban_rules (agent_id, pipe_type, stage_name, goal, behavior)
  VALUES (v_agent, 'upsell_gestao', 'campeoes', 'objetivo', 'comportamento');

  -- o bloco de guarda, literal
  BEGIN
    SELECT count(*) INTO v_regras FROM public.copilot_agent_kanban_rules
     WHERE pipe_type IN ('upsell_base','upsell_gestao');
    SELECT count(*) INTO v_move FROM public.copilot_agents
     WHERE move_rules::text LIKE '%upsell_base%' OR move_rules::text LIKE '%upsell_gestao%';
    IF v_regras <> 0 OR v_move <> 0 THEN
      RAISE EXCEPTION 'ABORTADO: desativar apagaria % regra(s) de kanban de carteira e reescreveria move_rules de % agente(s). Decida o destino dessa configuração antes de aposentar.', v_regras, v_move;
    END IF;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'ABORTADO:%' THEN
      v_disparou := true;
      RAISE NOTICE 'P6 OK: guarda disparou como esperado → %', SQLERRM;
    ELSE
      RAISE;
    END IF;
  END;

  IF NOT v_disparou THEN
    RAISE EXCEPTION 'P6 FALHOU: havia regra de kanban de carteira e a guarda NÃO abortou';
  END IF;
END $$;

ROLLBACK;
