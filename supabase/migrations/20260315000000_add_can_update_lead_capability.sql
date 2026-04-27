-- Migration: Add can_update_lead capability to copilot_agents
-- Description: Permite que o agente atualize leads no próprio CRM v8 (leads, custom fields, notes)
-- Date: 2026-03-15

ALTER TABLE public.copilot_agents
  ADD COLUMN IF NOT EXISTS can_update_lead BOOLEAN DEFAULT true;

COMMENT ON COLUMN public.copilot_agents.can_update_lead IS 'Se o agente pode atualizar informações do lead no CRM (leads, campos personalizados, notas)';
