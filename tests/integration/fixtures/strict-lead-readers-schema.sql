ALTER TABLE leads ADD COLUMN company text, ADD COLUMN phone text, ADD COLUMN email text,
 ADD COLUMN normalized_phone text, ADD COLUMN uf character(2) DEFAULT 'RS', ADD COLUMN uf_source text,
 ADD COLUMN created_at timestamptz DEFAULT now(), ADD COLUMN qualification_tier text,
 ADD COLUMN pre_qualification_tier text, ADD COLUMN origin text, ADD COLUMN rating int, ADD COLUMN qualification_score numeric;
ALTER TABLE organizations ADD COLUMN chat_restrict_to_owner boolean DEFAULT false;
ALTER TABLE pipeline_entries ADD COLUMN pipeline_id uuid, ADD COLUMN stage_key text DEFAULT 'enviada',
 ADD COLUMN created_at timestamptz DEFAULT now(), ADD COLUMN stage_changed_at timestamptz DEFAULT now(), ADD COLUMN closed_at timestamptz;
CREATE TABLE pipelines(id uuid PRIMARY KEY,organization_id uuid,slug text,type text);
-- Exists alongside the same-named RPC CTE; must not replace the CTE reference.
CREATE TABLE meetings(id uuid PRIMARY KEY,organization_id uuid,lead_id uuid,title text);
CREATE TABLE messaging_channels(id uuid PRIMARY KEY,organization_id uuid,channel_type text);
CREATE TABLE lead_social_identities(id uuid PRIMARY KEY,organization_id uuid,lead_id uuid,channel_type text,external_user_id text);
CREATE TABLE channel_messages(id uuid PRIMARY KEY,organization_id uuid,lead_id uuid,messaging_channel_id uuid,contact_external_id text,phone_number text);
CREATE FUNCTION normalize_brazilian_phone(text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT regexp_replace($1,'[^0-9]','','g') $$;
CREATE TABLE meeting_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,lead_id uuid,
 event_type text,meeting_date timestamptz,occurred_at timestamptz,booked_event_id uuid,pre_sale_responsible_id uuid);
CREATE TABLE follow_ups(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,lead_id uuid,title text,
 completed_at timestamptz,archived_at timestamptz,due_date timestamptz);
CREATE TABLE next_best_actions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,lead_id uuid,deal_id uuid,
 action_type text,title text,reason text,priority integer,due_by timestamptz,metadata jsonb,completed_at timestamptz,dismissed_at timestamptz);
CREATE TABLE field_changes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,entity_type text,
 entity_id uuid,field_name text,old_value text,new_value text,changed_by uuid,changed_at timestamptz DEFAULT now());
CREATE TABLE whatsapp_messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,lead_id uuid,
 phone_number text,normalized_phone text,content text,direction text,"timestamp" timestamptz DEFAULT now(),instance_id uuid,search_tsv tsvector);
CREATE TABLE lead_history(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,lead_id uuid,
 created_at timestamptz,action text,description text,metadata jsonb);
CREATE FUNCTION lead_excluded_from_metrics(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION _metric_ultimo_toque(uuid,uuid,timestamptz) RETURNS timestamptz LANGUAGE sql AS $$ SELECT NULL::timestamptz $$;
CREATE FUNCTION can_see_chat_scope(p_org_id uuid,p_lead_id uuid,p_normalized_phone text) RETURNS boolean
 LANGUAGE sql SECURITY DEFINER AS $$ SELECT true $$;
CREATE FUNCTION private.chat_scope_for_recipient(uuid,uuid,uuid,text) RETURNS boolean
 LANGUAGE sql SECURITY DEFINER AS $$ SELECT true $$;
DROP VIEW negocio_projetado;
CREATE VIEW negocio_projetado WITH (security_invoker=true) AS
 SELECT pe.*,p.slug AS funil_sistema,(pe.metadata->>'sale_value')::numeric AS sale_value
 FROM pipeline_entries pe LEFT JOIN pipelines p ON p.id=pe.pipeline_id;
GRANT SELECT ON negocio_projetado,pipelines TO authenticated,service_role;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['meeting_events','follow_ups','next_best_actions','field_changes','whatsapp_messages','lead_history'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('GRANT SELECT ON %I TO authenticated,service_role',t);
  EXECUTE format('CREATE POLICY fixture_org ON %I FOR SELECT USING(organization_id IN(SELECT get_my_organization_ids()))',t);
 END LOOP;
END $$;
