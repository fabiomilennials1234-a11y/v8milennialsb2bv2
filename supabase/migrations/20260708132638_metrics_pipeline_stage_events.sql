-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260708132638  name: metrics_pipeline_stage_events
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

-- 20270302000010 (#992, ADR-0017 write-model)
CREATE TABLE public.pipeline_stage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  pipeline_id uuid NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
  entry_id uuid,
  from_stage_key text,
  to_stage_key text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor uuid,
  source text NOT NULL DEFAULT 'trigger'
    CONSTRAINT pipeline_stage_events_source_check CHECK (source IN ('trigger','backfill')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pipeline_stage_events_real_transition CHECK (from_stage_key IS DISTINCT FROM to_stage_key)
);
COMMENT ON TABLE public.pipeline_stage_events IS 'ADR-0017 / #992 — caderno append-only de transições de stage_key em pipeline_entries. Fonte ÚNICA de métricas de funil (SP-3). Nunca sofre UPDATE/DELETE (trigger de imutabilidade); correção = evento novo.';

CREATE INDEX idx_pipeline_stage_events_org_occurred ON public.pipeline_stage_events (organization_id, occurred_at);
CREATE INDEX idx_pipeline_stage_events_org_pipeline_occurred ON public.pipeline_stage_events (organization_id, pipeline_id, occurred_at);
CREATE INDEX idx_pipeline_stage_events_lead ON public.pipeline_stage_events (lead_id, occurred_at DESC);
CREATE INDEX idx_pipeline_stage_events_entry ON public.pipeline_stage_events (entry_id) WHERE entry_id IS NOT NULL;

ALTER TABLE public.pipeline_stage_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY pipeline_stage_events_select ON public.pipeline_stage_events
  FOR SELECT TO authenticated USING (organization_id IN (SELECT public.get_my_organization_ids()));

REVOKE ALL ON public.pipeline_stage_events FROM PUBLIC;
REVOKE ALL ON public.pipeline_stage_events FROM anon;
REVOKE ALL ON public.pipeline_stage_events FROM authenticated;
REVOKE ALL ON public.pipeline_stage_events FROM service_role;
GRANT SELECT ON public.pipeline_stage_events TO authenticated;
GRANT SELECT ON public.pipeline_stage_events TO service_role;

CREATE FUNCTION public.fn_pipeline_stage_events_block_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'pipeline_stage_events é append-only (ADR-0017): UPDATE proibido — corrija com evento novo' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.leads WHERE id = OLD.lead_id)
     AND EXISTS (SELECT 1 FROM public.organizations WHERE id = OLD.organization_id)
     AND EXISTS (SELECT 1 FROM public.pipelines WHERE id = OLD.pipeline_id) THEN
    RAISE EXCEPTION 'pipeline_stage_events é append-only (ADR-0017): DELETE proibido — eventos só caem em cascade de lead/pipeline/org' USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_pipeline_stage_events_block_mutation() FROM PUBLIC;
CREATE TRIGGER trg_pipeline_stage_events_immutable
  BEFORE UPDATE OR DELETE ON public.pipeline_stage_events
  FOR EACH ROW EXECUTE FUNCTION public.fn_pipeline_stage_events_block_mutation();

CREATE FUNCTION public.fn_capture_pipeline_stage_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.pipeline_stage_events
    (organization_id, lead_id, pipeline_id, entry_id, from_stage_key, to_stage_key, occurred_at, actor, source)
  VALUES
    (NEW.organization_id, NEW.lead_id, NEW.pipeline_id, NEW.id,
     CASE WHEN TG_OP = 'UPDATE' THEN OLD.stage_key END,
     NEW.stage_key, now(), auth.uid(), 'trigger');
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.fn_capture_pipeline_stage_event() FROM PUBLIC;
CREATE TRIGGER trg_pipeline_entries_stage_event_insert
  AFTER INSERT ON public.pipeline_entries
  FOR EACH ROW WHEN (NEW.lead_id IS NOT NULL)
  EXECUTE FUNCTION public.fn_capture_pipeline_stage_event();
CREATE TRIGGER trg_pipeline_entries_stage_event_update
  AFTER UPDATE OF stage_key ON public.pipeline_entries
  FOR EACH ROW WHEN (OLD.stage_key IS DISTINCT FROM NEW.stage_key AND NEW.lead_id IS NOT NULL)
  EXECUTE FUNCTION public.fn_capture_pipeline_stage_event();

-- Backfill Part A — structured lead_history stage_changed
INSERT INTO public.pipeline_stage_events
  (organization_id, lead_id, pipeline_id, entry_id, from_stage_key, to_stage_key, occurred_at, actor, source)
SELECT
  lh.organization_id, lh.lead_id, (lh.metadata->>'pipeline_id')::uuid, pe.id,
  NULLIF(lh.metadata->>'from_stage',''), lh.metadata->>'to_stage', lh.created_at, lh.created_by, 'backfill'
FROM public.lead_history lh
JOIN public.pipelines p ON p.id = (lh.metadata->>'pipeline_id')::uuid
JOIN public.leads l ON l.id = lh.lead_id
LEFT JOIN public.pipeline_entries pe ON pe.pipeline_id = (lh.metadata->>'pipeline_id')::uuid AND pe.lead_id = lh.lead_id
WHERE lh.action = 'stage_changed'
  AND lh.organization_id IS NOT NULL
  AND COALESCE(lh.metadata->>'to_stage','') <> ''
  AND (lh.metadata->>'pipeline_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND NULLIF(lh.metadata->>'from_stage','') IS DISTINCT FROM (lh.metadata->>'to_stage');

-- Backfill Part B — terminal alignment with live kanban state
INSERT INTO public.pipeline_stage_events
  (organization_id, lead_id, pipeline_id, entry_id, from_stage_key, to_stage_key, occurred_at, actor, source)
SELECT
  pe.organization_id, pe.lead_id, pe.pipeline_id, pe.id, le.to_stage_key, pe.stage_key,
  GREATEST(COALESCE(pe.stage_changed_at, pe.entered_at, pe.created_at), COALESCE(le.occurred_at, '-infinity'::timestamptz)),
  NULL, 'backfill'
FROM public.pipeline_entries pe
LEFT JOIN LATERAL (
  SELECT e.to_stage_key, e.occurred_at FROM public.pipeline_stage_events e
  WHERE e.pipeline_id = pe.pipeline_id AND e.lead_id = pe.lead_id
  ORDER BY e.occurred_at DESC, e.created_at DESC LIMIT 1
) le ON true
WHERE pe.lead_id IS NOT NULL
  AND (le.to_stage_key IS NULL OR le.to_stage_key IS DISTINCT FROM pe.stage_key);
