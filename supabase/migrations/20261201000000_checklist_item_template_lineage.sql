-- 20261201000000_checklist_item_template_lineage.sql
-- ADR-0016: Checklist Items carry stable lineage back to the template item they
-- were copied from. This is the identity a Workflow node uses to address "this
-- specific item" across the template->lead copy, since the copy's own id is only
-- minted at apply time (title/position matching is unstable under rename/reorder).
--
-- Scope: schema column + backfill of existing lead items + updated stage trigger.
-- No RLS change: checklist_items inherits its existing policies; this is one more
-- nullable column on an already-protected table.

-- 1. Lineage column: a lead item points at the template item it descends from.
--    Template items (lead's checklist has lead_id set; template has lead_id NULL)
--    keep this NULL. Self-referencing FK; ON DELETE SET NULL so deleting a template
--    item never cascades into lead data — the lead item just loses its lineage
--    (node then no-ops on it, logged), never disappears.
ALTER TABLE public.checklist_items
  ADD COLUMN IF NOT EXISTS template_item_id uuid
  REFERENCES public.checklist_items(id) ON DELETE SET NULL;

-- Lookup index: the marker node resolves lead items by (checklist scope) +
-- template_item_id. Partial — only lead items ever carry lineage.
CREATE INDEX IF NOT EXISTS idx_checklist_items_template_item_id
  ON public.checklist_items(template_item_id)
  WHERE template_item_id IS NOT NULL;

-- 2. Backfill existing lead items. Best-effort (title, position) match against the
--    origin template's items, scoped through checklists.source_template_id. Items
--    renamed/reordered before this migration may not match and stay NULL — an
--    accepted one-time imprecision bounded to pre-existing data (ADR-0016).
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

-- 3. Stage auto-attach trigger must now stamp lineage on the items it copies.
--    CREATE OR REPLACE of apply_stage_checklist — based on the CURRENT prod
--    definition (20261032000003_fix_apply_stage_checklist_field_resolution: nested
--    IFs so pipeline_entries stage moves don't crash on the missing stage_id field)
--    with the single change: the item-copy INSERT carries ci.id into template_item_id.
--    Preserving the nested-IF structure is load-bearing — the compound ELSIF form
--    from the original 20260521120000 reintroduces that crash.
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

  -- Copy items only if a new checklist was actually inserted, stamping lineage
  -- (ci.id -> template_item_id) so the workflow marker node can address them.
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
