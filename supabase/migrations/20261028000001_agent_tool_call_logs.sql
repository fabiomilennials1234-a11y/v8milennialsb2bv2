-- =============================================================================
-- Migration: agent_tool_call_logs
-- RAG Observability — log every tool call executed by copilot agents.
-- Issue: #230
-- Date: 2026-05-18
-- =============================================================================

CREATE TABLE public.agent_tool_call_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id uuid REFERENCES public.copilot_agents(id) ON DELETE SET NULL,
  tool_name text NOT NULL,
  tool_input jsonb NOT NULL DEFAULT '{}',
  tool_output_summary jsonb,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_tool_call_logs_conv_created
  ON public.agent_tool_call_logs (conversation_id, created_at);

CREATE INDEX idx_agent_tool_call_logs_org
  ON public.agent_tool_call_logs (organization_id);

ALTER TABLE public.agent_tool_call_logs ENABLE ROW LEVEL SECURITY;

-- Authenticated users: SELECT only, scoped to their orgs
CREATE POLICY "tenant_isolation_select" ON public.agent_tool_call_logs
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT get_my_organization_ids()));

-- Service role: full access (used by edge functions / cron)
CREATE POLICY "service_role_full_access" ON public.agent_tool_call_logs
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT ON public.agent_tool_call_logs TO authenticated;
GRANT ALL ON public.agent_tool_call_logs TO service_role;

COMMENT ON TABLE public.agent_tool_call_logs IS
  'RAG observability: logs every tool call executed by copilot agents. Fire-and-forget insert from action executor.';
