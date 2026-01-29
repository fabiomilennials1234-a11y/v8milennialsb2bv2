-- Migration: Webhooks outbound (configuráveis por organização)
-- Description: Tabelas webhooks, webhook_delivery_logs, webhook_deliveries; RLS; índices.
-- Date: 2026-02-11

-- =====================================================
-- 1. TABELA webhooks
-- =====================================================

CREATE TABLE public.webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  secret TEXT,
  events TEXT[] NOT NULL DEFAULT '{}',
  http_method TEXT NOT NULL DEFAULT 'POST' CHECK (http_method IN ('POST', 'PUT', 'PATCH')),
  custom_headers JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.webhooks IS 'Configuração de webhooks outbound por organização (URL, eventos, assinatura).';

CREATE INDEX IF NOT EXISTS idx_webhooks_organization_id ON public.webhooks(organization_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_organization_active ON public.webhooks(organization_id, is_active);

ALTER TABLE public.webhooks ENABLE ROW LEVEL SECURITY;

-- Membros da org podem ler; apenas admins podem inserir/atualizar/deletar
CREATE POLICY "webhooks_select_own_org"
  ON public.webhooks FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "webhooks_insert_admin"
  ON public.webhooks FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT tm.organization_id FROM public.team_members tm
      JOIN public.user_roles ur ON ur.user_id = tm.user_id
      WHERE tm.user_id = auth.uid() AND ur.role = 'admin'
    )
  );

CREATE POLICY "webhooks_update_admin"
  ON public.webhooks FOR UPDATE
  USING (
    organization_id IN (
      SELECT tm.organization_id FROM public.team_members tm
      JOIN public.user_roles ur ON ur.user_id = tm.user_id
      WHERE tm.user_id = auth.uid() AND ur.role = 'admin'
    )
  );

CREATE POLICY "webhooks_delete_admin"
  ON public.webhooks FOR DELETE
  USING (
    organization_id IN (
      SELECT tm.organization_id FROM public.team_members tm
      JOIN public.user_roles ur ON ur.user_id = tm.user_id
      WHERE tm.user_id = auth.uid() AND ur.role = 'admin'
    )
  );

-- Trigger updated_at
DROP TRIGGER IF EXISTS update_webhooks_updated_at ON public.webhooks;
CREATE TRIGGER update_webhooks_updated_at
  BEFORE UPDATE ON public.webhooks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- 2. TABELA webhook_delivery_logs
-- =====================================================

CREATE TABLE public.webhook_delivery_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id UUID NOT NULL REFERENCES public.webhooks(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  attempt SMALLINT NOT NULL,
  status_code INT,
  response_body TEXT,
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  error_message TEXT
);

COMMENT ON TABLE public.webhook_delivery_logs IS 'Log de cada tentativa de entrega (sucesso ou falha).';

CREATE INDEX IF NOT EXISTS idx_webhook_delivery_logs_webhook_delivered
  ON public.webhook_delivery_logs(webhook_id, delivered_at DESC);

ALTER TABLE public.webhook_delivery_logs ENABLE ROW LEVEL SECURITY;

-- Mesmo escopo: membros da org do webhook podem ler
CREATE POLICY "webhook_delivery_logs_select_own_org"
  ON public.webhook_delivery_logs FOR SELECT
  USING (
    webhook_id IN (
      SELECT id FROM public.webhooks
      WHERE organization_id IN (
        SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
      )
    )
  );

-- Inserções feitas apenas pelo worker (service role, que bypassa RLS).

-- =====================================================
-- 3. TABELA webhook_deliveries (fila)
-- =====================================================

CREATE TABLE public.webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id UUID NOT NULL REFERENCES public.webhooks(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  payload JSONB NOT NULL,
  attempt SMALLINT NOT NULL DEFAULT 1,
  max_attempts SMALLINT NOT NULL DEFAULT 5,
  next_retry_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.webhook_deliveries IS 'Fila de entregas pendentes (worker processa por next_retry_at).';

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_next_retry
  ON public.webhook_deliveries(next_retry_at);

ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;

-- Sem políticas para usuários: apenas service role (worker) acessa, pois bypassa RLS.
