-- Campanhas vinculadas ao marketing: só as selecionadas aparecem na divisão e podem ser configuradas
-- Date: 2026-02-28

ALTER TABLE public.campanhas
ADD COLUMN IF NOT EXISTS mkt_ativo BOOLEAN DEFAULT false;

COMMENT ON COLUMN public.campanhas.mkt_ativo IS 'Se true, campanha aparece na divisão por campanha do Marketing e pode ser configurada (investimento, tipo, origem/etiqueta).';
