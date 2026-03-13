-- ============================================================
-- usage_events: rastreamento de ações do usuário no frontend
-- Permite identificar organizações ativas, módulos mais usados
-- e clientes em risco de churn por inatividade.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para consultas frequentes
CREATE INDEX IF NOT EXISTS idx_usage_events_org_created
  ON public.usage_events (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_usage_events_event_type_created
  ON public.usage_events (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_usage_events_user_created
  ON public.usage_events (user_id, created_at DESC);

-- RLS
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

-- Usuário autenticado pode inserir apenas seus próprios eventos
CREATE POLICY "user_insert_own_usage_events"
  ON public.usage_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Master admin pode ler todos
CREATE POLICY "master_read_usage_events"
  ON public.usage_events FOR SELECT
  USING (public.is_master_user());

-- Service role acesso total (para Edge Functions e cron)
CREATE POLICY "service_role_all_usage_events"
  ON public.usage_events FOR ALL
  USING (current_setting('role', true) = 'service_role');

-- pg_cron: limpar registros com mais de 180 dias (roda diariamente às 04:00 UTC)
SELECT cron.schedule(
  'cleanup_usage_events_180d',
  '0 4 * * *',
  $$DELETE FROM public.usage_events WHERE created_at < NOW() - INTERVAL '180 days'$$
);
