-- ROLLBACK de 20270302000040_commission_projection.sql (issue #994)
--
-- Remove a projeção de comissão (trigger + função), o guard de imutabilidade,
-- as linhas PROJETADAS e as colunas novas de commissions — ordem inversa da
-- criação. Restaura os grants table-level de INSERT/UPDATE que existiam antes
-- (era Supabase default).
--
-- ATENÇÃO: DELETE das linhas source='sale_event_projection' descarta a
-- projeção inteira — ela é derivável de novo (re-projetar sale_events num
-- eventual re-apply), MAS o flag `paid` marcado em projeções se perde.
-- Rollback só se a projeção ainda não é fonte de leitura (pré-SP-3).
-- Linhas manuais e o fluxo vigente não são tocados.

BEGIN;

-- Projeção
DROP TRIGGER IF EXISTS trg_sale_events_project_commission ON public.sale_events;
DROP FUNCTION IF EXISTS public.fn_project_commission();

-- Guard (precisa cair ANTES do DELETE das projeções — ele bloqueia delete
-- com evento pai vivo)
DROP TRIGGER IF EXISTS trg_commissions_protect_projection ON public.commissions;
DROP FUNCTION IF EXISTS public.fn_commissions_protect_projection();

-- Linhas projetadas (as manuais ficam)
DELETE FROM public.commissions WHERE source = 'sale_event_projection';

-- Índice e constraints
DROP INDEX IF EXISTS public.idx_commissions_projection_org_period;
ALTER TABLE public.commissions
  DROP CONSTRAINT IF EXISTS commissions_projection_coherence,
  DROP CONSTRAINT IF EXISTS commissions_sale_event_id_key;

-- Colunas (CHECKs inline caem junto)
ALTER TABLE public.commissions
  DROP COLUMN IF EXISTS rate_percent,
  DROP COLUMN IF EXISTS source,
  DROP COLUMN IF EXISTS sale_event_id;

-- Grants: volta ao table-level anterior
GRANT INSERT, UPDATE ON public.commissions TO authenticated, service_role;

COMMIT;
