-- =============================================
-- Performance Optimization Wave 2 — Indexes adicionais
-- =============================================

-- whatsapp_messages: queries por org + lead_id (chat individual)
CREATE INDEX IF NOT EXISTS idx_whatsapp_msgs_org_lead
  ON public.whatsapp_messages(organization_id, lead_id, "timestamp" DESC);

-- conversation_messages: queries por conversation_id + created_at
CREATE INDEX IF NOT EXISTS idx_conversation_msgs_conv_created
  ON public.conversation_messages(conversation_id, created_at);

-- pipe_propostas: listagem por org + data (kanban)
CREATE INDEX IF NOT EXISTS idx_pipe_propostas_org_created
  ON public.pipe_propostas(organization_id, created_at DESC);

-- pipe_confirmacao: listagem por org + data (kanban)
CREATE INDEX IF NOT EXISTS idx_pipe_confirmacao_org_created
  ON public.pipe_confirmacao(organization_id, created_at DESC);

-- pipe_whatsapp: listagem por org + data (kanban)
CREATE INDEX IF NOT EXISTS idx_pipe_whatsapp_org_created
  ON public.pipe_whatsapp(organization_id, created_at DESC);

-- leads: busca por org + shadow filter + data (listagem principal)
CREATE INDEX IF NOT EXISTS idx_leads_org_shadow_created
  ON public.leads(organization_id, created_at DESC)
  WHERE is_shadow IS NULL OR is_shadow = false;
