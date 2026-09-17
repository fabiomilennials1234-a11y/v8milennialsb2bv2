-- Local draft foundation only. No ERP writes, activation, existing-data updates,
-- sales events, catalog seeds or changes to the current Toth read integration.
-- Intentional membership-only API (reviewed master-ghost baseline exceptions):
-- toth_order_can_read, toth_order_preparer_access, toth_order_workspace and
-- toth_set_order_preparer require an ACTIVE membership in the pilot organization.
-- Global master status is not an ERP operator permission. A master who is also
-- an active org admin follows the same admin gates; a master with only member
-- access still needs the preparer grant and cannot review/send. This implements
-- the approved organization-admin scope without creating a cross-tenant bypass.
BEGIN;

CREATE SCHEMA IF NOT EXISTS toth_order_private;
REVOKE ALL ON SCHEMA toth_order_private FROM PUBLIC, anon, authenticated;

CREATE TABLE public.toth_order_catalog_items (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  product_external_id text NOT NULL CHECK (length(product_external_id) BETWEEN 1 AND 128
    AND product_external_id = btrim(product_external_id) AND product_external_id !~ '[[:cntrl:]]'),
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 500),
  active boolean NOT NULL DEFAULT true,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, product_external_id),
  CHECK (organization_id = '4922638c-4909-494e-ba10-12282ec0b161'::uuid)
);
COMMENT ON TABLE public.toth_order_catalog_items IS
  'Server-fed catalog snapshot for local preparation only. Empty until a validated supplier adapter exists; never a price or commercial authorization.';

CREATE TABLE public.toth_order_preparers (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  team_member_id uuid NOT NULL REFERENCES public.team_members(id),
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, team_member_id),
  CHECK (organization_id = '4922638c-4909-494e-ba10-12282ec0b161'::uuid)
);

CREATE TABLE public.toth_order_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  deal_id uuid NOT NULL UNIQUE REFERENCES public.deals(id),
  lead_id uuid NOT NULL REFERENCES public.leads(id),
  client_id uuid NOT NULL REFERENCES public.upsell_clients(id),
  customer_external_id text NOT NULL CHECK (length(btrim(customer_external_id)) > 0),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  items jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) <= 200),
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 1000),
  reviewed_revision integer,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  CHECK (organization_id = '4922638c-4909-494e-ba10-12282ec0b161'::uuid),
  CHECK ((reviewed_revision IS NULL AND reviewed_at IS NULL)
    OR (reviewed_revision = revision AND reviewed_at IS NOT NULL))
);
COMMENT ON COLUMN public.toth_order_drafts.reviewed_revision IS
  'Acknowledgement of this local draft revision. Never authorization to send or evidence of supplier/commercial validation.';

CREATE TABLE public.toth_order_draft_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  deal_id uuid NOT NULL REFERENCES public.deals(id),
  draft_id uuid,
  revision integer,
  action text NOT NULL CHECK (action IN ('draft_created','draft_saved','draft_reviewed_locally','preparer_granted','preparer_revoked')),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  before_snapshot jsonb,
  after_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, draft_id) REFERENCES public.toth_order_drafts(organization_id, id),
  CHECK (organization_id = '4922638c-4909-494e-ba10-12282ec0b161'::uuid)
);
CREATE INDEX toth_order_draft_audit_deal_idx ON public.toth_order_draft_audit(organization_id, deal_id, created_at DESC);
CREATE INDEX toth_order_drafts_client_idx ON public.toth_order_drafts(client_id);
CREATE INDEX toth_order_drafts_lead_idx ON public.toth_order_drafts(lead_id);
CREATE INDEX toth_order_preparers_member_idx ON public.toth_order_preparers(team_member_id);

-- Require an explicit boolean organization flag. A missing flag, JSON null or
-- the string "true" must never activate this pilot. Nothing is seeded here.
CREATE FUNCTION toth_order_private.enabled(p_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_org = '4922638c-4909-494e-ba10-12282ec0b161'::uuid
    AND EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = p_org
      AND o.feature_flags->'toth_order_drafts' = 'true'::jsonb);
$$;

CREATE FUNCTION toth_order_private.context(p_deal_id uuid, p_lock boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_deal public.deals%ROWTYPE; v_admin boolean; v_prepare boolean; v_enabled boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'toth_access_denied' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_deal FROM public.deals WHERE id = p_deal_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'toth_deal_unavailable' USING ERRCODE='P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.team_members m WHERE m.organization_id = v_deal.organization_id
    AND m.user_id = auth.uid() AND m.is_active)
    OR NOT COALESCE(public.can_link_or_read_lead(v_deal.source_lead_id, v_deal.organization_id), false) THEN
    RAISE EXCEPTION 'toth_access_denied' USING ERRCODE='42501';
  END IF;
  IF p_lock THEN
    -- A caller must pass authorization before acquiring a lock on business data.
    -- Re-read and reauthorize under that lock if the deal changed meanwhile.
    SELECT * INTO v_deal FROM public.deals WHERE id = p_deal_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'toth_deal_unavailable' USING ERRCODE='P0002'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.team_members m WHERE m.organization_id = v_deal.organization_id
      AND m.user_id = auth.uid() AND m.is_active)
      OR NOT COALESCE(public.can_link_or_read_lead(v_deal.source_lead_id,v_deal.organization_id),false) THEN
      RAISE EXCEPTION 'toth_access_denied' USING ERRCODE='42501';
    END IF;
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.team_members m WHERE m.organization_id = v_deal.organization_id
    AND m.user_id = auth.uid() AND m.is_active AND m.role = 'admin') INTO v_admin;
  SELECT v_admin OR EXISTS (SELECT 1 FROM public.toth_order_preparers p
    JOIN public.team_members m ON m.id = p.team_member_id AND m.organization_id = p.organization_id
    WHERE p.organization_id = v_deal.organization_id AND m.user_id = auth.uid() AND m.is_active) INTO v_prepare;
  v_enabled := toth_order_private.enabled(v_deal.organization_id);
  RETURN jsonb_build_object('organization_id',v_deal.organization_id,'lead_id',v_deal.source_lead_id,
    'enabled',v_enabled,'can_prepare',v_prepare AND v_enabled,'can_review',v_admin AND v_enabled);
END;
$$;

-- Never use leads.erp_code (a display-only mirror) or name/phone matching as
-- authority to write. A single active Toth portfolio link is required.
CREATE FUNCTION toth_order_private.customer(p_org uuid, p_lead uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('client_id',c.id,'customer_external_id',c.external_id)
  FROM public.upsell_clients c WHERE c.organization_id = p_org AND c.lead_id = p_lead
    AND c.external_source = 'toth' AND c.is_active
    AND (SELECT count(*) FROM public.upsell_clients links WHERE links.organization_id=p_org
      AND links.lead_id=p_lead AND links.external_source='toth' AND links.is_active)=1
    AND length(btrim(c.external_id)) > 0
    AND c.external_id = btrim(c.external_id)
    AND NOT EXISTS (SELECT 1 FROM public.upsell_clients other
      WHERE other.organization_id = c.organization_id AND other.external_source = 'toth'
        AND other.external_id = c.external_id AND other.id <> c.id);
$$;

CREATE FUNCTION toth_order_private.validate_items(p_org uuid, p_items jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_item jsonb; v_quantity numeric; v_ids text[] := ARRAY[]::text[]; v_id text;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'toth_invalid_items' USING ERRCODE='22023';
  END IF;
  IF jsonb_array_length(p_items) > 200 THEN RAISE EXCEPTION 'toth_invalid_items' USING ERRCODE='22023'; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF jsonb_typeof(v_item) <> 'object' OR NOT (v_item ?& ARRAY['product_external_id','quantity'])
      OR v_item - 'product_external_id' - 'quantity' <> '{}'::jsonb
      OR jsonb_typeof(v_item->'product_external_id') <> 'string'
      OR jsonb_typeof(v_item->'quantity') <> 'number' THEN
      RAISE EXCEPTION 'toth_invalid_items' USING ERRCODE='22023';
    END IF;
    v_id := v_item->>'product_external_id';
    v_quantity := (v_item->>'quantity')::numeric;
    IF length(v_id) NOT BETWEEN 1 AND 128 OR btrim(v_id) <> v_id OR v_id ~ '[[:cntrl:]]'
      OR v_id = ANY(v_ids) OR v_quantity <= 0 OR v_quantity > 1000000000 THEN
      RAISE EXCEPTION 'toth_invalid_items' USING ERRCODE='22023';
    END IF;
    PERFORM 1 FROM public.toth_order_catalog_items c
      WHERE c.organization_id = p_org AND c.product_external_id = v_id AND c.active FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'toth_catalog_item_unavailable' USING ERRCODE='22023'; END IF;
    v_ids := array_append(v_ids,v_id);
  END LOOP;
END;
$$;

CREATE FUNCTION public.toth_order_can_read(p_deal_id uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_org uuid; v_lead uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  SELECT organization_id,source_lead_id INTO v_org,v_lead FROM public.deals
    WHERE id = p_deal_id AND deleted_at IS NULL;
  RETURN COALESCE(toth_order_private.enabled(v_org),false)
    AND EXISTS (SELECT 1 FROM public.team_members m WHERE m.organization_id=v_org AND m.user_id=auth.uid() AND m.is_active)
    AND COALESCE(public.can_link_or_read_lead(v_lead,v_org),false)
    AND NOT EXISTS (SELECT 1 FROM public.toth_order_drafts d WHERE d.deal_id=p_deal_id
      AND d.organization_id=v_org AND d.lead_id IS DISTINCT FROM v_lead);
END;
$$;

ALTER TABLE public.toth_order_catalog_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.toth_order_preparers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.toth_order_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.toth_order_draft_audit ENABLE ROW LEVEL SECURITY;
-- Catalog and grant tables are readable only through the scoped workspace/RPC.
CREATE POLICY tenant_isolation_select ON public.toth_order_drafts FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.get_my_organization_ids()) AND public.toth_order_can_read(deal_id));
CREATE POLICY tenant_isolation_select ON public.toth_order_draft_audit FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.get_my_organization_ids()) AND public.toth_order_can_read(deal_id));
REVOKE ALL ON public.toth_order_catalog_items,public.toth_order_preparers,public.toth_order_drafts,public.toth_order_draft_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.toth_order_drafts,public.toth_order_draft_audit TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.toth_order_catalog_items TO service_role;

CREATE FUNCTION public.toth_order_workspace(p_deal_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ctx jsonb; v_org uuid; v_customer jsonb; v_draft public.toth_order_drafts%ROWTYPE;
  v_catalog jsonb; v_audit jsonb; v_blockers jsonb := '["supplier_contract_unverified","homologation_unverified","commercial_validation_unavailable","writes_disabled"]'::jsonb;
BEGIN
  v_ctx := toth_order_private.context(p_deal_id);
  IF NOT (v_ctx->>'enabled')::boolean THEN
    RETURN jsonb_build_object('enabled',false,'can_prepare',false,'can_review',false,
      'draft',NULL,'audit','[]'::jsonb,'catalog','[]'::jsonb,'blockers',v_blockers || '["drafts_disabled"]'::jsonb);
  END IF;
  v_org := (v_ctx->>'organization_id')::uuid;
  v_customer := toth_order_private.customer(v_org,(v_ctx->>'lead_id')::uuid);
  SELECT * INTO v_draft FROM public.toth_order_drafts WHERE organization_id=v_org AND deal_id=p_deal_id;
  IF v_draft.id IS NOT NULL AND v_draft.lead_id IS DISTINCT FROM (v_ctx->>'lead_id')::uuid THEN
    -- A viewer of the new lead must not learn the old customer's draft or audit.
    RETURN jsonb_build_object('enabled',true,'can_prepare',false,'can_review',false,
      'draft',NULL,'audit','[]'::jsonb,'catalog','[]'::jsonb,'blockers',v_blockers || '["client_link_changed"]'::jsonb);
  END IF;
  IF v_customer IS NULL THEN v_blockers := v_blockers || '["client_link_unavailable"]'::jsonb;
  ELSIF v_draft.id IS NOT NULL AND (v_draft.lead_id IS DISTINCT FROM (v_ctx->>'lead_id')::uuid
    OR v_draft.client_id IS DISTINCT FROM (v_customer->>'client_id')::uuid
    OR v_draft.customer_external_id IS DISTINCT FROM v_customer->>'customer_external_id') THEN
    v_blockers := v_blockers || '["client_link_changed"]'::jsonb;
    v_customer := NULL;
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('product_external_id',product_external_id,'description',description)
    ORDER BY description,product_external_id),'[]'::jsonb) INTO v_catalog
    FROM public.toth_order_catalog_items WHERE organization_id=v_org AND active;
  IF jsonb_array_length(v_catalog)=0 THEN v_blockers := v_blockers || '["catalog_unavailable"]'::jsonb; END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.created_at,a.id),'[]'::jsonb) INTO v_audit
    FROM (SELECT a.id,a.action,a.revision,a.actor_id,a.created_at,
      (SELECT min(m.name) FROM public.team_members m WHERE m.organization_id=v_org AND m.user_id=a.actor_id) AS actor_name
      FROM public.toth_order_draft_audit a
      WHERE a.organization_id=v_org AND a.deal_id=p_deal_id AND a.draft_id IS NOT NULL
      ORDER BY a.created_at DESC,a.id DESC LIMIT 100) a;
  RETURN jsonb_build_object('enabled',true,'can_prepare',(v_ctx->>'can_prepare')::boolean AND v_customer IS NOT NULL,
    'can_review',(v_ctx->>'can_review')::boolean AND v_customer IS NOT NULL,
    'draft',CASE WHEN v_draft.id IS NOT NULL THEN to_jsonb(v_draft) ELSE NULL END,
    'catalog',v_catalog,'audit',v_audit,'blockers',v_blockers);
END;
$$;

CREATE FUNCTION public.toth_save_order_draft(p_deal_id uuid,p_expected_revision integer,p_items jsonb,p_notes text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ctx jsonb; v_org uuid; v_customer jsonb; v_before public.toth_order_drafts%ROWTYPE; v_after public.toth_order_drafts%ROWTYPE;
BEGIN
  v_ctx := toth_order_private.context(p_deal_id,true);
  IF NOT (v_ctx->>'enabled')::boolean THEN RAISE EXCEPTION 'toth_drafts_disabled' USING ERRCODE='42501'; END IF;
  IF NOT (v_ctx->>'can_prepare')::boolean THEN RAISE EXCEPTION 'toth_access_denied' USING ERRCODE='42501'; END IF;
  v_org := (v_ctx->>'organization_id')::uuid;
  v_customer := toth_order_private.customer(v_org,(v_ctx->>'lead_id')::uuid);
  IF v_customer IS NULL THEN RAISE EXCEPTION 'toth_client_link_unavailable' USING ERRCODE='22023'; END IF;
  IF p_notes IS NULL OR length(p_notes)>1000 THEN RAISE EXCEPTION 'toth_invalid_notes' USING ERRCODE='22023'; END IF;
  PERFORM toth_order_private.validate_items(v_org,p_items);
  SELECT * INTO v_before FROM public.toth_order_drafts WHERE organization_id=v_org AND deal_id=p_deal_id FOR UPDATE;
  IF p_expected_revision IS NULL OR p_expected_revision IS DISTINCT FROM COALESCE(v_before.revision,0) THEN
    RAISE EXCEPTION 'toth_revision_conflict' USING ERRCODE='40001';
  END IF;
  IF v_before.id IS NULL THEN
    INSERT INTO public.toth_order_drafts(organization_id,deal_id,lead_id,client_id,customer_external_id,items,notes,created_by,updated_by)
    VALUES (v_org,p_deal_id,(v_ctx->>'lead_id')::uuid,(v_customer->>'client_id')::uuid,v_customer->>'customer_external_id',p_items,p_notes,auth.uid(),auth.uid())
    RETURNING * INTO v_after;
  ELSE
    IF v_before.lead_id IS DISTINCT FROM (v_ctx->>'lead_id')::uuid
      OR v_before.client_id IS DISTINCT FROM (v_customer->>'client_id')::uuid
      OR v_before.customer_external_id IS DISTINCT FROM v_customer->>'customer_external_id' THEN
      RAISE EXCEPTION 'toth_client_link_changed' USING ERRCODE='40001';
    END IF;
    UPDATE public.toth_order_drafts SET items=p_items,notes=p_notes,revision=revision+1,
      reviewed_revision=NULL,reviewed_by=NULL,reviewed_at=NULL,updated_by=auth.uid(),updated_at=clock_timestamp()
    WHERE organization_id=v_org AND id=v_before.id RETURNING * INTO v_after;
  END IF;
  INSERT INTO public.toth_order_draft_audit(organization_id,deal_id,draft_id,revision,action,actor_id,before_snapshot,after_snapshot)
  VALUES (v_org,p_deal_id,v_after.id,v_after.revision,CASE WHEN v_before.id IS NULL THEN 'draft_created' ELSE 'draft_saved' END,
    auth.uid(),CASE WHEN v_before.id IS NOT NULL THEN to_jsonb(v_before) ELSE NULL END,to_jsonb(v_after));
  RETURN public.toth_order_workspace(p_deal_id);
END;
$$;

CREATE FUNCTION public.toth_review_order_draft(p_deal_id uuid,p_expected_revision integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ctx jsonb; v_org uuid; v_customer jsonb; v_before public.toth_order_drafts%ROWTYPE; v_after public.toth_order_drafts%ROWTYPE;
BEGIN
  v_ctx := toth_order_private.context(p_deal_id,true);
  IF NOT (v_ctx->>'enabled')::boolean THEN RAISE EXCEPTION 'toth_drafts_disabled' USING ERRCODE='42501'; END IF;
  IF NOT (v_ctx->>'can_review')::boolean THEN RAISE EXCEPTION 'toth_access_denied' USING ERRCODE='42501'; END IF;
  v_org := (v_ctx->>'organization_id')::uuid;
  SELECT * INTO v_before FROM public.toth_order_drafts WHERE organization_id=v_org AND deal_id=p_deal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'toth_draft_unavailable' USING ERRCODE='P0002'; END IF;
  IF p_expected_revision IS NULL OR p_expected_revision IS DISTINCT FROM v_before.revision THEN
    RAISE EXCEPTION 'toth_revision_conflict' USING ERRCODE='40001';
  END IF;
  v_customer := toth_order_private.customer(v_org,(v_ctx->>'lead_id')::uuid);
  IF v_customer IS NULL THEN RAISE EXCEPTION 'toth_client_link_unavailable' USING ERRCODE='22023'; END IF;
  IF v_before.lead_id IS DISTINCT FROM (v_ctx->>'lead_id')::uuid
    OR v_before.client_id IS DISTINCT FROM (v_customer->>'client_id')::uuid
    OR v_before.customer_external_id IS DISTINCT FROM v_customer->>'customer_external_id' THEN
    RAISE EXCEPTION 'toth_client_link_changed' USING ERRCODE='40001';
  END IF;
  IF jsonb_array_length(v_before.items)=0 THEN RAISE EXCEPTION 'toth_review_requires_items' USING ERRCODE='22023'; END IF;
  PERFORM toth_order_private.validate_items(v_org,v_before.items);
  IF v_before.reviewed_revision = v_before.revision AND v_before.reviewed_by IS NOT NULL THEN
    RETURN public.toth_order_workspace(p_deal_id);
  END IF;
  UPDATE public.toth_order_drafts SET reviewed_revision=revision,reviewed_at=clock_timestamp(),reviewed_by=auth.uid()
    WHERE organization_id=v_org AND id=v_before.id RETURNING * INTO v_after;
  INSERT INTO public.toth_order_draft_audit(organization_id,deal_id,draft_id,revision,action,actor_id,before_snapshot,after_snapshot)
    VALUES(v_org,p_deal_id,v_after.id,v_after.revision,'draft_reviewed_locally',auth.uid(),to_jsonb(v_before),to_jsonb(v_after));
  RETURN public.toth_order_workspace(p_deal_id);
END;
$$;

CREATE FUNCTION public.toth_request_order_send(p_deal_id uuid,p_expected_revision integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ctx jsonb;
BEGIN
  v_ctx := toth_order_private.context(p_deal_id);
  IF NOT (v_ctx->>'enabled')::boolean THEN RAISE EXCEPTION 'toth_drafts_disabled' USING ERRCODE='42501'; END IF;
  IF NOT (v_ctx->>'can_review')::boolean THEN RAISE EXCEPTION 'toth_access_denied' USING ERRCODE='42501'; END IF;
  -- No queue, network call, deal update or audit insertion: raising rolls back
  -- the transaction. This function cannot dispatch even a reviewed draft.
  RAISE EXCEPTION 'toth_write_contract_unverified' USING ERRCODE='55000';
END;
$$;

CREATE FUNCTION public.toth_order_preparer_access(p_deal_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ctx jsonb; v_org uuid; v_result jsonb;
BEGIN
  v_ctx := toth_order_private.context(p_deal_id);
  IF NOT (v_ctx->>'enabled')::boolean THEN RAISE EXCEPTION 'toth_drafts_disabled' USING ERRCODE='42501'; END IF;
  IF NOT (v_ctx->>'can_review')::boolean THEN RAISE EXCEPTION 'toth_access_denied' USING ERRCODE='42501'; END IF;
  v_org := (v_ctx->>'organization_id')::uuid;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('team_member_id',m.id,'name',m.name,'is_admin',m.role='admin',
    'can_prepare',m.role='admin' OR p.team_member_id IS NOT NULL) ORDER BY m.name,m.id),'[]'::jsonb) INTO v_result
  FROM public.team_members m LEFT JOIN public.toth_order_preparers p ON p.organization_id=m.organization_id AND p.team_member_id=m.id
  WHERE m.organization_id=v_org AND m.is_active AND m.user_id IS NOT NULL AND m.role <> 'admin';
  RETURN v_result;
END;
$$;

CREATE FUNCTION public.toth_set_order_preparer(p_deal_id uuid,p_team_member_id uuid,p_enabled boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_ctx jsonb; v_org uuid; v_count integer;
BEGIN
  v_ctx := toth_order_private.context(p_deal_id,true);
  IF NOT (v_ctx->>'enabled')::boolean THEN RAISE EXCEPTION 'toth_drafts_disabled' USING ERRCODE='42501'; END IF;
  IF NOT (v_ctx->>'can_review')::boolean THEN RAISE EXCEPTION 'toth_access_denied' USING ERRCODE='42501'; END IF;
  v_org := (v_ctx->>'organization_id')::uuid;
  IF p_enabled IS NULL OR NOT EXISTS (SELECT 1 FROM public.team_members m WHERE m.id=p_team_member_id
    AND m.organization_id=v_org AND m.is_active AND m.user_id IS NOT NULL AND m.role <> 'admin') THEN
    RAISE EXCEPTION 'toth_invalid_preparer' USING ERRCODE='22023';
  END IF;
  IF p_enabled THEN
    INSERT INTO public.toth_order_preparers(organization_id,team_member_id,granted_by)
      VALUES(v_org,p_team_member_id,auth.uid()) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.toth_order_preparers WHERE organization_id=v_org AND team_member_id=p_team_member_id;
  END IF;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count>0 THEN
    INSERT INTO public.toth_order_draft_audit(organization_id,deal_id,action,actor_id,after_snapshot)
      VALUES(v_org,p_deal_id,CASE WHEN p_enabled THEN 'preparer_granted' ELSE 'preparer_revoked' END,auth.uid(),
        jsonb_build_object('team_member_id',p_team_member_id,'enabled',p_enabled));
  END IF;
  RETURN public.toth_order_preparer_access(p_deal_id);
END;
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA toth_order_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.toth_order_can_read(uuid),public.toth_order_workspace(uuid),
  public.toth_save_order_draft(uuid,integer,jsonb,text),public.toth_review_order_draft(uuid,integer),
  public.toth_request_order_send(uuid,integer),public.toth_order_preparer_access(uuid),
  public.toth_set_order_preparer(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.toth_order_can_read(uuid),public.toth_order_workspace(uuid),
  public.toth_save_order_draft(uuid,integer,jsonb,text),public.toth_review_order_draft(uuid,integer),
  public.toth_request_order_send(uuid,integer),public.toth_order_preparer_access(uuid),
  public.toth_set_order_preparer(uuid,uuid,boolean) TO authenticated;

COMMIT;
