-- ROLLBACK de 20270302000090_stage_role_money_guard_and_fn_hardening.sql
--
-- Reverte FIX-4 (trigger de gate won/lost) e FIX-5a (search_path em
-- fn_sale_events_force_sold_at) ao estado anterior. FIX-5b (get_funnel_flow
-- guard-first) e FIX-6 (COMMENTs) NÃO são revertidos aqui de propósito:
--   · get_funnel_flow: a mudança é só a ORDEM do assert_org_access (guard-first,
--     mais seguro). Reverter reintroduziria a inconsistência sem ganho — o corpo
--     canônico vive em 20270302000060; reaplicar aquela migration restaura o
--     original bit-a-bit se de fato necessário.
--   · COMMENTs: metadados; reverter re-afirmaria a alegação exagerada de
--     cobertura custom. Deixados como estão (forward-only).
--
-- ATENÇÃO SEGURANÇA: dropar o trigger FIX-4 reabre o buraco — qualquer membro
-- volta a poder gravar stage_role won/lost (inflar receita + auto-creditar
-- comissão dentro do tenant). Só role em ambiente sem esse risco.

BEGIN;

-- FIX-4 — gate de won/lost
DROP TRIGGER IF EXISTS trg_pipeline_stages_won_lost_guard ON public.pipeline_stages;
DROP FUNCTION IF EXISTS public.fn_pipeline_stages_guard_money_role();

-- FIX-5a — restaura fn_sale_events_force_sold_at SEM search_path (estado do
-- 20270302000030). Corpo idêntico; só remove o SET search_path.
CREATE OR REPLACE FUNCTION public.fn_sale_events_force_sold_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.source = 'trigger' THEN
    NEW.sold_at := now();
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
