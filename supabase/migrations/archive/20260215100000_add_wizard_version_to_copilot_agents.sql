-- Migration: Adicionar wizard_version à tabela copilot_agents
-- Rastreia qual versão do wizard criou o agente (v1 = wizard antigo, v2 = wizard config-driven)

ALTER TABLE copilot_agents ADD COLUMN IF NOT EXISTS wizard_version INTEGER DEFAULT 1;
COMMENT ON COLUMN copilot_agents.wizard_version IS 'Versão do wizard usado para criar o agente (1=legacy, 2=config-driven)';
