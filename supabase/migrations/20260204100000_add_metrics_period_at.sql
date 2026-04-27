-- Adiciona coluna metrics_period_at para permitir que leads importados
-- sejam atribuídos a um período específico nas métricas (evita distorcer
-- métricas do mês atual ao importar leads antigos)

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS metrics_period_at TIMESTAMPTZ NULL;

ALTER TABLE public.pipe_confirmacao
  ADD COLUMN IF NOT EXISTS metrics_period_at TIMESTAMPTZ NULL;

ALTER TABLE public.pipe_propostas
  ADD COLUMN IF NOT EXISTS metrics_period_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.leads.metrics_period_at IS 'Quando preenchido, usado no lugar de created_at para filtrar por período nas métricas (ex: leads antigos importados)';
COMMENT ON COLUMN public.pipe_confirmacao.metrics_period_at IS 'Quando preenchido, usado no lugar de created_at para filtrar por período nas métricas';
COMMENT ON COLUMN public.pipe_propostas.metrics_period_at IS 'Quando preenchido, usado no lugar de created_at/closed_at para filtrar por período nas métricas';
