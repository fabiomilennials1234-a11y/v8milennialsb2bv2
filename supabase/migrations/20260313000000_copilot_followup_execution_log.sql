-- Migration: Log de execução de follow-ups por regra
-- Permite rastrear quantos follow-ups foram enviados por lead+regra (max_followups)
-- Date: 2026-03-13

CREATE TABLE IF NOT EXISTS public.copilot_followup_execution_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  rule_id UUID NOT NULL REFERENCES public.copilot_agent_followup_rules(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  message_content TEXT,
  instance_name TEXT
);

CREATE INDEX IF NOT EXISTS idx_followup_exec_lead ON public.copilot_followup_execution_log(lead_id);
CREATE INDEX IF NOT EXISTS idx_followup_exec_rule ON public.copilot_followup_execution_log(rule_id);
CREATE INDEX IF NOT EXISTS idx_followup_exec_org ON public.copilot_followup_execution_log(organization_id);

ALTER TABLE public.copilot_followup_execution_log ENABLE ROW LEVEL SECURITY;

-- Service role / system only - usuários não acessam diretamente (RLS bypass para service_role)
CREATE POLICY "followup_exec_service_only"
  ON public.copilot_followup_execution_log FOR ALL
  USING (false)
  WITH CHECK (false);

COMMENT ON TABLE public.copilot_followup_execution_log IS 'Log de execuções de follow-up (por lead+regra) para controlar max_followups';
