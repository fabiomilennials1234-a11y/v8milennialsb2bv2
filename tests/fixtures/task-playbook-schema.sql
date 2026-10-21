CREATE SCHEMA auth;
CREATE SCHEMA private;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public,auth,private TO authenticated,anon,service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claim.role',true); $$;
CREATE TYPE public.app_role AS ENUM ('admin','member');
CREATE TABLE organizations(id uuid PRIMARY KEY,name text,timezone text DEFAULT 'America/Sao_Paulo',ui_v5_enabled boolean DEFAULT false);
CREATE TABLE team_members(id uuid PRIMARY KEY,organization_id uuid REFERENCES organizations(id),user_id uuid,name text,is_active boolean DEFAULT true,role app_role DEFAULT 'member');
CREATE TABLE leads(id uuid PRIMARY KEY,organization_id uuid,name text);
CREATE TABLE acoes_do_dia(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,organization_id uuid REFERENCES organizations(id),lead_id uuid,title text);
CREATE TABLE deals(id uuid PRIMARY KEY);
CREATE TABLE pipelines(id uuid PRIMARY KEY,organization_id uuid,name text,slug text,is_active boolean DEFAULT true,display_order integer DEFAULT 0);
CREATE TABLE pipeline_stages(id uuid PRIMARY KEY,organization_id uuid,pipeline_id uuid,pipeline_type text,stage_key text,name text,position integer DEFAULT 0,is_active boolean DEFAULT true,checklist_template_id uuid);
CREATE TABLE pipeline_entries(id uuid PRIMARY KEY,organization_id uuid,pipeline_id uuid,stage_id uuid,stage_key text,assigned_to uuid,metadata jsonb DEFAULT '{}',closed_at timestamptz,lead_id uuid,deal_id uuid);
CREATE TABLE checklists(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,lead_id uuid REFERENCES leads(id) ON DELETE CASCADE,pipeline_entry_id uuid,deal_id uuid REFERENCES deals(id) ON DELETE SET NULL,source_template_id uuid,title text,description text,created_by uuid);
CREATE TABLE checklist_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),checklist_id uuid REFERENCES checklists(id) ON DELETE CASCADE,title text,position integer DEFAULT 0,is_completed boolean DEFAULT false,template_item_id uuid);
CREATE UNIQUE INDEX uniq_checklists_entry_source ON checklists(pipeline_entry_id,source_template_id) WHERE source_template_id IS NOT NULL AND pipeline_entry_id IS NOT NULL;
CREATE UNIQUE INDEX uniq_checklists_lead_source ON checklists(lead_id,source_template_id) WHERE source_template_id IS NOT NULL AND lead_id IS NOT NULL AND pipeline_entry_id IS NULL;
CREATE FUNCTION is_master_user() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('test.master',true),'false')='true'; $$;
CREATE FUNCTION get_my_organization_ids() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT organization_id FROM team_members WHERE user_id=auth.uid() AND is_active
  UNION SELECT id FROM organizations WHERE is_master_user();
$$;
CREATE FUNCTION has_feature_permission(p_feature text,p_org uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('test.followups',true),'true')<>'false';
$$;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO authenticated,service_role;
