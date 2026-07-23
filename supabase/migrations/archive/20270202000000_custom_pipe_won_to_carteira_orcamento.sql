-- 20270202000000_custom_pipe_won_to_carteira_orcamento.sql
-- Auto-create a carteira (upsell_clients) record when a lead reaches a "won"
-- (is_final_positive) stage of the Milennials "Orçamento" CUSTOM pipeline.
--
-- SCOPE = variant A (pipeline-scoped; approved by user 2026-07-08):
--   Fires ONLY for custom_pipe_entries in pipeline
--   21ada19b-bcb9-428b-a5bd-99f19e89f6ad (org Milennials 6030520a-...).
--   No other org / pipeline / stage is affected. Activates on apply with NO
--   data change (the "Vendido" stage already has is_final_positive = true).
--   If the Orçamento pipeline is ever deleted and rebuilt its id changes and
--   this trigger stops firing — re-point NEW.pipeline_id then.
--
-- Mirrors ONLY the client-creation half of public.handle_proposta_vendida()
-- (identity fields). Custom pipes have no proposta_items / sale value, so this
-- writes NO upsell_orders / upsell_client_products / upsell_campanhas — revenue
-- KPIs and the approved-order cron are intentionally untouched.

CREATE OR REPLACE FUNCTION public.handle_custom_pipe_won()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_stage        RECORD;
  v_lead         RECORD;
  v_org_id       UUID;
  v_name         TEXT;
  v_closer_id    UUID;
  v_first_sale   TIMESTAMPTZ;
  v_lock_key     BIGINT;
BEGIN
  -- SCOPE GATE (variant A): only the Milennials "Orçamento" custom pipeline.
  IF NEW.pipeline_id <> '21ada19b-bcb9-428b-a5bd-99f19e89f6ad' THEN
    RETURN NEW;
  END IF;

  -- React only to real stage moves. Trigger is AFTER UPDATE OF stage_id, but
  -- guard anyway so a same-stage re-write is a no-op.
  IF TG_OP = 'UPDATE' AND NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN
    RETURN NEW;
  END IF;

  -- MULTI-TENANT SAFETY: org_id comes ONLY from the entry row. Never derive it
  -- from the lead. Do not remove this.
  v_org_id := NEW.organization_id;
  IF v_org_id IS NULL OR NEW.lead_id IS NULL OR NEW.stage_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Destination stage, scoped to the entry's org (defense in depth).
  SELECT s.is_final_positive
    INTO v_stage
    FROM public.custom_pipeline_stages s
   WHERE s.id = NEW.stage_id
     AND s.organization_id = v_org_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Gate: only a "won" (is_final_positive) stage creates a carteira client.
  IF COALESCE(v_stage.is_final_positive, false) = false THEN
    RETURN NEW;
  END IF;

  -- Serialize concurrent moves of the same entry so we never double-insert.
  v_lock_key := ('x' || left(replace(NEW.id::text, '-', ''), 15))::bit(60)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Lead identity, same-org. A NULL-org lead is accepted (leads.organization_id
  -- is nullable in PROD); a lead whose org is present AND different is a genuine
  -- cross-tenant anomaly and is excluded. Never drop the org predicate (that
  -- would allow cross-tenant reads of name/company/email/phone).
  SELECT l.name, l.company, l.email, l.phone, l.closer_id
    INTO v_lead
    FROM public.leads l
   WHERE l.id = NEW.lead_id
     AND (l.organization_id IS NULL OR l.organization_id = v_org_id);

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- upsell_clients.name is NOT NULL -> fall back if the lead has no name.
  v_name := COALESCE(NULLIF(btrim(v_lead.name), ''), 'Cliente sem nome');

  -- CROSS-TENANT GUARD on closer_id: sale_responsible_id / lead.closer_id /
  -- assigned_to all FK team_members(id) but the FK does NOT enforce same-org.
  -- This SECURITY DEFINER insert bypasses upsell_clients RLS, so this org-check
  -- is the only guard: pick the first candidate that belongs to this org, else
  -- leave NULL (column is nullable, ON DELETE SET NULL).
  SELECT tm.id
    INTO v_closer_id
    FROM public.team_members tm
   WHERE tm.id = ANY (ARRAY[NEW.sale_responsible_id, v_lead.closer_id, NEW.assigned_to]::uuid[])
     AND tm.organization_id = v_org_id
   ORDER BY array_position(
     ARRAY[NEW.sale_responsible_id, v_lead.closer_id, NEW.assigned_to]::uuid[], tm.id)
   LIMIT 1;

  -- Close moment, not trigger moment (parity with handle_proposta_vendida's
  -- COALESCE(closed_at, now())): correct for bulk / import rows landing directly
  -- in the won stage on INSERT. Feeds tenure / time-bucket semantics.
  v_first_sale := COALESCE(NEW.stage_changed_at, NEW.entered_at, now());

  -- INSERT identity + seed last_order_at ON FIRST CREATE ONLY. Seeding it (not
  -- on conflict) stops a just-won client from being born "999 dias / recompra
  -- atrasada / em risco": calculate-portfolio-health reads last_order_at IS NULL
  -- as days_since=999 and flips overdue KPIs / fires a critical reorder alert.
  -- We still write NO upsell_orders row (revenue KPIs untouched). On CONFLICT we
  -- only bump updated_at and never reset last_order_at / first_sale_at.
  INSERT INTO public.upsell_clients (
    organization_id, lead_id, name, company, email, phone,
    closer_id, first_sale_at, last_order_at
  ) VALUES (
    v_org_id, NEW.lead_id, v_name, v_lead.company,
    v_lead.email, v_lead.phone, v_closer_id, v_first_sale, now()
  )
  ON CONFLICT (organization_id, lead_id) DO UPDATE
    SET updated_at = now();

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_custom_pipe_won ON public.custom_pipe_entries;

CREATE TRIGGER trg_custom_pipe_won
  AFTER INSERT OR UPDATE OF stage_id ON public.custom_pipe_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_custom_pipe_won();
