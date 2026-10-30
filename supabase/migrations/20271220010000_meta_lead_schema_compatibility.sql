-- Use the existing lead identifier column; never persist arbitrary form fields.
-- Keep the delivery ledger, tenant checks and deletion tombstones intact.
CREATE OR REPLACE FUNCTION public.meta_record_lead(p_org uuid,p_page uuid,p_app text,p_event text,p_fields jsonb,p_existing uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE result uuid; was_delivered boolean; fields jsonb; columns_sql text; values_sql text;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.meta_pages p JOIN public.meta_connections c ON c.id=p.meta_connection_id WHERE p.id=p_page AND p.organization_id=p_org AND c.organization_id=p_org AND c.app_id=p_app AND c.status='connected' AND p.is_active) THEN RAISE EXCEPTION 'meta_page_binding_inactive'; END IF;
  INSERT INTO public.meta_leadgen_deliveries(app_id,organization_id,leadgen_id) VALUES(p_app,p_org,p_event) ON CONFLICT DO NOTHING;
  SELECT lead_id,delivered INTO result,was_delivered FROM public.meta_leadgen_deliveries WHERE app_id=p_app AND organization_id=p_org AND leadgen_id=p_event FOR UPDATE;
  IF was_delivered THEN
    IF NOT EXISTS(SELECT 1 FROM public.leads WHERE id=result AND organization_id=p_org AND deleted_at IS NULL) THEN RETURN NULL; END IF;
    RETURN result;
  END IF;
  IF p_existing IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.leads WHERE id=p_existing AND organization_id=p_org AND deleted_at IS NULL) THEN RAISE EXCEPTION 'meta_lead_tenant_mismatch'; END IF;
  fields := (p_fields - 'metadata') || jsonb_build_object('organization_id',p_org,'origin','meta_ads','meta_lead_id',p_event);
  IF p_existing IS NOT NULL THEN fields := fields - 'name'; END IF;
  -- Only this literal allowlist controls SQL identifiers. Values remain bind parameters.
  SELECT string_agg(format('%I',key),',' ORDER BY key),string_agg(format('r.%I',key),',' ORDER BY key)
  INTO columns_sql,values_sql FROM jsonb_object_keys(fields) key WHERE key=ANY(ARRAY['organization_id','origin','name','email','phone','company','segment','urgency','faturamento','notes','utm_campaign','utm_source','utm_medium','utm_content','utm_term','meta_campaign_id','meta_adset_id','meta_ad_id','meta_lead_id']);
  IF p_existing IS NULL THEN
    EXECUTE format('INSERT INTO public.leads(%s) SELECT %s FROM jsonb_populate_record(NULL::public.leads,$1) r RETURNING id',columns_sql,values_sql) INTO result USING fields;
  ELSE
    EXECUTE format('UPDATE public.leads SET (%s)=(SELECT %s FROM jsonb_populate_record(NULL::public.leads,$1) r) WHERE id=$2 AND organization_id=$3 RETURNING id',columns_sql,values_sql) INTO result USING fields,p_existing,p_org;
  END IF;
  UPDATE public.meta_leadgen_deliveries SET lead_id=result,delivered=true WHERE app_id=p_app AND organization_id=p_org AND leadgen_id=p_event;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.meta_record_lead(uuid,uuid,text,text,jsonb,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meta_record_lead(uuid,uuid,text,text,jsonb,uuid) TO service_role;
