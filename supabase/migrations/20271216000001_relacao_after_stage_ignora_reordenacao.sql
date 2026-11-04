-- Reordenar etapas (UPDATE de position/updated_at) disparava, por etapa, o
-- refresh de relacao_negocios de TODOS os leads do funil (FOR UPDATE + cálculo
-- por lead). Funil com ~600 leads x ~17 etapas estourava o statement_timeout
-- de 15s do `authenticated` -> "Erro ao reordenar etapas" (Chique Distribuidora).
-- relacao_negocios() só lê stage_role, is_active, stage_key e pipeline_id da
-- etapa; position/name/color não alteram o resultado. UPDATE OF restringe o
-- disparo às colunas que importam (INSERT/DELETE seguem iguais).
DROP TRIGGER IF EXISTS relacao_after_stage ON public.pipeline_stages;
CREATE TRIGGER relacao_after_stage
AFTER INSERT OR DELETE OR UPDATE OF stage_role, is_active, stage_key, pipeline_id, organization_id
ON public.pipeline_stages
FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_lead_relacao();
