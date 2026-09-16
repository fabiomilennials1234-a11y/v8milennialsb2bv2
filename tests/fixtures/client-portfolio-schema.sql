-- Disposable PostgreSQL fixture: columns used by the production query, real
-- tables and row security. No mock query builder or service-role bypass.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
CREATE TABLE organizations(id uuid PRIMARY KEY, timezone text DEFAULT 'America/Sao_Paulo');
CREATE TABLE leads(
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, name text NOT NULL, company text,
  email text, phone text, normalized_phone text, erp_code text, created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz, is_shadow boolean, classificacao text DEFAULT 'lead', qualification_tier text,
  uf char(2), origin text, sale_responsible_id uuid, pre_sale_responsible_id uuid, responsible_id uuid,
  sdr_id uuid, closer_id uuid, primeira_venda_at timestamptz, cafe_jurere_erp_elegivel boolean DEFAULT true
);
CREATE TABLE deals(id uuid PRIMARY KEY, organization_id uuid NOT NULL, source_lead_id uuid, outcome text, deleted_at timestamptz);
CREATE TABLE pipelines(id uuid PRIMARY KEY, organization_id uuid NOT NULL, is_active boolean DEFAULT true);
CREATE TABLE pipeline_stages(id uuid PRIMARY KEY, organization_id uuid NOT NULL, pipeline_id uuid, stage_key text, stage_role text, is_active boolean DEFAULT true);
CREATE TABLE pipeline_entries(id uuid PRIMARY KEY, organization_id uuid NOT NULL, pipeline_id uuid, lead_id uuid, deal_id uuid, stage_key text);
CREATE TABLE sale_events(id uuid PRIMARY KEY, organization_id uuid NOT NULL, lead_id uuid, event_type text, sold_at timestamptz, sale_value numeric, reversed_event_id uuid);
CREATE TABLE upsell_clients(id uuid PRIMARY KEY, organization_id uuid NOT NULL, lead_id uuid, segment text);
CREATE TABLE upsell_orders(id uuid PRIMARY KEY, organization_id uuid NOT NULL, client_id uuid, approval_status text, sold_at timestamptz, sale_value numeric);
CREATE INDEX sale_events_lead_org ON sale_events(organization_id,lead_id);
CREATE INDEX sale_events_reversal_org ON sale_events(organization_id,reversed_event_id);
CREATE INDEX leads_org ON leads(organization_id);
CREATE INDEX deals_org_lead ON deals(organization_id,source_lead_id);
CREATE INDEX upsell_clients_org_lead ON upsell_clients(organization_id,lead_id);
CREATE INDEX upsell_orders_org_client ON upsell_orders(organization_id,client_id);
GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_scope ON organizations TO authenticated USING (id::text=current_setting('request.jwt.claim.org',true));
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['leads','deals','pipelines','pipeline_stages','pipeline_entries','sale_events','upsell_clients','upsell_orders'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY org_scope ON %I TO authenticated USING (organization_id::text=current_setting(''request.jwt.claim.org'',true))',t);
  END LOOP;
END $$;
CREATE POLICY assignment_scope ON leads AS RESTRICTIVE TO authenticated USING (
  coalesce(current_setting('request.jwt.claim.admin',true),'false')='true'
  OR sale_responsible_id::text=current_setting('request.jwt.claim.member',true)
);
