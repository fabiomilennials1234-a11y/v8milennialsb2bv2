-- Rollback de 20280120010000: volta o gatilho a escutar só as colunas legadas.
CREATE OR REPLACE TRIGGER trg_workflow_lead_assigned
  AFTER UPDATE OF sdr_id, closer_id
  ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_workflow_lead_assigned();

DELETE FROM supabase_migrations.schema_migrations WHERE version = '20280120010000';
