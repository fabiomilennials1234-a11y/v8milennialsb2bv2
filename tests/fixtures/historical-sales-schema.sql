CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TABLE organizations(id uuid PRIMARY KEY, timezone text DEFAULT 'America/Sao_Paulo', carteira_emits_revenue_enabled boolean DEFAULT true, default_reorder_cycle_days integer DEFAULT 30);
CREATE TABLE team_members(id uuid PRIMARY KEY, user_id uuid, organization_id uuid, is_active boolean DEFAULT true, role text DEFAULT 'member');
CREATE TABLE companies(id uuid PRIMARY KEY);
CREATE TABLE products(id uuid PRIMARY KEY);
CREATE TABLE upsell_campanhas(id uuid PRIMARY KEY);
CREATE TABLE pipeline_entries(id uuid PRIMARY KEY);
CREATE TABLE pipeline_stages(organization_id uuid,pipeline_type text,stage_key text,is_active boolean,auto_move_min_days integer,auto_move_max_days integer,position integer);
CREATE TABLE leads(id uuid PRIMARY KEY, organization_id uuid REFERENCES organizations(id), name text, company text, email text, phone text, deleted_at timestamptz, sale_responsible_id uuid, pre_sale_responsible_id uuid);
CREATE FUNCTION get_my_organization_ids() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT organization_id FROM team_members WHERE user_id=auth.uid() AND is_active $$;
CREATE FUNCTION is_master_user() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION assert_org_member(p_org_id uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF NOT EXISTS(SELECT 1 FROM get_my_organization_ids() AS t(id) WHERE id=p_org_id) THEN RAISE EXCEPTION 'access denied' USING ERRCODE='42501'; END IF; END $$;
CREATE FUNCTION can_link_or_read_lead(p_lead_id uuid,p_org uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS(SELECT 1 FROM leads l JOIN team_members m ON m.organization_id=l.organization_id AND m.user_id=auth.uid() AND m.is_active WHERE l.id=p_lead_id AND l.organization_id=p_org AND (l.sale_responsible_id IS NULL OR l.sale_responsible_id=m.id)) $$;

CREATE TABLE public.deals (id uuid NOT NULL DEFAULT gen_random_uuid(),
organization_id uuid NOT NULL,
title text NOT NULL,
value numeric,
currency text DEFAULT 'BRL'::text,
company_id uuid,
owner_id uuid,
source_lead_id uuid,
probability integer,
expected_close_date date,
closed_at timestamp with time zone,
won boolean,
loss_reason text,
loss_reason_id uuid,
notes text,
metadata jsonb DEFAULT '{}'::jsonb,
created_by uuid,
deleted_at timestamp with time zone,
deleted_by uuid,
created_at timestamp with time zone NOT NULL DEFAULT now(),
updated_at timestamp with time zone NOT NULL DEFAULT now(),
source text NOT NULL,
last_activity_at timestamp with time zone,
outcome text NOT NULL DEFAULT 'open'::text,
outcome_at timestamp with time zone,
outcome_source text);
CREATE TABLE public.upsell_clients (id uuid NOT NULL DEFAULT gen_random_uuid(),
organization_id uuid NOT NULL,
lead_id uuid NOT NULL,
name text NOT NULL,
company text,
email text,
phone text,
potencial text NOT NULL DEFAULT 'medio',
tipo_cliente_tempo text NOT NULL DEFAULT '0-3m'::text,
is_active boolean NOT NULL DEFAULT true,
closer_id uuid,
first_sale_at timestamp with time zone NOT NULL DEFAULT now(),
churned_at timestamp with time zone,
reactivated_at timestamp with time zone,
created_at timestamp with time zone NOT NULL DEFAULT now(),
updated_at timestamp with time zone NOT NULL DEFAULT now(),
gestao_stage text DEFAULT 'primeira_compra'::text,
gestao_manual_override boolean NOT NULL DEFAULT false,
responsible_id uuid,
pre_sale_responsible_id uuid,
sale_responsible_id uuid,
reorder_cycle_days integer,
days_since_last_order integer,
last_order_at timestamp with time zone,
next_order_expected timestamp with time zone,
order_count integer DEFAULT 0,
lifetime_value numeric DEFAULT 0,
avg_ticket numeric,
health_score integer DEFAULT 100,
health_status text DEFAULT 'saudavel'::text,
health_updated_at timestamp with time zone,
segment text DEFAULT 'novo'::text,
company_id uuid,
trend text,
churn_probability integer DEFAULT 0,
cnpj text,
tiny_contact_id text,
external_source text,
tiny_synced_at timestamp with time zone,
external_id text,
external_ref text,
erp_company text,
erp_owner_name text,
erp_owner_external_id text,
erp_status text,
erp_segment text,
erp_registered_at date,
erp_city text,
erp_uf text,
erp_metadata jsonb,
erp_last_order_at date,
erp_order_count integer,
erp_first_order_at date,
erp_avg_days_between_orders numeric,
erp_orders_computed_at timestamp with time zone);
CREATE TABLE public.upsell_orders (id uuid NOT NULL DEFAULT gen_random_uuid(),
organization_id uuid NOT NULL,
client_id uuid NOT NULL,
closer_id uuid,
product_id uuid,
product_name text NOT NULL,
product_type text NOT NULL,
sale_value numeric NOT NULL,
origin text NOT NULL DEFAULT 'upsell'::text,
campanha_id uuid,
pipe_proposta_id uuid,
sold_at timestamp with time zone NOT NULL DEFAULT now(),
notes text,
created_at timestamp with time zone NOT NULL DEFAULT now(),
responsible_id uuid,
pre_sale_responsible_id uuid,
sale_responsible_id uuid,
source text DEFAULT 'pipe'::text,
approval_status text NOT NULL DEFAULT 'pending'::text,
approved_by uuid,
approved_at timestamp with time zone,
approval_comment text,
tiny_order_id text,
external_source text,
external_id text,
external_ref text,
erp_status text);
CREATE TABLE public.sale_events (id uuid NOT NULL DEFAULT gen_random_uuid(),
organization_id uuid NOT NULL,
lead_id uuid NOT NULL,
pipeline_id uuid,
stage_key text,
stage_event_id uuid,
event_type text NOT NULL,
reversed_event_id uuid,
sold_at timestamp with time zone NOT NULL DEFAULT now(),
sale_value numeric,
currency text NOT NULL DEFAULT 'BRL'::text,
revenue_stream text NOT NULL,
sale_responsible_id uuid,
pre_sale_responsible_id uuid,
actor uuid,
source text NOT NULL DEFAULT 'trigger'::text,
created_at timestamp with time zone NOT NULL DEFAULT now(),
producer text NOT NULL DEFAULT 'funnel'::text,
origin_record_id uuid,
deal_id uuid);
ALTER TABLE deals ADD FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL;
ALTER TABLE deals ADD FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE deals ADD FOREIGN KEY (deleted_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE deals ADD FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE deals ADD CHECK ((outcome = ANY (ARRAY['open'::text, 'won'::text, 'lost'::text])));
ALTER TABLE deals ADD CHECK (((outcome_source IS NULL) OR (outcome_source = ANY (ARRAY['stage'::text, 'workflow'::text, 'ui'::text, 'backfill'::text, 'api'::text]))));
ALTER TABLE deals ADD FOREIGN KEY (owner_id) REFERENCES team_members(id) ON DELETE SET NULL;
ALTER TABLE deals ADD PRIMARY KEY (id);
ALTER TABLE deals ADD CHECK (((probability >= 0) AND (probability <= 100)));
ALTER TABLE deals ADD CHECK (((source IS NULL) OR (source = ANY (ARRAY['human'::text, 'workflow'::text, 'api'::text, 'import'::text, 'backfill'::text, 'backfill_funil_custom'::text, 'entrada_materializada'::text]))));
ALTER TABLE deals ADD FOREIGN KEY (source_lead_id) REFERENCES leads(id) ON DELETE SET NULL;
ALTER TABLE sale_events ADD CHECK ((currency ~ '^[A-Z]{3}$'::text));
ALTER TABLE sale_events ADD FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE SET NULL;
ALTER TABLE sale_events ADD CHECK ((event_type = ANY (ARRAY['sale'::text, 'sale_reversed'::text, 'sale_lost'::text])));
ALTER TABLE sale_events ADD FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;
ALTER TABLE sale_events ADD FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE sale_events ADD CHECK (((producer = ANY (ARRAY['funnel'::text, 'deal'::text])) OR (origin_record_id IS NOT NULL)));
ALTER TABLE sale_events ADD PRIMARY KEY (id);
ALTER TABLE sale_events ADD CHECK ((producer = ANY (ARRAY['funnel'::text, 'carteira'::text, 'deal'::text])));
ALTER TABLE sale_events ADD CHECK (
CASE producer
    WHEN 'funnel'::text THEN ((pipeline_id IS NOT NULL) AND (stage_key IS NOT NULL))
    WHEN 'carteira'::text THEN true
    WHEN 'deal'::text THEN (deal_id IS NOT NULL)
    ELSE false
END);
ALTER TABLE sale_events ADD CHECK ((revenue_stream = ANY (ARRAY['novo_negocio'::text, 'carteira'::text])));
ALTER TABLE sale_events ADD CHECK (((event_type = 'sale_reversed'::text) = (reversed_event_id IS NOT NULL)));
ALTER TABLE sale_events ADD FOREIGN KEY (reversed_event_id) REFERENCES sale_events(id) ON DELETE CASCADE;
ALTER TABLE sale_events ADD CHECK ((source = ANY (ARRAY['trigger'::text, 'backfill'::text, 'stage'::text, 'ui'::text, 'workflow'::text, 'api'::text])));
ALTER TABLE sale_events ADD CHECK (((sale_value IS NULL) OR (sale_value >= (0)::numeric)));
ALTER TABLE upsell_clients ADD CHECK (((churn_probability >= 0) AND (churn_probability <= 100)));
ALTER TABLE upsell_clients ADD FOREIGN KEY (closer_id) REFERENCES team_members(id) ON DELETE SET NULL;
ALTER TABLE upsell_clients ADD FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL;
ALTER TABLE upsell_clients ADD CHECK ((health_status = ANY (ARRAY['saudavel'::text, 'atencao'::text, 'risco'::text, 'inativo'::text])));
ALTER TABLE upsell_clients ADD FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;
ALTER TABLE upsell_clients ADD FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE upsell_clients ADD UNIQUE (organization_id, lead_id);
ALTER TABLE upsell_clients ADD PRIMARY KEY (id);
ALTER TABLE upsell_clients ADD FOREIGN KEY (pre_sale_responsible_id) REFERENCES team_members(id) ON DELETE SET NULL;
ALTER TABLE upsell_clients ADD FOREIGN KEY (responsible_id) REFERENCES team_members(id) ON DELETE SET NULL;
ALTER TABLE upsell_clients ADD FOREIGN KEY (sale_responsible_id) REFERENCES team_members(id) ON DELETE SET NULL;
ALTER TABLE upsell_clients ADD CHECK ((segment = ANY (ARRAY['ouro'::text, 'prata'::text, 'novo'::text, 'resgate'::text, 'dormindo'::text])));
ALTER TABLE upsell_clients ADD CHECK ((trend = ANY (ARRAY['up'::text, 'stable'::text, 'down'::text])));
ALTER TABLE upsell_orders ADD CHECK ((approval_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])));
ALTER TABLE upsell_orders ADD FOREIGN KEY (approved_by) REFERENCES auth.users(id);
ALTER TABLE upsell_orders ADD FOREIGN KEY (campanha_id) REFERENCES upsell_campanhas(id) ON DELETE SET NULL;
ALTER TABLE upsell_orders ADD FOREIGN KEY (client_id) REFERENCES upsell_clients(id) ON DELETE CASCADE;
ALTER TABLE upsell_orders ADD FOREIGN KEY (closer_id) REFERENCES team_members(id) ON DELETE SET NULL;
ALTER TABLE upsell_orders ADD FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE upsell_orders ADD CHECK ((origin = ANY (ARRAY['new_business'::text, 'upsell'::text])));
ALTER TABLE upsell_orders ADD FOREIGN KEY (pipe_proposta_id) REFERENCES pipeline_entries(id) ON DELETE SET NULL;
ALTER TABLE upsell_orders ADD PRIMARY KEY (id);
ALTER TABLE upsell_orders ADD FOREIGN KEY (pre_sale_responsible_id) REFERENCES team_members(id) ON DELETE SET NULL;
ALTER TABLE upsell_orders ADD FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE upsell_orders ADD CHECK ((product_type = ANY (ARRAY['mrr'::text, 'projeto'::text, 'unitario'::text])));
ALTER TABLE upsell_orders ADD FOREIGN KEY (responsible_id) REFERENCES team_members(id) ON DELETE SET NULL;
ALTER TABLE upsell_orders ADD FOREIGN KEY (sale_responsible_id) REFERENCES team_members(id) ON DELETE SET NULL;
ALTER TABLE upsell_orders ADD CHECK ((sale_value > (0)::numeric));
ALTER TABLE upsell_orders ADD CHECK ((source = ANY (ARRAY['pipe'::text, 'manual'::text, 'erp'::text, 'copilot'::text, 'csv_import'::text])));
CREATE UNIQUE INDEX sale_origin ON sale_events(producer,origin_record_id,event_type) WHERE origin_record_id IS NOT NULL;
CREATE OR REPLACE FUNCTION public.fn_carteira_emit_sale_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_enabled boolean; v_lead_id uuid; v_stream text;
BEGIN
  SELECT o.carteira_emits_revenue_enabled INTO v_enabled FROM public.organizations o WHERE o.id = NEW.organization_id;
  IF NOT coalesce(v_enabled, false) THEN RETURN NULL; END IF;
  SELECT c.lead_id INTO v_lead_id FROM public.upsell_clients c
    WHERE c.id = NEW.client_id AND c.organization_id = NEW.organization_id;
  IF v_lead_id IS NULL THEN RETURN NULL; END IF;
  v_stream := public.metric_revenue_stream(NEW.organization_id, v_lead_id, NEW.sold_at);
  INSERT INTO public.sale_events (
    organization_id, lead_id, pipeline_id, stage_key, event_type, sold_at, sale_value, currency,
    revenue_stream, sale_responsible_id, pre_sale_responsible_id, actor, source, producer, origin_record_id
  ) VALUES (
    NEW.organization_id, v_lead_id, NULL, NULL, 'sale', NEW.sold_at, NEW.sale_value, 'BRL',
    v_stream, NEW.sale_responsible_id, NEW.pre_sale_responsible_id, NEW.approved_by, 'trigger', 'carteira', NEW.id
  )
  ON CONFLICT (producer, origin_record_id, event_type) WHERE origin_record_id IS NOT NULL DO NOTHING;
  RETURN NULL;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_deals_exige_procedencia()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.source IS NULL THEN
    RAISE EXCEPTION
      'Procedência é obrigatória ao abrir um Negócio. Informe uma de: human, workflow, api, import, backfill, backfill_funil_custom.'
      USING ERRCODE = 'not_null_violation';
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.fn_sale_events_force_sold_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.source <> 'backfill' AND NEW.producer <> 'carteira' THEN
    NEW.sold_at := now();
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.recalc_upsell_client_metrics(p_client_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_org_id        uuid;
  v_org_default   int;
  v_order_count   int;   -- LINHAS de item (inalterado de propósito — ver cabeçalho)
  v_day_count     int;   -- PEDIDOS de verdade (dias UTC distintos com venda)
  v_total         numeric;
  v_avg           numeric;
  v_last          timestamptz;
  v_cycle         int;
  v_days_since    int;
  v_next          timestamptz;
  v_now           timestamptz := now();
BEGIN
  IF p_client_id IS NULL THEN
    RETURN;
  END IF;

  -- FOR UPDATE serializa recomputes concorrentes do MESMO cliente: sob READ
  -- COMMITTED, o 2º recompute espera o 1º commitar e então enxerga o order dele
  -- no agregado — evita lost-update (order_count/lifetime sobrescritos).
  SELECT organization_id INTO v_org_id
  FROM upsell_clients WHERE id = p_client_id
  FOR UPDATE;

  IF v_org_id IS NULL THEN
    RETURN; -- cliente inexistente (ex.: já deletado)
  END IF;

  -- default org de ciclo de recompra (fallback 30) — espelha orgDefaultCycleDays
  SELECT COALESCE(default_reorder_cycle_days, 30) INTO v_org_default
  FROM organizations WHERE id = v_org_id;
  v_org_default := COALESCE(v_org_default, 30);

  -- Agregados dos orders APPROVED (mesmo filtro do edge fn).
  -- count(*) = linhas; count(DISTINCT dia UTC) = pedidos de verdade.
  SELECT count(*),
         count(DISTINCT (sold_at AT TIME ZONE 'UTC')::date),
         COALESCE(sum(sale_value), 0),  -- metric-lint-allow: linha herdada verbatim da função viva; receita inalterada, ver cabeçalho (ADR-0017 SP-3)
         max(sold_at)
    INTO v_order_count, v_day_count, v_total, v_last
  FROM upsell_orders
  WHERE client_id = p_client_id
    AND approval_status = 'approved';

  -- avg_ticket: total / PEDIDOS, NULL se 0 (espelha `avgTicket || null` em JS)
  v_avg := CASE
             WHEN v_day_count > 0 AND v_total > 0 THEN v_total / v_day_count
             ELSE NULL
           END;

  -- reorder_cycle_days: < 2 PEDIDOS → default da org (não há gap pra medir);
  -- senão média dos gaps entre dias distintos, arredondada, mínimo 1.
  -- Espelha computeCycleDays(groupOrdersByDay(orders), orgDefault).
  IF v_day_count < 2 THEN
    v_cycle := v_org_default;
  ELSE
    SELECT round(avg(gap_days))::int
      INTO v_cycle
    FROM (
      SELECT (dia - lag(dia) OVER (ORDER BY dia))::numeric AS gap_days
      FROM (
        SELECT DISTINCT (sold_at AT TIME ZONE 'UTC')::date AS dia
        FROM upsell_orders
        WHERE client_id = p_client_id
          AND approval_status = 'approved'
      ) d
    ) g
    WHERE gap_days IS NOT NULL;
    -- COALESCE ANTES do GREATEST: GREATEST(1, NULL) = 1 em Postgres, então na
    -- ordem inversa o fallback pro default da org nunca disparava.
    v_cycle := GREATEST(1, COALESCE(v_cycle, v_org_default));
  END IF;

  -- days_since_last_order: 999 se nunca comprou (espelha edge fn); senão dias
  v_days_since := CASE
                    WHEN v_last IS NULL THEN 999
                    ELSE GREATEST(0, round(EXTRACT(EPOCH FROM (v_now - v_last)) / 86400.0)::int)
                  END;

  -- next_order_expected: último + ciclo (NULL se sem orders)
  v_next := CASE
              WHEN v_last IS NULL THEN NULL
              ELSE v_last + (v_cycle || ' days')::interval
            END;

  UPDATE upsell_clients SET
    order_count           = v_order_count,
    lifetime_value        = v_total,
    avg_ticket            = v_avg,
    last_order_at         = v_last,
    reorder_cycle_days    = v_cycle,
    days_since_last_order = v_days_since,
    next_order_expected   = v_next,
    updated_at            = v_now
  WHERE id = p_client_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.metric_revenue_stream(p_org_id uuid, p_lead_id uuid, p_sold_at timestamp with time zone, p_exclude_sale_event_id uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.sale_events e
      WHERE e.organization_id = p_org_id
        AND e.lead_id         = p_lead_id
        AND e.event_type      = 'sale'
        AND e.sold_at         < p_sold_at
        AND (p_exclude_sale_event_id IS NULL OR e.id <> p_exclude_sale_event_id)
        AND NOT EXISTS (
          SELECT 1
          FROM public.sale_events r
          WHERE r.event_type        = 'sale_reversed'
            AND r.reversed_event_id = e.id
        )
    )
    THEN 'carteira'
    ELSE 'novo_negocio'
  END;
$function$
;
CREATE TRIGGER emit_sale AFTER INSERT ON upsell_orders FOR EACH ROW WHEN (new.approval_status='approved') EXECUTE FUNCTION fn_carteira_emit_sale_event();
CREATE TRIGGER sale_date BEFORE INSERT ON sale_events FOR EACH ROW EXECUTE FUNCTION fn_sale_events_force_sold_at();
CREATE FUNCTION recalc_order_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM recalc_upsell_client_metrics(NEW.client_id); RETURN NEW; END $$;
CREATE TRIGGER recalc_order AFTER INSERT ON upsell_orders FOR EACH ROW EXECUTE FUNCTION recalc_order_fixture();
GRANT USAGE ON SCHEMA public,auth TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
