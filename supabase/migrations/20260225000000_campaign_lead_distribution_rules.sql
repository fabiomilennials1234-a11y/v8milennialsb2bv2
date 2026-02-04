-- Migration: Regras de distribuição automática de leads para campanhas
-- Quando leads chegam via importação ou integrações (Meta Ads, etc.), aplica distribuição aleatória ou para pessoa específica
-- Date: 2026-02-25

-- Adicionar colunas de distribuição na tabela campanhas
ALTER TABLE public.campanhas
ADD COLUMN IF NOT EXISTS lead_distribution_mode TEXT DEFAULT NULL
  CHECK (lead_distribution_mode IS NULL OR lead_distribution_mode IN ('random', 'round_robin', 'single')),
ADD COLUMN IF NOT EXISTS lead_assigned_to UUID REFERENCES public.team_members(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.campanhas.lead_distribution_mode IS 'Modo de distribuição: random (aleatório), round_robin (rotativo), single (pessoa específica). Null = manual';
COMMENT ON COLUMN public.campanhas.lead_assigned_to IS 'Quando lead_distribution_mode=single, ID do team_member que recebe todos os leads';

CREATE INDEX IF NOT EXISTS idx_campanhas_lead_distribution ON public.campanhas(lead_distribution_mode) WHERE lead_distribution_mode IS NOT NULL;
