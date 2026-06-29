-- apply_15_onda3_move_workflows.sql
-- Onda 3 — 3 workflows Padrão A (tag_added -> move_stage) p/ recuperação B/C/D.
-- is_active=FALSE (DORMENTE): só ativar quando a Zuvic emitir checkout.initiated/pix.generated/
-- boleto.generated (DEP-4) E mandar as tags. Stages destino + drips B/C/D já existem.
-- Idempotente por nome. Template = 'DNA · Pago' (provado).

-- Abandonado
INSERT INTO public.workflows (organization_id,name,is_active,trigger_type,trigger_config,definition)
SELECT 'd67ae17a-815d-476d-b3a9-287c7b267997','DNA · Abandonado (tag→stage)',false,'tag_added',
 '{"tag_name":"checkout_abandonado"}'::jsonb,
 '{"edges":[{"id":"e1","type":"animated","source":"trigger-1","target":"action-2","animated":true}],
   "nodes":[
     {"id":"trigger-1","type":"trigger","position":{"x":400,"y":50},"measured":{"width":280,"height":62},
      "data":{"type":"trigger","label":"Tag adicionada","triggerType":"tag_added","config":{"tag_name":"checkout_abandonado"}}},
     {"id":"action-2","type":"action","position":{"x":400,"y":180},"measured":{"width":280,"height":62},
      "data":{"type":"action","label":"Mover p/ Checkout abandonado","actionType":"move_stage","targetStage":"checkout_abandonado","pipeType":"whatsapp"}}
   ]}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.workflows WHERE organization_id='d67ae17a-815d-476d-b3a9-287c7b267997' AND name='DNA · Abandonado (tag→stage)');

-- PIX
INSERT INTO public.workflows (organization_id,name,is_active,trigger_type,trigger_config,definition)
SELECT 'd67ae17a-815d-476d-b3a9-287c7b267997','DNA · PIX (tag→stage)',false,'tag_added',
 '{"tag_name":"pix_gerado"}'::jsonb,
 '{"edges":[{"id":"e1","type":"animated","source":"trigger-1","target":"action-2","animated":true}],
   "nodes":[
     {"id":"trigger-1","type":"trigger","position":{"x":400,"y":50},"measured":{"width":280,"height":62},
      "data":{"type":"trigger","label":"Tag adicionada","triggerType":"tag_added","config":{"tag_name":"pix_gerado"}}},
     {"id":"action-2","type":"action","position":{"x":400,"y":180},"measured":{"width":280,"height":62},
      "data":{"type":"action","label":"Mover p/ PIX gerado","actionType":"move_stage","targetStage":"pix_gerado","pipeType":"whatsapp"}}
   ]}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.workflows WHERE organization_id='d67ae17a-815d-476d-b3a9-287c7b267997' AND name='DNA · PIX (tag→stage)');

-- Boleto
INSERT INTO public.workflows (organization_id,name,is_active,trigger_type,trigger_config,definition)
SELECT 'd67ae17a-815d-476d-b3a9-287c7b267997','DNA · Boleto (tag→stage)',false,'tag_added',
 '{"tag_name":"boleto_gerado"}'::jsonb,
 '{"edges":[{"id":"e1","type":"animated","source":"trigger-1","target":"action-2","animated":true}],
   "nodes":[
     {"id":"trigger-1","type":"trigger","position":{"x":400,"y":50},"measured":{"width":280,"height":62},
      "data":{"type":"trigger","label":"Tag adicionada","triggerType":"tag_added","config":{"tag_name":"boleto_gerado"}}},
     {"id":"action-2","type":"action","position":{"x":400,"y":180},"measured":{"width":280,"height":62},
      "data":{"type":"action","label":"Mover p/ Boleto gerado","actionType":"move_stage","targetStage":"boleto_gerado","pipeType":"whatsapp"}}
   ]}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.workflows WHERE organization_id='d67ae17a-815d-476d-b3a9-287c7b267997' AND name='DNA · Boleto (tag→stage)');

SELECT name, trigger_config->>'tag_name' AS tag,
  (definition->'nodes'->1->'data'->>'targetStage') AS stage, is_active
FROM public.workflows
WHERE organization_id='d67ae17a-815d-476d-b3a9-287c7b267997'
  AND trigger_type='tag_added' AND trigger_config->>'tag_name' IN ('checkout_abandonado','pix_gerado','boleto_gerado')
ORDER BY name;
