---
tags:
  - torque-crm
  - spec
  - features
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: .specs/features/analytics-marketing-redesign/tasks.md
---

# Tasks: Analytics - Redesign de Arquitetura de Informação

**Created:** 2026-04-06
**Updated:** 2026-04-08 (rewrite - aligned with new spec + design)

---

## Phase 0: Foundation Components [P] - podem rodar em paralelo

### T0.1: Analytics tokens - escala tipográfica unificada [R4.1]
- **What:** Criar arquivo de tokens tipográficos e de cor para toda a seção Analytics
- **Where:** `src/components/analytics/analytics-tokens.ts` (novo)
- **Depends on:** -
- **Done when:**
  - Exporta objeto `AT` com 9 tokens tipográficos (metric-label, metric-sublabel, chart-title, chart-subtitle, value-lg, value-md, value-sm, section-heading, section-desc)
  - Exporta objeto `ACCENT` com cores semânticas (revenue: emerald, conversion: blue, cost: amber, alert: destructive)
  - TypeScript correto, sem valores duplicados
- **Gate:** `npm run build`

### T0.2: HealthScoreRing - SVG ring progress [R2.2, R4.1]
- **What:** Criar ring progress SVG minimalista que substitui o speedometer canvas
- **Where:** `src/components/analytics/HealthScoreRing.tsx` (novo)
- **Depends on:** T0.1 (usa AT tokens)
- **Reuses:** `calculateHealthScore()` de `HealthScoreGauge.tsx` (migrar a função), zonas de cor existentes
- **Done when:**
  - SVG ring de 120px com stroke 8px
  - Animated stroke-dashoffset (1200ms, ease-out cubic) via Framer Motion ou CSS transition
  - Score em `text-2xl font-black` no centro do ring
  - Label da zone (Saudável/Crítico/etc) em `text-xs font-semibold` abaixo, colorido
  - Track em `hsl(var(--muted))` com opacity 0.2
  - Progress arc usa cor da zone (5 zonas: mesmas do atual)
  - Tooltip info com explicação das dimensoes
  - Dark mode correto
  - `calculateHealthScore` exportado do mesmo arquivo
- **Tests:** Visual - comparar com gauge atual
- **Gate:** `npm run build`

### T0.3: UnifiedFunnel - componente de funil reutilizável [R2.5, R4.5]
- **What:** Criar funil visual que substitui FunnelChart (Marketing) e FullFunnel (Analytics)
- **Where:** `src/components/analytics/UnifiedFunnel.tsx` (novo)
- **Depends on:** T0.1 (usa AT tokens)
- **Done when:**
  - Props aceita `steps[]` com label, value, icon?, color, lostCount?, avgDays?
  - Prop `variant`: `"compact"` (hero section) ou `"detailed"` (pipeline section)
  - Barras alinhadas à esquerda (não centralizadas)
  - Cor: background com opacity 0.12, border-left 3px sólida
  - Gargalo (maior drop): `ring-2 ring-destructive/30`
  - Conversion rate entre stages com seta small text
  - `variant="detailed"`: mostra avg_days, lost_count, bottleneck label
  - `variant="compact"`: mostra apenas label, value, conversion %
  - Animated width com Framer Motion (staggered, 0.12s delay per stage)
  - Dark mode correto
- **Tests:** Visual - testar com dados mockados (0 leads, muitos leads, todos iguais)
- **Gate:** `npm run build`

### T0.4: HeroKPICard - card tier 1 com semantic color [R2.1, R4.6]
- **What:** Criar card de KPI grande para a hero section com accent color e gradient glow
- **Where:** `src/components/analytics/HeroKPICard.tsx` (novo)
- **Depends on:** T0.1 (usa AT tokens + ACCENT colors)
- **Reuses:** `useCountUp` hook, `formatValue` logic de KPICard
- **Done when:**
  - Props: title, value, format, trend?, accentColor (emerald|blue|amber), icon, delay?
  - Padding `p-6` (maior que KPICard standard)
  - Value usa token `value-lg` (text-3xl)
  - Label usa token `metric-label`
  - Sem accent bar lateral - usa `bg-gradient-to-t from-{color}/5 to-transparent`
  - Icon container com `bg-{color}/10 text-{color}` (canto superior direito)
  - Count-up animation via useCountUp
  - Trend badge com cor verde/vermelho
  - Animated entry via Framer Motion
  - Dark mode correto
- **Gate:** `npm run build`

### T0.5: AnalyticsSectionHeader - header para deep-dive sections [R4.4]
- **What:** Criar header para cada section do deep-dive com ícone, título e descrição
- **Where:** `src/components/analytics/AnalyticsSectionHeader.tsx` (novo)
- **Depends on:** T0.1 (usa AT tokens)
- **Done when:**
  - Props: title, description, icon
  - Visual: `border-t border-border/30 pt-8 mt-8` como separador
  - Título usa `section-heading`, descrição usa `section-desc`
  - Ícone ao lado do título
  - Dark mode correto
- **Gate:** `npm run build`

---

## Phase 1: Layout Principal

### T1.1: TabAnalyticsV2 - shell da tab unificada [R1.1-R1.4, R5.1-R5.4]
- **What:** Criar novo componente que unifica Marketing + Analytics numa tab com hero section + 4 deep-dive sections
- **Where:** `src/components/dashboard/TabAnalyticsV2.tsx` (novo)
- **Depends on:** T0.1, T0.2, T0.3, T0.4, T0.5
- **Reuses:** `KPICard` (tier 2), `InsightCard` (refatorado), todos os chart components existentes
- **Done when:**
  - Recebe `month` e `year` do Dashboard via props (sem seletor inline)
  - Hero section no topo:
    - 3 HeroKPICard (Receita/emerald, Conversão/blue, CAC/amber)
    - 1 HealthScoreRing (inline, ao lado dos hero cards)
    - 4-5 KPICard tier 2 (Leads, Ticket, Ciclo, T.Resposta, Investimento)
    - 2-3 InsightCards (texto completo, sem .slice())
    - 1 UnifiedFunnel compact (full-width)
  - Deep-dive tabs abaixo: Aquisição, Pipeline, Receita, Equipe (com ícones)
  - Cada deep-dive section é um componente separado (lazy importado)
  - Data hooks com `enabled` flag para lazy loading
  - AnalyticsFilters refatorado e sticky no topo
  - Dark mode correto
  - Animated tab transitions (Framer Motion)
- **Tests:** Visual - verificar hierarquia, responsive em 3 breakpoints
- **Gate:** `npm run build`

### T1.2: Refatorar AnalyticsFilters - sticky + agrupamento semântico [R5.1-R5.3]
- **What:** Refatorar o filter bar para ser sticky, com grupos semânticos e visual integrado
- **Where:** `src/components/analytics/AnalyticsFilters.tsx` (editar)
- **Depends on:** T0.1
- **Done when:**
  - Sticky: `sticky top-0 z-10 bg-background/80 backdrop-blur-sm py-3 border-b border-border/20`
  - Grupo tempo à esquerda: presets + date display
  - Grupo dimensão à direita: vendedor select + origem select + compare toggle
  - Presets com active state claro via variant
  - Selects com `bg-transparent border-border/50`
  - Não inclui seletor de mês/ano (vem do DashboardHeader)
- **Gate:** `npm run build`

### T1.3: Refatorar InsightCard - texto legível [R2.4]
- **What:** Corrigir truncamento de texto nos InsightCards
- **Where:** `src/components/analytics/InsightCard.tsx` (editar), `src/components/dashboard/TabAnalyticsV2.tsx` (consumo)
- **Depends on:** T0.1
- **Done when:**
  - InsightCard aceita `title` e `description` como props separadas (não value+subtitle)
  - Usa `line-clamp-2` no título e `line-clamp-3` na description (CSS, não JS slice)
  - Hover state expande para mostrar texto completo
  - Typography usa AT tokens (chart-title para título, metric-sublabel para description)
- **Gate:** `npm run build`

---

## Phase 2: Deep-Dive Sections

### T2.1: Section Aquisição [R3.1]
- **What:** Criar section de Aquisição que combina dados de Marketing (origins) + Analytics (attribution, CAC)
- **Where:** `src/components/analytics/sections/AquisicaoSection.tsx` (novo)
- **Depends on:** T1.1 (integrado no shell)
- **Reuses:** `AttributionTable`, `MktOriginRanking`, `MktOriginCard`, `CACByOriginTrend`, `LeadQualityByOrigin`, `MktConfigModal`
- **Done when:**
  - AnalyticsSectionHeader com "Aquisição" + "De onde vêm seus leads e quanto custa cada um?"
  - Layout: Attribution + Ranking (2-col) → Origin Cards (grid adaptável) → CAC + Lead Quality (2-col)
  - Origin cards com config modal (botão settings para admin)
  - Dados from `useMktByOrigin(month, year)`, `useAnalyticsOverview`, `useAnalyticsFinanceiro`
  - Marketing investment KPIs inline (Investimento, CPL, CPV)
  - Dark mode correto
- **Gate:** `npm run build`

### T2.2: Section Pipeline [R3.2]
- **What:** Criar section de Pipeline com funil detalhado e métricas de velocidade
- **Where:** `src/components/analytics/sections/PipelineSection.tsx` (novo)
- **Depends on:** T1.1, T0.3 (UnifiedFunnel)
- **Reuses:** `StageAnalysis`, `PipelineAging`, `WeightedForecast`, `ConversionTrends`, `WeeklyPipelineFlow`, `SalesVelocity`, `PipelineSelector`
- **Done when:**
  - AnalyticsSectionHeader com "Pipeline" + "Como está a saúde do seu pipeline?"
  - PipelineSelector no topo da section
  - UnifiedFunnel variant="detailed" (full-width)
  - Layout variado: Stage+Aging (2-col) → Velocity+Forecast (2-col) → Trends (full-width) → Weekly (full-width)
  - Dados from `useAnalyticsPipesFunis(selectedPipeline)`, `useAnalyticsOverview`
  - Dark mode correto
- **Gate:** `npm run build`

### T2.3: Section Receita [R3.3]
- **What:** Criar section de Receita com composição, evolução e projeção
- **Where:** `src/components/analytics/sections/ReceitaSection.tsx` (novo)
- **Depends on:** T1.1
- **Reuses:** `RevenueComposition`, `MRREvolution`, `TicketEvolution`, `Projection90d`, `SellerProfitability`, `UnitEconomicsCards`, `CohortHeatmap`
- **Done when:**
  - AnalyticsSectionHeader com "Receita" + "Quanto está faturando e pra onde vai?"
  - Layout: Revenue+MRR (2-col) → Ticket+Projection (2-col) → Seller+UnitEcon (2-col) → Cohort (full-width)
  - Dados from `useAnalyticsFinanceiro`, `useAnalyticsOverview` (unit_economics, cohort)
  - Dark mode correto
- **Gate:** `npm run build`

### T2.4: Section Equipe [R3.4]
- **What:** Criar section de Equipe com métricas de performance individual e team
- **Where:** `src/components/analytics/sections/EquipeSection.tsx` (novo)
- **Depends on:** T1.1
- **Reuses:** `EngagementKPIs`, `TeamResponseTimes`, `HourlyResponsePattern`, `SpeedConversionCorrelation`, `CopilotVsHuman`, `RankingEvolution`, `RadarComparison`, `WinLossAnalysis`, `SellerTrend`, `EngagementTrends`, `ResponseByOrigin`, `ConversionMatrix`
- **Done when:**
  - AnalyticsSectionHeader com "Equipe" + "Como está a performance do seu time?"
  - EngagementKPIs no topo (4 cards, refatorados com AT tokens)
  - Layout variado: Response+Hourly (2-col) → Speed+Copilot (2-col) → Ranking+Radar (2-col) → WinLoss+Seller (2-col) → Trends (full-width)
  - Dados from `useAnalyticsEngajamento`, `useAnalyticsComercial`
  - Dark mode correto
- **Gate:** `npm run build`

---

## Phase 3: Integration + Cleanup

### T3.1: Dashboard.tsx - integrar tab unificada [R1.1, R6.2, R6.3]
- **What:** Substituir TabAnalytics + TabMarketing por TabAnalyticsV2 no Dashboard
- **Where:** `src/pages/Dashboard.tsx` (editar)
- **Depends on:** T1.1, T2.1, T2.2, T2.3, T2.4
- **Done when:**
  - Remove tab "Marketing" e tab "Analytics" separados
  - Adiciona tab "Analytics" única usando TabAnalyticsV2
  - Passa `month` e `year` para TabAnalyticsV2
  - Remove lazy import de TabMarketing
  - `showAnalytics` (isMaster) controla visibilidade da tab unificada
  - Build passa
- **Gate:** `npm run build`

### T3.2: Rota cleanup [R6.4]
- **What:** Remover redirect de `/marketing` se existir; manter `/analytics` → `/dashboard`
- **Where:** `src/App.tsx` ou router config
- **Depends on:** T3.1
- **Done when:**
  - `/marketing` redireciona para `/dashboard` (ou removido)
  - `/analytics` redireciona para `/dashboard`
  - Nenhuma rota quebrada
- **Gate:** `npm run build`

### T3.3: Token migration - aplicar AT tokens nos charts existentes [R4.1, R9 fix]
- **What:** Aplicar os tokens AT de tipografia nos chart components reutilizados (headers, labels)
- **Where:** Todos os chart components em `src/components/analytics/charts/` + `src/components/marketing/`
- **Depends on:** T0.1, T2.1-T2.4
- **Done when:**
  - Todos os `CardTitle` usam `AT.chartTitle` (ou className equivalente)
  - Todas as subtitles de charts usam `AT.chartSubtitle`
  - Labels de métricas internas usam `AT.metricLabel` ou `AT.metricSublabel`
  - Nenhum style orphan (11px, 10px, 9px com patterns diferentes)
  - Dark mode sem regressão
- **Gate:** `npm run build`

### T3.4: Remover componentes obsoletos [R6.1]
- **What:** Deletar componentes que foram substituídos
- **Where:** Múltiplos arquivos
- **Depends on:** T3.1, T3.3 (tudo funcionando com os novos)
- **Done when:**
  - `ResponseHeatmapPlaceholder.tsx` deletado
  - `HealthScoreGauge.tsx` deletado (se não usado fora de analytics - verificar)
  - `TabMarketing.tsx` (dashboard) deletado
  - Antigo `TabAnalytics.tsx` deletado (substituído por V2)
  - Antigas sub-tab files (`OverviewTab.tsx`, `FinanceiroTab.tsx`, `ComercialTab.tsx`, `PipesFunisTab.tsx`, `EngajamentoTab.tsx`) deletados
  - `FullFunnel.tsx` deletado (substituído por UnifiedFunnel)
  - Nenhum import quebrado
- **Gate:** `npm run build`

### T3.5: Dark mode + responsive validation [R5, visual]
- **What:** Validar dark mode e responsividade em toda a seção
- **Where:** Todos os componentes novos/refatorados
- **Depends on:** T3.3
- **Done when:**
  - Dark mode: nenhum texto invisível, nenhum contraste insuficiente, borders visíveis
  - Mobile (< 640px): grid 1-col, hero KPIs empilhados, funnel vertical
  - Tablet (640-1024px): grid 2-col, hero 2+2
  - Desktop (> 1024px): grid variado conforme design, hero 3+ring
  - Nenhuma barra horizontal (overflow-x)
- **Gate:** Visual check + `npm run build`

---

## Dependency Graph

```
Phase 0 (parallel):
  T0.1 ──┬── T0.2
         ├── T0.3
         ├── T0.4
         └── T0.5

Phase 1:
  T0.* ──── T1.1 ──┬── T2.1
             │      ├── T2.2
  T0.1 ─── T1.2    ├── T2.3
  T0.1 ─── T1.3    └── T2.4

Phase 2 (parallel):
  T2.1 ──┐
  T2.2 ──┤
  T2.3 ──┼── T3.1 ─── T3.2
  T2.4 ──┘         ├── T3.3 ─── T3.4 ─── T3.5

Phase 3 (sequential):
  T3.1 → T3.2 → T3.3 → T3.4 → T3.5
```

## Parallel Opportunities

- **T0.1, T0.2, T0.3, T0.4, T0.5** - Phase 0 inteira é parallelizable (T0.1 precisa rodar primeiro, os outros dependem dele mas são independentes entre si)
- **T2.1, T2.2, T2.3, T2.4** - As 4 sections são independentes e podem rodar em paralelo
- **T1.2, T1.3** - Refatoraçoes podem rodar em paralelo com T1.1

## Estimation

| Phase | Tasks | Parallel? | Effort |
|-------|-------|-----------|--------|
| Phase 0 | T0.1-T0.5 | Sim | 5 componentes pequenos |
| Phase 1 | T1.1-T1.3 | Parcial | T1.1 é o mais complexo (shell principal) |
| Phase 2 | T2.1-T2.4 | Sim | 4 sections, cada uma compoe charts existentes |
| Phase 3 | T3.1-T3.5 | Sequencial | Integration + cleanup |
| **Total** | **17 tasks** | | |


## Links relacionados

- [[Analytics Comercial]]
- [[Analytics UTMs]]

- [[MOC - Arquitetura]]

- [[Dashboard]]

- [[Ranking]]

- [[Copilot]]

- [[00 - INDEX]]
- [[Visao Geral]]
