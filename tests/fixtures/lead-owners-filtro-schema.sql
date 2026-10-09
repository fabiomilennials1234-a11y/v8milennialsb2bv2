-- tests/fixtures/lead-owners-filtro-schema.sql
--
-- Complemento de tests/fixtures/lead-owners-schema.sql para o pgTAP
-- supabase/tests/lead_owners_filtro_test.sql (Chamado 793f4b05 · PR2) num
-- cluster DESCARTÁVEL (supabase/postgres:17.6.1.106), já que o `supabase start`
-- local não sobe. Só as colunas que get_pipeline_page / get_pipeline_lead_ids
-- leem. A view negocio_projetado é a de prod (pg_get_viewdef, 09/10), reduzida
-- às colunas que os resolvers usam. Nunca aplique em projeto real.
--
-- Ordem do harness:
--   lead-owners-schema.sql → 20271116000000 → 20271116000010 → ESTE arquivo
--   → corpo de prod dos resolvers (rollback/20271116000020)  [teste: vermelho]
--   → migrations/20271116000020                                [teste: verde]

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS company text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS rating integer,
  ADD COLUMN IF NOT EXISTS segment text,
  ADD COLUMN IF NOT EXISTS faturamento text,
  ADD COLUMN IF NOT EXISTS urgency text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS compromisso_date timestamptz,
  ADD COLUMN IF NOT EXISTS ai_disabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS erp_code text,
  ADD COLUMN IF NOT EXISTS qualification_tier text,
  ADD COLUMN IF NOT EXISTS pre_qualification_tier text;

CREATE TABLE IF NOT EXISTS public.pipelines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  name text NOT NULL,
  slug text NOT NULL,
  type text NOT NULL DEFAULT 'custom',
  display_order integer
);

CREATE TABLE IF NOT EXISTS public.pipeline_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_role text,
  name text,
  "position" integer,
  is_final_positive boolean,
  is_final_negative boolean
);

ALTER TABLE public.pipeline_entries
  ADD COLUMN IF NOT EXISTS organization_id uuid,
  ADD COLUMN IF NOT EXISTS pipeline_id uuid,
  ADD COLUMN IF NOT EXISTS stage_id uuid,
  ADD COLUMN IF NOT EXISTS stage_key text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS deal_id uuid,
  ADD COLUMN IF NOT EXISTS entered_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS stage_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid,
  value numeric,
  outcome text,
  outcome_at timestamptz,
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  color text
);

CREATE TABLE IF NOT EXISTS public.lead_tags (
  lead_id uuid,
  tag_id uuid
);

CREATE TABLE IF NOT EXISTS public.scheduled_user_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid,
  organization_id uuid,
  status text
);

CREATE OR REPLACE VIEW public.negocio_projetado AS
 SELECT pe.id,
    pe.organization_id,
    pe.lead_id,
    pe.pipeline_id,
    pe.stage_id,
    pe.stage_key,
    p.slug AS pipeline_slug,
    p.type AS pipeline_type,
    (pe.metadata ->> 'pre_sale_responsible_id'::text)::uuid AS pre_sale_responsible_id,
    (pe.metadata ->> 'sale_responsible_id'::text)::uuid AS sale_responsible_id
   FROM public.pipeline_entries pe
     JOIN public.pipelines p ON p.id = pe.pipeline_id
     LEFT JOIN public.pipeline_stages ps ON ps.id = pe.stage_id;

GRANT SELECT ON public.negocio_projetado TO authenticated;

-- get_pipeline_lead_ids é criado pelo corpo de prod (rollback/20271116000020)
-- ANTES deste wrapper rodar; aqui só um stub para o wrapper compilar.
CREATE OR REPLACE FUNCTION public.get_pipeline_lead_ids(p_pipeline_id uuid DEFAULT NULL::uuid, p_pipeline_slug text DEFAULT NULL::text, p_stage_id uuid DEFAULT NULL::uuid, p_stage_key text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_responsible_id uuid DEFAULT NULL::uuid, p_tag_ids uuid[] DEFAULT NULL::uuid[], p_qualification_tier text[] DEFAULT NULL::text[], p_pre_qualification_tier text[] DEFAULT NULL::text[], p_origin text[] DEFAULT NULL::text[], p_organization_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF uuid LANGUAGE sql STABLE SET search_path TO '' AS $$ SELECT NULL::uuid WHERE false $$;

-- Literal de prod (pg_get_functiondef, 09/10).
CREATE OR REPLACE FUNCTION public.get_filtered_lead_ids(p_pipeline_type text, p_stage_key text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_responsible_id uuid DEFAULT NULL::uuid, p_tag_ids uuid[] DEFAULT NULL::uuid[], p_qualification_tier text[] DEFAULT NULL::text[], p_pre_qualification_tier text[] DEFAULT NULL::text[], p_origin text[] DEFAULT NULL::text[], p_organization_id uuid DEFAULT NULL::uuid)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  -- SCRUM-626: wrapper fino; o predicado type='system' morreu (slug único por org).
  SELECT public.get_pipeline_lead_ids(
    p_pipeline_slug          => p_pipeline_type,
    p_stage_key              => p_stage_key,
    p_search                 => p_search,
    p_responsible_id         => p_responsible_id,
    p_tag_ids                => p_tag_ids,
    p_qualification_tier     => p_qualification_tier,
    p_pre_qualification_tier => p_pre_qualification_tier,
    p_origin                 => p_origin,
    p_organization_id        => p_organization_id
  );
$function$;
