DROP TRIGGER IF EXISTS relacao_after_stage ON public.pipeline_stages;
CREATE TRIGGER relacao_after_stage
AFTER INSERT OR UPDATE OR DELETE ON public.pipeline_stages
FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_lead_relacao();
