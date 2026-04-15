---
tags:
  - torque-crm
  - docs
  - plan
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: docs/superpowers/plans/2026-03-27-central-de-comandos-b2b.md
---

# Central de Comandos B2B - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the dashboard from automotive/gamified theme to a premium B2B executive command center with 3 tabs, new KPIs, speedometer gauge, product ranking, seller activity scores, and an evolved Oráculo chat with rate limiting.

**Architecture:** Hybrid approach - new Dashboard.tsx with tabbed layout and new visual components, reusing and extending existing RPCs/hooks. Backend receives surgical additions (new RPCs + oraculo_usage table). Edge function extended for chat mode.

**Tech Stack:** React + TypeScript, Tailwind CSS, Framer Motion, Recharts, shadcn/ui (Tabs, Card, Dialog), Supabase RPCs (plpgsql), Supabase Edge Functions (Deno), @tanstack/react-query.

**Branch:** `Refactor-Dashboard` (already created from main)
**Database:** DEV only (`bcfadphgsibjzivtbjvc`)

---

## File Structure

### New Files
- `supabase/migrations/20260327100000_extend_dashboard_metrics_v2.sql` - Extended RPC with proposals count, response time, first-order vs base
- `supabase/migrations/20260327100001_seller_activity_scores_rpc.sql` - New RPC
- `supabase/migrations/20260327100002_product_ranking_rpc.sql` - New RPC
- `supabase/migrations/20260327100003_oraculo_usage_table.sql` - New table + check_oraculo_limit RPC
- `supabase/migrations/20260327100004_segment_benchmark_rpc.sql` - New RPC
- `src/hooks/useCountUp.ts` - Count-up animation hook
- `src/hooks/useProductRanking.ts` - Product ranking data hook
- `src/hooks/useSellerActivity.ts` - Seller activity scores hook
- `src/hooks/useSegmentBenchmark.ts` - Segment benchmark hook
- `src/hooks/useOraculoChat.ts` - Oráculo chat state + rate limit hook
- `src/components/dashboard/SpeedometerGauge.tsx` - SVG speedometer with dual needles
- `src/components/dashboard/KPICard.tsx` - New KPI card with count-up + trend
- `src/components/dashboard/ProductRanking.tsx` - Chart + table of top products
- `src/components/dashboard/SellerActivityCard.tsx` - Score ring + expandable breakdown
- `src/components/dashboard/MetaComparativeChart.tsx` - Expected vs real line chart
- `src/components/dashboard/SegmentBenchmark.tsx` - Comparison bars
- `src/components/dashboard/RankingTable.tsx` - Full ranking table (all sellers)
- `src/components/dashboard/OraculoFloatingButton.tsx` - Floating icon with badge
- `src/components/dashboard/OraculoChat.tsx` - Chat modal with animation
- `src/components/dashboard/DashboardHeader.tsx` - Executive header with month nav
- `src/components/dashboard/TabVisaoGeral.tsx` - Tab 1 content
- `src/components/dashboard/TabPerformance.tsx` - Tab 2 content
- `src/components/dashboard/TabInteligencia.tsx` - Tab 3 content
- `src/components/dashboard/FirstOrderVsBase.tsx` - Ring chart first order vs base

### Modified Files
- `src/pages/Dashboard.tsx` - Complete rewrite with tabbed layout
- `src/hooks/useDashboardMetrics.ts` - Extended interface for new fields
- `supabase/functions/oraculo-comercial/index.ts` - Add chat mode + rate limit validation

---

## Task 1: Backend - Extend get_dashboard_metrics RPC

**Files:**
- Create: `supabase/migrations/20260327100000_extend_dashboard_metrics_v2.sql`
- Reference: `supabase/migrations/20260703200000_dashboard_metrics_rpc.sql`

This extends the existing RPC to return additional fields needed by the new dashboard: proposals count, avg response time, first-order revenue, base-active revenue, and daily sales series.

- [ ] **Step 1: Create the migration file**

```sql
-- Extend get_dashboard_metrics with new fields for Central de Comandos B2B
CREATE OR REPLACE FUNCTION public.get_dashboard_metrics(
  p_org_id UUID,
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ,
  p_filter_member_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSONB;

  -- Leads
  v_total_leads BIGINT;

  -- Confirmação (reunioes)
  v_reunioes_marcadas BIGINT;
  v_reunioes_comparecidas BIGINT;
  v_no_show BIGINT;
  v_finalizados_data_passada BIGINT;
  v_taxa_no_show INT;

  -- Propostas / vendas
  v_venda_total NUMERIC := 0;
  v_venda_mrr NUMERIC := 0;
  v_venda_projeto NUMERIC := 0;
  v_mrr_proposal_count BIGINT := 0;
  v_projeto_proposal_count BIGINT := 0;
  v_novos_clientes BIGINT;
  v_ticket_medio NUMERIC := 0;
  v_ticket_medio_mrr NUMERIC := 0;
  v_ticket_medio_projeto NUMERIC := 0;

  -- Funil
  v_funnel_leads BIGINT;
  v_funnel_reunioes BIGINT;
  v_funnel_comparecidas BIGINT;
  v_funnel_propostas BIGINT;
  v_funnel_vendas BIGINT;

  -- NEW: Proposals count, response time, first order vs base
  v_propostas_enviadas BIGINT;
  v_tempo_medio_resposta NUMERIC := 0;
  v_venda_primeiro_pedido NUMERIC := 0;
  v_venda_base_ativa NUMERIC := 0;

  -- NEW: Daily sales series
  v_daily_sales JSONB;

  -- Auxiliar para vendas
  rec RECORD;
BEGIN
  -------------------------------------------------------------------
  -- 1. Total Leads
  -------------------------------------------------------------------
  SELECT COUNT(*) INTO v_total_leads
  FROM leads
  WHERE organization_id = p_org_id
    AND (is_shadow IS NULL OR is_shadow = false)
    AND COALESCE(metrics_period_at, created_at) >= p_start_date
    AND COALESCE(metrics_period_at, created_at) <= p_end_date
    AND (
      p_filter_member_id IS NULL
      OR sdr_id = p_filter_member_id
      OR closer_id = p_filter_member_id
    );

  v_funnel_leads := v_total_leads;

  -------------------------------------------------------------------
  -- 2. Confirmação / Reunioes (same as before)
  -------------------------------------------------------------------
  SELECT COUNT(*) INTO v_reunioes_marcadas
  FROM pipe_confirmacao
  WHERE organization_id = p_org_id
    AND COALESCE(metrics_period_at, created_at) >= p_start_date
    AND COALESCE(metrics_period_at, created_at) <= p_end_date
    AND (
      p_filter_member_id IS NULL
      OR sdr_id = p_filter_member_id
      OR closer_id = p_filter_member_id
    );

  v_funnel_reunioes := v_reunioes_marcadas;

  SELECT COUNT(*) INTO v_reunioes_comparecidas
  FROM pipe_confirmacao
  WHERE organization_id = p_org_id
    AND status = 'compareceu'
    AND COALESCE(metrics_period_at, created_at) >= p_start_date
    AND COALESCE(metrics_period_at, created_at) <= p_end_date
    AND (
      p_filter_member_id IS NULL
      OR sdr_id = p_filter_member_id
      OR closer_id = p_filter_member_id
    );

  v_funnel_comparecidas := v_reunioes_comparecidas;

  SELECT
    COUNT(*) FILTER (WHERE status IN ('perdido', 'remarcar')),
    COUNT(*)
  INTO v_no_show, v_finalizados_data_passada
  FROM pipe_confirmacao
  WHERE organization_id = p_org_id
    AND COALESCE(metrics_period_at, created_at) >= p_start_date
    AND COALESCE(metrics_period_at, created_at) <= p_end_date
    AND meeting_date IS NOT NULL
    AND meeting_date <= NOW()
    AND status IN ('compareceu', 'perdido', 'remarcar')
    AND (
      p_filter_member_id IS NULL
      OR sdr_id = p_filter_member_id
      OR closer_id = p_filter_member_id
    );

  IF v_finalizados_data_passada > 0 THEN
    v_taxa_no_show := ROUND((v_no_show::NUMERIC / v_finalizados_data_passada) * 100);
  ELSE
    v_taxa_no_show := 0;
  END IF;

  -------------------------------------------------------------------
  -- 3. Propostas enviadas (NEW)
  -------------------------------------------------------------------
  SELECT COUNT(*) INTO v_propostas_enviadas
  FROM pipe_propostas
  WHERE organization_id = p_org_id
    AND COALESCE(metrics_period_at, created_at) >= p_start_date
    AND COALESCE(metrics_period_at, created_at) <= p_end_date
    AND (
      p_filter_member_id IS NULL
      OR closer_id = p_filter_member_id
    );

  v_funnel_propostas := v_propostas_enviadas;

  -------------------------------------------------------------------
  -- 4. Vendas + primeiro pedido vs base ativa
  -------------------------------------------------------------------
  SELECT COUNT(*) INTO v_funnel_vendas
  FROM pipe_propostas
  WHERE organization_id = p_org_id
    AND status = 'vendido'
    AND COALESCE(metrics_period_at, closed_at) >= p_start_date
    AND COALESCE(metrics_period_at, closed_at) <= p_end_date
    AND (
      p_filter_member_id IS NULL
      OR closer_id = p_filter_member_id
    );

  v_novos_clientes := v_funnel_vendas;

  -- Calculate sales values by type AND first-order vs base
  FOR rec IN
    SELECT
      pp.id AS proposta_id,
      pp.lead_id,
      pp.sale_value AS prop_sale_value,
      pp.product_type AS prop_product_type,
      COALESCE(
        (SELECT jsonb_agg(jsonb_build_object(
          'sale_value', ppi.sale_value,
          'product_type', pr.type
        ))
        FROM pipe_proposta_items ppi
        LEFT JOIN products pr ON pr.id = ppi.product_id
        WHERE ppi.proposta_id = pp.id),
        '[]'::jsonb
      ) AS items,
      -- Check if this lead has any previous sold proposal before this period
      EXISTS (
        SELECT 1 FROM pipe_propostas prev
        WHERE prev.lead_id = pp.lead_id
          AND prev.organization_id = p_org_id
          AND prev.status = 'vendido'
          AND prev.id != pp.id
          AND COALESCE(prev.metrics_period_at, prev.closed_at) < p_start_date
      ) AS is_returning_customer
    FROM pipe_propostas pp
    WHERE pp.organization_id = p_org_id
      AND pp.status = 'vendido'
      AND COALESCE(pp.metrics_period_at, pp.closed_at) >= p_start_date
      AND COALESCE(pp.metrics_period_at, pp.closed_at) <= p_end_date
      AND (
        p_filter_member_id IS NULL
        OR pp.closer_id = p_filter_member_id
      )
  LOOP
    DECLARE
      item JSONB;
      item_val NUMERIC;
      item_type TEXT;
      prop_total NUMERIC := 0;
      prop_mrr NUMERIC := 0;
      prop_proj NUMERIC := 0;
    BEGIN
      IF jsonb_array_length(rec.items) > 0 THEN
        FOR item IN SELECT * FROM jsonb_array_elements(rec.items)
        LOOP
          item_val := COALESCE((item->>'sale_value')::NUMERIC, 0);
          item_type := item->>'product_type';
          prop_total := prop_total + item_val;
          IF item_type = 'mrr' THEN
            prop_mrr := prop_mrr + item_val;
          ELSIF item_type = 'projeto' THEN
            prop_proj := prop_proj + item_val;
          END IF;
        END LOOP;
      ELSE
        prop_total := COALESCE(rec.prop_sale_value, 0);
        IF rec.prop_product_type = 'mrr' THEN
          prop_mrr := prop_total;
        ELSIF rec.prop_product_type = 'projeto' THEN
          prop_proj := prop_total;
        END IF;
      END IF;

      v_venda_total := v_venda_total + prop_total;
      v_venda_mrr := v_venda_mrr + prop_mrr;
      v_venda_projeto := v_venda_projeto + prop_proj;
      IF prop_mrr > 0 THEN v_mrr_proposal_count := v_mrr_proposal_count + 1; END IF;
      IF prop_proj > 0 THEN v_projeto_proposal_count := v_projeto_proposal_count + 1; END IF;

      -- First order vs base ativa
      IF rec.is_returning_customer THEN
        v_venda_base_ativa := v_venda_base_ativa + prop_total;
      ELSE
        v_venda_primeiro_pedido := v_venda_primeiro_pedido + prop_total;
      END IF;
    END;
  END LOOP;

  -- Tickets médios
  IF v_novos_clientes > 0 THEN
    v_ticket_medio := v_venda_total / v_novos_clientes;
  END IF;
  IF v_mrr_proposal_count > 0 THEN
    v_ticket_medio_mrr := v_venda_mrr / v_mrr_proposal_count;
  END IF;
  IF v_projeto_proposal_count > 0 THEN
    v_ticket_medio_projeto := v_venda_projeto / v_projeto_proposal_count;
  END IF;

  -------------------------------------------------------------------
  -- 5. Tempo médio de resposta (NEW)
  -- Approximation: time between lead created_at and first pipe_confirmacao.created_at
  -------------------------------------------------------------------
  SELECT COALESCE(
    AVG(EXTRACT(EPOCH FROM (first_contact - lead_created)) / 3600), 0
  ) INTO v_tempo_medio_resposta
  FROM (
    SELECT
      l.created_at AS lead_created,
      (SELECT MIN(pc.created_at) FROM pipe_confirmacao pc WHERE pc.lead_id = l.id) AS first_contact
    FROM leads l
    WHERE l.organization_id = p_org_id
      AND (l.is_shadow IS NULL OR l.is_shadow = false)
      AND COALESCE(l.metrics_period_at, l.created_at) >= p_start_date
      AND COALESCE(l.metrics_period_at, l.created_at) <= p_end_date
      AND (
        p_filter_member_id IS NULL
        OR l.sdr_id = p_filter_member_id
        OR l.closer_id = p_filter_member_id
      )
  ) sub
  WHERE first_contact IS NOT NULL;

  -------------------------------------------------------------------
  -- 6. Daily sales series (NEW)
  -------------------------------------------------------------------
  SELECT COALESCE(jsonb_agg(row_to_json(daily) ORDER BY daily.day), '[]'::jsonb)
  INTO v_daily_sales
  FROM (
    SELECT
      DATE(COALESCE(pp.metrics_period_at, pp.closed_at)) AS day,
      SUM(COALESCE(pp.sale_value, 0)) AS revenue,
      COUNT(*) AS count
    FROM pipe_propostas pp
    WHERE pp.organization_id = p_org_id
      AND pp.status = 'vendido'
      AND COALESCE(pp.metrics_period_at, pp.closed_at) >= p_start_date
      AND COALESCE(pp.metrics_period_at, pp.closed_at) <= p_end_date
      AND (
        p_filter_member_id IS NULL
        OR pp.closer_id = p_filter_member_id
      )
    GROUP BY DATE(COALESCE(pp.metrics_period_at, pp.closed_at))
  ) daily;

  -------------------------------------------------------------------
  -- 7. Build result
  -------------------------------------------------------------------
  result := jsonb_build_object(
    -- Original metrics
    'totalLeads', v_total_leads,
    'reunioesMarcadas', v_reunioes_marcadas,
    'reunioesComparecidas', v_reunioes_comparecidas,
    'noShow', v_no_show,
    'taxaNoShow', v_taxa_no_show,
    'vendaTotal', v_venda_total,
    'vendaMRR', v_venda_mrr,
    'vendaProjeto', v_venda_projeto,
    'ticketMedio', v_ticket_medio,
    'ticketMedioMRR', v_ticket_medio_mrr,
    'ticketMedioProjeto', v_ticket_medio_projeto,
    'novosClientes', v_novos_clientes,
    -- Funnel
    'funnelLeads', v_funnel_leads,
    'funnelReunioes', v_funnel_reunioes,
    'funnelComparecidas', v_funnel_comparecidas,
    'funnelPropostas', v_funnel_propostas,
    'funnelVendas', v_funnel_vendas,
    -- NEW fields
    'propostasEnviadas', v_propostas_enviadas,
    'tempoMedioResposta', ROUND(v_tempo_medio_resposta::NUMERIC, 1),
    'vendaPrimeiroPedido', v_venda_primeiro_pedido,
    'vendaBaseAtiva', v_venda_base_ativa,
    'dailySales', v_daily_sales
  );

  RETURN result;
END;
$$;
```

- [ ] **Step 2: Apply migration to DEV database**

```bash
supabase db push --db-url "postgresql://postgres:[password]@db.bcfadphgsibjzivtbjvc.supabase.co:5432/postgres" < supabase/migrations/20260327100000_extend_dashboard_metrics_v2.sql
```

Or via Supabase SQL editor on the DEV project.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260327100000_extend_dashboard_metrics_v2.sql
git commit -m "feat(db): extend get_dashboard_metrics with proposals, response time, first-order vs base, daily sales"
```

---

## Task 2: Backend - Seller Activity Scores RPC

**Files:**
- Create: `supabase/migrations/20260327100001_seller_activity_scores_rpc.sql`

- [ ] **Step 1: Create the migration**

```sql
-- RPC to calculate activity scores for each seller
CREATE OR REPLACE FUNCTION public.get_seller_activity_scores(
  p_org_id UUID,
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSONB;
  v_max_score NUMERIC := 0;
BEGIN
  WITH seller_metrics AS (
    SELECT
      tm.id,
      tm.name,
      tm.role,
      (tm.metric_type)::TEXT AS metric_type,
      -- Leads touched (assigned as sdr or closer)
      (SELECT COUNT(*) FROM leads l
       WHERE l.organization_id = p_org_id
         AND (l.sdr_id = tm.id OR l.closer_id = tm.id)
         AND COALESCE(l.metrics_period_at, l.created_at) >= p_start_date
         AND COALESCE(l.metrics_period_at, l.created_at) <= p_end_date
      ) AS leads_movimentados,
      -- Follow-ups completed
      (SELECT COUNT(*) FROM follow_ups fu
       WHERE fu.organization_id = p_org_id
         AND fu.assigned_to = tm.id
         AND fu.completed_at IS NOT NULL
         AND fu.completed_at >= p_start_date
         AND fu.completed_at <= p_end_date
      ) AS followups_completos,
      -- Meetings held (compareceu)
      (SELECT COUNT(*) FROM pipe_confirmacao pc
       WHERE pc.organization_id = p_org_id
         AND (pc.sdr_id = tm.id OR pc.closer_id = tm.id)
         AND pc.status = 'compareceu'
         AND COALESCE(pc.metrics_period_at, pc.created_at) >= p_start_date
         AND COALESCE(pc.metrics_period_at, pc.created_at) <= p_end_date
      ) AS reunioes_realizadas,
      -- Proposals sent
      (SELECT COUNT(*) FROM pipe_propostas pp
       WHERE pp.organization_id = p_org_id
         AND pp.closer_id = tm.id
         AND COALESCE(pp.metrics_period_at, pp.created_at) >= p_start_date
         AND COALESCE(pp.metrics_period_at, pp.created_at) <= p_end_date
      ) AS propostas_enviadas,
      -- Sales closed
      (SELECT COUNT(*) FROM pipe_propostas pp
       WHERE pp.organization_id = p_org_id
         AND pp.closer_id = tm.id
         AND pp.status = 'vendido'
         AND COALESCE(pp.metrics_period_at, pp.closed_at) >= p_start_date
         AND COALESCE(pp.metrics_period_at, pp.closed_at) <= p_end_date
      ) AS vendas_fechadas
    FROM team_members tm
    WHERE tm.organization_id = p_org_id
      AND tm.is_active = true
  ),
  scored AS (
    SELECT
      sm.*,
      (sm.leads_movimentados * 10 +
       sm.followups_completos * 15 +
       sm.reunioes_realizadas * 20 +
       sm.propostas_enviadas * 25 +
       sm.vendas_fechadas * 30
      ) AS score_bruto
    FROM seller_metrics sm
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'name', s.name,
      'role', s.role,
      'metricType', s.metric_type,
      'leads', s.leads_movimentados,
      'followups', s.followups_completos,
      'reunioes', s.reunioes_realizadas,
      'propostas', s.propostas_enviadas,
      'vendas', s.vendas_fechadas,
      'scoreBruto', s.score_bruto,
      'scoreNormalizado', CASE
        WHEN (SELECT MAX(score_bruto) FROM scored) > 0
        THEN ROUND((s.score_bruto::NUMERIC / (SELECT MAX(score_bruto) FROM scored)) * 100)
        ELSE 0
      END
    )
    ORDER BY s.score_bruto DESC
  )
  INTO result
  FROM scored s;

  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_seller_activity_scores(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_seller_activity_scores(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
```

- [ ] **Step 2: Apply to DEV and commit**

```bash
git add supabase/migrations/20260327100001_seller_activity_scores_rpc.sql
git commit -m "feat(db): add get_seller_activity_scores RPC"
```

---

## Task 3: Backend - Product Ranking RPC

**Files:**
- Create: `supabase/migrations/20260327100002_product_ranking_rpc.sql`

- [ ] **Step 1: Create the migration**

```sql
CREATE OR REPLACE FUNCTION public.get_product_ranking(
  p_org_id UUID,
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(ranked) ORDER BY ranked.total_value DESC), '[]'::jsonb)
  INTO result
  FROM (
    SELECT
      p.id AS product_id,
      p.name AS product_name,
      p.type AS product_type,
      COUNT(DISTINCT ppi.pipe_proposta_id) AS qty_sold,
      SUM(COALESCE(ppi.sale_value, 0)) AS total_value,
      CASE
        WHEN COUNT(DISTINCT ppi.pipe_proposta_id) > 0
        THEN ROUND(SUM(COALESCE(ppi.sale_value, 0)) / COUNT(DISTINCT ppi.pipe_proposta_id), 2)
        ELSE 0
      END AS ticket_medio
    FROM pipe_proposta_items ppi
    JOIN pipe_propostas pp ON pp.id = ppi.pipe_proposta_id
    JOIN products p ON p.id = ppi.product_id
    WHERE pp.organization_id = p_org_id
      AND pp.status = 'vendido'
      AND COALESCE(pp.metrics_period_at, pp.closed_at) >= p_start_date
      AND COALESCE(pp.metrics_period_at, pp.closed_at) <= p_end_date
    GROUP BY p.id, p.name, p.type
    ORDER BY total_value DESC
    LIMIT 10
  ) ranked;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_product_ranking(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_product_ranking(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
```

- [ ] **Step 2: Apply to DEV and commit**

```bash
git add supabase/migrations/20260327100002_product_ranking_rpc.sql
git commit -m "feat(db): add get_product_ranking RPC"
```

---

## Task 4: Backend - Oráculo Usage Table + Rate Limit RPC

**Files:**
- Create: `supabase/migrations/20260327100003_oraculo_usage_table.sql`

- [ ] **Step 1: Create the migration**

```sql
-- Table to track Oráculo usage for rate limiting
CREATE TABLE IF NOT EXISTS public.oraculo_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  response TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_oraculo_usage_user_date ON oraculo_usage(user_id, created_at);
CREATE INDEX idx_oraculo_usage_org ON oraculo_usage(organization_id);

-- RLS: users can only see their own usage
ALTER TABLE oraculo_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own oraculo usage"
  ON oraculo_usage FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own oraculo usage"
  ON oraculo_usage FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- RPC to check rate limit (3 per day per user)
CREATE OR REPLACE FUNCTION public.check_oraculo_limit(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_used INTEGER;
  v_limit INTEGER := 3;
BEGIN
  SELECT COUNT(*) INTO v_used
  FROM oraculo_usage
  WHERE user_id = p_user_id
    AND created_at >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC')
    AND created_at < DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 day';

  RETURN jsonb_build_object(
    'used', v_used,
    'remaining', GREATEST(v_limit - v_used, 0),
    'limit', v_limit
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_oraculo_limit(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_oraculo_limit(UUID) TO service_role;

-- RPC to record oraculo usage (called by edge function)
CREATE OR REPLACE FUNCTION public.record_oraculo_usage(
  p_user_id UUID,
  p_org_id UUID,
  p_question TEXT,
  p_response TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_used INTEGER;
  v_limit INTEGER := 3;
BEGIN
  -- Check limit first
  SELECT COUNT(*) INTO v_used
  FROM oraculo_usage
  WHERE user_id = p_user_id
    AND created_at >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC')
    AND created_at < DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 day';

  IF v_used >= v_limit THEN
    RETURN jsonb_build_object('error', 'limit_exceeded', 'used', v_used, 'remaining', 0);
  END IF;

  INSERT INTO oraculo_usage (user_id, organization_id, question, response)
  VALUES (p_user_id, p_org_id, p_question, p_response);

  RETURN jsonb_build_object('used', v_used + 1, 'remaining', v_limit - v_used - 1);
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_oraculo_usage(UUID, UUID, TEXT, TEXT) TO service_role;
```

- [ ] **Step 2: Apply to DEV and commit**

```bash
git add supabase/migrations/20260327100003_oraculo_usage_table.sql
git commit -m "feat(db): add oraculo_usage table with rate limiting RPCs"
```

---

## Task 5: Backend - Segment Benchmark RPC

**Files:**
- Create: `supabase/migrations/20260327100004_segment_benchmark_rpc.sql`

- [ ] **Step 1: Create the migration**

Uses `leads.segment` as similarity criterion. Returns anonymous aggregated metrics.

```sql
CREATE OR REPLACE FUNCTION public.get_segment_benchmark(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_segment TEXT;
  v_org_count BIGINT;
  result JSONB;
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
BEGIN
  -- Current month range
  v_start := DATE_TRUNC('month', NOW());
  v_end := (DATE_TRUNC('month', NOW()) + INTERVAL '1 month' - INTERVAL '1 second');

  -- Get the most common segment for this org's leads
  SELECT l.segment INTO v_segment
  FROM leads l
  WHERE l.organization_id = p_org_id
    AND l.segment IS NOT NULL
    AND l.segment != ''
  GROUP BY l.segment
  ORDER BY COUNT(*) DESC
  LIMIT 1;

  IF v_segment IS NULL THEN
    RETURN jsonb_build_object('available', false, 'reason', 'no_segment_data');
  END IF;

  -- Count orgs in same segment (excluding this one)
  SELECT COUNT(DISTINCT o.id) INTO v_org_count
  FROM organizations o
  JOIN leads l ON l.organization_id = o.id
  WHERE l.segment = v_segment
    AND o.id != p_org_id;

  IF v_org_count < 2 THEN
    RETURN jsonb_build_object('available', false, 'reason', 'insufficient_peers', 'segment', v_segment);
  END IF;

  -- Aggregate benchmark metrics from peer orgs
  WITH peer_orgs AS (
    SELECT DISTINCT o.id AS org_id
    FROM organizations o
    JOIN leads l ON l.organization_id = o.id
    WHERE l.segment = v_segment AND o.id != p_org_id
  ),
  peer_metrics AS (
    SELECT
      po.org_id,
      (SELECT COUNT(*) FROM leads l WHERE l.organization_id = po.org_id
        AND COALESCE(l.metrics_period_at, l.created_at) >= v_start
        AND COALESCE(l.metrics_period_at, l.created_at) <= v_end) AS leads,
      (SELECT COUNT(*) FROM pipe_propostas pp WHERE pp.organization_id = po.org_id
        AND pp.status = 'vendido'
        AND COALESCE(pp.metrics_period_at, pp.closed_at) >= v_start
        AND COALESCE(pp.metrics_period_at, pp.closed_at) <= v_end) AS vendas,
      (SELECT COALESCE(SUM(pp.sale_value), 0) FROM pipe_propostas pp WHERE pp.organization_id = po.org_id
        AND pp.status = 'vendido'
        AND COALESCE(pp.metrics_period_at, pp.closed_at) >= v_start
        AND COALESCE(pp.metrics_period_at, pp.closed_at) <= v_end) AS revenue,
      (SELECT COUNT(*) FROM team_members tm WHERE tm.organization_id = po.org_id AND tm.is_active = true) AS team_size
    FROM peer_orgs po
  )
  SELECT jsonb_build_object(
    'available', true,
    'segment', v_segment,
    'peerCount', v_org_count,
    'avgTicketMedio', CASE WHEN SUM(vendas) > 0 THEN ROUND(SUM(revenue) / SUM(vendas), 2) ELSE 0 END,
    'avgLeadsPerSeller', CASE WHEN SUM(team_size) > 0 THEN ROUND(SUM(leads)::NUMERIC / SUM(team_size), 1) ELSE 0 END,
    'avgConversionRate', CASE WHEN SUM(leads) > 0 THEN ROUND((SUM(vendas)::NUMERIC / SUM(leads)) * 100, 1) ELSE 0 END
  ) INTO result
  FROM peer_metrics;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_segment_benchmark(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_segment_benchmark(UUID) TO service_role;
```

- [ ] **Step 2: Apply to DEV and commit**

```bash
git add supabase/migrations/20260327100004_segment_benchmark_rpc.sql
git commit -m "feat(db): add get_segment_benchmark RPC"
```

---

## Task 6: Frontend - useCountUp Hook

**Files:**
- Create: `src/hooks/useCountUp.ts`

- [ ] **Step 1: Create the hook**

```typescript
import { useState, useEffect, useRef } from "react";

export function useCountUp(target: number, duration: number = 1200, enabled: boolean = true) {
  const [value, setValue] = useState(0);
  const prevTarget = useRef(0);
  const frameRef = useRef<number>();

  useEffect(() => {
    if (!enabled || target === prevTarget.current) return;

    const startValue = prevTarget.current;
    prevTarget.current = target;
    const startTime = performance.now();

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = startValue + (target - startValue) * eased;

      setValue(current);

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate);
      }
    };

    frameRef.current = requestAnimationFrame(animate);

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [target, duration, enabled]);

  return value;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useCountUp.ts
git commit -m "feat: add useCountUp animation hook"
```

---

## Task 7: Frontend - Extended useDashboardMetrics + New Data Hooks

**Files:**
- Modify: `src/hooks/useDashboardMetrics.ts`
- Create: `src/hooks/useProductRanking.ts`
- Create: `src/hooks/useSellerActivity.ts`
- Create: `src/hooks/useSegmentBenchmark.ts`
- Create: `src/hooks/useOraculoChat.ts`

- [ ] **Step 1: Extend DashboardMetrics interface in useDashboardMetrics.ts**

Add new fields to the `DashboardMetrics` interface (line 14) and map them in the query response:

```typescript
// Add to interface DashboardMetrics (after line 26):
interface DashboardMetrics {
  totalLeads: number;
  reunioesMarcadas: number;
  reunioesComparecidas: number;
  noShow: number;
  taxaNoShow: number;
  vendaTotal: number;
  vendaMRR: number;
  vendaProjeto: number;
  ticketMedio: number;
  ticketMedioMRR: number;
  ticketMedioProjeto: number;
  novosClientes: number;
  // NEW fields
  propostasEnviadas: number;
  tempoMedioResposta: number;
  vendaPrimeiroPedido: number;
  vendaBaseAtiva: number;
  dailySales: Array<{ day: string; revenue: number; count: number }>;
}
```

Update the zero-return objects to include the new fields, and update the response mapping (around line 103) to map the new fields from the RPC response.

- [ ] **Step 2: Create useProductRanking.ts**

```typescript
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "./useTeamMembers";

export interface ProductRankingItem {
  product_id: string;
  product_name: string;
  product_type: "mrr" | "projeto";
  qty_sold: number;
  total_value: number;
  ticket_medio: number;
}

function getMonthRangeUTC(month: number, year: number) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return { startStr: start.toISOString(), endStr: end.toISOString() };
}

export function useProductRanking(month?: number, year?: number) {
  const now = new Date();
  const selectedMonth = month ?? now.getMonth() + 1;
  const selectedYear = year ?? now.getFullYear();
  const { data: currentTeamMember } = useCurrentTeamMember();
  const organizationId = currentTeamMember?.organization_id ?? null;
  const { startStr, endStr } = getMonthRangeUTC(selectedMonth, selectedYear);

  return useQuery({
    queryKey: ["product-ranking", selectedMonth, selectedYear, organizationId],
    queryFn: async (): Promise<ProductRankingItem[]> => {
      if (!organizationId) return [];

      const { data, error } = await supabase.rpc("get_product_ranking", {
        p_org_id: organizationId,
        p_start_date: startStr,
        p_end_date: endStr,
      });

      if (error) {
        console.error("[useProductRanking] RPC error:", error);
        return [];
      }

      const raw = Array.isArray(data) ? data : (data ? [data] : []);
      // If the RPC returns a single array wrapped in jsonb
      const items = raw.length === 1 && Array.isArray(raw[0]) ? raw[0] : raw;
      return items as ProductRankingItem[];
    },
    enabled: !!organizationId,
    staleTime: 120000,
  });
}
```

- [ ] **Step 3: Create useSellerActivity.ts**

```typescript
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "./useTeamMembers";

export interface SellerActivity {
  id: string;
  name: string;
  role: string;
  metricType: string;
  leads: number;
  followups: number;
  reunioes: number;
  propostas: number;
  vendas: number;
  scoreBruto: number;
  scoreNormalizado: number;
}

function getMonthRangeUTC(month: number, year: number) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return { startStr: start.toISOString(), endStr: end.toISOString() };
}

export function useSellerActivity(month?: number, year?: number) {
  const now = new Date();
  const selectedMonth = month ?? now.getMonth() + 1;
  const selectedYear = year ?? now.getFullYear();
  const { data: currentTeamMember } = useCurrentTeamMember();
  const organizationId = currentTeamMember?.organization_id ?? null;
  const { startStr, endStr } = getMonthRangeUTC(selectedMonth, selectedYear);

  return useQuery({
    queryKey: ["seller-activity", selectedMonth, selectedYear, organizationId],
    queryFn: async (): Promise<SellerActivity[]> => {
      if (!organizationId) return [];

      const { data, error } = await supabase.rpc("get_seller_activity_scores", {
        p_org_id: organizationId,
        p_start_date: startStr,
        p_end_date: endStr,
      });

      if (error) {
        console.error("[useSellerActivity] RPC error:", error);
        return [];
      }

      const raw = Array.isArray(data) ? data : [];
      return raw as SellerActivity[];
    },
    enabled: !!organizationId,
    staleTime: 120000,
  });
}
```

- [ ] **Step 4: Create useSegmentBenchmark.ts**

```typescript
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "./useTeamMembers";

export interface SegmentBenchmarkData {
  available: boolean;
  reason?: string;
  segment?: string;
  peerCount?: number;
  avgTicketMedio?: number;
  avgLeadsPerSeller?: number;
  avgConversionRate?: number;
}

export function useSegmentBenchmark() {
  const { data: currentTeamMember } = useCurrentTeamMember();
  const organizationId = currentTeamMember?.organization_id ?? null;

  return useQuery({
    queryKey: ["segment-benchmark", organizationId],
    queryFn: async (): Promise<SegmentBenchmarkData> => {
      if (!organizationId) return { available: false, reason: "no_org" };

      const { data, error } = await supabase.rpc("get_segment_benchmark", {
        p_org_id: organizationId,
      });

      if (error) {
        console.error("[useSegmentBenchmark] RPC error:", error);
        return { available: false, reason: "error" };
      }

      const raw = Array.isArray(data) && data.length > 0 ? data[0] : data;
      return raw as SegmentBenchmarkData;
    },
    enabled: !!organizationId,
    staleTime: 300000, // 5 min
  });
}
```

- [ ] **Step 5: Create useOraculoChat.ts**

```typescript
import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "./useOrganization";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export function useOraculoChat() {
  const { user } = useAuth();
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  const { data: rateLimit } = useQuery({
    queryKey: ["oraculo-limit", user?.id],
    queryFn: async () => {
      if (!user?.id) return { used: 0, remaining: 3, limit: 3 };
      const { data, error } = await supabase.rpc("check_oraculo_limit", {
        p_user_id: user.id,
      });
      if (error) return { used: 0, remaining: 3, limit: 3 };
      const raw = Array.isArray(data) && data.length > 0 ? data[0] : data;
      return raw as { used: number; remaining: number; limit: number };
    },
    enabled: !!user?.id,
    staleTime: 30000,
  });

  const sendMessage = useCallback(async (question: string) => {
    if (!user?.id || !organizationId) return;
    if ((rateLimit?.remaining ?? 0) <= 0) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: question,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke("oraculo-comercial", {
        body: {
          mode: "chat",
          question,
          user_id: user.id,
          organization_id: organizationId,
        },
      });

      if (error) throw error;
      if (data?.error) {
        if (data.error === "limit_exceeded") {
          queryClient.invalidateQueries({ queryKey: ["oraculo-limit"] });
          throw new Error("Você atingiu o limite de consultas diárias.");
        }
        throw new Error(data.error);
      }

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.response || data.tarefa || "Sem resposta",
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, assistantMsg]);
      queryClient.invalidateQueries({ queryKey: ["oraculo-limit"] });
    } catch (err: any) {
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: err?.message || "Erro ao consultar o Oráculo. Tente novamente.",
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id, organizationId, rateLimit?.remaining, queryClient]);

  return {
    messages,
    isLoading,
    isOpen,
    setIsOpen,
    sendMessage,
    rateLimit: rateLimit ?? { used: 0, remaining: 3, limit: 3 },
  };
}
```

- [ ] **Step 6: Commit all hooks**

```bash
git add src/hooks/useCountUp.ts src/hooks/useProductRanking.ts src/hooks/useSellerActivity.ts src/hooks/useSegmentBenchmark.ts src/hooks/useOraculoChat.ts src/hooks/useDashboardMetrics.ts
git commit -m "feat: add new hooks for dashboard v2 (product ranking, seller activity, benchmark, oraculo chat, count-up)"
```

---

## Task 8: Frontend - SpeedometerGauge Component

**Files:**
- Create: `src/components/dashboard/SpeedometerGauge.tsx`

This is the key visual component - a car-style speedometer with dual needles.

- [ ] **Step 1: Create the component**

```typescript
import { memo, useMemo } from "react";
import { motion } from "framer-motion";

interface SpeedometerGaugeProps {
  currentPercent: number; // Where we actually are (0-120+)
  expectedPercent: number; // Where we should be today (0-100)
  goalLabel: string; // e.g. "R$ 100.000"
  currentLabel: string; // e.g. "R$ 65.000"
  subtitle?: string; // e.g. "Dia 15 de 30"
  type?: "faturamento" | "reunioes";
}

function SpeedometerGaugeBase({
  currentPercent,
  expectedPercent,
  goalLabel,
  currentLabel,
  subtitle,
}: SpeedometerGaugeProps) {
  const clampedCurrent = Math.min(Math.max(currentPercent, 0), 130);
  const clampedExpected = Math.min(Math.max(expectedPercent, 0), 130);

  // Arc goes from -135deg (left) to +135deg (right) = 270deg total
  const MIN_ANGLE = -135;
  const MAX_ANGLE = 135;
  const RANGE = MAX_ANGLE - MIN_ANGLE;

  const currentAngle = MIN_ANGLE + (clampedCurrent / 130) * RANGE;
  const expectedAngle = MIN_ANGLE + (clampedExpected / 130) * RANGE;

  const isAhead = currentPercent >= expectedPercent;

  // Generate tick marks
  const ticks = useMemo(() => {
    const result = [];
    for (let i = 0; i <= 13; i++) {
      const pct = i * 10;
      const angle = MIN_ANGLE + (pct / 130) * RANGE;
      const rad = (angle * Math.PI) / 180;
      const isMajor = pct % 20 === 0;
      const innerR = isMajor ? 72 : 76;
      const outerR = 82;
      result.push({
        x1: 100 + innerR * Math.cos(rad),
        y1: 100 + innerR * Math.sin(rad),
        x2: 100 + outerR * Math.cos(rad),
        y2: 100 + outerR * Math.sin(rad),
        label: isMajor ? `${pct}%` : null,
        labelX: 100 + 64 * Math.cos(rad),
        labelY: 100 + 64 * Math.sin(rad),
        isMajor,
      });
    }
    return result;
  }, []);

  // Arc path for the colored band
  const arcPath = (startAngle: number, endAngle: number, radius: number) => {
    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;
    const x1 = 100 + radius * Math.cos(startRad);
    const y1 = 100 + radius * Math.sin(startRad);
    const x2 = 100 + radius * Math.cos(endRad);
    const y2 = 100 + radius * Math.sin(endRad);
    const largeArc = endAngle - startAngle > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`;
  };

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 140" className="w-full max-w-[400px]">
        {/* Background arc */}
        <path
          d={arcPath(MIN_ANGLE, MAX_ANGLE, 82)}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth="8"
          strokeLinecap="round"
        />

        {/* Colored progress arc */}
        <motion.path
          d={arcPath(MIN_ANGLE, currentAngle, 82)}
          fill="none"
          stroke={isAhead ? "hsl(var(--success))" : "hsl(var(--warning))"}
          strokeWidth="8"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.2, ease: "easeOut" }}
        />

        {/* Tick marks */}
        {ticks.map((tick, i) => (
          <g key={i}>
            <line
              x1={tick.x1} y1={tick.y1}
              x2={tick.x2} y2={tick.y2}
              stroke="hsl(var(--muted-foreground))"
              strokeWidth={tick.isMajor ? 2 : 1}
              opacity={tick.isMajor ? 0.7 : 0.3}
            />
            {tick.label && (
              <text
                x={tick.labelX} y={tick.labelY}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-muted-foreground"
                fontSize="7"
                fontWeight="500"
              >
                {tick.label}
              </text>
            )}
          </g>
        ))}

        {/* Expected needle (red/muted) */}
        <motion.g
          initial={{ rotate: MIN_ANGLE }}
          animate={{ rotate: expectedAngle }}
          transition={{ duration: 1, ease: "easeOut", delay: 0.3 }}
          style={{ transformOrigin: "100px 100px" }}
        >
          <line
            x1={100} y1={100}
            x2={100} y2={30}
            stroke="hsl(var(--destructive))"
            strokeWidth="2"
            opacity={0.6}
            strokeLinecap="round"
          />
          <circle cx={100} cy={30} r={3} fill="hsl(var(--destructive))" opacity={0.6} />
        </motion.g>

        {/* Current needle (primary/green) */}
        <motion.g
          initial={{ rotate: MIN_ANGLE }}
          animate={{ rotate: currentAngle }}
          transition={{ duration: 1.2, ease: "easeOut", delay: 0.5 }}
          style={{ transformOrigin: "100px 100px" }}
        >
          <line
            x1={100} y1={100}
            x2={100} y2={25}
            stroke={isAhead ? "hsl(var(--success))" : "hsl(var(--primary))"}
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx={100} cy={25} r={4} fill={isAhead ? "hsl(var(--success))" : "hsl(var(--primary))"} />
          {/* Glow effect when ahead */}
          {isAhead && (
            <motion.circle
              cx={100} cy={25} r={6}
              fill="none"
              stroke="hsl(var(--success))"
              strokeWidth="2"
              animate={{ opacity: [0.8, 0.2, 0.8] }}
              transition={{ repeat: Infinity, duration: 2 }}
            />
          )}
        </motion.g>

        {/* Center hub */}
        <circle cx={100} cy={100} r={8} fill="hsl(var(--card))" stroke="hsl(var(--border))" strokeWidth="2" />
        <circle cx={100} cy={100} r={4} fill="hsl(var(--primary))" />

        {/* Center percentage text */}
        <text
          x={100} y={120}
          textAnchor="middle"
          className="fill-foreground"
          fontSize="18"
          fontWeight="bold"
        >
          {Math.round(currentPercent)}%
        </text>
      </svg>

      {/* Legend */}
      <div className="flex items-center gap-6 mt-2 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-3 h-0.5 bg-destructive/60 rounded" />
          <span className="text-muted-foreground">Meta esperada</span>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-3 h-0.5 rounded ${isAhead ? "bg-success" : "bg-primary"}`} />
          <span className="text-muted-foreground">Realizado</span>
        </div>
      </div>

      {/* Labels */}
      <div className="flex items-center justify-between w-full max-w-[400px] mt-3 px-4">
        <div className="text-center">
          <p className="text-xs text-muted-foreground">Meta</p>
          <p className="text-sm font-bold">{goalLabel}</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-muted-foreground">Realizado</p>
          <p className={`text-sm font-bold ${isAhead ? "text-success" : ""}`}>{currentLabel}</p>
        </div>
        {subtitle && (
          <div className="text-center">
            <p className="text-xs text-muted-foreground">Progresso</p>
            <p className="text-sm font-medium">{subtitle}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export const SpeedometerGauge = memo(SpeedometerGaugeBase);
```

- [ ] **Step 2: Commit**

```bash
git add src/components/dashboard/SpeedometerGauge.tsx
git commit -m "feat: add SpeedometerGauge component with dual needles"
```

---

## Task 9: Frontend - KPICard + FirstOrderVsBase Components

**Files:**
- Create: `src/components/dashboard/KPICard.tsx`
- Create: `src/components/dashboard/FirstOrderVsBase.tsx`

- [ ] **Step 1: Create KPICard with count-up and trend**

```typescript
import { memo } from "react";
import { motion } from "framer-motion";
import { LucideIcon, TrendingUp, TrendingDown } from "lucide-react";
import { useCountUp } from "@/hooks/useCountUp";

interface KPICardProps {
  title: string;
  value: number;
  format?: "currency" | "number" | "percent" | "hours";
  icon: LucideIcon;
  trend?: { value: number; isPositive: boolean };
  delay?: number;
}

function formatValue(value: number, format: string): string {
  switch (format) {
    case "currency":
      if (value >= 1000000) return `R$ ${(value / 1000000).toFixed(1)}M`;
      if (value >= 1000) return `R$ ${(value / 1000).toFixed(0)}K`;
      return `R$ ${Math.round(value).toLocaleString("pt-BR")}`;
    case "percent":
      return `${Math.round(value)}%`;
    case "hours":
      return `${value.toFixed(1)}h`;
    default:
      return Math.round(value).toLocaleString("pt-BR");
  }
}

function KPICardBase({ title, value, format = "number", icon: Icon, trend, delay = 0 }: KPICardProps) {
  const animated = useCountUp(value, 1200, true);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      className="bg-card/80 backdrop-blur-sm border border-border/50 rounded-xl p-5 hover:border-primary/20 transition-colors"
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <div className="flex items-baseline gap-2 mt-1">
            <p className="text-3xl font-bold tracking-tight">
              {formatValue(animated, format)}
            </p>
            {trend && (
              <span className={`flex items-center text-xs font-medium ${trend.isPositive ? "text-success" : "text-destructive"}`}>
                {trend.isPositive ? <TrendingUp className="w-3 h-3 mr-0.5" /> : <TrendingDown className="w-3 h-3 mr-0.5" />}
                {Math.abs(trend.value)}%
              </span>
            )}
          </div>
        </div>
        <div className="p-3 rounded-xl bg-primary/10">
          <Icon className="w-5 h-5 text-primary" />
        </div>
      </div>
    </motion.div>
  );
}

export const KPICard = memo(KPICardBase);
```

- [ ] **Step 2: Create FirstOrderVsBase ring chart**

```typescript
import { memo } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { motion } from "framer-motion";

interface FirstOrderVsBaseProps {
  firstOrderValue: number;
  baseActiveValue: number;
}

function FirstOrderVsBaseBase({ firstOrderValue, baseActiveValue }: FirstOrderVsBaseProps) {
  const total = firstOrderValue + baseActiveValue;
  const data = [
    { name: "Primeiro Pedido", value: firstOrderValue },
    { name: "Base Ativa", value: baseActiveValue },
  ];
  const COLORS = ["hsl(var(--primary))", "hsl(var(--success))"];

  const firstPct = total > 0 ? Math.round((firstOrderValue / total) * 100) : 0;
  const basePct = total > 0 ? Math.round((baseActiveValue / total) * 100) : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card/80 backdrop-blur-sm border border-border/50 rounded-xl p-5"
    >
      <h3 className="font-semibold text-sm mb-4">Receita por Tipo de Cliente</h3>
      <div className="flex items-center gap-4">
        <div className="w-28 h-28">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                innerRadius={30}
                outerRadius={50}
                dataKey="value"
                animationBegin={300}
                animationDuration={800}
              >
                {data.map((_, i) => (
                  <Cell key={i} fill={COLORS[i]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: number) => `R$ ${value.toLocaleString("pt-BR")}`}
                contentStyle={{ fontSize: 12 }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex-1 space-y-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2.5 h-2.5 rounded-full bg-primary" />
              <span className="text-xs text-muted-foreground">Primeiro Pedido</span>
            </div>
            <p className="text-sm font-bold">{firstPct}%</p>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2.5 h-2.5 rounded-full bg-success" />
              <span className="text-xs text-muted-foreground">Base Ativa</span>
            </div>
            <p className="text-sm font-bold">{basePct}%</p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export const FirstOrderVsBase = memo(FirstOrderVsBaseBase);
```

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/KPICard.tsx src/components/dashboard/FirstOrderVsBase.tsx
git commit -m "feat: add KPICard with count-up and FirstOrderVsBase ring chart"
```

---

## Task 10: Frontend - ProductRanking + SellerActivityCard + RankingTable Components

**Files:**
- Create: `src/components/dashboard/ProductRanking.tsx`
- Create: `src/components/dashboard/SellerActivityCard.tsx`
- Create: `src/components/dashboard/RankingTable.tsx`

- [ ] **Step 1: Create ProductRanking** (chart + table)

Uses `useProductRanking` hook. Shows horizontal bar chart on left, table on right. Follows existing recharts patterns from PerformanceChart.

- [ ] **Step 2: Create SellerActivityCard** (score ring + expandable breakdown)

Each seller shows a ring chart with their normalized score (0-100). Click to expand reveals mini horizontal bars for each activity type with the absolute count and comparison to team average.

- [ ] **Step 3: Create RankingTable** (full sortable ranking)

Table showing all sellers with columns: Position, Name, Sales (R$), # Sales, Ticket Médio, Meta, % Atingido with inline progress bar. Current user's row highlighted. Uses `useRankingData` hook.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/ProductRanking.tsx src/components/dashboard/SellerActivityCard.tsx src/components/dashboard/RankingTable.tsx
git commit -m "feat: add ProductRanking, SellerActivityCard, and RankingTable components"
```

---

## Task 11: Frontend - MetaComparativeChart + SegmentBenchmark Components

**Files:**
- Create: `src/components/dashboard/MetaComparativeChart.tsx`
- Create: `src/components/dashboard/SegmentBenchmark.tsx`

- [ ] **Step 1: Create MetaComparativeChart**

Dual-line chart: dashed line for ideal pace (meta ÷ days, cumulative), solid line for actual cumulative. Area between lines colored green (when above) or red (when below). Uses `dailySales` from the extended dashboard metrics RPC + team goal target_value.

- [ ] **Step 2: Create SegmentBenchmark**

Uses `useSegmentBenchmark` hook. Shows side-by-side bars comparing org metrics vs segment average. Handles the "unavailable" state with a friendly message.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/MetaComparativeChart.tsx src/components/dashboard/SegmentBenchmark.tsx
git commit -m "feat: add MetaComparativeChart and SegmentBenchmark components"
```

---

## Task 12: Frontend - Oráculo Chat Components

**Files:**
- Create: `src/components/dashboard/OraculoFloatingButton.tsx`
- Create: `src/components/dashboard/OraculoChat.tsx`

- [ ] **Step 1: Create OraculoFloatingButton**

Fixed position bottom-right floating button with the Sparkles icon, pulsing glow animation, and badge showing remaining questions.

- [ ] **Step 2: Create OraculoChat**

Modal that animates from the floating button position. Uses `useOraculoChat` hook. Chat interface with messages area, input field, send button. Quick suggestion chips. Disabled input when rate limit reached. Framer Motion `layoutId` for smooth open/close transition.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/OraculoFloatingButton.tsx src/components/dashboard/OraculoChat.tsx
git commit -m "feat: add Oráculo chat modal with floating button and animations"
```

---

## Task 13: Frontend - Tab Content Components

**Files:**
- Create: `src/components/dashboard/DashboardHeader.tsx`
- Create: `src/components/dashboard/TabVisaoGeral.tsx`
- Create: `src/components/dashboard/TabPerformance.tsx`
- Create: `src/components/dashboard/TabInteligencia.tsx`

- [ ] **Step 1: Create DashboardHeader**

Executive header with dynamic greeting, user name, subtitle "Aqui está o panorama do seu mês.", and month navigator (prev/next buttons + formatted month name).

- [ ] **Step 2: Create TabVisaoGeral**

Assembles: Row 1 (6 KPICards), Row 2 (SpeedometerGauge + FunnelChart), Row 3 (TopPerformers top 5 + FirstOrderVsBase).

- [ ] **Step 3: Create TabPerformance**

Assembles: Row 1 (RankingTable), Row 2 (SellerActivityCard grid), Row 3 (ProductRanking), Row 4 (PerformanceChart + ActivityFeed).

- [ ] **Step 4: Create TabInteligencia**

Assembles: Row 1 (team goals + individual goals), Row 2 (MetaComparativeChart), Row 3 (AI Insights card + SegmentBenchmark), Row 4 (WeeklyChart).

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/DashboardHeader.tsx src/components/dashboard/TabVisaoGeral.tsx src/components/dashboard/TabPerformance.tsx src/components/dashboard/TabInteligencia.tsx
git commit -m "feat: add dashboard tab components (VisaoGeral, Performance, Inteligencia)"
```

---

## Task 14: Frontend - New Dashboard.tsx Page

**Files:**
- Modify: `src/pages/Dashboard.tsx`

- [ ] **Step 1: Rewrite Dashboard.tsx**

Replace the entire file with the new tabbed layout. Key structure:

```typescript
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { TabVisaoGeral } from "@/components/dashboard/TabVisaoGeral";
import { TabPerformance } from "@/components/dashboard/TabPerformance";
import { TabInteligencia } from "@/components/dashboard/TabInteligencia";
import { OraculoFloatingButton } from "@/components/dashboard/OraculoFloatingButton";
import { OraculoChat } from "@/components/dashboard/OraculoChat";
import { useOraculoChat } from "@/hooks/useOraculoChat";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { useUserRole } from "@/hooks/useUserRole";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";
import { useMasterAuth } from "@/hooks/useMasterAuth";
import { Skeleton } from "@/components/ui/skeleton";
import DashboardOutbound from "./DashboardOutbound";

export default function Dashboard() {
  const { user } = useAuth();
  const { organizationId, orgType, isLoading: orgLoading } = useOrganization();
  const { data: userRole } = useUserRole();
  const role = userRole?.role;
  const { data: currentTeamMember, isLoading: teamMemberLoading } = useCurrentTeamMember();
  const { isMaster } = useMasterAuth();
  const oraculo = useOraculoChat();

  const [selectedMonth, setSelectedMonth] = useState(() => new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());

  // Outbound members get their own dashboard
  if (orgType === "outbound" && role === "member") {
    return <DashboardOutbound />;
  }

  if (orgLoading || teamMemberLoading) {
    return (
      <div className="space-y-8">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-10 w-96" />
        <div className="grid grid-cols-3 gap-4">
          {Array(6).fill(0).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      </div>
    );
  }

  const isAdmin = role === "admin";

  return (
    <div className="space-y-6 relative">
      <DashboardHeader
        month={selectedMonth}
        year={selectedYear}
        onMonthChange={(m, y) => { setSelectedMonth(m); setSelectedYear(y); }}
      />

      <Tabs defaultValue="visao-geral" className="w-full">
        <TabsList className="grid w-full max-w-lg grid-cols-3">
          <TabsTrigger value="visao-geral">Visão Geral</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="inteligencia">Inteligência</TabsTrigger>
        </TabsList>

        <AnimatePresence mode="wait">
          <TabsContent value="visao-geral" className="mt-6">
            <motion.div
              key="visao-geral"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <TabVisaoGeral month={selectedMonth} year={selectedYear} isAdmin={isAdmin} />
            </motion.div>
          </TabsContent>

          <TabsContent value="performance" className="mt-6">
            <motion.div
              key="performance"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <TabPerformance month={selectedMonth} year={selectedYear} />
            </motion.div>
          </TabsContent>

          <TabsContent value="inteligencia" className="mt-6">
            <motion.div
              key="inteligencia"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <TabInteligencia month={selectedMonth} year={selectedYear} isAdmin={isAdmin} />
            </motion.div>
          </TabsContent>
        </AnimatePresence>
      </Tabs>

      {/* Oráculo Floating Button + Chat Modal */}
      <OraculoFloatingButton
        remaining={oraculo.rateLimit.remaining}
        isOpen={oraculo.isOpen}
        onClick={() => oraculo.setIsOpen(!oraculo.isOpen)}
      />
      <AnimatePresence>
        {oraculo.isOpen && (
          <OraculoChat
            messages={oraculo.messages}
            isLoading={oraculo.isLoading}
            rateLimit={oraculo.rateLimit}
            onSend={oraculo.sendMessage}
            onClose={() => oraculo.setIsOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
```

- [ ] **Step 2: Verify the app builds**

```bash
npm run build
```

Fix any TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Dashboard.tsx
git commit -m "feat: rewrite Dashboard.tsx with tabbed Central de Comandos B2B layout"
```

---

## Task 15: Backend - Extend Oráculo Edge Function for Chat Mode

**Files:**
- Modify: `supabase/functions/oraculo-comercial/index.ts`

- [ ] **Step 1: Add chat mode to the edge function**

Extend the handler to detect `mode: "chat"` in the request body. When in chat mode:
1. Validate rate limit using `record_oraculo_usage` RPC (service_role client)
2. Fetch org metrics via `get_dashboard_metrics` RPC
3. Build context prompt with real data
4. Send to OpenRouter with conversational system prompt
5. Return `{ response: "..." }` (not the old `{ problema, tarefa }` format)

The old mode (without `mode` field) continues to work as before for backwards compatibility.

- [ ] **Step 2: Deploy to DEV**

```bash
supabase functions deploy oraculo-comercial --project-ref bcfadphgsibjzivtbjvc
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/oraculo-comercial/index.ts
git commit -m "feat: extend oraculo-comercial edge function with chat mode and rate limiting"
```

---

## Task 16: Visual Polish - Mockup & Review Checkpoint

- [ ] **Step 1: Start dev server and visually inspect each tab**

```bash
npm run dev
```

- [ ] **Step 2: Check all animations trigger correctly**
- Count-up on KPI cards
- Speedometer needle animations
- Tab crossfade transitions
- Oráculo open/close animation
- Funnel bar grow animation
- Staggered card entrance

- [ ] **Step 3: Verify glassmorphism styling on cards**
- `bg-card/80 backdrop-blur-sm border border-border/50`
- Consistent across all new components

- [ ] **Step 4: Verify all old gamified language is removed**
- No "Combustível", "Pilotos", "Pit Lane", "Velocímetro de Metas", "Pista de Conversão", "Hora de Acelerar", "Voltas", "Central de Comando Torque"
- All replaced with B2B executive language

- [ ] **Step 5: Fix any visual issues found**

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: visual polish and language cleanup for Central de Comandos B2B"
```

---

## Task 17: Create Browser Mockup for User Review

- [ ] **Step 1: Run dev server and capture screenshots or create live mockup**

Use Playwright browser tools to navigate to the dashboard and show the user what each tab looks like.

- [ ] **Step 2: Present mockup to user for approval**

---

## Dependencies Between Tasks

```
Task 1 (extend RPC) ──────┐
Task 2 (seller scores) ───┤
Task 3 (product ranking) ─┤──→ Task 7 (hooks) ──→ Task 13 (tab components) ──→ Task 14 (Dashboard.tsx)
Task 4 (oraculo table) ───┤                                                           │
Task 5 (benchmark) ───────┘                                                           ▼
                                                                               Task 16 (polish)
Task 6 (useCountUp) ──→ Task 9 (KPICard) ─────┐                                     │
Task 8 (Speedometer) ─────────────────────────┤──→ Task 13 (tab components)          ▼
Task 10 (Product/Seller/Ranking) ─────────────┤                               Task 17 (mockup)
Task 11 (MetaChart/Benchmark) ────────────────┤
Task 12 (Oráculo Chat) ──────────────────────┘

Task 15 (edge function) can be done in parallel with frontend tasks.
```

**Parallelizable groups:**
- Group A: Tasks 1-5 (all backend, independent)
- Group B: Tasks 6, 8 (independent utility components)
- Group C: Tasks 9-12 (depend on hooks from Task 7)
- Group D: Task 15 (independent backend)
- Sequential: Task 13 → Task 14 → Task 16 → Task 17


## Links relacionados

- [[Master Admin]]

- [[Produtos]]

- [[Visao Geral]]

- [[Metas]]

- [[Gestao de Time]]

- [[Permissoes Sistema]]

- [[Dashboard]]

- [[Ranking]]

- [[Follow-ups]]

- [[Oraculo Comercial]]

- [[OpenRouter Setup]]

- [[Pipe Propostas]]

- [[Pipe Confirmacao]]

- [[00 - INDEX]]
