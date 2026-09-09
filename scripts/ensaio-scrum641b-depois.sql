-- ═══════════════════════════════════════════════════════════════════════════
-- ENSAIO SCRUM-641b — DEPOIS: sonda end-to-end da reunião em ORG NOVA
-- (org → lead → card no funil padrão em etapa de PAPEL meeting_booked →
-- meeting_events capturado → held por papel) + não-mudança + ENSAIO_OK.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_org uuid;
  v_pipe uuid;
  v_lead uuid;
  v_entry uuid;
  v_booked public.meeting_events%ROWTYPE;
  v_held_count int;
BEGIN
  -- Org nova: o trigger da 000000 semeia o Funil de Vendas como padrão.
  INSERT INTO public.organizations (name, slug)
  VALUES ('__sonda_scrum641b__', 'sonda-scrum641b-' || left(md5(random()::text), 8))
  RETURNING id INTO v_org;

  -- RETURNING não enxerga o UPDATE do trigger AFTER — lê depois.
  SELECT default_pipeline_id INTO v_pipe FROM public.organizations WHERE id = v_org;

  IF v_pipe IS NULL THEN
    RAISE EXCEPTION 'FAIL sonda-b: org nova sem funil padrão.';
  END IF;

  INSERT INTO public.leads (organization_id, name, phone)
  VALUES (v_org, 'Lead Sonda 641b', '+5511999990000')
  RETURNING id INTO v_lead;

  -- Reunião: card entra DIRETO na etapa de papel meeting_booked do funil
  -- padrão (o que webhook-calcom/new-lead/lead-webhook fazem pós-641).
  INSERT INTO public.pipeline_entries
    (organization_id, pipeline_id, lead_id, stage_key, metadata)
  VALUES
    (v_org, v_pipe, v_lead, 'reuniao_marcada',
     jsonb_build_object('meeting_date', (now() + interval '2 days')::text))
  RETURNING id INTO v_entry;

  SELECT * INTO v_booked FROM public.meeting_events
   WHERE organization_id = v_org AND lead_id = v_lead AND event_type = 'meeting_booked';
  IF v_booked.id IS NULL THEN
    RAISE EXCEPTION 'FAIL sonda-b: reunião em etapa meeting_booked NÃO capturou meeting_event (âncora por papel falhou).';
  END IF;
  IF v_booked.source IS DISTINCT FROM 'pipeline:vendas' THEN
    RAISE EXCEPTION 'FAIL sonda-b: source esperado pipeline:vendas, veio %.', v_booked.source;
  END IF;

  -- HELD por papel: dá papel meeting_held a uma etapa do funil (org sintética;
  -- meeting_held não é papel de dinheiro, o guard won/lost não se aplica) e
  -- move o card para ela.
  UPDATE public.pipeline_stages
     SET stage_role = 'meeting_held'
   WHERE pipeline_id = v_pipe AND stage_key = 'proposta_enviada';

  UPDATE public.pipeline_entries
     SET stage_key = 'proposta_enviada'
   WHERE id = v_entry;

  SELECT count(*) INTO v_held_count FROM public.meeting_events
   WHERE organization_id = v_org AND lead_id = v_lead AND event_type = 'meeting_held'
     AND booked_event_id = v_booked.id;
  IF v_held_count <> 1 THEN
    RAISE EXCEPTION 'FAIL sonda-b: esperado 1 meeting_held encadeado ao booked, veio %.', v_held_count;
  END IF;

  RAISE NOTICE 'sonda-b OK: booked por papel (source=%) e held por papel encadeado.', v_booked.source;
END $$;

-- ─── Não-mudança fora da org sintética + ENSAIO_OK (aborta tudo) ────────────
DO $$
DECLARE v _e641b_antes%ROWTYPE; v_outros bigint;
BEGIN
  SELECT * INTO v FROM _e641b_antes;

  -- Nenhum meeting_event nasceu FORA da org sintética.
  SELECT count(*) INTO v_outros FROM public.meeting_events me
   WHERE NOT EXISTS (
     SELECT 1 FROM public.organizations o
      WHERE o.id = me.organization_id AND o.name = '__sonda_scrum641b__'
   );
  IF v_outros <> v.meeting_events THEN
    RAISE EXCEPTION 'FAIL não-mudança: meeting_events fora da sonda % → %.', v.meeting_events, v_outros;
  END IF;

  RAISE EXCEPTION 'ENSAIO_OK SCRUM-641b — org nova agenda por PAPEL: booked e held capturados no funil padrão; % meeting_events pré-existentes intocados.', v.meeting_events;
END $$;

ROLLBACK;
