-- Schema only. Credentials stay backend-only; existing rows retain legacy app binding (NULL).
ALTER TABLE public.meta_connections ALTER COLUMN token_expires_at DROP NOT NULL;
ALTER TABLE public.meta_connections ADD COLUMN app_id text CHECK (app_id ~ '^[0-9]+$');
ALTER TABLE public.meta_connections ADD COLUMN token_kind text NOT NULL DEFAULT 'user' CHECK (token_kind IN ('user', 'system_user'));
ALTER TABLE public.meta_connections DROP CONSTRAINT meta_connections_org_fbuser_type_key;
CREATE UNIQUE INDEX meta_connections_app_subject_type_key ON public.meta_connections (organization_id, facebook_user_id, connection_type, COALESCE(app_id, 'legacy'));
-- API upsert uses this index for non-null app bindings. Deploy the new callback together with this schema.
CREATE UNIQUE INDEX meta_connections_crm_upsert_key ON public.meta_connections (organization_id, facebook_user_id, connection_type, app_id);

REVOKE ALL ON public.meta_connections, public.meta_pages FROM PUBLIC, anon, authenticated;
REVOKE ALL (access_token) ON public.meta_connections FROM PUBLIC, anon, authenticated;
REVOKE ALL (page_access_token) ON public.meta_pages FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, organization_id, user_id, facebook_user_id, facebook_user_name, token_expires_at, status, connection_type, connected_at, updated_at, app_id, token_kind) ON public.meta_connections TO authenticated;
GRANT SELECT (id, meta_connection_id, organization_id, page_id, page_name, instagram_account_id, instagram_username, is_active, webhook_subscribed, created_at, updated_at) ON public.meta_pages TO authenticated;
-- Browser writes remain revoked; admin operations use the authenticated backend.
GRANT ALL ON public.meta_connections, public.meta_pages TO service_role;

CREATE TABLE public.meta_oauth_nonces (
  nonce uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  app_id text NOT NULL CHECK (app_id ~ '^[0-9]+$'),
  connection_type text NOT NULL CHECK (connection_type IN ('facebook', 'instagram')),
  expires_at timestamptz NOT NULL
);
ALTER TABLE public.meta_oauth_nonces ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_oauth_nonces FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.meta_oauth_nonces TO service_role;

CREATE FUNCTION public.meta_consume_oauth_nonce(p_nonce uuid, p_user_id uuid, p_organization_id uuid, p_app_id text, p_connection_type text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE consumed uuid;
BEGIN
  -- Revalidate current authority, including removal/demotion during the external round-trip.
  IF NOT EXISTS (SELECT 1 FROM public.team_members WHERE user_id = p_user_id AND organization_id = p_organization_id AND is_active = true AND role = 'admin')
     AND NOT EXISTS (SELECT 1 FROM public.master_users WHERE user_id = p_user_id AND is_active = true) THEN
    RETURN false;
  END IF;
  DELETE FROM public.meta_oauth_nonces WHERE nonce = p_nonce AND user_id = p_user_id
    AND organization_id = p_organization_id AND app_id = p_app_id
    AND connection_type = p_connection_type AND expires_at > now() RETURNING nonce INTO consumed;
  RETURN consumed IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.meta_consume_oauth_nonce(uuid, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meta_consume_oauth_nonce(uuid, uuid, uuid, text, text) TO service_role;

-- A page binding cannot silently move between apps/tenants through upsert.
CREATE FUNCTION public.meta_validate_page_binding() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE binding_app text; previous_app text; previous_status text;
BEGIN
  SELECT app_id INTO binding_app FROM public.meta_connections WHERE id = NEW.meta_connection_id AND organization_id = NEW.organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_meta_page_tenant_binding'; END IF;
  IF TG_OP = 'UPDATE' THEN
    SELECT app_id,status INTO previous_app,previous_status FROM public.meta_connections WHERE id = OLD.meta_connection_id;
    IF NEW.organization_id <> OLD.organization_id OR (binding_app IS DISTINCT FROM previous_app AND NOT (previous_status = 'disconnected' AND OLD.is_active = false AND OLD.page_access_token = '')) THEN
      RAISE EXCEPTION 'meta_page_app_rebind_requires_explicit_migration';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.meta_validate_page_binding() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meta_validate_page_binding() TO service_role;
CREATE TRIGGER meta_validate_page_binding BEFORE INSERT OR UPDATE ON public.meta_pages FOR EACH ROW EXECUTE FUNCTION public.meta_validate_page_binding();

CREATE TABLE public.meta_ad_accounts (
  meta_connection_id uuid NOT NULL REFERENCES public.meta_connections(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id text NOT NULL CHECK(account_id ~ '^act_[0-9]+$'),
  name text NOT NULL,
  currency text,
  account_status integer,
  is_active boolean NOT NULL DEFAULT true,
  PRIMARY KEY(meta_connection_id,account_id)
);
ALTER TABLE public.meta_ad_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_ad_accounts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.meta_ad_accounts TO service_role;

CREATE FUNCTION public.meta_save_business_connection(p_user_id uuid, p_org_id uuid, p_app_id text, p_subject text, p_name text, p_type text, p_token text, p_expires timestamptz, p_pages jsonb, p_ad_accounts jsonb DEFAULT '[]'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE connection_id uuid; page jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.team_members WHERE user_id = p_user_id AND organization_id = p_org_id AND is_active = true AND role = 'admin')
     AND NOT EXISTS (SELECT 1 FROM public.master_users WHERE user_id = p_user_id AND is_active = true) THEN
    RAISE EXCEPTION 'meta_authority_revoked';
  END IF;
  IF p_app_id IS NULL OR p_app_id !~ '^[0-9]+$' OR p_subject !~ '^[0-9]+$' OR p_token !~ '^crm1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$' OR jsonb_typeof(p_pages) <> 'array' THEN RAISE EXCEPTION 'invalid_meta_connection'; END IF;
  INSERT INTO public.meta_connections (organization_id,user_id,app_id,facebook_user_id,facebook_user_name,connection_type,token_kind,access_token,token_expires_at,status)
  VALUES (p_org_id,p_user_id,p_app_id,p_subject,p_name,p_type,'system_user',p_token,p_expires,'connected')
  ON CONFLICT (organization_id,facebook_user_id,connection_type,app_id) DO UPDATE SET user_id=EXCLUDED.user_id,access_token=EXCLUDED.access_token,token_expires_at=EXCLUDED.token_expires_at,facebook_user_name=EXCLUDED.facebook_user_name,status='connected',token_kind='system_user',connected_at=now()
  RETURNING id INTO connection_id;
  UPDATE public.meta_pages SET is_active=false,webhook_subscribed=false WHERE meta_connection_id=connection_id AND organization_id=p_org_id;
  FOR page IN SELECT * FROM jsonb_array_elements(p_pages) LOOP
    IF page->>'id' !~ '^[0-9]+$' OR COALESCE(page->>'access_token','') !~ '^crm1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$' THEN RAISE EXCEPTION 'invalid_meta_page'; END IF;
    INSERT INTO public.meta_pages (meta_connection_id,organization_id,page_id,page_name,page_access_token,instagram_account_id,instagram_username,is_active,webhook_subscribed)
    VALUES(connection_id,p_org_id,page->>'id',page->>'name',page->>'access_token',page->>'instagram_account_id',page->>'instagram_username',true,true)
    ON CONFLICT (organization_id,page_id) DO UPDATE SET meta_connection_id=EXCLUDED.meta_connection_id,page_name=EXCLUDED.page_name,page_access_token=EXCLUDED.page_access_token,instagram_account_id=EXCLUDED.instagram_account_id,instagram_username=EXCLUDED.instagram_username,is_active=true,webhook_subscribed=true;
  END LOOP;
  UPDATE public.meta_ad_accounts SET is_active=false WHERE meta_connection_id=connection_id AND organization_id=p_org_id;
  FOR page IN SELECT * FROM jsonb_array_elements(p_ad_accounts) LOOP
    INSERT INTO public.meta_ad_accounts(meta_connection_id,organization_id,account_id,name,currency,account_status,is_active)
    VALUES(connection_id,p_org_id,page->>'id',page->>'name',page->>'currency',(page->>'account_status')::integer,true)
    ON CONFLICT(meta_connection_id,account_id) DO UPDATE SET name=EXCLUDED.name,currency=EXCLUDED.currency,account_status=EXCLUDED.account_status,is_active=true;
  END LOOP;
  RETURN connection_id;
END;
$$;
REVOKE ALL ON FUNCTION public.meta_save_business_connection(uuid,uuid,text,text,text,text,text,timestamptz,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meta_save_business_connection(uuid,uuid,text,text,text,text,text,timestamptz,jsonb,jsonb) TO service_role;
CREATE FUNCTION public.meta_disconnect_connection(p_org_id uuid, p_connection_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.meta_connections SET status='disconnected',access_token='' WHERE id=p_connection_id AND organization_id=p_org_id;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.meta_pages SET is_active=false,webhook_subscribed=false,page_access_token='' WHERE meta_connection_id=p_connection_id AND organization_id=p_org_id;
  UPDATE public.meta_ad_accounts SET is_active=false WHERE meta_connection_id=p_connection_id AND organization_id=p_org_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.meta_disconnect_connection(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meta_disconnect_connection(uuid,uuid) TO service_role;

CREATE TABLE public.meta_webhook_receipts (
  id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{64}$'),
  app_id text NOT NULL CHECK (app_id ~ '^[0-9]+$'),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
ALTER TABLE public.meta_webhook_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_webhook_receipts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.meta_webhook_receipts TO service_role;
CREATE INDEX meta_webhook_pending ON public.meta_webhook_receipts(available_at) WHERE status <> 'completed';
CREATE FUNCTION public.meta_claim_webhooks(p_app_id text)
RETURNS SETOF public.meta_webhook_receipts LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH candidates AS (
    SELECT id FROM public.meta_webhook_receipts WHERE app_id=p_app_id AND status <> 'completed' AND available_at <= now()
    ORDER BY created_at LIMIT 10 FOR UPDATE SKIP LOCKED
  )
  UPDATE public.meta_webhook_receipts r SET status='processing',attempts=r.attempts+1,available_at=now()+interval '5 minutes'
  FROM candidates c WHERE r.id=c.id RETURNING r.*;
$$;
REVOKE ALL ON FUNCTION public.meta_claim_webhooks(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meta_claim_webhooks(text) TO service_role;

-- Message persistence and inbox counters commit together; delivery retries never double-count unread.
CREATE FUNCTION public.meta_record_message(p_org uuid, p_page uuid, p_app text, p_data jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE source_page text; inserted uuid;
BEGIN
  SELECT p.page_id INTO source_page FROM public.meta_pages p JOIN public.meta_connections c ON c.id=p.meta_connection_id
  WHERE p.id=p_page AND p.organization_id=p_org AND c.organization_id=p_org AND c.app_id=p_app AND c.status='connected' AND p.is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'meta_page_binding_inactive'; END IF;
  IF COALESCE(p_data->>'external_id','')='' OR p_data->>'channel' NOT IN ('messenger','instagram') THEN RAISE EXCEPTION 'invalid_meta_message'; END IF;
  INSERT INTO public.channel_messages (organization_id,channel,page_id,external_id,sender_id,direction,message_type,content,media_url,status,lead_id,timestamp,raw_payload)
  VALUES(p_org,(p_data->>'channel')::public.channel_type,source_page,p_data->>'external_id',p_data->>'sender_id',p_data->>'direction',p_data->>'message_type',p_data->>'content',p_data->>'media_url',p_data->>'status',(p_data->>'lead_id')::uuid,(p_data->>'timestamp')::timestamptz,p_data->'raw_payload')
  ON CONFLICT(external_id,channel,organization_id) DO NOTHING RETURNING id INTO inserted;
  PERFORM public.upsert_meta_conversation(p_org,p_page,(p_data->>'channel')::public.channel_type,p_data->>'sender_id',p_data->>'direction',(p_data->>'timestamp')::timestamptz,p_data->>'content',(p_data->>'lead_id')::uuid,inserted IS NOT NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.meta_record_message(uuid,uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meta_record_message(uuid,uuid,text,jsonb) TO service_role;

CREATE TABLE public.meta_leadgen_deliveries (
  app_id text NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  leadgen_id text NOT NULL CHECK (leadgen_id ~ '^[0-9]+$'),
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  delivered boolean NOT NULL DEFAULT false,
  PRIMARY KEY(app_id,organization_id,leadgen_id)
);
ALTER TABLE public.meta_leadgen_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_leadgen_deliveries FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.meta_leadgen_deliveries TO service_role;
CREATE FUNCTION public.meta_record_lead(p_org uuid,p_page uuid,p_app text,p_event text,p_fields jsonb,p_existing uuid DEFAULT NULL)
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
  fields := p_fields || jsonb_build_object('organization_id',p_org,'origin','meta_ads');
  IF p_existing IS NOT NULL THEN fields := fields - 'name'; END IF;
  -- Only this literal allowlist controls SQL identifiers. Values remain bind parameters.
  SELECT string_agg(format('%I',key),',' ORDER BY key),string_agg(format('r.%I',key),',' ORDER BY key)
  INTO columns_sql,values_sql FROM jsonb_object_keys(fields) key WHERE key=ANY(ARRAY['organization_id','origin','name','email','phone','company','segment','urgency','faturamento','notes','utm_campaign','utm_source','utm_medium','utm_content','utm_term','meta_campaign_id','meta_adset_id','meta_ad_id','metadata']);
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
