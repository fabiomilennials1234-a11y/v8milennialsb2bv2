---
tags:
  - claude-code
  - feature
  - torque-crm
  - analytics
created: 2026-04-12
last_updated: 2026-04-12
status: active
---

# Analytics UTMs

## O que faz

Explorer hierarquico de UTMs (campaign → adset → ad → leads). Metricas: total leads, conversoes, CPL (cost per lead), CAC (customer acquisition cost), ROAS. Combina dados do Supabase com Meta Ads spend.

## Regras de negocio

- Drill-down hierarquico: campaign → adset → ad → leads individuais
- Metricas combinam dados internos (leads, conversao, receita) com externos (Meta Ads spend)
- KPIs calculados: totalLeads, totalSpend, avgCpl, avgConversionRate, roas, cac
- Apenas orgs com Meta Ads integrado veem dados de spend

## Como o usuario usa

1. Dashboard → Tab Analytics → Sub-tab UTMs
2. Ve lista de campaigns com metricas
3. Clica numa campaign → ve adsets
4. Clica num adset → ve ads individuais
5. Clica num ad → ve leads gerados

---

## Como funciona (tecnico)

### Componentes

- `src/components/analytics/tabs/UtmsTab.tsx` — Explorer hierarquico

### Hooks

- `useAnalyticsUtms(level, campaign?, adset?, ad?, campaignMetaId?, adsetMetaId?)` — Retorna items[], leads[], kpis {totalLeads, totalSpend, avgCpl, avgConversionRate, roas, cac}

### Edge Functions

- `meta-ads-insights` — Puxa dados Meta Ads API (spend, impressions, clicks, CTR, CPC)

### Tabelas

- `leads` — UTM data vinculado ao lead
- Meta Ads Insights — Dados externos sincronizados

---

## Historico de mudancas

## Links relacionados

- [[Analytics Comercial]]
- [[Meta Facebook]]
