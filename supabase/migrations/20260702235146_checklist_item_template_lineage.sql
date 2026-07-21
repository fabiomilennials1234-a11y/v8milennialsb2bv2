-- Reconciliado do ledger de PROD (schema_migrations) na faxina A2 — aplicado out-of-band, arquivo-fonte ausente.
-- version: 20260702235146  name: checklist_item_template_lineage
-- NÃO re-aplicar cegamente: prod JÁ tem isto. Fonte-da-verdade histórica.

-- ADR-0016: Checklist Items carry stable lineage back to the template item.
ALTER TABLE public.checklist_items
  ADD COLUMN IF NOT EXISTS template_item_id uuid
  REFERENCES public.checklist_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_checklist_items_template_item_id
  ON public.checklist_items(template_item_id)
  WHERE template_item_id IS NOT NULL;

-- Backfill existing lead items by (title, position) within source_template_id.
UPDATE public.checklist_items ci
SET template_item_id = ti.id
FROM public.checklists cl
JOIN public.checklist_items ti
  ON ti.checklist_id = cl.source_template_id
WHERE ci.checklist_id = cl.id
  AND cl.source_template_id IS NOT NULL
  AND cl.lead_id IS NOT NULL
  AND ci.template_item_id IS NULL
  AND ti.title = ci.title
  AND ti.position = ci.position;

-- Stage trigger stamps lineage on copied items (based on current prod nested-IF def).
CREATE OR REPLACE FUNCTION public.apply_stage_checklist()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_template_id uuid;
  v_stage_org_id uuid;
  v_new_checklist_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF TG_TABLE_NAME = 'pipeline_entries' THEN
      IF NEW.stage_key IS NOT DISTINCT FROM OLD.stage_key THEN
        RETURN NEW;
      END IF;
    END IF;
    IF TG_TABLE_NAME = 'custom_pipe_entries' THEN
      IF NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'pipeline_entries' THEN
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

  IF v_template_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_stage_org_id IS NULL OR v_stage_org_id <> NEW.organization_id THEN
    RETURN NEW;
  END IF;

  IF NEW.lead_id IS NULL THEN
    RETURN NEW;
  END IF;

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

  IF v_new_checklist_id IS NOT NULL THEN
    INSERT INTO public.checklist_items (checklist_id, title, position, template_item_id)
    SELECT v_new_checklist_id, ci.title, ci.position, ci.id
    FROM public.checklist_items ci
    WHERE ci.checklist_id = v_template_id
    ORDER BY ci.position;
  END IF;

  RETURN NEW;
END;
$function$;
