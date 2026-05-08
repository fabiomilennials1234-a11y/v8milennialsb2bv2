# Dual Responsible Fields (Pré-Venda / Venda) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace single `responsible_id` with two fields — `pre_sale_responsible_id` (meetings attribution) and `sale_responsible_id` (sales/closing attribution) — across all tables, RPCs, hooks, components, and edge functions.

**Architecture:** Add two new FK columns to every table that currently has responsible/sdr/closer fields. Migrate data from legacy fields. Update all RPCs, triggers, RLS functions to use dual fields. Update frontend to show two dropdowns everywhere. Keep legacy fields temporarily for backward compatibility but stop writing to them.

**Tech Stack:** PostgreSQL (migrations), TypeScript/React (frontend), Deno (edge functions)

---

## Phase 1: Database Migration

### Task 1: Schema — Add dual responsible columns to all tables

**Files:**
- Create: `supabase/migrations/20260930000000_dual_responsible_fields.sql`

- [ ] **Step 1: Create migration file with column additions**

```sql
BEGIN;

-- ============================================
-- 1. ADD COLUMNS TO ALL TABLES
-- ============================================

-- leads
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS pre_sale_responsible_id UUID REFERENCES public.team_members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sale_responsible_id UUID REFERENCES public.team_members(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_leads_pre_sale_responsible ON public.leads(pre_sale_responsible_id);
CREATE INDEX IF NOT EXISTS idx_leads_sale_responsible ON public.leads(sale_responsible_id);

-- pipe_whatsapp
ALTER TABLE public.pipe_whatsapp
  ADD COLUMN IF NOT EXISTS pre_sale_responsible_id UUID REFERENCES public.team_members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sale_responsible_id UUID REFERENCES public.team_members(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_pipe_whatsapp_pre_sale ON public.pipe_whatsapp(pre_sale_responsible_id);
CREATE INDEX IF NOT EXISTS idx_pipe_whatsapp_sale ON public.pipe_whatsapp(sale_responsible_id);

-- pipe_confirmacao
ALTER TABLE public.pipe_confirmacao
  ADD COLUMN IF NOT EXISTS pre_sale_responsible_id UUID REFERENCES public.team_members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sale_responsible_id UUID REFERENCES public.team_members(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_pipe_confirmacao_pre_sale ON public.pipe_confirmacao(pre_sale_responsible_id);
CREATE INDEX IF NOT EXISTS idx_pipe_confirmacao_sale ON public.pipe_confirmacao(sale_responsible_id);

-- pipe_propostas
ALTER TABLE public.pipe_propostas
  ADD COLUMN IF NOT EXISTS pre_sale_responsible_id UUID REFERENCES public.team_members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sale_responsible_id UUID REFERENCES public.team_members(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_pipe_propostas_pre_sale ON public.pipe_propostas(pre_sale_responsible_id);
CREATE INDEX IF NOT EXISTS idx_pipe_propostas_sale ON public.pipe_propostas(sale_responsible_id);

-- campanha_leads
ALTER TABLE public.campanha_leads
  ADD COLUMN IF NOT EXISTS pre_sale_responsible_id UUID REFERENCES public.team_members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sale_responsible_id UUID REFERENCES public.team_members(id) ON DELETE SET NULL;

-- custom_pipe_entries
ALTER TABLE public.custom_pipe_entries
  ADD COLUMN IF NOT EXISTS pre_sale_responsible_id UUID REFERENCES public.team_members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sale_responsible_id UUID REFERENCES public.team_members(id) ON DELETE SET NULL;

-- upsell_clients
ALTER TABLE public.upsell_clients
  ADD COLUMN IF NOT EXISTS pre_sale_responsible_id UUID REFERENCES public.team_members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sale_responsible_id UUID REFERENCES public.team_members(id) ON DELETE SET NULL;

-- upsell_campanhas
ALTER TABLE public.upsell_campanhas
  ADD COLUMN IF NOT EXISTS pre_sale_responsible_id UUID REFERENCES public.team_members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sale_responsible_id UUID REFERENCES public.team_members(id) ON DELETE SET NULL;

-- upsell_orders
ALTER TABLE public.upsell_orders
  ADD COLUMN IF NOT EXISTS pre_sale_responsible_id UUID REFERENCES public.team_members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sale_responsible_id UUID REFERENCES public.team_members(id) ON DELETE SET NULL;
```

- [ ] **Step 2: Add data migration from legacy fields**

```sql
-- ============================================
-- 2. MIGRATE EXISTING DATA
-- ============================================

-- leads: pre_sale from sdr_id or responsible_id, sale from closer_id or responsible_id
UPDATE public.leads SET
  pre_sale_responsible_id = COALESCE(sdr_id, responsible_id),
  sale_responsible_id = COALESCE(closer_id, responsible_id)
WHERE pre_sale_responsible_id IS NULL AND sale_responsible_id IS NULL;

-- pipe_whatsapp
UPDATE public.pipe_whatsapp SET
  pre_sale_responsible_id = COALESCE(sdr_id, responsible_id),
  sale_responsible_id = responsible_id
WHERE pre_sale_responsible_id IS NULL AND sale_responsible_id IS NULL;

-- pipe_confirmacao
UPDATE public.pipe_confirmacao SET
  pre_sale_responsible_id = COALESCE(sdr_id, responsible_id),
  sale_responsible_id = COALESCE(closer_id, responsible_id)
WHERE pre_sale_responsible_id IS NULL AND sale_responsible_id IS NULL;

-- pipe_propostas
UPDATE public.pipe_propostas SET
  pre_sale_responsible_id = responsible_id,
  sale_responsible_id = COALESCE(closer_id, responsible_id)
WHERE pre_sale_responsible_id IS NULL AND sale_responsible_id IS NULL;

-- campanha_leads
UPDATE public.campanha_leads SET
  pre_sale_responsible_id = COALESCE(sdr_id, responsible_id),
  sale_responsible_id = COALESCE(closer_id, responsible_id)
WHERE pre_sale_responsible_id IS NULL AND sale_responsible_id IS NULL;

-- custom_pipe_entries
UPDATE public.custom_pipe_entries SET
  pre_sale_responsible_id = responsible_id,
  sale_responsible_id = responsible_id
WHERE pre_sale_responsible_id IS NULL AND sale_responsible_id IS NULL
  AND responsible_id IS NOT NULL;

-- upsell_clients
UPDATE public.upsell_clients SET
  pre_sale_responsible_id = responsible_id,
  sale_responsible_id = COALESCE(closer_id, responsible_id)
WHERE pre_sale_responsible_id IS NULL AND sale_responsible_id IS NULL;

-- upsell_orders
UPDATE public.upsell_orders SET
  pre_sale_responsible_id = responsible_id,
  sale_responsible_id = COALESCE(closer_id, responsible_id)
WHERE pre_sale_responsible_id IS NULL AND sale_responsible_id IS NULL;
```

- [ ] **Step 3: Add trigger to sync dual fields from pipes to leads**

```sql
-- ============================================
-- 3. TRIGGER: SYNC DUAL RESPONSIBLE FROM PIPES TO LEADS
-- ============================================

CREATE OR REPLACE FUNCTION public.sync_dual_responsible_to_lead_from_pipe()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.leads SET
    pre_sale_responsible_id = COALESCE(
      NEW.pre_sale_responsible_id,
      leads.pre_sale_responsible_id
    ),
    sale_responsible_id = COALESCE(
      NEW.sale_responsible_id,
      leads.sale_responsible_id
    )
  WHERE id = NEW.lead_id
    AND (
      (NEW.pre_sale_responsible_id IS NOT NULL AND leads.pre_sale_responsible_id IS DISTINCT FROM NEW.pre_sale_responsible_id)
      OR
      (NEW.sale_responsible_id IS NOT NULL AND leads.sale_responsible_id IS DISTINCT FROM NEW.sale_responsible_id)
    );
  RETURN NEW;
END;
$$;

-- Drop old triggers
DROP TRIGGER IF EXISTS trg_sync_responsible_to_lead_from_pipe_whatsapp ON public.pipe_whatsapp;
DROP TRIGGER IF EXISTS trg_sync_responsible_to_lead_from_pipe_confirmacao ON public.pipe_confirmacao;
DROP TRIGGER IF EXISTS trg_sync_responsible_to_lead_from_pipe_propostas ON public.pipe_propostas;

-- Create new dual triggers
CREATE TRIGGER trg_sync_dual_responsible_pipe_whatsapp
  AFTER INSERT OR UPDATE OF pre_sale_responsible_id, sale_responsible_id ON public.pipe_whatsapp
  FOR EACH ROW EXECUTE FUNCTION public.sync_dual_responsible_to_lead_from_pipe();

CREATE TRIGGER trg_sync_dual_responsible_pipe_confirmacao
  AFTER INSERT OR UPDATE OF pre_sale_responsible_id, sale_responsible_id ON public.pipe_confirmacao
  FOR EACH ROW EXECUTE FUNCTION public.sync_dual_responsible_to_lead_from_pipe();

CREATE TRIGGER trg_sync_dual_responsible_pipe_propostas
  AFTER INSERT OR UPDATE OF pre_sale_responsible_id, sale_responsible_id ON public.pipe_propostas
  FOR EACH ROW EXECUTE FUNCTION public.sync_dual_responsible_to_lead_from_pipe();
```

- [ ] **Step 4: Update RLS functions for dual fields**

```sql
-- ============================================
-- 4. RLS FUNCTIONS — DUAL RESPONSIBLE
-- ============================================

CREATE OR REPLACE FUNCTION public.is_user_responsible(p_pre_sale UUID, p_sale UUID)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members
    WHERE user_id = auth.uid()
      AND id IN (p_pre_sale, p_sale)
  );
$$;

CREATE OR REPLACE FUNCTION public.is_user_responsible_in_any_pipe(p_lead_id UUID)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.pipe_whatsapp
    WHERE lead_id = p_lead_id
      AND (pre_sale_responsible_id IN (SELECT id FROM public.team_members WHERE user_id = auth.uid())
           OR sale_responsible_id IN (SELECT id FROM public.team_members WHERE user_id = auth.uid()))
    UNION ALL
    SELECT 1 FROM public.pipe_confirmacao
    WHERE lead_id = p_lead_id
      AND (pre_sale_responsible_id IN (SELECT id FROM public.team_members WHERE user_id = auth.uid())
           OR sale_responsible_id IN (SELECT id FROM public.team_members WHERE user_id = auth.uid()))
    UNION ALL
    SELECT 1 FROM public.pipe_propostas
    WHERE lead_id = p_lead_id
      AND (pre_sale_responsible_id IN (SELECT id FROM public.team_members WHERE user_id = auth.uid())
           OR sale_responsible_id IN (SELECT id FROM public.team_members WHERE user_id = auth.uid()))
  );
$$;
```

- [ ] **Step 5: Update RLS policies on leads**

```sql
-- ============================================
-- 5. RLS POLICIES — DUAL RESPONSIBLE
-- ============================================

DROP POLICY IF EXISTS "leads_select_by_responsibility_and_permissions" ON public.leads;
CREATE POLICY "leads_select_by_responsibility_and_permissions"
  ON public.leads FOR SELECT
  TO authenticated
  USING (
    organization_id = public.get_user_organization_id()
    AND (
      public.is_master_user()
      OR public.get_user_role() = 'admin'
      OR public.is_user_responsible(pre_sale_responsible_id, sale_responsible_id)
      OR public.is_user_responsible(responsible_id)
      OR public.is_user_responsible_in_any_pipe(id)
      OR public.can_see_lead_by_permissions(sdr_id, closer_id)
    )
  );

DROP POLICY IF EXISTS "leads_update_by_responsibility_and_permissions" ON public.leads;
CREATE POLICY "leads_update_by_responsibility_and_permissions"
  ON public.leads FOR UPDATE
  TO authenticated
  USING (
    organization_id = public.get_user_organization_id()
    AND (
      public.is_master_user()
      OR public.get_user_role() = 'admin'
      OR public.is_user_responsible(pre_sale_responsible_id, sale_responsible_id)
      OR public.is_user_responsible(responsible_id)
      OR public.is_user_responsible_in_any_pipe(id)
      OR public.can_see_lead_by_permissions(sdr_id, closer_id)
    )
  )
  WITH CHECK (
    organization_id = public.get_user_organization_id()
  );
```

- [ ] **Step 6: Update get_dashboard_metrics RPC**

```sql
-- ============================================
-- 6. DASHBOARD METRICS RPC — DUAL RESPONSIBLE
-- ============================================

CREATE OR REPLACE FUNCTION public.get_dashboard_metrics(
  p_org_id UUID,
  p_start_date TEXT,
  p_end_date TEXT,
  p_filter_member_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
  v_leads_total INT;
  v_leads_period INT;
  v_reunioes_marcadas INT;
  v_reunioes_comparecidas INT;
  v_no_show_count INT;
  v_no_show_total INT;
  v_funnel_total INT;
  v_funnel_enviadas INT;
  v_funnel_vendas INT;
  v_total_mrr NUMERIC;
  v_total_projeto NUMERIC;
  v_avg_response_time NUMERIC;
  v_daily_sales JSONB;
BEGIN
  -- Leads total
  SELECT count(*) INTO v_leads_total
  FROM public.leads
  WHERE organization_id = p_org_id
    AND (p_filter_member_id IS NULL
         OR pre_sale_responsible_id = p_filter_member_id
         OR sale_responsible_id = p_filter_member_id
         OR sdr_id = p_filter_member_id
         OR closer_id = p_filter_member_id
         OR responsible_id = p_filter_member_id);

  -- Leads period
  SELECT count(*) INTO v_leads_period
  FROM public.leads
  WHERE organization_id = p_org_id
    AND COALESCE(metrics_period_at, created_at) >= p_start_date::timestamptz
    AND COALESCE(metrics_period_at, created_at) <= p_end_date::timestamptz
    AND (p_filter_member_id IS NULL
         OR pre_sale_responsible_id = p_filter_member_id
         OR sale_responsible_id = p_filter_member_id
         OR sdr_id = p_filter_member_id
         OR closer_id = p_filter_member_id
         OR responsible_id = p_filter_member_id);

  -- Reuniões marcadas (attributed to pre_sale_responsible_id)
  SELECT count(*) INTO v_reunioes_marcadas
  FROM public.pipe_confirmacao
  WHERE organization_id = p_org_id
    AND COALESCE(metrics_period_at, created_at) >= p_start_date::timestamptz
    AND COALESCE(metrics_period_at, created_at) <= p_end_date::timestamptz
    AND (p_filter_member_id IS NULL
         OR pre_sale_responsible_id = p_filter_member_id
         OR sdr_id = p_filter_member_id
         OR responsible_id = p_filter_member_id);

  -- Comparecidas (attributed to pre_sale_responsible_id)
  SELECT count(*) INTO v_reunioes_comparecidas
  FROM public.pipe_confirmacao
  WHERE organization_id = p_org_id
    AND status = 'compareceu'
    AND COALESCE(metrics_period_at, created_at) >= p_start_date::timestamptz
    AND COALESCE(metrics_period_at, created_at) <= p_end_date::timestamptz
    AND (p_filter_member_id IS NULL
         OR pre_sale_responsible_id = p_filter_member_id
         OR sdr_id = p_filter_member_id
         OR responsible_id = p_filter_member_id);

  -- No-show (attributed to pre_sale_responsible_id)
  SELECT count(*) INTO v_no_show_count
  FROM public.pipe_confirmacao
  WHERE organization_id = p_org_id
    AND status IN ('perdido', 'remarcar')
    AND COALESCE(metrics_period_at, created_at) >= p_start_date::timestamptz
    AND COALESCE(metrics_period_at, created_at) <= p_end_date::timestamptz
    AND (p_filter_member_id IS NULL
         OR pre_sale_responsible_id = p_filter_member_id
         OR sdr_id = p_filter_member_id
         OR responsible_id = p_filter_member_id);

  SELECT count(*) INTO v_no_show_total
  FROM public.pipe_confirmacao
  WHERE organization_id = p_org_id
    AND meeting_date IS NOT NULL
    AND meeting_date::date < CURRENT_DATE
    AND COALESCE(metrics_period_at, created_at) >= p_start_date::timestamptz
    AND COALESCE(metrics_period_at, created_at) <= p_end_date::timestamptz
    AND (p_filter_member_id IS NULL
         OR pre_sale_responsible_id = p_filter_member_id
         OR sdr_id = p_filter_member_id
         OR responsible_id = p_filter_member_id);

  -- Propostas enviadas (attributed to sale_responsible_id)
  SELECT count(*) INTO v_funnel_enviadas
  FROM public.pipe_propostas
  WHERE organization_id = p_org_id
    AND COALESCE(metrics_period_at, created_at) >= p_start_date::timestamptz
    AND COALESCE(metrics_period_at, created_at) <= p_end_date::timestamptz
    AND (p_filter_member_id IS NULL
         OR sale_responsible_id = p_filter_member_id
         OR closer_id = p_filter_member_id
         OR responsible_id = p_filter_member_id);

  -- Vendas (attributed to sale_responsible_id)
  SELECT count(*) INTO v_funnel_vendas
  FROM public.pipe_propostas
  WHERE organization_id = p_org_id
    AND status = 'vendido'
    AND COALESCE(metrics_period_at, closed_at) >= p_start_date::timestamptz
    AND COALESCE(metrics_period_at, closed_at) <= p_end_date::timestamptz
    AND (p_filter_member_id IS NULL
         OR sale_responsible_id = p_filter_member_id
         OR closer_id = p_filter_member_id
         OR responsible_id = p_filter_member_id);

  -- Total no pipe
  SELECT count(*) INTO v_funnel_total
  FROM public.pipe_propostas
  WHERE organization_id = p_org_id
    AND (p_filter_member_id IS NULL
         OR sale_responsible_id = p_filter_member_id
         OR closer_id = p_filter_member_id
         OR responsible_id = p_filter_member_id);

  -- Revenue by type (attributed to sale_responsible_id)
  SELECT
    COALESCE(SUM(CASE WHEN pp.product_type = 'mrr' THEN pp.sale_value ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN pp.product_type = 'projeto' THEN pp.sale_value ELSE 0 END), 0)
  INTO v_total_mrr, v_total_projeto
  FROM public.pipe_propostas pp
  WHERE pp.organization_id = p_org_id
    AND pp.status = 'vendido'
    AND COALESCE(pp.metrics_period_at, pp.closed_at) >= p_start_date::timestamptz
    AND COALESCE(pp.metrics_period_at, pp.closed_at) <= p_end_date::timestamptz
    AND (p_filter_member_id IS NULL
         OR pp.sale_responsible_id = p_filter_member_id
         OR pp.closer_id = p_filter_member_id
         OR pp.responsible_id = p_filter_member_id);

  -- Avg response time
  SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (l.first_response_at - l.created_at)) / 3600), 0)
  INTO v_avg_response_time
  FROM public.leads l
  WHERE l.organization_id = p_org_id
    AND l.first_response_at IS NOT NULL
    AND COALESCE(l.metrics_period_at, l.created_at) >= p_start_date::timestamptz
    AND COALESCE(l.metrics_period_at, l.created_at) <= p_end_date::timestamptz
    AND (p_filter_member_id IS NULL
         OR l.pre_sale_responsible_id = p_filter_member_id
         OR l.sale_responsible_id = p_filter_member_id
         OR l.sdr_id = p_filter_member_id
         OR l.closer_id = p_filter_member_id
         OR l.responsible_id = p_filter_member_id);

  -- Daily sales
  SELECT COALESCE(jsonb_agg(row_to_json(d)), '[]'::jsonb)
  INTO v_daily_sales
  FROM (
    SELECT
      COALESCE(pp.metrics_period_at, pp.closed_at)::date as date,
      count(*) as count,
      COALESCE(SUM(pp.sale_value), 0) as value
    FROM public.pipe_propostas pp
    WHERE pp.organization_id = p_org_id
      AND pp.status = 'vendido'
      AND COALESCE(pp.metrics_period_at, pp.closed_at) >= p_start_date::timestamptz
      AND COALESCE(pp.metrics_period_at, pp.closed_at) <= p_end_date::timestamptz
      AND (p_filter_member_id IS NULL
           OR pp.sale_responsible_id = p_filter_member_id
           OR pp.closer_id = p_filter_member_id
           OR pp.responsible_id = p_filter_member_id)
    GROUP BY 1
    ORDER BY 1
  ) d;

  v_result := jsonb_build_object(
    'leads_total', v_leads_total,
    'leads_period', v_leads_period,
    'reunioes_marcadas', v_reunioes_marcadas,
    'reunioes_comparecidas', v_reunioes_comparecidas,
    'no_show_count', v_no_show_count,
    'no_show_total', v_no_show_total,
    'funnel_total', v_funnel_total,
    'funnel_enviadas', v_funnel_enviadas,
    'funnel_vendas', v_funnel_vendas,
    'total_mrr', v_total_mrr,
    'total_projeto', v_total_projeto,
    'avg_response_time_hours', ROUND(v_avg_response_time::numeric, 1),
    'daily_sales', v_daily_sales
  );

  RETURN v_result;
END;
$$;
```

- [ ] **Step 7: Update get_ranking_data RPC**

```sql
-- ============================================
-- 7. RANKING RPC — DUAL RESPONSIBLE
-- ============================================

CREATE OR REPLACE FUNCTION public.get_ranking_data(p_month INT, p_year INT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_org_id UUID;
  v_start_date TIMESTAMPTZ;
  v_end_date TIMESTAMPTZ;
  v_closer_ranking JSONB;
  v_sdr_ranking JSONB;
BEGIN
  SELECT public.get_user_organization_id() INTO v_org_id;
  v_start_date := make_timestamptz(p_year, p_month, 1, 0, 0, 0, 'UTC');
  v_end_date := (v_start_date + INTERVAL '1 month' - INTERVAL '1 second');

  -- Closer ranking: grouped by sale_responsible_id (fallback closer_id)
  WITH sales_agg AS (
    SELECT
      COALESCE(pp.sale_responsible_id, pp.closer_id) as member_id,
      COALESCE(SUM(pp.sale_value), 0) as total_value,
      count(*) as conversions
    FROM public.pipe_propostas pp
    WHERE pp.organization_id = v_org_id
      AND pp.status = 'vendido'
      AND COALESCE(pp.sale_responsible_id, pp.closer_id) IS NOT NULL
      AND (
        (pp.metrics_period_at >= v_start_date AND pp.metrics_period_at <= v_end_date)
        OR (pp.metrics_period_at IS NULL AND pp.closed_at >= v_start_date AND pp.closed_at <= v_end_date)
      )
    GROUP BY COALESCE(pp.sale_responsible_id, pp.closer_id)
  )
  SELECT COALESCE(jsonb_agg(row_to_json(r)), '[]'::jsonb) INTO v_closer_ranking
  FROM (
    SELECT
      tm.id,
      tm.name,
      COALESCE(sa.total_value, 0) as value,
      COALESCE(sa.conversions, 0) as conversions,
      COALESCE(g.target_value, 0) as goal,
      CASE WHEN COALESCE(g.target_value, 0) > 0
        THEN ROUND((COALESCE(sa.total_value, 0) / g.target_value) * 100, 1)
        ELSE 0
      END as "goalProgress",
      ROW_NUMBER() OVER (ORDER BY COALESCE(sa.total_value, 0) DESC) as position,
      tm.role
    FROM public.team_members tm
    LEFT JOIN sales_agg sa ON sa.member_id = tm.id
    LEFT JOIN public.goals g ON g.team_member_id = tm.id
      AND g.type = 'vendas' AND g.month = p_month AND g.year = p_year
    WHERE tm.organization_id = v_org_id
      AND tm.is_active = true
      AND (tm.metric_type = 'sales' OR tm.role IN ('closer', 'agency'))
    ORDER BY COALESCE(sa.total_value, 0) DESC
  ) r;

  -- SDR ranking: grouped by pre_sale_responsible_id (fallback sdr_id)
  WITH meetings_agg AS (
    SELECT
      COALESCE(pc.pre_sale_responsible_id, pc.sdr_id) as member_id,
      count(*) as meeting_count
    FROM public.pipe_confirmacao pc
    WHERE pc.organization_id = v_org_id
      AND pc.status = 'compareceu'
      AND COALESCE(pc.pre_sale_responsible_id, pc.sdr_id) IS NOT NULL
      AND (
        (pc.metrics_period_at >= v_start_date AND pc.metrics_period_at <= v_end_date)
        OR (pc.metrics_period_at IS NULL AND pc.created_at >= v_start_date AND pc.created_at <= v_end_date)
      )
    GROUP BY COALESCE(pc.pre_sale_responsible_id, pc.sdr_id)
  )
  SELECT COALESCE(jsonb_agg(row_to_json(r)), '[]'::jsonb) INTO v_sdr_ranking
  FROM (
    SELECT
      tm.id,
      tm.name,
      COALESCE(ma.meeting_count, 0) as value,
      COALESCE(ma.meeting_count, 0) as meetings,
      COALESCE(g.target_value, 0) as goal,
      CASE WHEN COALESCE(g.target_value, 0) > 0
        THEN ROUND((COALESCE(ma.meeting_count, 0) / g.target_value) * 100, 1)
        ELSE 0
      END as "goalProgress",
      ROW_NUMBER() OVER (ORDER BY COALESCE(ma.meeting_count, 0) DESC) as position,
      tm.role
    FROM public.team_members tm
    LEFT JOIN meetings_agg ma ON ma.member_id = tm.id
    LEFT JOIN public.goals g ON g.team_member_id = tm.id
      AND g.type = 'reunioes' AND g.month = p_month AND g.year = p_year
    WHERE tm.organization_id = v_org_id
      AND tm.is_active = true
      AND (tm.metric_type = 'meetings' OR tm.role IN ('sdr', 'bdr'))
    ORDER BY COALESCE(ma.meeting_count, 0) DESC
  ) r;

  RETURN jsonb_build_object(
    'closerRanking', v_closer_ranking,
    'sdrRanking', v_sdr_ranking
  );
END;
$$;
```

- [ ] **Step 8: Update round-robin distribution RPCs**

```sql
-- ============================================
-- 8. DISTRIBUTION RPCs — DUAL RESPONSIBLE
-- ============================================

-- Update distribute_pipe_round_robin to count by pre_sale/sale
CREATE OR REPLACE FUNCTION public.distribute_pipe_round_robin(
  p_pipe_type TEXT,
  p_organization_id UUID,
  p_member_ids UUID[]
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_mid UUID;
  v_count INT;
  v_min_count INT := 2147483647;
  v_chosen UUID;
BEGIN
  FOREACH v_mid IN ARRAY p_member_ids LOOP
    v_count := 0;

    SELECT v_count + count(*) INTO v_count
    FROM public.pipe_whatsapp
    WHERE organization_id = p_organization_id
      AND pre_sale_responsible_id = v_mid
      AND status NOT IN ('vendido', 'perdido', 'cancelado');

    SELECT v_count + count(*) INTO v_count
    FROM public.pipe_confirmacao
    WHERE organization_id = p_organization_id
      AND pre_sale_responsible_id = v_mid
      AND status NOT IN ('vendido', 'perdido', 'cancelado');

    SELECT v_count + count(*) INTO v_count
    FROM public.pipe_propostas
    WHERE organization_id = p_organization_id
      AND sale_responsible_id = v_mid
      AND status NOT IN ('vendido', 'perdido', 'cancelado');

    IF v_count < v_min_count THEN
      v_min_count := v_count;
      v_chosen := v_mid;
    END IF;
  END LOOP;

  RETURN v_chosen;
END;
$$;
```

- [ ] **Step 9: Add verification and COMMIT**

```sql
-- ============================================
-- 9. VERIFICATION
-- ============================================
DO $$
DECLARE
  v_leads_migrated INT;
  v_pipes_migrated INT;
BEGIN
  SELECT count(*) INTO v_leads_migrated
  FROM public.leads
  WHERE pre_sale_responsible_id IS NOT NULL OR sale_responsible_id IS NOT NULL;

  SELECT count(*) INTO v_pipes_migrated
  FROM public.pipe_whatsapp
  WHERE pre_sale_responsible_id IS NOT NULL OR sale_responsible_id IS NOT NULL;

  RAISE NOTICE 'Dual responsible migration: % leads, % pipe_whatsapp records migrated',
    v_leads_migrated, v_pipes_migrated;
END $$;

COMMIT;
```

- [ ] **Step 10: Commit migration**

```bash
git add supabase/migrations/20260930000000_dual_responsible_fields.sql
git commit -m "feat(db): add dual responsible fields (pre_sale + sale) to all tables

Add pre_sale_responsible_id and sale_responsible_id to leads, pipes,
campaigns. Migrate data from legacy sdr_id/closer_id. Update RPCs
for dashboard metrics, ranking, and distribution."
```

---

## Phase 2: Frontend Hooks

### Task 2: Update useLeads.ts — dual field queries and sync

**Files:**
- Modify: `src/hooks/useLeads.ts:62-241`

- [ ] **Step 1: Update useLeads query to join dual responsible fields**

In `useLeads()` function (~line 82), update the select to include new FK joins:

```typescript
.select(`
  *,
  pre_sale_responsible:team_members!leads_pre_sale_responsible_id_fkey(id, name),
  sale_responsible:team_members!leads_sale_responsible_id_fkey(id, name),
  responsible:team_members!leads_responsible_id_fkey(id, name),
  sdr:team_members!leads_sdr_id_fkey(id, name),
  closer:team_members!leads_closer_id_fkey(id, name),
  lead_tags(
    tag:tags(id, name, color)
  )
`)
```

- [ ] **Step 2: Update useUpdateLead to sync dual fields to pipes**

In `useUpdateLead()` (~line 205), replace the responsible_id sync block:

```typescript
if (safeUpdates.pre_sale_responsible_id !== undefined || safeUpdates.sale_responsible_id !== undefined) {
  const pipeUpdate: Record<string, unknown> = {};
  if (safeUpdates.pre_sale_responsible_id !== undefined) {
    pipeUpdate.pre_sale_responsible_id = safeUpdates.pre_sale_responsible_id || null;
  }
  if (safeUpdates.sale_responsible_id !== undefined) {
    pipeUpdate.sale_responsible_id = safeUpdates.sale_responsible_id || null;
  }
  if (Object.keys(pipeUpdate).length > 0) {
    await supabase.from("pipe_whatsapp").update(pipeUpdate).eq("lead_id", id);
    await supabase.from("pipe_confirmacao").update(pipeUpdate).eq("lead_id", id);
    await supabase.from("pipe_propostas").update(pipeUpdate).eq("lead_id", id);
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useLeads.ts
git commit -m "feat(hooks): update useLeads for dual responsible fields"
```

---

### Task 3: Update pipe hooks — dual FK joins

**Files:**
- Modify: `src/hooks/usePipeWhatsapp.ts:49-57`
- Modify: `src/hooks/usePipeConfirmacao.ts:54-64`
- Modify: `src/hooks/usePipePropostas.ts:52-60`

- [ ] **Step 1: Update usePipeWhatsapp select**

Add FK joins for new fields in the query select (~line 49):

```typescript
lead:leads(
  id, name, company, email, phone, rating, origin, segment, faturamento, urgency, notes, compromisso_date, ai_disabled,
  sdr_id, closer_id, responsible_id, pre_sale_responsible_id, sale_responsible_id,
  pre_sale_responsible:team_members!leads_pre_sale_responsible_id_fkey(id, name),
  sale_responsible:team_members!leads_sale_responsible_id_fkey(id, name),
  responsible:team_members!leads_responsible_id_fkey(id, name),
  sdr:team_members!leads_sdr_id_fkey(id, name),
  closer:team_members!leads_closer_id_fkey(id, name),
),
pre_sale_responsible:team_members!pipe_whatsapp_pre_sale_responsible_id_fkey(id, name),
sale_responsible:team_members!pipe_whatsapp_sale_responsible_id_fkey(id, name),
responsible:team_members!pipe_whatsapp_responsible_id_fkey(id, name),
sdr:team_members!pipe_whatsapp_sdr_id_fkey(id, name)
```

- [ ] **Step 2: Update usePipeConfirmacao select**

Same pattern (~line 54):

```typescript
lead:leads(
  id, name, company, email, phone, rating, origin, segment, faturamento, urgency, ai_disabled,
  sdr_id, closer_id, responsible_id, pre_sale_responsible_id, sale_responsible_id,
  pre_sale_responsible:team_members!leads_pre_sale_responsible_id_fkey(id, name),
  sale_responsible:team_members!leads_sale_responsible_id_fkey(id, name),
  responsible:team_members!leads_responsible_id_fkey(id, name),
  sdr:team_members!leads_sdr_id_fkey(id, name),
  closer:team_members!leads_closer_id_fkey(id, name),
),
pre_sale_responsible:team_members!pipe_confirmacao_pre_sale_responsible_id_fkey(id, name),
sale_responsible:team_members!pipe_confirmacao_sale_responsible_id_fkey(id, name),
responsible:team_members!pipe_confirmacao_responsible_id_fkey(id, name),
sdr:team_members!pipe_confirmacao_sdr_id_fkey(id, name),
closer:team_members!pipe_confirmacao_closer_id_fkey(id, name)
```

- [ ] **Step 3: Update usePipePropostas select**

Same pattern (~line 52):

```typescript
lead:leads(
  id, name, company, email, phone, rating, origin, segment, faturamento, ai_disabled,
  sdr_id, closer_id, responsible_id, pre_sale_responsible_id, sale_responsible_id,
  pre_sale_responsible:team_members!leads_pre_sale_responsible_id_fkey(id, name),
  sale_responsible:team_members!leads_sale_responsible_id_fkey(id, name),
  responsible:team_members!leads_responsible_id_fkey(id, name),
  sdr:team_members!leads_sdr_id_fkey(id, name),
  closer:team_members!leads_closer_id_fkey(id, name),
),
pre_sale_responsible:team_members!pipe_propostas_pre_sale_responsible_id_fkey(id, name),
sale_responsible:team_members!pipe_propostas_sale_responsible_id_fkey(id, name),
responsible:team_members!pipe_propostas_responsible_id_fkey(id, name),
closer:team_members!pipe_propostas_closer_id_fkey(id, name)
```

- [ ] **Step 4: Update useUpdatePipeProposta sync**

In `useUpdatePipeProposta` (~line 145), update the leads sync:

```typescript
if (effectiveLeadId && (updates.pre_sale_responsible_id !== undefined || updates.sale_responsible_id !== undefined)) {
  const leadUpdate: Record<string, unknown> = {};
  if (updates.pre_sale_responsible_id !== undefined) leadUpdate.pre_sale_responsible_id = updates.pre_sale_responsible_id || null;
  if (updates.sale_responsible_id !== undefined) leadUpdate.sale_responsible_id = updates.sale_responsible_id || null;
  await supabase.from("leads").update(leadUpdate).eq("id", effectiveLeadId);
}
```

- [ ] **Step 5: Commit**

```bash
git add src/hooks/usePipeWhatsapp.ts src/hooks/usePipeConfirmacao.ts src/hooks/usePipePropostas.ts
git commit -m "feat(hooks): update pipe hooks for dual responsible FK joins"
```

---

### Task 4: Update useGoals.ts — attribution by field

**Files:**
- Modify: `src/hooks/useGoals.ts:175-260`

- [ ] **Step 1: Update useIndividualGoals sales filter**

In useIndividualGoals (~line 178), update pipe_propostas select:

```typescript
.select("sale_responsible_id, responsible_id, closer_id, sale_value")
```

Update the filter (~line 220):

```typescript
const currentValue = salesData
  .filter((s) => (s.sale_responsible_id || s.responsible_id || s.closer_id) === member.id)
  .reduce((sum, s) => sum + (Number(s.sale_value) || 0), 0);
```

- [ ] **Step 2: Update useIndividualGoals meetings filter**

In useIndividualGoals (~line 194), update pipe_confirmacao select:

```typescript
.select("pre_sale_responsible_id, responsible_id, sdr_id, closer_id")
```

Update the filter (~line 240):

```typescript
const currentValue = confData.filter(
  (c) => (c.pre_sale_responsible_id || c.responsible_id || c.sdr_id) === member.id
).length;
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useGoals.ts
git commit -m "feat(hooks): update useGoals for dual responsible attribution"
```

---

### Task 5: Update useCommissions.ts — sale_responsible_id

**Files:**
- Modify: `src/hooks/useCommissions.ts:178-291`

- [ ] **Step 1: Update sales commission query**

In useCommissionSummary (~line 183), change filter from `closer_id` to `sale_responsible_id`:

Add `.or` filter to catch both new and legacy fields:

```typescript
.or(`sale_responsible_id.eq.${teamMemberId},closer_id.eq.${teamMemberId}`)
```

instead of:

```typescript
.eq("closer_id", teamMemberId)
```

- [ ] **Step 2: Update meetings OTE query**

In useCommissionSummary (~line 277), change filter from `sdr_id` to `pre_sale_responsible_id`:

```typescript
.or(`pre_sale_responsible_id.eq.${teamMemberId},sdr_id.eq.${teamMemberId}`)
```

instead of:

```typescript
.eq("sdr_id", teamMemberId)
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useCommissions.ts
git commit -m "feat(hooks): update useCommissions for dual responsible fields"
```

---

### Task 6: Update useDashboardMetrics.ts and useTVDashboardData.ts

**Files:**
- Modify: `src/hooks/useDashboardMetrics.ts:170-200`
- Modify: `src/hooks/useTVDashboardData.ts:91-250`

- [ ] **Step 1: Update useConversionRates filters**

In useDashboardMetrics `useConversionRates` (~line 170), update select and filters:

```typescript
// pipe_confirmacao select
.select("pre_sale_responsible_id, responsible_id, sdr_id, closer_id, status")

// pipe_propostas select
.select("sale_responsible_id, responsible_id, closer_id, status")
```

Update meeting filter (~line 183):

```typescript
const total = confirmacaoData?.filter(
  (c) => (c.pre_sale_responsible_id || c.responsible_id || c.sdr_id) === member.id
).length || 0;
const comparecidas = confirmacaoData?.filter(
  (c) => ((c.pre_sale_responsible_id || c.responsible_id || c.sdr_id) === member.id) && c.status === "compareceu"
).length || 0;
```

Update sales filter (~line 198):

```typescript
const total = (propostasData || []).filter(
  (p) => (p.sale_responsible_id || p.responsible_id || p.closer_id) === member.id
).length;
const vendidas = (propostasData || []).filter(
  (p) => ((p.sale_responsible_id || p.responsible_id || p.closer_id) === member.id) && p.status === "vendido"
).length;
```

- [ ] **Step 2: Update useTVDashboardData non-admin filter**

In useTVDashboardData (~line 91), update filters:

```typescript
const propostasFiltradas = isAdmin
  ? (propostas ?? [])
  : (propostas ?? []).filter(p =>
      (p as any).sale_responsible_id === myId ||
      (p as any).responsible_id === myId ||
      p.closer_id === myId
    );
const confirmacoesFiltradas = isAdmin
  ? (confirmacoes ?? [])
  : (confirmacoes ?? []).filter(c =>
      (c as any).pre_sale_responsible_id === myId ||
      (c as any).responsible_id === myId ||
      c.sdr_id === myId
    );
const whatsappFiltrado = isAdmin
  ? (whatsapp ?? [])
  : (whatsapp ?? []).filter(w =>
      (w as any).pre_sale_responsible_id === myId ||
      (w as any).responsible_id === myId ||
      w.sdr_id === myId
    );
```

- [ ] **Step 3: Update useTVDashboardData closer/sdr goal filters**

At ~line 170, update closer proposals filter:

```typescript
const closerProposals = propostasFiltradas.filter(
  p => (p as any).sale_responsible_id === closer.id || p.closer_id === closer.id
);
```

At ~line 240, update individual goal sales filter:

```typescript
const memberSales = currentMonthPropostas
  .filter(p => ((p as any).sale_responsible_id || p.closer_id) === g.id);
```

At ~line 250, update meetings goal filter:

```typescript
const memberMeetings = currentMonthConfirmacoes.filter(
  c => ((c as any).pre_sale_responsible_id || c.sdr_id) === g.id && c.status === "compareceu"
).length;
```

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useDashboardMetrics.ts src/hooks/useTVDashboardData.ts
git commit -m "feat(hooks): update dashboard/TV metrics for dual responsible"
```

---

### Task 7: Update useRecentActivity.ts

**Files:**
- Modify: `src/hooks/useRecentActivity.ts:58-111`

- [ ] **Step 1: Update FK joins**

At ~line 58 (pipe_confirmacao select):

```typescript
pre_sale_responsible:team_members!pipe_confirmacao_pre_sale_responsible_id_fkey(name),
sale_responsible:team_members!pipe_confirmacao_sale_responsible_id_fkey(name),
responsible:team_members!pipe_confirmacao_responsible_id_fkey(name),
sdr:team_members!pipe_confirmacao_sdr_id_fkey(name)
```

At ~line 88 (pipe_propostas select):

```typescript
pre_sale_responsible:team_members!pipe_propostas_pre_sale_responsible_id_fkey(name),
sale_responsible:team_members!pipe_propostas_sale_responsible_id_fkey(name),
responsible:team_members!pipe_propostas_responsible_id_fkey(name),
closer:team_members!pipe_propostas_closer_id_fkey(name)
```

At ~line 71, update personName resolution:

```typescript
personName: meeting.pre_sale_responsible?.name || meeting.responsible?.name || meeting.sdr?.name || meeting.lead?.name,
```

At ~line 102:

```typescript
personName: sale.sale_responsible?.name || sale.responsible?.name || sale.closer?.name,
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useRecentActivity.ts
git commit -m "feat(hooks): update useRecentActivity for dual responsible joins"
```

---

## Phase 3: Frontend Components

### Task 8: Update LeadDetailDrawer — two dropdowns

**Files:**
- Modify: `src/components/leads/LeadDetailDrawer.tsx:272-819`

- [ ] **Step 1: Update form state**

At ~line 272, add dual fields to state:

```typescript
const [formData, setFormData] = useState({
  name: "",
  company: "",
  email: "",
  phone: "",
  origin: "outro",
  rating: 5,
  segment: "",
  faturamento: "",
  urgency: "",
  notes: "",
  responsible_id: "" as string | null,
  pre_sale_responsible_id: "" as string | null,
  sale_responsible_id: "" as string | null,
});
```

At ~line 289, update reset effect:

```typescript
pre_sale_responsible_id: lead.pre_sale_responsible_id || "",
sale_responsible_id: lead.sale_responsible_id || "",
```

- [ ] **Step 2: Add dual change handlers**

After the existing `handleResponsibleChange` (~line 335), add two new handlers:

```typescript
const handlePreSaleResponsibleChange = async (newId: string | null) => {
  if (!lead) return;
  setFormData((prev) => ({ ...prev, pre_sale_responsible_id: newId }));
  try {
    await updateLead.mutateAsync({
      id: lead.id,
      pre_sale_responsible_id: newId,
    });
    const name = responsibleMembers.find((m) => m.id === newId)?.name || "Nenhum";
    logAction({ leadId: lead.id, action: "pre_sale_responsible_assigned", description: `Resp. Pré-Venda alterado para "${name}"` });
    queryClient.invalidateQueries({ queryKey: ["lead-detail", leadId] });
    toast.success(`Resp. Pré-Venda: "${name}"`);
    onSuccess?.();
  } catch (error: any) {
    setFormData((prev) => ({ ...prev, pre_sale_responsible_id: lead.pre_sale_responsible_id || "" }));
    toast.error(`Erro ao alterar responsável: ${error?.message || "Erro desconhecido"}`);
  }
};

const handleSaleResponsibleChange = async (newId: string | null) => {
  if (!lead) return;
  setFormData((prev) => ({ ...prev, sale_responsible_id: newId }));
  try {
    await updateLead.mutateAsync({
      id: lead.id,
      sale_responsible_id: newId,
    });
    const name = responsibleMembers.find((m) => m.id === newId)?.name || "Nenhum";
    logAction({ leadId: lead.id, action: "sale_responsible_assigned", description: `Resp. Venda alterado para "${name}"` });
    queryClient.invalidateQueries({ queryKey: ["lead-detail", leadId] });
    toast.success(`Resp. Venda: "${name}"`);
    onSuccess?.();
  } catch (error: any) {
    setFormData((prev) => ({ ...prev, sale_responsible_id: lead.sale_responsible_id || "" }));
    toast.error(`Erro ao alterar responsável: ${error?.message || "Erro desconhecido"}`);
  }
};
```

- [ ] **Step 3: Replace single select with two selects in sidebar**

Replace the existing responsible Select block (~lines 789-819) with:

```tsx
{/* RESPONSÁVEL PRÉ-VENDA */}
<div>
  <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">Resp. Pré-Venda</h3>
  <Select
    value={formData.pre_sale_responsible_id || "none"}
    onValueChange={(v) => handlePreSaleResponsibleChange(v === "none" ? null : v)}
  >
    <SelectTrigger className="h-9">
      {formData.pre_sale_responsible_id && formData.pre_sale_responsible_id !== "none" ? (
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
            <span className="text-[9px] font-bold text-blue-500">
              {initials(responsibleMembers.find(m => m.id === formData.pre_sale_responsible_id)?.name)}
            </span>
          </div>
          <span className="truncate text-sm">
            {responsibleMembers.find(m => m.id === formData.pre_sale_responsible_id)?.name || "—"}
          </span>
        </div>
      ) : (
        <SelectValue placeholder="Selecionar..." />
      )}
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="none">Nenhum</SelectItem>
      {responsibleMembers.map((m) => (
        <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
      ))}
    </SelectContent>
  </Select>
</div>

{/* RESPONSÁVEL VENDA */}
<div>
  <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">Resp. Venda</h3>
  <Select
    value={formData.sale_responsible_id || "none"}
    onValueChange={(v) => handleSaleResponsibleChange(v === "none" ? null : v)}
  >
    <SelectTrigger className="h-9">
      {formData.sale_responsible_id && formData.sale_responsible_id !== "none" ? (
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0">
            <span className="text-[9px] font-bold text-emerald-500">
              {initials(responsibleMembers.find(m => m.id === formData.sale_responsible_id)?.name)}
            </span>
          </div>
          <span className="truncate text-sm">
            {responsibleMembers.find(m => m.id === formData.sale_responsible_id)?.name || "—"}
          </span>
        </div>
      ) : (
        <SelectValue placeholder="Selecionar..." />
      )}
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="none">Nenhum</SelectItem>
      {responsibleMembers.map((m) => (
        <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
      ))}
    </SelectContent>
  </Select>
</div>
```

- [ ] **Step 4: Commit**

```bash
git add src/components/leads/LeadDetailDrawer.tsx
git commit -m "feat(ui): dual responsible dropdowns in LeadDetailDrawer"
```

---

### Task 9: Update Leads.tsx — creation/edit form

**Files:**
- Modify: `src/pages/Leads.tsx:105-801`

- [ ] **Step 1: Update LeadFormData interface**

At ~line 105:

```typescript
interface LeadFormData {
  name: string;
  company: string;
  email: string;
  phone: string;
  origin: string;
  rating: number;
  segment: string;
  faturamento: string;
  urgency: string;
  notes: string;
  responsible_id: string | null;
  pre_sale_responsible_id: string | null;
  sale_responsible_id: string | null;
  compromisso_date: string;
}
```

Update initialFormData (~line 120):

```typescript
const initialFormData: LeadFormData = {
  name: "",
  company: "",
  email: "",
  phone: "",
  origin: "outro",
  rating: 5,
  segment: "",
  faturamento: "",
  urgency: "",
  notes: "",
  responsible_id: null,
  pre_sale_responsible_id: null,
  sale_responsible_id: null,
  compromisso_date: "",
};
```

- [ ] **Step 2: Update handleOpenDialog for editing**

At ~line 280, add dual fields:

```typescript
pre_sale_responsible_id: lead.pre_sale_responsible_id,
sale_responsible_id: lead.sale_responsible_id,
```

- [ ] **Step 3: Update form payload**

At ~line 334:

```typescript
const payload = {
  ...formData,
  origin: formData.origin as any,
  faturamento: formData.faturamento || null,
  responsible_id: formData.responsible_id || null,
  pre_sale_responsible_id: formData.pre_sale_responsible_id || null,
  sale_responsible_id: formData.sale_responsible_id || null,
  compromisso_date: formData.compromisso_date ? new Date(formData.compromisso_date).toISOString() : null,
  organization_id: currentTeamMember.organization_id,
};
```

- [ ] **Step 4: Replace single select with dual selects in dialog**

Replace the responsible Select (~lines 785-801) with two selects:

```tsx
<div className="grid grid-cols-2 gap-4">
  <div className="grid gap-2">
    <Label>Resp. Pré-Venda</Label>
    <Select
      value={formData.pre_sale_responsible_id || "none"}
      onValueChange={(v) => setFormData({ ...formData, pre_sale_responsible_id: v === "none" ? null : v })}
    >
      <SelectTrigger>
        <SelectValue placeholder="Selecionar" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">Nenhum</SelectItem>
        {responsibleMembers.map(member => (
          <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
  <div className="grid gap-2">
    <Label>Resp. Venda</Label>
    <Select
      value={formData.sale_responsible_id || "none"}
      onValueChange={(v) => setFormData({ ...formData, sale_responsible_id: v === "none" ? null : v })}
    >
      <SelectTrigger>
        <SelectValue placeholder="Selecionar" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">Nenhum</SelectItem>
        {responsibleMembers.map(member => (
          <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
</div>
```

- [ ] **Step 5: Update table display column**

Replace the single responsible Badge at ~line 563:

```tsx
<TableCell>
  <div className="flex flex-col gap-0.5">
    {lead.pre_sale_responsible?.name && (
      <Badge variant="outline" className="text-xs border-blue-500/30 text-blue-400">
        {lead.pre_sale_responsible.name}
      </Badge>
    )}
    {lead.sale_responsible?.name && (
      <Badge variant="outline" className="text-xs border-emerald-500/30 text-emerald-400">
        {lead.sale_responsible.name}
      </Badge>
    )}
    {!lead.pre_sale_responsible?.name && !lead.sale_responsible?.name && (
      <span className="text-muted-foreground text-xs">-</span>
    )}
  </div>
</TableCell>
```

- [ ] **Step 6: Commit**

```bash
git add src/pages/Leads.tsx
git commit -m "feat(ui): dual responsible fields in lead creation/edit form and table"
```

---

### Task 10: Update PropostaModal.tsx

**Files:**
- Modify: `src/components/leads/PropostaModal.tsx:54-169`

- [ ] **Step 1: Update form state and mutation**

At ~line 54, update initialization:

```typescript
const [formData, setFormData] = useState({
  status: proposta?.status || "marcar_compromisso",
  product_type: proposta?.product_type || "",
  sale_value: proposta?.sale_value || "",
  contract_duration: proposta?.contract_duration || "",
  pre_sale_responsible_id: proposta?.pre_sale_responsible_id || proposta?.responsible_id || null,
  sale_responsible_id: proposta?.sale_responsible_id || proposta?.closer_id || proposta?.responsible_id || null,
  commitment_date: proposta?.commitment_date
    ? format(new Date(proposta.commitment_date), "yyyy-MM-dd'T'HH:mm")
    : "",
  notes: proposta?.notes || "",
});
```

At ~line 71, update mutation payload:

```typescript
await updateProposta.mutateAsync({
  id: proposta.id,
  status: formData.status as PipePropostasStatus,
  product_type: formData.product_type as any || null,
  sale_value: formData.sale_value ? Number(formData.sale_value) : null,
  contract_duration: formData.contract_duration ? Number(formData.contract_duration) : null,
  pre_sale_responsible_id: formData.pre_sale_responsible_id || null,
  sale_responsible_id: formData.sale_responsible_id || null,
  responsible_id: formData.sale_responsible_id || null,
  closer_id: formData.sale_responsible_id || null,
  commitment_date: formData.commitment_date ? new Date(formData.commitment_date).toISOString() : null,
  notes: formData.notes || null,
  closed_at: formData.status === "vendido" ? new Date().toISOString() : null,
});
```

- [ ] **Step 2: Replace single select with dual selects**

Replace the responsible Select (~line 154) with:

```tsx
<div className="grid grid-cols-2 gap-4">
  <div className="grid gap-2">
    <Label>Resp. Pré-Venda</Label>
    <Select
      value={formData.pre_sale_responsible_id || "none"}
      onValueChange={(v) => setFormData({ ...formData, pre_sale_responsible_id: v === "none" ? null : v })}
    >
      <SelectTrigger>
        <SelectValue placeholder="Selecionar" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">Nenhum</SelectItem>
        {activeMembers.map(c => (
          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
  <div className="grid gap-2">
    <Label>Resp. Venda</Label>
    <Select
      value={formData.sale_responsible_id || "none"}
      onValueChange={(v) => setFormData({ ...formData, sale_responsible_id: v === "none" ? null : v })}
    >
      <SelectTrigger>
        <SelectValue placeholder="Selecionar" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">Nenhum</SelectItem>
        {activeMembers.map(c => (
          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
</div>
```

- [ ] **Step 3: Commit**

```bash
git add src/components/leads/PropostaModal.tsx
git commit -m "feat(ui): dual responsible fields in PropostaModal"
```

---

### Task 11: Update CreateOpportunityModal.tsx

**Files:**
- Modify: `src/components/kanban/CreateOpportunityModal.tsx:62-326`

- [ ] **Step 1: Update form state**

At ~line 62:

```typescript
const [formData, setFormData] = useState({
  pre_sale_responsible_id: "",
  sale_responsible_id: "",
  scheduled_date: "",
  notes: "",
});
```

Update auto-fill effect:

```typescript
useEffect(() => {
  if (selectedLead) {
    setFormData(prev => ({
      ...prev,
      pre_sale_responsible_id: selectedLead.pre_sale_responsible_id || selectedLead.responsible_id || "",
      sale_responsible_id: selectedLead.sale_responsible_id || "",
    }));
  }
}, [selectedLead]);
```

- [ ] **Step 2: Update create mutation**

At ~line 136:

```typescript
await createPipeWhatsapp.mutateAsync({
  lead_id: selectedLeadId,
  status: "novo",
  pre_sale_responsible_id: formData.pre_sale_responsible_id || null,
  sale_responsible_id: formData.sale_responsible_id || null,
  responsible_id: formData.pre_sale_responsible_id || null,
  scheduled_date: formData.scheduled_date ? new Date(formData.scheduled_date).toISOString() : null,
  notes: formData.notes || null,
  organization_id: organizationId,
});
```

- [ ] **Step 3: Replace single select with dual selects**

Replace at ~line 310:

```tsx
<div className="grid grid-cols-2 gap-4">
  <div className="grid gap-2">
    <Label>Resp. Pré-Venda</Label>
    <Select
      value={formData.pre_sale_responsible_id}
      onValueChange={(v) => setFormData({ ...formData, pre_sale_responsible_id: v })}
    >
      <SelectTrigger>
        <User className="w-4 h-4 mr-2 text-muted-foreground" />
        <SelectValue placeholder="Selecionar (opcional)" />
      </SelectTrigger>
      <SelectContent>
        {activeMembers.map(member => (
          <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
  <div className="grid gap-2">
    <Label>Resp. Venda</Label>
    <Select
      value={formData.sale_responsible_id}
      onValueChange={(v) => setFormData({ ...formData, sale_responsible_id: v })}
    >
      <SelectTrigger>
        <User className="w-4 h-4 mr-2 text-muted-foreground" />
        <SelectValue placeholder="Selecionar (opcional)" />
      </SelectTrigger>
      <SelectContent>
        {activeMembers.map(member => (
          <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
</div>
```

- [ ] **Step 4: Commit**

```bash
git add src/components/kanban/CreateOpportunityModal.tsx
git commit -m "feat(ui): dual responsible fields in CreateOpportunityModal"
```

---

## Phase 4: Edge Functions

### Task 12: Update lead-webhook

**Files:**
- Modify: `supabase/functions/lead-webhook/index.ts:274-511`

- [ ] **Step 1: Update new lead assignment**

At ~line 274, when `assigned_user_id` provided:

```typescript
if (payload.assigned_user_id) {
  insertData.sdr_id = payload.assigned_user_id;
  insertData.closer_id = payload.assigned_user_id;
  insertData.responsible_id = payload.assigned_user_id;
  insertData.pre_sale_responsible_id = payload.assigned_user_id;
  insertData.sale_responsible_id = payload.assigned_user_id;
}
```

- [ ] **Step 2: Update existing lead assignment**

At ~line 341:

```typescript
if (payload.assigned_user_id) {
  updateData.sdr_id = payload.assigned_user_id;
  updateData.closer_id = payload.assigned_user_id;
  updateData.responsible_id = payload.assigned_user_id;
  updateData.pre_sale_responsible_id = payload.assigned_user_id;
  updateData.sale_responsible_id = payload.assigned_user_id;
}
```

- [ ] **Step 3: Update auto-distribution result**

At ~line 504:

```typescript
const responsibleId = closerId || sdrId;
if (responsibleId) {
  const leadAssign: Record<string, unknown> = {
    responsible_id: responsibleId,
    pre_sale_responsible_id: sdrId || responsibleId,
    sale_responsible_id: closerId || responsibleId,
  };
  if (sdrId) leadAssign.sdr_id = sdrId;
  if (closerId) leadAssign.closer_id = closerId;
  await supabase.from("leads").update(leadAssign).eq("id", leadId);
}
```

- [ ] **Step 4: Update campaign placement**

At ~line 629, when inserting into campanha_leads:

```typescript
const clInsert = {
  campanha_id: campaignId,
  lead_id: leadId,
  stage_id: stageId,
  sdr_id: sdrId,
  closer_id: closerId,
  responsible_id: closerId || sdrId,
  pre_sale_responsible_id: sdrId,
  sale_responsible_id: closerId,
};
```

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/lead-webhook/index.ts
git commit -m "feat(edge): update lead-webhook for dual responsible fields"
```

---

### Task 13: Update remaining edge functions

**Files:**
- Modify: `supabase/functions/webhook-new-lead/index.ts`
- Modify: `supabase/functions/webhook-confirmacao/index.ts`
- Modify: `supabase/functions/import-leads/index.ts`
- Modify: `supabase/functions/meta-webhook/index.ts`
- Modify: `supabase/functions/campaign-rule-dispatch/index.ts`
- Modify: `supabase/functions/pipe-rule-dispatch/index.ts`
- Modify: `supabase/functions/process-pipe-distribution/index.ts`
- Modify: `supabase/functions/process-followup-automations/index.ts`
- Modify: `supabase/functions/_shared/campaign-distribution.ts`
- Modify: `supabase/functions/_shared/workflow-condition-evaluator.ts`

- [ ] **Step 1: Update webhook-new-lead**

At ~line 232:

```typescript
if (sdr_id && !existingLead.sdr_id) updatedData.sdr_id = sdr_id;
if (sdr_id && !existingLead.responsible_id) updatedData.responsible_id = sdr_id;
if (sdr_id && !existingLead.pre_sale_responsible_id) updatedData.pre_sale_responsible_id = sdr_id;
```

At ~line 386:

```typescript
p_sdr_id: sdr_id || null,
p_responsible_id: sdr_id || null,
p_pre_sale_responsible_id: sdr_id || null,
```

- [ ] **Step 2: Update webhook-confirmacao**

At ~line 91:

```typescript
p_sdr_id: sdr_id || null,
p_closer_id: closer_id || null,
p_responsible_id: closer_id || sdr_id || null,
p_pre_sale_responsible_id: sdr_id || null,
p_sale_responsible_id: closer_id || null,
```

- [ ] **Step 3: Update import-leads**

At ~line 451 (existing lead in campaign):

```typescript
await supabase.from("campanha_leads").insert({
  campanha_id: campanhaId,
  lead_id: existingLead.id,
  stage_id: stageIdForLead,
  sdr_id: assignedSdrId,
  closer_id: assignedCloserId,
  responsible_id: assignedCloserId || assignedSdrId,
  pre_sale_responsible_id: assignedSdrId,
  sale_responsible_id: assignedCloserId,
});

const leadUpdates: Record<string, string> = {};
if (assignedSdrId) {
  leadUpdates.sdr_id = assignedSdrId;
  leadUpdates.pre_sale_responsible_id = assignedSdrId;
}
if (assignedCloserId) {
  leadUpdates.closer_id = assignedCloserId;
  leadUpdates.sale_responsible_id = assignedCloserId;
}
const responsibleId = assignedCloserId || assignedSdrId;
if (responsibleId) leadUpdates.responsible_id = responsibleId;
```

At ~line 517 (new lead in campaign), same pattern.

- [ ] **Step 4: Update meta-webhook**

At ~line 595:

```typescript
const insertPayload: Record<string, unknown> = {
  campanha_id: campaignId,
  lead_id: newLead.id,
  stage_id: firstStage.id,
  sdr_id: sdrId,
  closer_id: closerId,
  responsible_id: responsibleId,
  pre_sale_responsible_id: sdrId,
  sale_responsible_id: closerId,
};

// And when updating leads:
if (responsibleId) {
  const leadAssign: Record<string, unknown> = {
    responsible_id: responsibleId,
    pre_sale_responsible_id: sdrId,
    sale_responsible_id: closerId,
  };
  if (sdrId) leadAssign.sdr_id = sdrId;
  if (closerId) leadAssign.closer_id = closerId;
  await supabase.from("leads").update(leadAssign).eq("id", newLead.id);
}
```

- [ ] **Step 5: Update campaign-rule-dispatch**

At ~line 553:

```typescript
const { error: sdrErr } = await supabase
  .from("campanha_leads")
  .update({
    sdr_id: sdrId,
    responsible_id: sdrId,
    pre_sale_responsible_id: sdrId,
  })
  .eq("id", row.campanha_lead_id);
```

- [ ] **Step 6: Update pipe-rule-dispatch**

At ~line 623:

```typescript
const { error: sdrErr } = await supabase
  .from(pipeTable)
  .update({
    sdr_id: sdrId,
    responsible_id: sdrId,
    pre_sale_responsible_id: sdrId,
  })
  .eq("id", row.pipe_record_id);
```

- [ ] **Step 7: Update process-pipe-distribution**

At ~line 176:

```typescript
.update({
  responsible_id: selectedMemberId,
  pre_sale_responsible_id: selectedMemberId,
  sdr_id: selectedMemberId,
})
```

- [ ] **Step 8: Update process-followup-automations**

At ~line 186, update select:

```typescript
.select("id, name, responsible_id, pre_sale_responsible_id, sale_responsible_id, sdr_id, closer_id")
```

Update fallback logic:

```typescript
let assignedTo: string | null = lead.pre_sale_responsible_id || lead.sale_responsible_id || lead.responsible_id || null;
if (!assignedTo) {
  assignedTo = lead.sdr_id || lead.closer_id || null;
}
```

- [ ] **Step 9: Update workflow-condition-evaluator**

At ~line 27:

```typescript
interface Lead {
  sdr_id?: string;
  closer_id?: string;
  responsible_id?: string;
  pre_sale_responsible_id?: string;
  sale_responsible_id?: string;
}
```

- [ ] **Step 10: Commit**

```bash
git add supabase/functions/webhook-new-lead/index.ts \
  supabase/functions/webhook-confirmacao/index.ts \
  supabase/functions/import-leads/index.ts \
  supabase/functions/meta-webhook/index.ts \
  supabase/functions/campaign-rule-dispatch/index.ts \
  supabase/functions/pipe-rule-dispatch/index.ts \
  supabase/functions/process-pipe-distribution/index.ts \
  supabase/functions/process-followup-automations/index.ts \
  supabase/functions/_shared/campaign-distribution.ts \
  supabase/functions/_shared/workflow-condition-evaluator.ts
git commit -m "feat(edge): update all edge functions for dual responsible fields"
```

---

## Phase 5: Regenerate Types

### Task 14: Regenerate Supabase types

**Files:**
- Modify: `src/integrations/supabase/types.ts` (auto-generated)

- [ ] **Step 1: Deploy migration to dev**

```bash
supabase db push --linked
```

- [ ] **Step 2: Regenerate types**

```bash
supabase gen types typescript --project-id bcfadphgsibjzivtbjvc > src/integrations/supabase/types.ts
```

- [ ] **Step 3: Verify types compile**

```bash
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 4: Commit**

```bash
git add src/integrations/supabase/types.ts
git commit -m "chore: regenerate Supabase types with dual responsible fields"
```

---

## Phase 6: Verify

### Task 15: Build and test

- [ ] **Step 1: Run unit tests**

```bash
npm run test:unit
```

- [ ] **Step 2: Run build**

```bash
npm run build
```

- [ ] **Step 3: Start dev server and test**

```bash
npm run dev
```

Verify:
1. Open lead detail drawer — see two dropdowns (Pré-Venda / Venda)
2. Change pré-venda responsible — toast confirms
3. Change venda responsible — toast confirms
4. Create new lead — both fields in form
5. Check Leads table — both badges show
6. Check kanban card — both fields present
7. Check PropostaModal — both fields
8. Check Dashboard metrics — filter by member shows correct attribution
9. Check Ranking page — closers by sale_responsible, SDRs by pre_sale_responsible

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address dual responsible field integration issues"
```
