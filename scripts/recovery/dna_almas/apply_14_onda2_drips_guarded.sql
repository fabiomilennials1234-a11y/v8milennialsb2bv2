-- apply_14_onda2_drips_guarded.sql
-- Onda 2 — drips Inadimplente (cobrança) + Cancelado (winback), copy aprovada CTO 2026-06-19.
-- Pattern B com GUARD nativo (condition field=stage in_stage <stage> → source-false → end).
-- trigger stage_changed (cascateia quando o move workflow leva o lead pro stage).
-- is_active=true (consistente com E/F/G; send no-op até whatsapp_instance existir). Idempotente por nome.

-- Inadimplente (cobrança)
INSERT INTO public.workflows (organization_id,name,is_active,trigger_type,trigger_config,definition)
SELECT 'd67ae17a-815d-476d-b3a9-287c7b267997','DNA · Inadimplente (cobrança)',true,'stage_changed',
 '{"to_stage":"inadimplente","pipe_type":"whatsapp"}'::jsonb,
 '{"edges":[
     {"id":"e1","type":"animated","source":"trigger-1","target":"delay-2","animated":true},
     {"id":"e2","type":"animated","source":"delay-2","target":"cond-3","animated":true},
     {"id":"e3","type":"animated","source":"cond-3","target":"action-4","sourceHandle":"source-true","animated":true},
     {"id":"e4","type":"animated","source":"cond-3","target":"end-5","sourceHandle":"source-false","animated":true}
   ],
   "nodes":[
     {"id":"trigger-1","type":"trigger","position":{"x":400,"y":50},"measured":{"width":280,"height":62},
      "data":{"type":"trigger","label":"Entrou em Inadimplente","triggerType":"stage_changed","config":{}}},
     {"id":"delay-2","type":"delay","position":{"x":400,"y":180},"measured":{"width":280,"height":62},
      "data":{"type":"delay","label":"Aguardar 10 min","unit":"minutes","amount":10}},
     {"id":"cond-3","type":"condition","position":{"x":400,"y":310},"measured":{"width":280,"height":62},
      "data":{"type":"condition","label":"Ainda inadimplente?","conditionMode":"field","field":"stage","operator":"in_stage","value":"inadimplente"}},
     {"id":"action-4","type":"action","position":{"x":260,"y":440},"measured":{"width":280,"height":62},
      "data":{"type":"action","label":"Enviar WhatsApp","actionType":"send_whatsapp","messageTemplate":"{{custom.primeiro_nome}}, identificamos que a renovação do seu acesso ao DNA de Almas não foi confirmada. Pra não perder o acesso, é só regularizar por aqui:\n👉 {{custom.link_checkout}}"}},
     {"id":"end-5","type":"end","position":{"x":560,"y":440},"measured":{"width":280,"height":62},
      "data":{"type":"end","label":"Encerrar (saiu do stage)"}}
   ]}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.workflows WHERE organization_id='d67ae17a-815d-476d-b3a9-287c7b267997' AND name='DNA · Inadimplente (cobrança)');

-- Cancelado (winback)
INSERT INTO public.workflows (organization_id,name,is_active,trigger_type,trigger_config,definition)
SELECT 'd67ae17a-815d-476d-b3a9-287c7b267997','DNA · Cancelado (winback)',true,'stage_changed',
 '{"to_stage":"cancelado","pipe_type":"whatsapp"}'::jsonb,
 '{"edges":[
     {"id":"e1","type":"animated","source":"trigger-1","target":"delay-2","animated":true},
     {"id":"e2","type":"animated","source":"delay-2","target":"cond-3","animated":true},
     {"id":"e3","type":"animated","source":"cond-3","target":"action-4","sourceHandle":"source-true","animated":true},
     {"id":"e4","type":"animated","source":"cond-3","target":"end-5","sourceHandle":"source-false","animated":true}
   ],
   "nodes":[
     {"id":"trigger-1","type":"trigger","position":{"x":400,"y":50},"measured":{"width":280,"height":62},
      "data":{"type":"trigger","label":"Entrou em Cancelado","triggerType":"stage_changed","config":{}}},
     {"id":"delay-2","type":"delay","position":{"x":400,"y":180},"measured":{"width":280,"height":62},
      "data":{"type":"delay","label":"Aguardar 30 min","unit":"minutes","amount":30}},
     {"id":"cond-3","type":"condition","position":{"x":400,"y":310},"measured":{"width":280,"height":62},
      "data":{"type":"condition","label":"Ainda cancelado?","conditionMode":"field","field":"stage","operator":"in_stage","value":"cancelado"}},
     {"id":"action-4","type":"action","position":{"x":260,"y":440},"measured":{"width":280,"height":62},
      "data":{"type":"action","label":"Enviar WhatsApp","actionType":"send_whatsapp","messageTemplate":"{{custom.primeiro_nome}}, seu acesso ao DNA de Almas foi encerrado. Se quiser voltar quando fizer sentido, deixo o link aqui:\n👉 {{custom.link_checkout}}\nTe desejo um caminho leve. 🌙"}},
     {"id":"end-5","type":"end","position":{"x":560,"y":440},"measured":{"width":280,"height":62},
      "data":{"type":"end","label":"Encerrar (saiu do stage)"}}
   ]}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.workflows WHERE organization_id='d67ae17a-815d-476d-b3a9-287c7b267997' AND name='DNA · Cancelado (winback)');

SELECT name, trigger_config->>'to_stage' AS to_stage, is_active,
  (definition->'nodes'->2->'data'->>'operator') AS guard_op,
  (definition->'nodes'->2->'data'->>'value') AS guard_val,
  jsonb_array_length(definition->'nodes') AS n_nodes
FROM public.workflows
WHERE organization_id='d67ae17a-815d-476d-b3a9-287c7b267997'
  AND name IN ('DNA · Inadimplente (cobrança)','DNA · Cancelado (winback)') ORDER BY name;
