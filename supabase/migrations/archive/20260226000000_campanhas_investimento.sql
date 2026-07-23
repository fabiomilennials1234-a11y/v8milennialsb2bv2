-- Migration: Investimento por campanha (manual e futura API)
-- Permite informar valor investido por campanha para métricas de marketing
-- Date: 2026-02-26

ALTER TABLE public.campanhas
ADD COLUMN IF NOT EXISTS investimento_cents BIGINT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS investimento_updated_at TIMESTAMPTZ DEFAULT NULL,
ADD COLUMN IF NOT EXISTS investimento_source TEXT DEFAULT 'manual'
  CHECK (investimento_source IS NULL OR investimento_source IN ('manual', 'api'));

COMMENT ON COLUMN public.campanhas.investimento_cents IS 'Investimento na campanha em centavos (ex: 10000 = R$ 100,00). Null = não informado';
COMMENT ON COLUMN public.campanhas.investimento_updated_at IS 'Última atualização do investimento';
COMMENT ON COLUMN public.campanhas.investimento_source IS 'Origem do dado: manual (preenchido no sistema) ou api (webhook/integração)';
