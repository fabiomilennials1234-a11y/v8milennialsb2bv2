-- 20260608000007_followup_classifier_auto_refresh.sql
-- Auto-refresh the AI Stage Classifier when an org's funnel changes (#745).
-- Debounced: a trigger on pipeline_stages marks the org dirty; a 5-min cron
-- reclassifies orgs idle >= 5 min, then dequeues. Mirrors the prod-applied DDL.
-- NOTE: the classifier upsert overwrites trigger_stage_keys — manual org
-- overrides are not yet preserved across an auto-refresh (follow-up).

CREATE TABLE IF NOT EXISTS public.followup_reclassify_queue (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  queued_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.followup_reclassify_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON public.followup_reclassify_queue
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.queue_followup_reclassify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid;
BEGIN
  org := COALESCE(NEW.organization_id, OLD.organization_id);
  IF org IS NOT NULL THEN
    INSERT INTO public.followup_reclassify_queue (organization_id, queued_at)
    VALUES (org, now())
    ON CONFLICT (organization_id) DO UPDATE SET queued_at = now();
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$;

DROP TRIGGER IF EXISTS trg_queue_followup_reclassify ON public.pipeline_stages;
CREATE TRIGGER trg_queue_followup_reclassify
  AFTER INSERT OR UPDATE OR DELETE ON public.pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION public.queue_followup_reclassify();

CREATE OR REPLACE FUNCTION public.invoke_followup_reclassify()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE secret_val text; org_row record;
BEGIN
  SELECT value INTO secret_val FROM public.cron_config WHERE key = 'cron_secret';
  FOR org_row IN
    SELECT organization_id FROM public.followup_reclassify_queue
    WHERE queued_at < now() - interval '5 minutes' LIMIT 20
  LOOP
    PERFORM net.http_post(
      url := 'https://jsjsmuncfkbsbzqzqhfq.supabase.co/functions/v1/classify-followup-stages',
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret', COALESCE(secret_val,'')),
      body := jsonb_build_object('organization_id', org_row.organization_id)
    );
    DELETE FROM public.followup_reclassify_queue WHERE organization_id = org_row.organization_id;
  END LOOP;
EXCEPTION WHEN OTHERS THEN NULL;
END; $$;

SELECT cron.schedule('followup-reclassify', '*/5 * * * *', $$SELECT public.invoke_followup_reclassify()$$);
