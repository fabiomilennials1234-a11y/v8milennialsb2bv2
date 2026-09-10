BEGIN;

-- ADR-0034: `pipelines` is the single funnel registry. Older seeded funnels
-- could still carry their technical seed in `pipelines.name`, while the name
-- chosen by the organization lived only in `pipeline_display_config`.
UPDATE public.pipelines AS pipeline
   SET name = btrim(config.display_name),
       updated_at = now()
  FROM public.pipeline_display_config AS config
 WHERE pipeline.organization_id = config.organization_id
   AND pipeline.slug = config.pipe_type
   AND NULLIF(btrim(config.display_name), '') IS NOT NULL
   AND pipeline.name IS DISTINCT FROM btrim(config.display_name);

-- Keep the old display registry as a write-through compatibility mirror. New
-- code writes only `pipelines.name`; old readers cannot drift while they are
-- being retired.
CREATE OR REPLACE FUNCTION public.sync_pipeline_name_to_legacy_display()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.pipeline_display_config
     SET display_name = NEW.name,
         updated_at = now()
   WHERE organization_id = NEW.organization_id
     AND pipe_type = NEW.slug
     AND display_name IS DISTINCT FROM NEW.name;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_pipeline_name_to_legacy_display()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_sync_pipeline_name_to_legacy_display
  ON public.pipelines;
CREATE TRIGGER trg_sync_pipeline_name_to_legacy_display
AFTER UPDATE OF name ON public.pipelines
FOR EACH ROW
WHEN (OLD.name IS DISTINCT FROM NEW.name)
EXECUTE FUNCTION public.sync_pipeline_name_to_legacy_display();

-- Transfer history keeps snapshots by design. Correct snapshots produced by
-- the former split-name model once; later renames continue preserving the name
-- that was current when each new event happened.
UPDATE public.pipeline_stage_events AS event
   SET from_pipeline_name = pipeline.name
  FROM public.pipelines AS pipeline
 WHERE event.from_pipeline_id = pipeline.id
   AND event.organization_id = pipeline.organization_id
   AND event.from_pipeline_name IS DISTINCT FROM pipeline.name;

UPDATE public.pipeline_stage_events AS event
   SET to_pipeline_name = pipeline.name
  FROM public.pipelines AS pipeline
 WHERE event.pipeline_id = pipeline.id
   AND event.organization_id = pipeline.organization_id
   AND event.to_pipeline_name IS DISTINCT FROM pipeline.name;

-- The old client-side move log embedded the three technical seeds in prose.
-- Replace only that exact sentence fragment and only through the matching
-- pipeline of the same organization.
WITH aliases(slug, old_name) AS (
  VALUES
    ('whatsapp'::text, 'Qualificação'::text),
    ('confirmacao'::text, 'Confirmação'::text),
    ('propostas'::text, 'Propostas'::text)
)
UPDATE public.lead_history AS history
   SET description = replace(
     history.description,
     'no funil ' || aliases.old_name,
     'no funil ' || pipeline.name
   )
  FROM aliases
  JOIN public.pipelines AS pipeline
    ON pipeline.slug = aliases.slug
 WHERE history.organization_id = pipeline.organization_id
   AND history.action = 'stage_changed'
   AND history.description LIKE '%no funil ' || aliases.old_name || '%'
   AND pipeline.name IS DISTINCT FROM aliases.old_name;

COMMIT;
