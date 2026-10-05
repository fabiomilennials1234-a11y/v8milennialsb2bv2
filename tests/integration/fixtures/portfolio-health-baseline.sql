-- Esqueleto de prod (jsjsmuncfkbsbzqzqhfq) para portfolio-health-rpc.test.mjs.
--
-- Copiado de information_schema / pg_constraint / pg_default_acl de prod em
-- 2026-10-05 (MCP, só leitura). Cada tabela traz as colunas que
-- portfolio_health_inputs / portfolio_health_apply tocam, com o tipo, a
-- nulidade, o default e as constraints de prod; colunas que as RPCs não leem
-- ficaram de fora (upsell_clients tem 61 em prod).

-- ─── Papéis e privilégios default (o que faz o REVOKE explícito ser preciso) ──
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- prod: `postgres f {anon=X, authenticated=X, service_role=X}` e
-- `postgres r {authenticated=arwdDxtm, service_role=arwdDxtm, anon=rxtm}`.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO anon;

-- ─── Tabelas ────────────────────────────────────────────────────────────────
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL,
  default_reorder_cycle_days integer
);

CREATE TABLE public.organization_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  feature_key text NOT NULL,
  enabled boolean DEFAULT true,
  CONSTRAINT unique_org_feature UNIQUE (organization_id, feature_key)
);

CREATE TABLE public.copilot_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  name text NOT NULL,
  is_active boolean DEFAULT false,
  retention_enabled boolean DEFAULT false,
  retention_config jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.upsell_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  closer_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reorder_cycle_days integer,
  days_since_last_order integer,
  last_order_at timestamptz,
  next_order_expected timestamptz,
  order_count integer DEFAULT 0,
  lifetime_value numeric DEFAULT 0,
  avg_ticket numeric,
  health_score integer DEFAULT 100,
  health_status text DEFAULT 'saudavel'::text,
  health_updated_at timestamptz,
  segment text DEFAULT 'novo'::text,
  trend text,
  churn_probability integer DEFAULT 0,
  CONSTRAINT upsell_clients_organization_id_lead_id_key UNIQUE (organization_id, lead_id),
  CONSTRAINT upsell_clients_churn_probability_check CHECK (churn_probability >= 0 AND churn_probability <= 100),
  CONSTRAINT upsell_clients_health_status_check CHECK (health_status = ANY (ARRAY['saudavel','atencao','risco','inativo'])),
  CONSTRAINT upsell_clients_segment_check CHECK (segment = ANY (ARRAY['ouro','prata','novo','resgate','dormindo'])),
  CONSTRAINT upsell_clients_trend_check CHECK (trend = ANY (ARRAY['up','stable','down']))
);

-- prod: trg_upsell_clients_updated_at BEFORE UPDATE → update_upsell_updated_at()
CREATE OR REPLACE FUNCTION public.update_upsell_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;
CREATE TRIGGER trg_upsell_clients_updated_at BEFORE UPDATE ON public.upsell_clients
  FOR EACH ROW EXECUTE FUNCTION public.update_upsell_updated_at();

CREATE TABLE public.upsell_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  client_id uuid NOT NULL,
  product_name text NOT NULL,
  product_type text NOT NULL DEFAULT 'unitario',
  sale_value numeric NOT NULL,
  sold_at timestamptz NOT NULL DEFAULT now(),
  approval_status text NOT NULL DEFAULT 'pending'::text,
  CONSTRAINT upsell_orders_sale_value_check CHECK (sale_value > 0::numeric),
  CONSTRAINT upsell_orders_approval_status_check CHECK (approval_status = ANY (ARRAY['pending','approved','rejected'])),
  CONSTRAINT upsell_orders_product_type_check CHECK (product_type = ANY (ARRAY['mrr','projeto','unitario']))
);

CREATE TABLE public.conversation_context_summary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  engagement_score integer DEFAULT 0,
  CONSTRAINT unique_context_per_lead UNIQUE (lead_id)
);

CREATE TABLE public.whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  lead_id uuid,
  direction text NOT NULL,
  "timestamp" timestamptz NOT NULL
);

CREATE TABLE public.client_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  client_id uuid NOT NULL,
  alert_type text NOT NULL,
  severity text NOT NULL DEFAULT 'warning'::text,
  title text NOT NULL,
  description text,
  metadata jsonb DEFAULT '{}'::jsonb,
  is_resolved boolean DEFAULT false,
  resolved_at timestamptz,
  created_at timestamptz DEFAULT now(),
  notified_at timestamptz,
  CONSTRAINT client_alerts_alert_type_check CHECK (alert_type = ANY (ARRAY['reorder_overdue','ticket_declining','product_missing','cycle_stretching','engagement_cold','nps_low'])),
  CONSTRAINT client_alerts_severity_check CHECK (severity = ANY (ARRAY['info','warning','critical']))
);

CREATE TABLE public.client_health_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  health_score integer NOT NULL,
  health_status text NOT NULL,
  segment text NOT NULL,
  snapshot_date date NOT NULL DEFAULT CURRENT_DATE,
  CONSTRAINT client_health_snapshots_client_id_snapshot_date_key UNIQUE (client_id, snapshot_date)
);

-- RLS ligada como em prod; nenhuma policy aqui → só service_role (BYPASSRLS)
-- enxerga linhas. Prova que as RPCs INVOKER dependem do papel que chama.
ALTER TABLE public.upsell_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upsell_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_context_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_health_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copilot_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
