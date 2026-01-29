-- Migration: Copilot availability & response delay
-- Description: Adds scheduling and response timing controls for agents
-- Date: 2026-01-24

ALTER TABLE public.copilot_agents
ADD COLUMN IF NOT EXISTS availability JSONB DEFAULT '{"mode":"always","timezone":"America/Sao_Paulo","days":["mon","tue","wed","thu","fri"],"start":"09:00","end":"18:00"}'::jsonb,
ADD COLUMN IF NOT EXISTS response_delay_seconds INTEGER DEFAULT 0;

COMMENT ON COLUMN public.copilot_agents.availability IS 'Regras de disponibilidade do agente: mode(always|scheduled), timezone, days, start, end';
COMMENT ON COLUMN public.copilot_agents.response_delay_seconds IS 'Atraso artificial de resposta (em segundos) para simular tempo humano';
