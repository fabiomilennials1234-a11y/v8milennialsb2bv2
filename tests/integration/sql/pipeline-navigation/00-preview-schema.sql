-- Isolated preview only. Real PostgreSQL schema slice, not a database mock.
-- Columns/defaults/checks from baseline, checked against production 2026-09-11.
-- This fallback slice does NOT validate full-schema FK/RLS/business triggers.
-- Never apply to production. Fails rather than replacing existing relations.
DO $$ BEGIN
  IF to_regclass('public.pipelines') IS NOT NULL
     OR to_regclass('public.pipeline_display_config') IS NOT NULL
     OR to_regclass('public.organization_features') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires an empty isolated preview database';
  END IF;
END $$;
CREATE TABLE "public"."pipelines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "type" "text" DEFAULT 'custom'::"text" NOT NULL,
    "description" "text",
    "icon" "text" DEFAULT 'kanban'::"text",
    "color" "text" DEFAULT '#3b82f6'::"text",
    "display_order" integer DEFAULT 0,
    "is_active" boolean DEFAULT true,
    "config" "jsonb" DEFAULT '{}'::"jsonb",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "pipelines_type_check" CHECK (("type" = ANY (ARRAY['system'::"text", 'custom'::"text"])))
);

CREATE TABLE "public"."pipeline_display_config" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "pipe_type" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "is_visible" boolean DEFAULT true NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "pipeline_display_config_pipe_type_check" CHECK (("pipe_type" = ANY (ARRAY['whatsapp'::"text", 'confirmacao'::"text", 'propostas'::"text", 'upsell'::"text"])))
);

CREATE TABLE "public"."organization_features" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "feature_key" "text" NOT NULL,
    "enabled" boolean DEFAULT true,
    "override_reason" "text",
    "overridden_by" "uuid",
    "overridden_at" timestamp with time zone DEFAULT "now"(),
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "is_enabled" boolean GENERATED ALWAYS AS ("enabled") STORED
);

ALTER TABLE public.pipelines ADD COLUMN stage_dispatch_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.pipelines ADD COLUMN stage_dispatch_enabled_at timestamptz;
ALTER TABLE public.pipelines ADD PRIMARY KEY (id);
ALTER TABLE public.pipeline_display_config ADD PRIMARY KEY (id);
ALTER TABLE public.pipeline_display_config ADD UNIQUE (organization_id, pipe_type);
ALTER TABLE public.organization_features ADD PRIMARY KEY (id);
ALTER TABLE public.organization_features ADD UNIQUE (organization_id, feature_key);
-- Exact production function/trigger definition read via pg_get_functiondef.
CREATE OR REPLACE FUNCTION public.update_updated_at()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $function$;
CREATE TRIGGER update_pipelines_updated_at BEFORE UPDATE ON public.pipelines
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Additional production columns used by org_get_features_and_limits precedence.
-- This is a column slice; unrelated billing/org schema is intentionally omitted.
CREATE TABLE public.organizations (id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY, subscription_plan text);
CREATE TABLE public.subscription_plans (id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY, name text NOT NULL UNIQUE, features jsonb NOT NULL DEFAULT '{}');
CREATE TABLE public.org_subscriptions (id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY, organization_id uuid NOT NULL, cancelled_at timestamptz, features jsonb NOT NULL DEFAULT '{}');
CREATE TABLE public.feature_catalog (key text NOT NULL PRIMARY KEY, default_enabled boolean DEFAULT false);
