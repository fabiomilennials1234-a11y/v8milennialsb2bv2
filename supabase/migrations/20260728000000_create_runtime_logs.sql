-- ============================================================
-- runtime_logs: tabela de logs estruturados para Edge Functions
-- Permite investigar falhas sem depender de relato do cliente.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.runtime_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  module TEXT NOT NULL CHECK (module IN (
    'pipe_dispatch', 'copilot', 'campaign', 'webhook', 'followup', 'outbound', 'permission'
  )),
  action TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'error', 'skipped')),
  payload_snapshot JSONB,
  error_message TEXT,
  entity_type TEXT,
  entity_id UUID,
  triggered_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para consultas frequentes
CREATE INDEX IF NOT EXISTS idx_runtime_logs_org_created
  ON public.runtime_logs (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_runtime_logs_status_created
  ON public.runtime_logs (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_runtime_logs_module_created
  ON public.runtime_logs (module, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_runtime_logs_entity
  ON public.runtime_logs (entity_type, entity_id);

-- RLS: apenas master admin pode ler
ALTER TABLE public.runtime_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "master_read_runtime_logs"
  ON public.runtime_logs FOR SELECT
  USING (public.is_master_user());

CREATE POLICY "service_role_all_runtime_logs"
  ON public.runtime_logs FOR ALL
  USING (current_setting('role', true) = 'service_role');

-- pg_cron: limpar registros com mais de 90 dias (roda diariamente às 03:00 UTC)
SELECT cron.schedule(
  'cleanup_runtime_logs_90d',
  '0 3 * * *',
  $$DELETE FROM public.runtime_logs WHERE created_at < NOW() - INTERVAL '90 days'$$
);
