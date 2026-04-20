---
tags:
  - claude-code
  - feature
  - torque-crm
  - analytics
created: 2026-04-12
last_updated: 2026-04-17
status: active
---

# Analytics Comercial

## O que faz

Analytics completo da operação comercial. Hero KPIs, funil unificado, seções de Aquisição (origens + CAC + ranking), Pipeline (stages + forecast), Receita (composição + MRR + cohort), Equipe (engajamento + ranking + win/loss), UTMs (drill-down Meta). Filtros por data, membro, origem.

## Invariantes técnicos (2026-04-17)

### Fonte de verdade temporal (único)

Todo RPC de analytics usa:
- **Leads**: `COALESCE(l.metrics_period_at, l.created_at)` no WHERE de filtro temporal
- **Vendas**: `COALESCE(pp.metrics_period_at, pp.closed_at)` no WHERE de filtro temporal
- **Confirmações**: `COALESCE(pc.metrics_period_at, pc.created_at)` no WHERE de filtro temporal

Motivo: `metrics_period_at` permite backdated leads/vendas serem atribuídos a uma janela de marketing específica (útil em importações n8n). Se não existe, cai para `created_at`/`closed_at`. Dashboard e Analytics DEVEM usar o mesmo critério — senão os números divergem para o mesmo período.

### Agregação server-side

Toda métrica exibida vem de uma RPC PostgreSQL. Zero agregação client-side de dados do banco. Exceções permitidas:
- Cálculos derivados puros (ex.: `cpl = investimento / leads`) a partir de valores já agregados
- Merge com configuração manual client-side (ex.: investimento de marketing)

Motivo: client-side aggregation fatalmente diverge das RPCs (filtros/joins/semântica diferem). Exemplo corrigido: `useMktByOrigin` antes fazia `supabase.from("leads").select(...)` + filtro JS; agora chama `get_mkt_origin_metrics` server-side.

### Error handling

Hooks de analytics JAMAIS retornam zeros silenciosos em caso de erro RPC. Padrão obrigatório:
```typescript
if (error) {
  console.error("❌ [useX] RPC error:", error.message);
  throw new Error(`X failed: ${error.message}`);
}
```

Componentes DEVEM ler `isError`/`error` de `useQuery` e mostrar banner de erro. Zero mascara erro como "0 leads" bonito.

### Funil compacto = Funil detalhado

`TabAnalyticsV2` (funil compacto, hero) e `PipelineSection` (funil detalhado) consomem a MESMA RPC (`get_analytics_pipeline_metrics` → `funnel_stages`). Nunca adicionar uma segunda fonte para o funil — quebra a invariante "números batem entre widgets".

### Unit de sale_value

`pipe_propostas.sale_value` é `DECIMAL(12,2)` armazenando **reais** (não cents). Forms escrevem reais direto. RPCs retornam reais em `revenue`/`sale_value`. `mkt_origin_config.investimento_cents` é cents (divide por 100 no frontend).

**Atenção**: existem 3 divisões por 100 no frontend mantidas por decisão de negócio ("mantenha tudo em reais e centavos") — exibem receita 100x menor em `TabAnalyticsV2` hero KPIs e `useMktByOrigin` legacy. Consumidores desses valores precisam ter consciência.

## Regras de negócio

- Visível apenas para master admins (tab Analytics do dashboard)
- Filtros persistem em `localStorage` via `useAnalyticsFilters`
- Presets: hoje, 7d, 30d, 90d, custom
- Compare com período anterior (toggle)

## Métricas principais → Fonte SQL

| Métrica | RPC | Campo retorno | Fórmula |
|---------|-----|---------------|---------|
| Leads no período | `get_dashboard_metrics` | `totalLeads` | `COUNT(*) WHERE COALESCE(metrics_period_at, created_at) IN [start, end]` |
| Reuniões marcadas | `get_dashboard_metrics` | `reunioesMarcadas` | `COUNT(pipe_confirmacao)` no período |
| Reuniões comparecidas | `get_dashboard_metrics` | `reunioesComparecidas` | `COUNT(*) WHERE status = 'compareceu'` |
| Vendas | `get_dashboard_metrics` | `funnelVendas` | `COUNT(pipe_propostas) WHERE status = 'vendido'` no período |
| Receita | `get_dashboard_metrics` | `vendaTotal` | `SUM(sale_value)` de vendas no período (reais) |
| Taxa conversão | `get_dashboard_metrics` | `taxaConversao` | `vendas / leads * 100` |
| Ticket médio | `get_dashboard_metrics` | `ticketMedio` | `vendaTotal / funnelVendas` |
| Cohort retention | `get_analytics_overview_metrics` | `cohort_data` | Retenção 6 meses |
| Unit economics (CAC, LTV, LTV:CAC, churn) | `get_analytics_overview_metrics` | `unit_economics` | CAC = commissions/new_customers; LTV = avg_ticket/churn |
| Attribution por origem | `get_analytics_overview_metrics` | `attribution` | Leads/sales/revenue agrupado por `origin` |
| Sales velocity | `get_analytics_overview_metrics` | `sales_velocity` | Avg days por transição de stage |
| Member stats | `get_analytics_commercial_metrics` | `member_stats` | Leads handled, meetings, proposals, deals_won, revenue, avg_ticket por membro |
| Loss reasons | `get_analytics_commercial_metrics` | `loss_reasons` | Distribuição de `loss_reason` em perdidos |
| Origin quality | `get_analytics_commercial_metrics` | `origin_quality` | Conversão e ticket médio por origem |
| Revenue by product type | `get_analytics_financial_metrics` | `revenue_by_type` | Receita agrupada por product_type (mrr/projeto/outros) |
| MRR evolution | `get_analytics_financial_metrics` | `mrr_evolution` | Novo MRR / Churned MRR / Net MRR por mês (6 meses) |
| Seller profitability | `get_analytics_financial_metrics` | `seller_profitability` | Receita + comissão + margem + ROI por vendedor |
| CAC by origin | `get_analytics_financial_metrics` | `cac_by_origin` | Leads por venda agrupado por origem |
| Ticket by type | `get_analytics_financial_metrics` | `ticket_by_type` | Avg ticket por product_type × mês (6 meses) |
| Funil completo | `get_analytics_pipeline_metrics` | `funnel_stages` | Leads → Qualificação → Reunião → Vendido com conversão cumulativa |
| Stage analysis | `get_analytics_pipeline_metrics` | `stage_analysis` | Conversão por transição de stage |
| Pipeline aging | `get_analytics_pipeline_metrics` | `pipeline_aging` | Distribuição saudável/atenção/risco/crítico por stage (dias desde updated_at) |
| Weighted forecast | `get_analytics_pipeline_metrics` | `weighted_forecast` | Deals ativos × win_probability por stage |
| Conversion trends | `get_analytics_pipeline_metrics` | `conversion_trends` | 4 transições × 6 meses |
| Engagement KPIs | `get_analytics_engagement_metrics` | `kpi_cards` | Our avg response, client avg response, response_rate, close_rate |
| Response by origin | `get_analytics_engagement_metrics` | `response_by_origin` | Taxa de resposta por origem |
| Team response times | `get_analytics_engagement_metrics` | `team_response_times` | Avg response time por membro |
| Speed-conversion | `get_analytics_engagement_metrics` | `speed_conversion` | Conversão por bucket de tempo de resposta |
| Hourly pattern | `get_analytics_engagement_metrics` | `hourly_pattern` | Respostas por hora do dia |
| Copilot vs Human | `get_analytics_engagement_metrics` | `copilot_vs_human` | Avg response + response rate + coverage para copilot vs humano |
| UTM metrics | `get_analytics_utm_metrics` | `items` | Leads/converted/revenue por campaign/adset/ad (merge com Meta Insights) |
| Marketing por origem | `get_mkt_origin_metrics` | `origins[]` | Leads + agendamentos + comparecimentos + propostas + vendas + receita por origem |

## Como o usuário usa

1. Dashboard → Tab Analytics (master only)
2. Filtros: período (hoje/7d/30d/90d/custom), membro, origem
3. Hero: 4 KPIs principais (Receita, Conversão, CAC, Health Score) + 5 suporte (Leads, Ticket, Ciclo, Resposta, Investimento)
4. Insights strip: melhor origem, maior gargalo, insight do banco
5. Funil compacto (4 stages)
6. 5 seções deep-dive: Aquisição, Pipeline, Receita, Equipe, UTMs

---

## Como funciona (técnico)

### Componentes

- [TabAnalyticsV2](../../../../src/components/dashboard/TabAnalyticsV2.tsx) — Container com hero + tabs
- [AnalyticsFilters](../../../../src/components/analytics/AnalyticsFilters.tsx) — Sticky filter bar
- [AquisicaoSection](../../../../src/components/analytics/sections/AquisicaoSection.tsx)
- [PipelineSection](../../../../src/components/analytics/sections/PipelineSection.tsx)
- [ReceitaSection](../../../../src/components/analytics/sections/ReceitaSection.tsx)
- [EquipeSection](../../../../src/components/analytics/sections/EquipeSection.tsx)
- [UtmsTab](../../../../src/components/analytics/tabs/UtmsTab.tsx)

### Hooks

- `useAnalyticsOverview()` — hero KPIs, cohort, unit economics, velocity, insights
- `useAnalyticsComercial()` — member stats, loss reasons, origin quality
- `useAnalyticsFinanceiro()` — revenue composition, MRR, seller profitability, CAC, ticket
- `useAnalyticsPipesFunis()` — funnel completo, stage analysis, aging, forecast, trends
- `useAnalyticsEngajamento()` — KPIs de engajamento, response times, patterns, copilot vs human
- `useAnalyticsUtms()` — UTM analytics com merge Meta Ads
- `useMktByOrigin(month, year)` — **server-side via `get_mkt_origin_metrics`** + merge com `mkt_origin_config` para investimento/CPL/ROI
- `useAnalyticsFilters()` — Gerencia filtros persistidos em localStorage

### Tabelas

- `leads` — base com `origin`, `metrics_period_at`, `created_at`, responsáveis
- `pipe_confirmacao` — reuniões com `metrics_period_at`, `status`, `meeting_date`
- `pipe_propostas` — propostas com `sale_value`, `status`, `closed_at`, `metrics_period_at`, `product_type`, `contract_duration`, `loss_reason`
- `pipe_proposta_items` — breakdown MRR/Projeto por item
- `team_members` — membros ativos + `metric_type` (sales/meetings)
- `commissions` — comissões mensais para CAC
- `mkt_origin_config` — investimento manual por origem × month × year (cents)
- `whatsapp_messages` — para response time, hourly pattern, copilot vs human

---

## Histórico de mudanças

- **2026-04-17** — Fix completa: migration `20260417000000_fix_analytics_consistency` padroniza temporal field (`COALESCE(metrics_period_at, ...)`) em 6 RPCs, adiciona `taxaConversao` no dashboard, cria `get_mkt_origin_metrics` para eliminar agregação client-side; hooks agora fazem `throw` em erro RPC; componentes mostram error banner; funil compacto do `TabAnalyticsV2` trocado para usar a mesma RPC do `PipelineSection`; fix de JS truthiness em `useConversionRates`. Ver [[../../07 — Changelog/2026-04-17]].
- **2026-04-12** — Criação da nota.

## Links relacionados

- [[Dashboard]]
- [[Analytics UTMs]]
- [[Performance]]
- [[Ranking]]
