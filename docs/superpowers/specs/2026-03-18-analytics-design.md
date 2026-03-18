# Analytics Module — Design Spec

## Overview

The Analytics module is a new top-level section in the v8 Milennials B2B platform that serves as the **intelligence center** of the system. Unlike the existing Dashboard (which shows current-state KPIs), Analytics provides historical trends, cross-dimensional analysis, predictive metrics, and deep insights across financial, commercial, pipeline, and engagement data.

## Navigation & Structure

**Approach:** Single route `/analytics` with internal tabs and global filters.

**Tabs:**
1. Visão Geral (Overview)
2. Financeiro (Financial)
3. Comercial (Commercial/Sales)
4. Pipes & Funis (Pipelines & Funnels)
5. Engajamento (Engagement)

**Global Filters (persistent across all tabs):**
- Date range picker with presets (hoje, 7d, 30d, 90d, custom) and "vs período anterior" comparison toggle
- Team member filter (all or specific seller)
- Lead origin filter (all or specific origin)

**Sidebar Integration:** New item "Analytics" with BarChart3 icon, placed after "Marketing" in the main navigation. Feature key: `analytics.view`.

## Data Sources

**Internal (existing Supabase tables):**
- `leads` — lead data, origin, segment, faturamento
- `pipe_whatsapp` — qualification pipeline with timestamps
- `pipe_confirmacao` — meeting confirmation pipeline with meeting dates
- `pipe_propostas` — proposals with sales_value, type (unica/mrr/projeto), closed_at
- `team_members` — seller data, roles
- `goals` — monthly targets and achievements
- `commissions` — commission rules and calculations
- `pipeline_stages` — custom stage configuration
- WhatsApp messages (for response time calculations)

**External (future integration — Phase 4):**
- Google Ads API — spend data for CAC calculation
- Meta Ads API — spend data for CAC calculation
- Manual import (CSV/spreadsheet) — costs and financial data not in the system

## Implementation Phases

### Phase 1: Infrastructure + Comercial Tab
Core routing, layout, global filters, date range component, and the Comercial tab (richest existing data).

### Phase 2: Financeiro + Pipes & Funis Tabs
Financial analytics and pipeline analysis using existing data.

### Phase 3: Engajamento Tab
Response time metrics requiring WhatsApp message timestamp analysis.

### Phase 4: External Integrations
Ads API integration, manual import, and real CAC calculations.

---

## Tab 1: Visão Geral (Overview)

The overview tab surfaces the most important cross-cutting insights — the kind of data that answers "how is the business doing and where should I pay attention?"

### Components

**1. Análise de Cohort — Retenção de Clientes**
- Heatmap grid: rows = acquisition month (cohort), columns = months since acquisition (M0–M11)
- Cells show retention % with color intensity (darker = higher retention)
- Data source: `pipe_propostas` (vendido status) cross-referenced with ongoing activity
- Helps identify: which months produced loyal customers, retention trends over time

**2. Unit Economics**
- 6-card grid showing calculated metrics:
  - **CAC** (Customer Acquisition Cost): total marketing/sales cost ÷ new customers. Phase 1-3 uses estimated costs; Phase 4 uses real ad spend.
  - **LTV** (Lifetime Value): average revenue per customer × average customer lifespan
  - **LTV/CAC Ratio**: with health indicator (>3x = healthy, 1-3x = attention, <1x = danger)
  - **Payback Period**: CAC ÷ average monthly revenue per customer
  - **Churn Rate**: customers lost ÷ total customers at start of period
  - **Revenue Churn**: MRR lost ÷ total MRR at start of period
- Each card shows value, trend vs previous period, and health benchmark

**3. Atribuição por Origem — ROI Real**
- Table: Origin × Conversion Rate bar × Leads count × Sales count × Revenue generated × CAC per origin
- Color-coded CAC (green = low, red = high)
- Answers: "which channels actually generate revenue, not just volume?"

**4. Velocidade de Vendas**
- Pipeline flow visualization: Lead → Qualificação → Reunião → Proposta → Venda
- Each transition shows average time in days
- Bottleneck highlighted in red (longest transition)
- 4-card grid:
  - **Ciclo Médio Total**: average days from lead to sale
  - **Gargalo**: which stage takes longest, % of total cycle
  - **Pipeline Velocity**: (deals × win rate × avg ticket) ÷ cycle length = revenue/day
  - **Forecast 30d**: projected revenue based on current pipeline

**5. Heatmap de Resposta — Melhor Hora pra Contato**
- Grid: rows = weekdays (Seg–Sex), columns = hours (8h–19h)
- Cell color intensity = response rate at that day/hour
- Legend: green = best, purple = good, red = weak
- Data source: WhatsApp message timestamps (response patterns)

**6. Insights Automáticos**
- 4 insight cards auto-generated from data analysis:
  - **Oportunidade** (green): underexploited patterns (e.g., high-converting origin with low volume)
  - **Alerta** (red): degrading metrics that need attention
  - **Tendência** (purple): sustained trends with projections
  - **Padrão** (orange): behavioral patterns discovered in data
- Generated by comparing current period metrics against historical baselines

---

## Tab 2: Financeiro (Financial)

Deep financial analysis: revenue composition, MRR health, profitability, projections, and cost trends.

### Components

**1. Composição de Receita**
- Donut chart: MRR vs Projeto vs Única (with percentages and absolute values)
- Total revenue in center
- Below: MRR growth trend (avg monthly growth in R$)

**2. Evolução do MRR**
- Stacked bar chart (6 months): each bar split into:
  - Base MRR (purple)
  - New MRR added (green)
  - Churned MRR (red, stacked on top)
- Below chart: 3 summary cards — Net New MRR, Churned MRR, Net MRR Change

**3. Rentabilidade por Vendedor**
- Table: Seller × visual bar (revenue vs commission overlay) × Revenue × Commission × Margin × ROI
- ROI = Revenue ÷ Commission (how much each R$1 in commission generates)
- Sorted by revenue descending
- Color-coded ROI (green >6x, yellow 3-6x, red <3x)

**4. Projeção 90 dias**
- 3 scenario cards: Pessimista, Realista, Otimista
  - Based on historical growth rate ± standard deviation
- MRR Projetado: current MRR compounded at current growth rate
- Total em Comissões (projetado): based on projected revenue × commission rules

**5. CAC por Canal — Tendência**
- Heatmap table: Origin × Month (6 months)
- Cells show CAC value with color coding (green = decreasing, red = spikes)
- Phase 1-3: estimated CAC. Phase 4: real ad spend data.

**6. Ticket Médio — Evolução por Tipo**
- Grouped bar chart: 3 bars per month (MRR, Projeto, Única)
- Shows trend of average ticket by sale type over 6 months
- Legend with current values

---

## Tab 3: Comercial (Commercial/Sales)

360-degree view of the sales team: performance profiles, rankings, conversion analysis, lead quality, and win/loss patterns.

### Components

**1. Perfil Comparativo de Vendedores (Radar Chart)**
- Radar/spider chart comparing 2+ selected sellers across 6 dimensions:
  - Volume (total deals)
  - Conversão (conversion rate)
  - Ticket (average ticket value)
  - Velocidade (sales cycle speed)
  - Retenção (customer retention)
  - Resposta (response time)
- Seller selector in header (toggle pills)
- Dashed line for team average baseline

**2. Evolução no Ranking — Últimos 6 Meses**
- Table: Seller × Month (6 months)
- Cells show position badge with color (1° purple, 2° blue, 3° green, 4° orange, 5° red)
- Shows stability, climbers, and fallers at a glance

**3. Matriz de Conversão — Vendedor × Etapa**
- Heatmap table: Seller × Pipeline transition (Lead→Qualif, Qualif→Reunião, Reunião→Prop, Prop→Venda)
- Cells show conversion % with color (green = above avg, red = below avg)
- Last row: team average for comparison
- Answers: "where is each seller strong/weak in the funnel?"

**4. Qualidade de Lead por Origem**
- Stacked cards per origin (Google Ads, Indicação, Meta Ads, etc.)
- Each card shows: composite quality Score (0-10), conversion rate, average ticket, cycle length, estimated LTV
- Score calculated from weighted combination of these metrics
- Answers: "which channels bring the best quality leads, not just volume?"

**5. Análise de Win/Loss**
- Split panel: left = Top Motivos de Ganho, right = Top Motivos de Perda
- Each side: 4 bars showing reason and percentage
- Data source: loss reasons from `pipe_propostas` (status = perdido) — may require adding a loss_reason field
- Answers: "why do we win and lose deals?"

**6. Tendência Individual — Quem Tá Subindo/Caindo**
- Diverging bar chart: center line = team average
- Bars extend left (declining) or right (improving) from center
- Color: green = improving, orange = slight decline, red = significant decline
- Shows performance vs own 3-month average
- Answers: "who needs attention and who deserves recognition?"

---

## Tab 4: Pipes & Funis (Pipelines & Funnels)

Pipeline flow analysis, funnel health, forecasting, and conversion trends.

### Components

**Pipeline Selector:** Pill buttons at top to filter by specific pipe (Todos, Qualificação, Confirmação, Propostas, Carteira) or custom pipelines.

**1. Funil Completo — Lead → Venda**
- Tapering bar visualization (wide at top, narrow at bottom)
- Each stage shows: name, count, cumulative %, and between stages: conversion %, lost count, average time
- Bottleneck transitions highlighted in red
- Interactive: click a stage to filter the rest of the tab to that stage

**2. Análise por Etapa — Onde Estamos Perdendo**
- Card per transition: conversion %, vs previous period (pp change), primary loss reason
- Bottleneck card highlighted with red left border and warning icon
- Answers: "which transition is degrading and why?"

**3. Fluxo do Pipeline — Entrada vs Saída por Semana**
- Table: Week × Pipe stages
- Each cell shows: +entries / -exits, net change
- Color-coded net: green positive, red negative, orange declining
- Answers: "is each pipe growing or shrinking? Is inflow keeping up with outflow?"

**4. Aging do Pipeline**
- Stacked horizontal bar per pipe stage
- Segments: Saudável (green, within expected time), Atenção (orange), Risco (red), Crítico (dark red)
- Alert card when any stage has >50% in risk/critical
- Answers: "are deals getting stuck? Where?"

**5. Forecast Ponderado**
- Table: Stage × Pipeline bar × Total Value × Win Probability × Weighted Forecast
- Probability per stage based on historical conversion rates
- Bottom: Pipeline Total and Weighted Forecast total
- Answers: "how much revenue can we realistically expect?"

**6. Taxa de Conversão — Tendência Mensal**
- Sparkline bars per transition (4 rows, 6 months each)
- Last bar colored green (improving) or red (declining)
- Current value and trend direction shown
- Answers: "are our conversion rates improving or declining over time?"

---

## Tab 5: Engajamento (Engagement)

Communication metrics, response patterns, and the impact of speed on conversion.

### Components

**KPI Cards (top row, 4 cards):**
- Tempo Médio Resposta (Nosso): team's average first-response time
- Tempo Médio Resposta (Cliente): how long clients take to reply
- Taxa de Resposta Geral: % of leads that respond to first contact
- Taxa de Fechamento Geral: lead-to-sale conversion rate

**1. Taxa de Resposta & Fechamento por Origem**
- Table: Origin × Response Rate bar × Close Rate bar × Response Time × Leads × Sales
- Color-coded rates and times
- Answers the user's core request: "which origins have the best response and close rates?"

**2. Tempo de Resposta — Nosso Time**
- Horizontal bar chart: each seller + Copilot
- Color bands: green (<4min), orange (4-7min), red (>7min)
- Copilot included as baseline comparison (typically ~12s)
- Answers: "which sellers are fast/slow at responding?"

**3. Padrão de Resposta dos Clientes por Horário**
- Bar chart: hours 7h-19h on x-axis, response volume on y-axis
- Peak hours highlighted in green
- Summary: peak morning, peak afternoon, worst hour
- Data source: WhatsApp message timestamps
- Answers: "when should we reach out for maximum engagement?"

**4. Correlação: Velocidade de Resposta → Conversão**
- 4 tier cards: <2min, 2-5min, 5-15min, >15min
- Each shows conversion rate with bar
- Insight card at bottom with multiplier (e.g., "5.25x more conversions when responding in <2min vs >15min")
- Answers: "does responding faster actually improve results?" (proves it with data)

**5. Tendência de Engajamento — Últimos 6 Meses**
- Heatmap table: metric rows (Taxa Resposta, Nosso Tempo, Cliente Tempo, Fechamento) × 6 months
- Color-coded cells: green = improving, red = degrading
- Shows the evolution of all engagement metrics at a glance

**6. Copilot vs Humano — Performance de Engajamento**
- Comparison table: Metric × Copilot value × Human value
- Metrics: first response time, response rate, qualification rate, scheduling rate, 24/7 coverage, cost per lead
- Highlights where each excels (Copilot: speed/coverage/cost, Human: qualification/scheduling)
- Answers: "what's the ROI of our AI automation?"

---

## Database Changes Required

### New RPC Functions

**`get_analytics_financial_metrics(p_org_id, p_start_date, p_end_date, p_member_id?, p_origin?)`**
Returns: revenue composition (MRR/projeto/unica), MRR evolution, ticket averages by type, commission totals, projections.

**`get_analytics_commercial_metrics(p_org_id, p_start_date, p_end_date, p_member_id?, p_origin?)`**
Returns: per-seller conversion matrix, ranking history, lead quality scores, win/loss reasons, performance trends.

**`get_analytics_pipeline_metrics(p_org_id, p_start_date, p_end_date, p_pipeline_type?, p_member_id?)`**
Returns: funnel flow with conversion rates and times, weekly entry/exit volumes, aging analysis, weighted forecast.

**`get_analytics_engagement_metrics(p_org_id, p_start_date, p_end_date, p_member_id?, p_origin?)`**
Returns: response times (team and client), response/close rates by origin, hourly patterns, speed-conversion correlation.

**`get_analytics_overview_metrics(p_org_id, p_start_date, p_end_date)`**
Returns: cohort data, unit economics, attribution, velocity, top insights.

### Possible Schema Additions

- `pipe_propostas.loss_reason` — enum or text field for why a deal was lost (needed for Win/Loss analysis)
- `analytics_costs` table — for manual cost import (Phase 4): org_id, channel, amount, month, year
- `analytics_ad_integrations` table — for ad platform connections (Phase 4): org_id, platform, credentials, last_sync

### Indexes

- `pipe_propostas`: index on `(organization_id, closed_at)` for time-series queries
- `pipe_whatsapp`: index on `(organization_id, created_at)` for flow analysis
- `pipe_confirmacao`: index on `(organization_id, meeting_date)` for confirmation metrics
- WhatsApp messages: index on `(organization_id, created_at, direction)` for response time calculations

---

## Technical Architecture

### Frontend Structure

```
src/
├── pages/
│   └── Analytics.tsx                    # Main page with tab routing
├── components/
│   └── analytics/
│       ├── AnalyticsLayout.tsx          # Shared layout with global filters
│       ├── AnalyticsFilters.tsx         # Date range, member, origin filters
│       ├── tabs/
│       │   ├── OverviewTab.tsx
│       │   ├── FinanceiroTab.tsx
│       │   ├── ComercialTab.tsx
│       │   ├── PipesFunisTab.tsx
│       │   └── EngajamentoTab.tsx
│       ├── charts/
│       │   ├── CohortHeatmap.tsx
│       │   ├── FunnelVisualization.tsx
│       │   ├── RadarComparison.tsx
│       │   ├── ResponseHeatmap.tsx
│       │   ├── PipelineAging.tsx
│       │   ├── SparklineBars.tsx
│       │   └── DivergingBar.tsx
│       └── cards/
│           ├── UnitEconomicsCard.tsx
│           ├── InsightCard.tsx
│           ├── ForecastCard.tsx
│           └── CorrelationCard.tsx
├── hooks/
│   ├── useAnalyticsFilters.ts           # Shared filter state
│   ├── useAnalyticsOverview.ts
│   ├── useAnalyticsFinanceiro.ts
│   ├── useAnalyticsComercial.ts
│   ├── useAnalyticsPipesFunis.ts
│   └── useAnalyticsEngajamento.ts
```

### Data Fetching Strategy

- One TanStack Query hook per tab, called with current filter state
- Queries only fire when their tab is active (lazy loading)
- `staleTime: 5 minutes` (matching existing config)
- Filters passed as query key parameters for automatic refetch on change
- Heavy computations done server-side in Supabase RPC functions

### Charting

- Primary: **Recharts** (already in project) for standard charts (bar, area, line, pie)
- Custom components for: cohort heatmap, radar chart, funnel visualization, pipeline aging, heatmap grid
- All charts use existing CSS variable color system (chart-1 through chart-5 + semantic colors)

---

## Feature Flagging

- Feature key: `analytics.view` — gates access to the entire Analytics module
- Can be tied to subscription plans (e.g., Pro/Enterprise only)
- Uses existing `PermissionProtectedRoute` and `OrgFeaturesContext`
