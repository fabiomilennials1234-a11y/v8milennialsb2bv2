-- Minimal PostgreSQL contract harness. Roles/RLS match the existing comment
-- policies; fake auth claims replace the gateway, never the database engine.
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA auth;
CREATE SCHEMA storage;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION public.get_my_organization_ids() RETURNS SETOF uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.org', true), '')::uuid $$;
CREATE FUNCTION public.is_master_user() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('test.master', true), '') = 'true' $$;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE TABLE public.pipeline_entries(id uuid PRIMARY KEY, organization_id uuid NOT NULL, lead_id uuid NOT NULL);
CREATE TABLE public.lead_comments(id uuid PRIMARY KEY, organization_id uuid NOT NULL, lead_id uuid NOT NULL, author_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL, pipeline_entry_id uuid REFERENCES public.pipeline_entries(id) ON DELETE SET NULL, body text NOT NULL, deleted_at timestamptz);
ALTER TABLE public.pipeline_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY entry_org ON public.pipeline_entries USING (organization_id IN (SELECT public.get_my_organization_ids()) OR public.is_master_user());
ALTER TABLE public.lead_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY comment_read ON public.lead_comments FOR SELECT USING (organization_id IN (SELECT public.get_my_organization_ids()) OR public.is_master_user());
CREATE POLICY comment_write ON public.lead_comments FOR INSERT WITH CHECK (author_user_id = auth.uid() AND (organization_id IN (SELECT public.get_my_organization_ids()) OR public.is_master_user()));
CREATE POLICY comment_edit ON public.lead_comments FOR UPDATE USING (author_user_id = auth.uid() OR public.is_master_user()) WITH CHECK (organization_id IN (SELECT public.get_my_organization_ids()) OR public.is_master_user());
CREATE TABLE storage.buckets(id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets, name text, metadata jsonb, UNIQUE(bucket_id,name));
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA public, auth, storage TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.pipeline_entries, public.lead_comments, storage.objects TO authenticated;
