-- Persist the relation on leads so PostgREST filters use a column and existing lead RLS.
-- Schema only; initialize existing rows with the separate backfill script.
BEGIN;
ALTER TABLE public.leads ADD COLUMN relacao_negocios text NOT NULL DEFAULT 'lead'
  CHECK (relacao_negocios IN ('lead','cliente','perdido'));
CREATE INDEX idx_leads_org_relacao ON public.leads (organization_id,relacao_negocios);

-- Server-owned projection: even direct client writes are recomputed, never trusted.
CREATE FUNCTION public.trg_lead_relacao_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  NEW.relacao_negocios := public.relacao_negocios(NEW);
  RETURN NEW;
END;
$$;
CREATE TRIGGER lead_relacao_guard BEFORE INSERT OR UPDATE OF relacao_negocios,organization_id
ON public.leads FOR EACH ROW EXECUTE FUNCTION public.trg_lead_relacao_guard();

CREATE FUNCTION public.refresh_lead_relacao(p_org uuid,p_lead uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_relacao text;
BEGIN
  IF p_lead IS NULL OR p_org IS NULL THEN RETURN; END IF;
  -- Serialize concurrent changes to different deals of the same lead.
  PERFORM 1 FROM public.leads WHERE id=p_lead AND organization_id=p_org FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT public.relacao_negocios(l) INTO v_relacao FROM public.leads l
  WHERE l.id=p_lead AND l.organization_id=p_org;
  UPDATE public.leads SET relacao_negocios=v_relacao
  WHERE id=p_lead AND organization_id=p_org AND relacao_negocios IS DISTINCT FROM v_relacao;
END;
$$;

CREATE FUNCTION public.trg_refresh_lead_relacao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE row_data jsonb; v_org uuid; v_lead uuid; v record;
BEGIN
  -- Both old and new links matter for deletes, reassignment and reversals.
  FOR row_data IN SELECT value FROM jsonb_array_elements(
    CASE TG_OP WHEN 'INSERT' THEN jsonb_build_array(to_jsonb(NEW))
      WHEN 'DELETE' THEN jsonb_build_array(to_jsonb(OLD))
      ELSE jsonb_build_array(to_jsonb(OLD),to_jsonb(NEW)) END
  ) LOOP
    v_org := (row_data->>'organization_id')::uuid;
    IF TG_TABLE_NAME IN ('pipelines','pipeline_stages') THEN
      FOR v IN SELECT DISTINCT pe.lead_id FROM public.pipeline_entries pe
        WHERE pe.organization_id=v_org AND pe.pipeline_id=
          CASE WHEN TG_TABLE_NAME='pipelines' THEN (row_data->>'id')::uuid
            ELSE (row_data->>'pipeline_id')::uuid END
        ORDER BY pe.lead_id
      LOOP PERFORM public.refresh_lead_relacao(v_org,v.lead_id); END LOOP;
    ELSE
      v_lead := CASE WHEN TG_TABLE_NAME='deals' THEN (row_data->>'source_lead_id')::uuid
        ELSE (row_data->>'lead_id')::uuid END;
      PERFORM public.refresh_lead_relacao(v_org,v_lead);
      IF TG_TABLE_NAME='deals' THEN
        FOR v IN SELECT DISTINCT pe.lead_id FROM public.pipeline_entries pe
          WHERE pe.organization_id=v_org AND pe.deal_id=(row_data->>'id')::uuid
          AND pe.lead_id IS DISTINCT FROM v_lead ORDER BY pe.lead_id
        LOOP PERFORM public.refresh_lead_relacao(v_org,v.lead_id); END LOOP;
      ELSIF TG_TABLE_NAME='sale_events' AND row_data->>'reversed_event_id' IS NOT NULL THEN
        FOR v IN SELECT s.lead_id FROM public.sale_events s
          WHERE s.organization_id=v_org AND s.id=(row_data->>'reversed_event_id')::uuid
        LOOP PERFORM public.refresh_lead_relacao(v_org,v.lead_id); END LOOP;
      END IF;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;
CREATE TRIGGER relacao_after_deal AFTER INSERT OR UPDATE OR DELETE ON public.deals
FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_lead_relacao();
CREATE TRIGGER relacao_after_entry AFTER INSERT OR UPDATE OR DELETE ON public.pipeline_entries
FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_lead_relacao();
CREATE TRIGGER relacao_after_sale AFTER INSERT OR UPDATE OR DELETE ON public.sale_events
FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_lead_relacao();
CREATE TRIGGER relacao_after_pipeline AFTER UPDATE OF is_active OR DELETE ON public.pipelines
FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_lead_relacao();
CREATE TRIGGER relacao_after_stage AFTER INSERT OR UPDATE OR DELETE ON public.pipeline_stages
FOR EACH ROW EXECUTE FUNCTION public.trg_refresh_lead_relacao();
REVOKE ALL ON FUNCTION public.trg_lead_relacao_guard() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.refresh_lead_relacao(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.trg_refresh_lead_relacao() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_lead_relacao(uuid,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
