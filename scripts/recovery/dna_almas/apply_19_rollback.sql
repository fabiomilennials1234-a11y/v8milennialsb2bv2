-- apply_19_rollback.sql  (2026-06-29)
-- Reverte SÓ as mudanças de config de apply_19 (workflows/stage).
-- O BACKFILL (novo→novo_lead) é fix intencional e NÃO é revertido (novo é stage morta).
-- Org DNA = d67ae17a-815d-476d-b3a9-287c7b267997

-- Restaura tag_names crus + is_active originais
UPDATE public.workflows SET trigger_config = jsonb_set(trigger_config,'{tag_name}','"Cliente"'), is_active=true            WHERE id='8cadc089-4ab5-4b22-854f-d33cb04a7a7c';
UPDATE public.workflows SET trigger_config = jsonb_set(trigger_config,'{tag_name}','"assinante"'), is_active=true          WHERE id='9237111c-419b-4ca7-a028-041ee7c0866e';
UPDATE public.workflows SET trigger_config = jsonb_set(trigger_config,'{tag_name}','"checkout_recusado"'), is_active=true  WHERE id='caf88585-4f76-4926-bab3-48be05b7e01c';
UPDATE public.workflows SET trigger_config = jsonb_set(trigger_config,'{tag_name}','"cancelado"'), is_active=true          WHERE id='53824f79-8e64-4ff6-a9ea-80d48ff0c124';
UPDATE public.workflows SET trigger_config = jsonb_set(trigger_config,'{tag_name}','"downgrade"'), is_active=true          WHERE id='3177f281-e1ae-44a0-a120-0479d75019b0';
UPDATE public.workflows SET trigger_config = jsonb_set(trigger_config,'{tag_name}','"inadimplente"'), is_active=true       WHERE id='3193331c-3bdc-4869-b69f-343242da5607';
UPDATE public.workflows SET trigger_config = jsonb_set(trigger_config,'{tag_name}','"renovacao"'), is_active=true          WHERE id='f01a1eba-8dfd-4309-b6b3-547009308e8f';
UPDATE public.workflows SET trigger_config = jsonb_set(trigger_config,'{tag_name}','"checkout_abandonado"'), is_active=false WHERE id='00a5ea0c-1813-41d6-b729-37ddfdee4c0e';
UPDATE public.workflows SET trigger_config = jsonb_set(trigger_config,'{tag_name}','"pix_gerado"'), is_active=false        WHERE id='f36f1c5c-78d0-4c67-afd3-b71cd6e5bac2';
UPDATE public.workflows SET is_active=true WHERE id='d7b01012-3dee-4000-b24a-63876b27f8b5';

-- Remove workflow + stage novos
DELETE FROM public.workflows WHERE organization_id='d67ae17a-815d-476d-b3a9-287c7b267997' AND name='DNA · PIX abandonado (tag→stage)';
DELETE FROM public.pipeline_stages WHERE organization_id='d67ae17a-815d-476d-b3a9-287c7b267997' AND pipeline_type='whatsapp' AND stage_key='pix_abandonado';
