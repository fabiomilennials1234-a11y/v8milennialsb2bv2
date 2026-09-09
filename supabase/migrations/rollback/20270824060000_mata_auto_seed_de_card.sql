-- Rollback de 20270824060000_mata_auto_seed_de_card.sql
-- Recria o CONSTRAINT TRIGGER exatamente como estava em produção antes do corte
-- (definição lida de pg_get_triggerdef em 2026-08-24).
CREATE CONSTRAINT TRIGGER trg_auto_assign_lead_default_pipe
  AFTER INSERT ON public.leads
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_auto_assign_lead_default_pipe();
