-- apply_16_fix_workflow_misconfig.sql
-- Bugs PRÉ-EXISTENTES achados na verificação da Onda 1 (2026-06-19). Org DNA de Almas.
-- (1) DNA · C / DNA · D com trigger_config={} → disparam em QUALQUER stage_changed.
--     Fix: setar to_stage correto (ficam dormentes-corretos, como B/E/F/G).
-- (2) "Disparo Automático" (lead_created, cfg vazio) → falha em todo lead novo. Desativar.

UPDATE public.workflows
SET trigger_config = '{"to_stage":"pix_gerado","pipe_type":"whatsapp"}'::jsonb, updated_at = now()
WHERE organization_id='d67ae17a-815d-476d-b3a9-287c7b267997'
  AND name='DNA · C — PIX gerado (não pago)' AND trigger_config = '{}'::jsonb;

UPDATE public.workflows
SET trigger_config = '{"to_stage":"boleto_gerado","pipe_type":"whatsapp"}'::jsonb, updated_at = now()
WHERE organization_id='d67ae17a-815d-476d-b3a9-287c7b267997'
  AND name='DNA · D — Boleto gerado (não pago)' AND trigger_config = '{}'::jsonb;

UPDATE public.workflows
SET is_active = false, updated_at = now()
WHERE id='d4388b7c-b88e-40c0-970c-d0f177b44696'  -- Disparo Automático (genérico stray)
  AND organization_id='d67ae17a-815d-476d-b3a9-287c7b267997';

-- verificação
SELECT name, trigger_type, trigger_config::text AS cfg, is_active
FROM public.workflows
WHERE organization_id='d67ae17a-815d-476d-b3a9-287c7b267997'
  AND (name IN ('DNA · C — PIX gerado (não pago)','DNA · D — Boleto gerado (não pago)')
       OR id='d4388b7c-b88e-40c0-970c-d0f177b44696')
ORDER BY name;
