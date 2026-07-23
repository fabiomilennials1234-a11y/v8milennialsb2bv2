-- Config por campanha: quais leads contam para Marketing Call e Marketing Cadastro (por origem ou por etiqueta)
-- Date: 2026-02-27

ALTER TABLE public.campanhas
ADD COLUMN IF NOT EXISTS mkt_call_origins TEXT[] DEFAULT NULL,
ADD COLUMN IF NOT EXISTS mkt_call_tag_ids UUID[] DEFAULT NULL,
ADD COLUMN IF NOT EXISTS mkt_cadastro_origins TEXT[] DEFAULT NULL,
ADD COLUMN IF NOT EXISTS mkt_cadastro_tag_ids UUID[] DEFAULT NULL;

COMMENT ON COLUMN public.campanhas.mkt_call_origins IS 'Origens (lead_origin) que contam para dashboard Marketing Call. Null/empty = não configurado (usa critério global).';
COMMENT ON COLUMN public.campanhas.mkt_call_tag_ids IS 'IDs de tags: leads com alguma dessas etiquetas contam para Marketing Call.';
COMMENT ON COLUMN public.campanhas.mkt_cadastro_origins IS 'Origens que contam para dashboard Marketing Cadastro.';
COMMENT ON COLUMN public.campanhas.mkt_cadastro_tag_ids IS 'IDs de tags que contam para Marketing Cadastro.';
