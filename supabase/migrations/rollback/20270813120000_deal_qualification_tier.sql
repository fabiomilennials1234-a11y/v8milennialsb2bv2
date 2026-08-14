-- rollback/20270813120000_deal_qualification_tier.sql
--
-- Desfaz a qualificação do negócio. `leads.qualification_tier` não é tocada —
-- ela nunca foi mexida pela migration original.
--
-- ⚠ O DROP APAGA AVALIAÇÃO DE NEGÓCIO. Se alguém já qualificou oportunidades,
-- isso não volta. Fica no fim, comentado.

DROP INDEX IF EXISTS public.idx_deals_qualification_tier;
ALTER TABLE public.deals DROP CONSTRAINT IF EXISTS deals_qualification_tier_check;

-- ALTER TABLE public.deals DROP COLUMN IF EXISTS qualification_tier;
