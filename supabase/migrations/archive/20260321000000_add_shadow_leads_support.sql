-- Migration: Shadow Leads
-- Permite que copilots atendam contatos sem lead criado.
-- Shadow leads são invisíveis nos pipes até serem promovidos (qualificação ou criação manual).

-- 1. Campo is_shadow na tabela leads
ALTER TABLE leads ADD COLUMN IF NOT EXISTS is_shadow BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_leads_not_shadow
  ON leads (organization_id) WHERE is_shadow = false;

COMMENT ON COLUMN leads.is_shadow IS
  'Shadow lead: criado automaticamente pelo copilot, invisível nos pipes até ser promovido';

-- 2. Campo attend_unknown_contacts na tabela copilot_agents
ALTER TABLE copilot_agents ADD COLUMN IF NOT EXISTS attend_unknown_contacts BOOLEAN DEFAULT false;

COMMENT ON COLUMN copilot_agents.attend_unknown_contacts IS
  'Se true, copilot cria shadow lead e atende números que ainda não são leads no sistema';
