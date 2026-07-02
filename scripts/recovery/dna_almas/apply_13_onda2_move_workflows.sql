-- apply_13_onda2_move_workflows.sql
-- Onda 2 — 5 workflows Padrão A (tag_added -> move_stage). Mecânica de placement no kanban.
-- is_active=true: só MOVEM stage (sem send) → seguros sem whatsapp_instance.
-- Drips que existem por stage_changed cascateiam (cartao_recusado->E, pago->F).
-- Idempotente por nome. Template = 'DNA · Pago' (provado).

-- helper: definição de um workflow tag->move (substitui __TAG__ e __STAGE__)
-- Recusado
INSERT INTO public.workflows (organization_id,name,is_active,trigger_type,trigger_config,definition)
SELECT 'd67ae17a-815d-476d-b3a9-287c7b267997','DNA · Recusado (tag→stage)',true,'tag_added',
 '{"tag_name":"checkout_recusado"}'::jsonb,
 '{"edges":[{"id":"e1","type":"animated","source":"trigger-1","target":"action-2","animated":true}],
   "nodes":[
     {"id":"trigger-1","type":"trigger","position":{"x":400,"y":50},"measured":{"width":280,"height":62},
      "data":{"type":"trigger","label":"Tag adicionada","triggerType":"tag_added","config":{"tag_name":"checkout_recusado"}}},
     {"id":"action-2","type":"action","position":{"x":400,"y":180},"measured":{"width":280,"height":62},
      "data":{"type":"action","label":"Mover p/ Cartão recusado","actionType":"move_stage","targetStage":"cartao_recusado","pipeType":"whatsapp"}}
   ]}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.workflows WHERE organization_id='d67ae17a-815d-476d-b3a9-287c7b267997' AND name='DNA · Recusado (tag→stage)');

-- Upgrade (tag DISTINTA de 'Cliente' p/ não duplo-disparar Pago)
INSERT INTO public.workflows (organization_id,name,is_active,trigger_type,trigger_config,definition)
SELECT 'd67ae17a-815d-476d-b3a9-287c7b267997','DNA · Upgrade (tag→stage)',true,'tag_added',
 '{"tag_name":"checkout_upgrade"}'::jsonb,
 '{"edges":[{"id":"e1","type":"animated","source":"trigger-1","target":"action-2","animated":true}],
   "nodes":[
     {"id":"trigger-1","type":"trigger","position":{"x":400,"y":50},"measured":{"width":280,"height":62},
      "data":{"type":"trigger","label":"Tag adicionada","triggerType":"tag_added","config":{"tag_name":"checkout_upgrade"}}},
     {"id":"action-2","type":"action","position":{"x":400,"y":180},"measured":{"width":280,"height":62},
      "data":{"type":"action","label":"Mover p/ Pago","actionType":"move_stage","targetStage":"pago","pipeType":"whatsapp"}}
   ]}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.workflows WHERE organization_id='d67ae17a-815d-476d-b3a9-287c7b267997' AND name='DNA · Upgrade (tag→stage)');

-- Downgrade
INSERT INTO public.workflows (organization_id,name,is_active,trigger_type,trigger_config,definition)
SELECT 'd67ae17a-815d-476d-b3a9-287c7b267997','DNA · Downgrade (tag→stage)',true,'tag_added',
 '{"tag_name":"downgrade"}'::jsonb,
 '{"edges":[{"id":"e1","type":"animated","source":"trigger-1","target":"action-2","animated":true}],
   "nodes":[
     {"id":"trigger-1","type":"trigger","position":{"x":400,"y":50},"measured":{"width":280,"height":62},
      "data":{"type":"trigger","label":"Tag adicionada","triggerType":"tag_added","config":{"tag_name":"downgrade"}}},
     {"id":"action-2","type":"action","position":{"x":400,"y":180},"measured":{"width":280,"height":62},
      "data":{"type":"action","label":"Mover p/ Cancelado","actionType":"move_stage","targetStage":"cancelado","pipeType":"whatsapp"}}
   ]}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.workflows WHERE organization_id='d67ae17a-815d-476d-b3a9-287c7b267997' AND name='DNA · Downgrade (tag→stage)');

-- Cancelado (move; winback drip = passada de copy CTO)
INSERT INTO public.workflows (organization_id,name,is_active,trigger_type,trigger_config,definition)
SELECT 'd67ae17a-815d-476d-b3a9-287c7b267997','DNA · Cancelado (tag→stage)',true,'tag_added',
 '{"tag_name":"cancelado"}'::jsonb,
 '{"edges":[{"id":"e1","type":"animated","source":"trigger-1","target":"action-2","animated":true}],
   "nodes":[
     {"id":"trigger-1","type":"trigger","position":{"x":400,"y":50},"measured":{"width":280,"height":62},
      "data":{"type":"trigger","label":"Tag adicionada","triggerType":"tag_added","config":{"tag_name":"cancelado"}}},
     {"id":"action-2","type":"action","position":{"x":400,"y":180},"measured":{"width":280,"height":62},
      "data":{"type":"action","label":"Mover p/ Cancelado","actionType":"move_stage","targetStage":"cancelado","pipeType":"whatsapp"}}
   ]}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.workflows WHERE organization_id='d67ae17a-815d-476d-b3a9-287c7b267997' AND name='DNA · Cancelado (tag→stage)');

-- Inadimplente (move; cobrança drip = passada de copy CTO)
INSERT INTO public.workflows (organization_id,name,is_active,trigger_type,trigger_config,definition)
SELECT 'd67ae17a-815d-476d-b3a9-287c7b267997','DNA · Inadimplente (tag→stage)',true,'tag_added',
 '{"tag_name":"inadimplente"}'::jsonb,
 '{"edges":[{"id":"e1","type":"animated","source":"trigger-1","target":"action-2","animated":true}],
   "nodes":[
     {"id":"trigger-1","type":"trigger","position":{"x":400,"y":50},"measured":{"width":280,"height":62},
      "data":{"type":"trigger","label":"Tag adicionada","triggerType":"tag_added","config":{"tag_name":"inadimplente"}}},
     {"id":"action-2","type":"action","position":{"x":400,"y":180},"measured":{"width":280,"height":62},
      "data":{"type":"action","label":"Mover p/ Inadimplente","actionType":"move_stage","targetStage":"inadimplente","pipeType":"whatsapp"}}
   ]}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.workflows WHERE organization_id='d67ae17a-815d-476d-b3a9-287c7b267997' AND name='DNA · Inadimplente (tag→stage)');

SELECT name, trigger_config->>'tag_name' AS tag,
  (definition->'nodes'->1->'data'->>'targetStage') AS stage, is_active
FROM public.workflows
WHERE organization_id='d67ae17a-815d-476d-b3a9-287c7b267997' AND name LIKE 'DNA · %(tag→stage)%'
ORDER BY name;
