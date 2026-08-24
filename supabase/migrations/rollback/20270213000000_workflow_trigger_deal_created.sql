-- Rollback de 20270213000000_workflow_trigger_deal_created.sql
DROP TRIGGER IF EXISTS trg_workflow_deal_created ON public.deals;
DROP FUNCTION IF EXISTS public.trigger_workflow_deal_created();
