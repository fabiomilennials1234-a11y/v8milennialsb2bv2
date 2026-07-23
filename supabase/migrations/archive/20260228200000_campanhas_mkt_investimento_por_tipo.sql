-- Investimento por tipo de marketing (Call e Cadastro) por campanha
-- Date: 2026-02-28

ALTER TABLE public.campanhas
ADD COLUMN IF NOT EXISTS mkt_investimento_call_cents INTEGER DEFAULT NULL,
ADD COLUMN IF NOT EXISTS mkt_investimento_cadastro_cents INTEGER DEFAULT NULL;

COMMENT ON COLUMN public.campanhas.mkt_investimento_call_cents IS 'Investimento em centavos atribuído ao dashboard Marketing Call para esta campanha.';
COMMENT ON COLUMN public.campanhas.mkt_investimento_cadastro_cents IS 'Investimento em centavos atribuído ao dashboard Marketing Cadastro para esta campanha.';
