-- 20260521120000_stage_auto_checklist.sql
-- Auto-apply checklist template when lead enters a stage configured with one.
-- Spec: docs/superpowers/specs/2026-05-21-stage-auto-checklist-design.md

-- 1. Stage points to template (1:1)
ALTER TABLE public.pipeline_stages
  ADD COLUMN IF NOT EXISTS checklist_template_id uuid
  REFERENCES public.checklists(id) ON DELETE SET NULL;

ALTER TABLE public.custom_pipeline_stages
  ADD COLUMN IF NOT EXISTS checklist_template_id uuid
  REFERENCES public.checklists(id) ON DELETE SET NULL;

-- 2. Checklist tracks origin template (for idempotence + audit)
ALTER TABLE public.checklists
  ADD COLUMN IF NOT EXISTS source_template_id uuid
  REFERENCES public.checklists(id) ON DELETE SET NULL;

-- 3. Idempotence: 1 checklist per (lead, template)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_checklists_lead_source
  ON public.checklists(lead_id, source_template_id)
  WHERE source_template_id IS NOT NULL AND lead_id IS NOT NULL;

-- 4. Trigger function
CREATE OR REPLACE FUNCTION public.apply_stage_checklist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_template_id uuid;
  v_stage_org_id uuid;
  v_new_checklist_id uuid;
BEGIN
  -- No-op if UPDATE didn't actually change the stage column
  IF TG_OP = 'UPDATE' THEN
    IF TG_TABLE_NAME = 'pipeline_entries' AND NEW.stage_key IS NOT DISTINCT FROM OLD.stage_key THEN
      RETURN NEW;
    ELSIF TG_TABLE_NAME = 'custom_pipe_entries' AND NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Lookup template + org for destination stage
  IF TG_TABLE_NAME = 'pipeline_entries' THEN
    -- pipeline_stages keyed by (organization_id, pipeline_type, stage_key).
    -- pipelines.slug holds the value that matches pipeline_stages.pipeline_type
    -- (confirmed: 'whatsapp' / 'confirmacao' / 'propostas' / 'upsell_base' / 'upsell_gestao').
    SELECT ps.checklist_template_id, ps.organization_id
      INTO v_template_id, v_stage_org_id
    FROM public.pipeline_stages ps
    JOIN public.pipelines p ON p.id = NEW.pipeline_id
    WHERE ps.organization_id = NEW.organization_id
      AND ps.pipeline_type = p.slug
      AND ps.stage_key = NEW.stage_key
      AND ps.is_active = true
    LIMIT 1;
  ELSIF TG_TABLE_NAME = 'custom_pipe_entries' THEN
    SELECT cps.checklist_template_id, cps.organization_id
      INTO v_template_id, v_stage_org_id
    FROM public.custom_pipeline_stages cps
    WHERE cps.id = NEW.stage_id
    LIMIT 1;
  END IF;

  -- No template configured for the destination stage → no-op
  IF v_template_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Cross-org safety
  IF v_stage_org_id IS NULL OR v_stage_org_id <> NEW.organization_id THEN
    RETURN NEW;
  END IF;

  -- No lead_id → can't apply (defensive; should not happen for pipeline_entries)
  IF NEW.lead_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Insert checklist from template, idempotent via unique partial index
  INSERT INTO public.checklists (
    organization_id, lead_id, source_template_id, title, description, created_by
  )
  SELECT t.organization_id, NEW.lead_id, t.id, t.title, t.description, NULL
  FROM public.checklists t
  WHERE t.id = v_template_id
    AND t.lead_id IS NULL
    AND t.organization_id = NEW.organization_id
  ON CONFLICT (lead_id, source_template_id)
    WHERE source_template_id IS NOT NULL AND lead_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_new_checklist_id;

  -- Copy items only if a new checklist was actually inserted
  IF v_new_checklist_id IS NOT NULL THEN
    INSERT INTO public.checklist_items (checklist_id, title, position)
    SELECT v_new_checklist_id, ci.title, ci.position
    FROM public.checklist_items ci
    WHERE ci.checklist_id = v_template_id
    ORDER BY ci.position;
  END IF;

  RETURN NEW;
END;
$$;

-- 5. Triggers (idempotent: drop then create)
DROP TRIGGER IF EXISTS trg_apply_stage_checklist_pipeline ON public.pipeline_entries;
CREATE TRIGGER trg_apply_stage_checklist_pipeline
  AFTER INSERT OR UPDATE OF stage_key ON public.pipeline_entries
  FOR EACH ROW EXECUTE FUNCTION public.apply_stage_checklist();

DROP TRIGGER IF EXISTS trg_apply_stage_checklist_custom ON public.custom_pipe_entries;
CREATE TRIGGER trg_apply_stage_checklist_custom
  AFTER INSERT OR UPDATE OF stage_id ON public.custom_pipe_entries
  FOR EACH ROW EXECUTE FUNCTION public.apply_stage_checklist();

-- 6. Realtime publication: enable checklists + checklist_items so UI sees auto-created items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'checklists'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.checklists;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'checklist_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.checklist_items;
  END IF;
END $$;
