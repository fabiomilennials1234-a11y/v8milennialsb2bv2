-- Tipo de marketing por campanha: incluir em Call e/ou Cadastro (mostrar em qual(is) dashboard(s))
-- Date: 2026-02-28

ALTER TABLE public.campanhas
ADD COLUMN IF NOT EXISTS mkt_incluir_call BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS mkt_incluir_cadastro BOOLEAN DEFAULT true;

COMMENT ON COLUMN public.campanhas.mkt_incluir_call IS 'Se true, campanha entra no dashboard Marketing Call (respeitando config por origem/etiqueta).';
COMMENT ON COLUMN public.campanhas.mkt_incluir_cadastro IS 'Se true, campanha entra no dashboard Marketing Cadastro (respeitando config por origem/etiqueta).';
