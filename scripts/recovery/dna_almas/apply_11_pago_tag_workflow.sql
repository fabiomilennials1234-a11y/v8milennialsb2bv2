-- apply_11_pago_tag_workflow.sql
-- Onda 1 — workflow nativo: tag "Cliente" -> move_stage "pago" (drip F cascateia via stage_changed)
-- Org DNA de Almas. Idempotente: não recria se já existir pelo nome.
INSERT INTO public.workflows
  (organization_id, name, is_active, trigger_type, trigger_config, definition)
SELECT
  'd67ae17a-815d-476d-b3a9-287c7b267997',
  'DNA · Pago (tag→stage)',
  true,
  'tag_added',
  '{"tag_name":"Cliente"}'::jsonb,
  '{
     "edges":[{"id":"e1","type":"animated","source":"trigger-1","target":"action-2","animated":true}],
     "nodes":[
       {"id":"trigger-1","type":"trigger","position":{"x":400,"y":50},"measured":{"width":280,"height":62},
        "data":{"type":"trigger","label":"Tag adicionada","triggerType":"tag_added","config":{"tag_name":"Cliente"}}},
       {"id":"action-2","type":"action","position":{"x":400,"y":180},"measured":{"width":280,"height":62},
        "data":{"type":"action","label":"Mover p/ Pago","actionType":"move_stage","targetStage":"pago","pipeType":"whatsapp"}}
     ]
   }'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM public.workflows
  WHERE organization_id='d67ae17a-815d-476d-b3a9-287c7b267997' AND name='DNA · Pago (tag→stage)'
)
RETURNING id, name, is_active, trigger_type, trigger_config::text;
