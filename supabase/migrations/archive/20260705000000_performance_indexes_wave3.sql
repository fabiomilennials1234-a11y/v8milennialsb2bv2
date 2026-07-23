-- Performance indexes wave 3 - otimização de queries lentas
-- Baseado em análise de performance (Mar 2026)

-- Leads: query mais frequente (filtro por org + ordenação por created_at)
CREATE INDEX IF NOT EXISTS idx_leads_org_created_desc
  ON leads(organization_id, created_at DESC);

-- Leads: filtro de shadow leads (usado no hook useLeads)
CREATE INDEX IF NOT EXISTS idx_leads_org_not_shadow
  ON leads(organization_id, created_at DESC)
  WHERE is_shadow = false OR is_shadow IS NULL;

-- WhatsApp Messages: full table scan na listagem de contatos
CREATE INDEX IF NOT EXISTS idx_whatsapp_msgs_org_instance_ts
  ON whatsapp_messages(organization_id, instance_id, timestamp DESC);

-- WhatsApp Messages: filtro por lead_id (usado no AgentEngine)
CREATE INDEX IF NOT EXISTS idx_whatsapp_msgs_org_lead_dir
  ON whatsapp_messages(organization_id, lead_id, direction);

-- WhatsApp Messages: filtro incoming para unread count
CREATE INDEX IF NOT EXISTS idx_whatsapp_msgs_org_inst_dir_ts
  ON whatsapp_messages(organization_id, instance_id, direction, timestamp DESC)
  WHERE direction = 'incoming';

-- Conversation Messages: histórico por conversa (AgentEngine hot path)
CREATE INDEX IF NOT EXISTS idx_conv_msgs_conv_created
  ON conversation_messages(conversation_id, created_at ASC);

-- Pipe Confirmação: queries do dashboard de métricas
CREATE INDEX IF NOT EXISTS idx_pipe_conf_org_sdr
  ON pipe_confirmacao(organization_id, sdr_id);

-- Pipe Propostas: queries do dashboard de métricas
CREATE INDEX IF NOT EXISTS idx_pipe_prop_org_closer
  ON pipe_propostas(organization_id, closer_id);

-- Copilot Agents: routing por organização (AgentEngine loadCapabilities)
CREATE INDEX IF NOT EXISTS idx_copilot_agents_org_active
  ON copilot_agents(organization_id, is_active)
  WHERE is_active = true;

-- Follow-up execution log: contagem por lead+rule (N+1 fix)
CREATE INDEX IF NOT EXISTS idx_followup_exec_lead_rule
  ON copilot_followup_execution_log(lead_id, rule_id);

-- Conversation context summary: lookup por lead_id
CREATE INDEX IF NOT EXISTS idx_conv_context_lead
  ON conversation_context_summary(lead_id);
