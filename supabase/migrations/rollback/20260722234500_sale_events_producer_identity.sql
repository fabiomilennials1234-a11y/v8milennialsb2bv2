-- ROLLBACK de 20260722234500_sale_events_producer_identity.sql (#1199)
--
-- A fatia é ADITIVA E ESCURA: nenhum produtor novo foi ligado, nenhuma linha de
-- receita foi escrita ou alterada. Por isso o rollback é limpo — desfaz DDL e
-- nada mais.
--
-- ORDEM IMPORTA: as constraints referenciam `producer`, então caem antes da
-- coluna. E o SET NOT NULL de pipeline_id/stage_key só volta se não houver
-- linha sem funil — o que só existiria se algum produtor de Carteira já tivesse
-- escrito. Se isso acontecer, o rollback FALHA de propósito: reverter o schema
-- com linhas de Carteira no livro deixaria o banco inconsistente em silêncio.

-- 1. Restaura a normalização de data sem a isenção.
CREATE OR REPLACE FUNCTION public.fn_sale_events_force_sold_at()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.source = 'trigger' THEN NEW.sold_at := now(); END IF;
  RETURN NEW;
END;
$function$;

-- 2. Índices.
DROP INDEX IF EXISTS public.uq_sale_events_producer_origin_event;
DROP INDEX IF EXISTS public.idx_sale_events_producer_sold_at;

-- 3. Constraints que dependem de `producer`.
ALTER TABLE public.sale_events DROP CONSTRAINT IF EXISTS sale_events_origin_required_off_funnel;
ALTER TABLE public.sale_events DROP CONSTRAINT IF EXISTS sale_events_producer_funnel_coherence;
ALTER TABLE public.sale_events DROP CONSTRAINT IF EXISTS sale_events_producer_check;

-- 4. Colunas.
ALTER TABLE public.sale_events DROP COLUMN IF EXISTS origin_record_id;
ALTER TABLE public.sale_events DROP COLUMN IF EXISTS producer;

-- 5. Devolve o NOT NULL de funil/etapa. Falha — corretamente — se já houver
--    linha sem funil no livro.
ALTER TABLE public.sale_events ALTER COLUMN pipeline_id SET NOT NULL;
ALTER TABLE public.sale_events ALTER COLUMN stage_key   SET NOT NULL;
