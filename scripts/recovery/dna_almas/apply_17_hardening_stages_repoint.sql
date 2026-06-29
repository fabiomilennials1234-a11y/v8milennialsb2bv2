-- apply_17_hardening_stages_repoint.sql
-- Hardening H1/H2/H3/H8: stages-por-evento (separa assinante de plano-free de cancelado).
-- Org DNA. Idempotente.

-- 1. Stages novos
INSERT INTO public.pipeline_stages (organization_id, pipeline_type, stage_key, name, position, is_active)
VALUES
 ('d67ae17a-815d-476d-b3a9-287c7b267997','whatsapp','assinante','💎 Assinante ativo',23,true),
 ('d67ae17a-815d-476d-b3a9-287c7b267997','whatsapp','plano_free','🆓 Plano free',24,true)
ON CONFLICT (organization_id, pipeline_type, stage_key) DO NOTHING;

-- 2. H1: Upgrade não vai mais pra 'pago' (não dispara F-onboarding-mapa) → 'assinante'
UPDATE public.workflows
SET definition = jsonb_set(
      jsonb_set(definition, '{nodes,1,data,targetStage}', '"assinante"'),
      '{nodes,1,data,label}', '"Mover p/ Assinante ativo"'),
    updated_at = now()
WHERE organization_id='d67ae17a-815d-476d-b3a9-287c7b267997'
  AND name='DNA · Upgrade (tag→stage)';

-- 3. H2: Downgrade não vai mais pra 'cancelado' (winback "encerrado" é falso) → 'plano_free'
UPDATE public.workflows
SET definition = jsonb_set(
      jsonb_set(definition, '{nodes,1,data,targetStage}', '"plano_free"'),
      '{nodes,1,data,label}', '"Mover p/ Plano free"'),
    updated_at = now()
WHERE organization_id='d67ae17a-815d-476d-b3a9-287c7b267997'
  AND name='DNA · Downgrade (tag→stage)';

-- 4. H3: Renovação (invoice.paid) tira inadimplente da cobrança → 'assinante' (guard da cobrança encerra)
INSERT INTO public.workflows (organization_id,name,is_active,trigger_type,trigger_config,definition)
SELECT 'd67ae17a-815d-476d-b3a9-287c7b267997','DNA · Renovação (tag→stage)',true,'tag_added',
 '{"tag_name":"renovacao"}'::jsonb,
 '{"edges":[{"id":"e1","type":"animated","source":"trigger-1","target":"action-2","animated":true}],
   "nodes":[
     {"id":"trigger-1","type":"trigger","position":{"x":400,"y":50},"measured":{"width":280,"height":62},
      "data":{"type":"trigger","label":"Tag adicionada","triggerType":"tag_added","config":{"tag_name":"renovacao"}}},
     {"id":"action-2","type":"action","position":{"x":400,"y":180},"measured":{"width":280,"height":62},
      "data":{"type":"action","label":"Mover p/ Assinante ativo","actionType":"move_stage","targetStage":"assinante","pipeType":"whatsapp"}}
   ]}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.workflows WHERE organization_id='d67ae17a-815d-476d-b3a9-287c7b267997' AND name='DNA · Renovação (tag→stage)');

-- 5. H1 (resto): checkout.success de PLANO (≠ avulso) → tag 'assinante' → stage assinante (não dispara F)
INSERT INTO public.workflows (organization_id,name,is_active,trigger_type,trigger_config,definition)
SELECT 'd67ae17a-815d-476d-b3a9-287c7b267997','DNA · Assinante (tag→stage)',true,'tag_added',
 '{"tag_name":"assinante"}'::jsonb,
 '{"edges":[{"id":"e1","type":"animated","source":"trigger-1","target":"action-2","animated":true}],
   "nodes":[
     {"id":"trigger-1","type":"trigger","position":{"x":400,"y":50},"measured":{"width":280,"height":62},
      "data":{"type":"trigger","label":"Tag adicionada","triggerType":"tag_added","config":{"tag_name":"assinante"}}},
     {"id":"action-2","type":"action","position":{"x":400,"y":180},"measured":{"width":280,"height":62},
      "data":{"type":"action","label":"Mover p/ Assinante ativo","actionType":"move_stage","targetStage":"assinante","pipeType":"whatsapp"}}
   ]}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.workflows WHERE organization_id='d67ae17a-815d-476d-b3a9-287c7b267997' AND name='DNA · Assinante (tag→stage)');

-- verificação
SELECT name, trigger_config->>'tag_name' AS tag,
  (definition->'nodes'->1->'data'->>'targetStage') AS stage, is_active
FROM public.workflows
WHERE organization_id='d67ae17a-815d-476d-b3a9-287c7b267997'
  AND name IN ('DNA · Upgrade (tag→stage)','DNA · Downgrade (tag→stage)','DNA · Renovação (tag→stage)','DNA · Assinante (tag→stage)')
ORDER BY name;
