-- apply_19_reconcile_zuvic_sys_tags.sql  (2026-06-29)
-- DNA de Almas — reconciliação com o NOVO contrato Zuvic (doc integracao_torque.pdf, 2026-06-28).
-- Zuvic passou (~26/06) a mandar tags com prefixo sys: + eventos novos (checkout.initiated/
-- pending/abandoned, product.purchased avulso vs checkout.success plano). Nossos workflows
-- tag→stage gatilhavam nomes crus → ZERO disparo → 49 leads presos em whatsapp/novo (INATIVA).
--
-- BLEED-STOP (L0). Tudo idempotente. NADA envia (whatsapp_instances=0).
-- Decisão CTO 2026-06-29: roteamento tag-driven canônico; aplicar em prod agora.
-- Org DNA = d67ae17a-815d-476d-b3a9-287c7b267997
--
-- Matcher confirmado: process-workflow-executions → matchesTriggerConfig() casa
-- workflows.trigger_config.tag_name (coluna) vs context.tag_name, case-insensitive.
-- Logo retag da COLUNA basta (nó da definition é cosmético/UI).

-- ── 1) RETAG tag→stage p/ sys:* (mapeamento evento Zuvic → tag → stage verificado) ──
-- sys:cliente   = product.purchased (compra avulsa do mapa) → pago
UPDATE public.workflows SET trigger_config = jsonb_set(trigger_config,'{tag_name}','"sys:cliente"'), is_active=true
  WHERE id='8cadc089-4ab5-4b22-854f-d33cb04a7a7c';
-- sys:assinante = checkout.success / checkout.upgrade (assinatura de plano) → assinante
UPDATE public.workflows SET trigger_config = jsonb_set(trigger_config,'{tag_name}','"sys:assinante"'), is_active=true
  WHERE id='9237111c-419b-4ca7-a028-041ee7c0866e';
-- sys:checkout_recusado = checkout.error → cartao_recusado
UPDATE public.workflows SET trigger_config = jsonb_set(trigger_config,'{tag_name}','"sys:checkout_recusado"'), is_active=true
  WHERE id='caf88585-4f76-4926-bab3-48be05b7e01c';
-- sys:cancelado = subscription.canceled → cancelado
UPDATE public.workflows SET trigger_config = jsonb_set(trigger_config,'{tag_name}','"sys:cancelado"'), is_active=true
  WHERE id='53824f79-8e64-4ff6-a9ea-80d48ff0c124';
-- sys:downgrade = plan.downgrade_free → plano_free
UPDATE public.workflows SET trigger_config = jsonb_set(trigger_config,'{tag_name}','"sys:downgrade"'), is_active=true
  WHERE id='3177f281-e1ae-44a0-a120-0479d75019b0';
-- sys:inadimplente = payment.overdue → inadimplente
UPDATE public.workflows SET trigger_config = jsonb_set(trigger_config,'{tag_name}','"sys:inadimplente"'), is_active=true
  WHERE id='3193331c-3bdc-4869-b69f-343242da5607';
-- sys:renovacao = invoice.paid → assinante
UPDATE public.workflows SET trigger_config = jsonb_set(trigger_config,'{tag_name}','"sys:renovacao"'), is_active=true
  WHERE id='f01a1eba-8dfd-4309-b6b3-547009308e8f';

-- ── 2) ATIVA Onda-3 tag→stage (os eventos AGORA existem no contrato Zuvic) ──
-- sys:checkout_abandonado = checkout.initiated (abandono de página, B) → checkout_abandonado
UPDATE public.workflows SET trigger_config = jsonb_set(trigger_config,'{tag_name}','"sys:checkout_abandonado"'), is_active=true
  WHERE id='00a5ea0c-1813-41d6-b729-37ddfdee4c0e';
-- sys:pix_gerado = checkout.pending (PIX gerado, régua começa) → pix_gerado
UPDATE public.workflows SET trigger_config = jsonb_set(trigger_config,'{tag_name}','"sys:pix_gerado"'), is_active=true
  WHERE id='f36f1c5c-78d0-4c67-afd3-b71cd6e5bac2';

-- ── 3) DESATIVA Upgrade órfão (checkout.upgrade agora manda sys:assinante; workflow Assinante cobre) ──
UPDATE public.workflows SET is_active=false WHERE id='d7b01012-3dee-4000-b24a-63876b27f8b5';

-- ── 4) STAGE NOVA pix_abandonado (checkout.abandoned = PIX gerado e NÃO pago; lead quente, ≠ pix_gerado) ──
-- position 25 (fim do bloco ativo) — CTO pode reordenar na UI.
INSERT INTO public.pipeline_stages (organization_id, pipeline_type, stage_key, name, position, is_active)
VALUES ('d67ae17a-815d-476d-b3a9-287c7b267997','whatsapp','pix_abandonado','🔥 PIX abandonado',25,true)
ON CONFLICT (organization_id, pipeline_type, stage_key) DO NOTHING;

-- ── 5) WORKFLOW sys:pix_abandonado → move pix_abandonado (Padrão A move-only; drip C = passada de copy CTO) ──
INSERT INTO public.workflows (organization_id,name,is_active,trigger_type,trigger_config,definition)
SELECT 'd67ae17a-815d-476d-b3a9-287c7b267997','DNA · PIX abandonado (tag→stage)',true,'tag_added',
 '{"tag_name":"sys:pix_abandonado"}'::jsonb,
 '{"edges":[{"id":"e1","type":"animated","source":"trigger-1","target":"action-2","animated":true}],
   "nodes":[
     {"id":"trigger-1","type":"trigger","position":{"x":400,"y":50},"measured":{"width":280,"height":62},
      "data":{"type":"trigger","label":"Tag adicionada","triggerType":"tag_added","config":{"tag_name":"sys:pix_abandonado"}}},
     {"id":"action-2","type":"action","position":{"x":400,"y":180},"measured":{"width":280,"height":62},
      "data":{"type":"action","label":"Mover p/ PIX abandonado","actionType":"move_stage","targetStage":"pix_abandonado","pipeType":"whatsapp"}}
   ]}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.workflows
  WHERE organization_id='d67ae17a-815d-476d-b3a9-287c7b267997' AND name='DNA · PIX abandonado (tag→stage)');

-- ── 6) BACKFILL: leads presos em whatsapp/novo (INATIVA) → novo_lead (1ª ativa) ──
-- novo_lead NÃO tem workflow stage_changed → move = no-op (zero execução de drip, zero send).
-- Os ~6 sys:-tagged ficam visíveis em novo_lead; placement no stage-de-cenário = go-live
-- (replay de tag COM instância), p/ evitar drip stale disparando ao conectar o número.
UPDATE public.pipeline_entries
SET stage_key='novo_lead', updated_at=now()
WHERE pipeline_id = (SELECT id FROM public.pipelines
                     WHERE organization_id='d67ae17a-815d-476d-b3a9-287c7b267997' AND slug='whatsapp')
  AND stage_key='novo';
