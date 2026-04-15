---
tags:
  - torque-crm
  - spec
  - features
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: .specs/features/analytics-marketing-redesign/design.md
---

# Design: Analytics - Redesign de Arquitetura de Informação

**Created:** 2026-04-06
**Updated:** 2026-04-08 (rewrite - information architecture focus)

---

## Layout Arquitetural

```
┌─────────────────────────────────────────────────────────────────────────┐
│  DASHBOARD HEADER (existente, inalterado)                               │
│  [month/year selector]                                                  │
├─────────────────────────────────────────────────────────────────────────┤
│  TABS: [Visão Geral] [Performance] [Inteligência] [Analytics*]         │
│  * unified - replaces old "Marketing" + "Analytics" tabs                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─ STICKY FILTER BAR ──────────────────────────────────────────────┐  │
│  │  [Hoje] [7d] [30d*] [90d]  📅 01 Mar - 08 Abr 2026             │  │
│  │                            [Vendedor ▼] [Origem ▼] [⇄ vs ant.]  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─ HERO SECTION ───────────────────────────────────────────────────┐  │
│  │                                                                   │  │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────┐  │  │
│  │  │ 💰 Receita   │ │ 📊 Conversão │ │ 💲 CAC       │ │  Ring  │  │  │
│  │  │ R$ 2.1M      │ │ 12.3%        │ │ R$ 847       │ │  78    │  │  │
│  │  │ ▲ +18%       │ │ ▲ +2.1pp     │ │ ▼ -12%       │ │Saudável│  │  │
│  │  │ [sparkline]  │ │ [sparkline]  │ │ [sparkline]  │ │        │  │  │
│  │  └──────────────┘ └──────────────┘ └──────────────┘ └────────┘  │  │
│  │                                                                   │  │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐        │  │
│  │  │ Leads  │ │ Ticket │ │ Ciclo  │ │ T.Resp │ │ Invest │        │  │
│  │  │ 1.847  │ │ R$ 4K  │ │ 8.2d   │ │ 32min  │ │ R$ 45K │        │  │
│  │  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘        │  │
│  │                                                                   │  │
│  │  ┌── INSIGHTS ───────────────────────────────────────────────┐   │  │
│  │  │ 🏆 Melhor Origem      │ ⚠️ Maior Gargalo  │ 📈 Tendência │   │  │
│  │  │ Meta Ads - 12.3% conv │ Propostas - 34%   │ +15% receita │   │  │
│  │  └───────────────────────────────────────────────────────────┘   │  │
│  │                                                                   │  │
│  │  ┌── FUNIL UNIFICADO (full-width) ───────────────────────────┐   │  │
│  │  │ ████████████████████████████████  Leads        1.847      │   │  │
│  │  │ ██████████████████████           Agendamentos   892  48%  │   │  │
│  │  │ ██████████████                   Comparecimentos 634  71% │   │  │
│  │  │ ████████                         Vendas          227  36% │   │  │
│  │  └───────────────────────────────────────────────────────────┘   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─ DEEP-DIVE TABS ────────────────────────────────────────────────┐   │
│  │  [📡 Aquisição] [🔀 Pipeline] [💰 Receita] [👥 Equipe]         │   │
│  │  ───────────────────────────────────────────────────────         │   │
│  │                                                                  │   │
│  │  (conteúdo da section selecionada - layout variado)              │   │
│  │                                                                  │   │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Design System - Escala Tipográfica

Todos os componentes da seção usam esta escala. Nenhum desvio.

| Token | Tailwind Classes | Uso |
|-------|-----------------|-----|
| `metric-label` | `text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground` | Labels de KPI e métricas |
| `metric-sublabel` | `text-[10px] text-muted-foreground/60` | Subtexto contextual abaixo de valores |
| `chart-title` | `text-sm font-semibold tracking-[-0.01em]` | Títulos de cards de chart |
| `chart-subtitle` | `text-xs text-muted-foreground/50` | Descriçoes abaixo de chart titles |
| `value-lg` | `text-3xl font-extrabold tracking-[-0.04em] tabular-nums` | Hero KPI values |
| `value-md` | `text-xl font-bold tracking-[-0.02em] tabular-nums` | Supporting KPI values |
| `value-sm` | `text-sm font-semibold tabular-nums` | Valores dentro de charts/tables |
| `section-heading` | `text-lg font-semibold tracking-[-0.02em]` | Section headers no deep-dive |
| `section-desc` | `text-sm text-muted-foreground/60` | Descrição abaixo do section heading |

**Implementação:** Utility object exportado de `src/components/analytics/analytics-tokens.ts`:
```ts
export const AT = {
  metricLabel: "text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground",
  metricSublabel: "text-[10px] text-muted-foreground/60",
  chartTitle: "text-sm font-semibold tracking-[-0.01em]",
  chartSubtitle: "text-xs text-muted-foreground/50",
  valueLg: "text-3xl font-extrabold tracking-[-0.04em] tabular-nums",
  valueMd: "text-xl font-bold tracking-[-0.02em] tabular-nums",
  valueSm: "text-sm font-semibold tabular-nums",
  sectionHeading: "text-lg font-semibold tracking-[-0.02em]",
  sectionDesc: "text-sm text-muted-foreground/60",
} as const;
```

---

## Design System - Semantic Colors (KPIs)

| Semântica | Accent Color | Uso |
|-----------|-------------|-----|
| Receita/Revenue | `emerald-500` | Hero KPI Receita, Revenue charts |
| Conversão | `blue-500` | Hero KPI Conversão, funnel |
| Custo/CAC | `amber-500` | Hero KPI CAC, cost metrics |
| Alerta/Danger | `destructive` | Gargalos, scores baixos |
| Health Score | Dynamic (zone color) | Ring progress |

**Implementação nos Hero KPIs:** Em vez da accent bar `bg-primary/60` genérica, cada hero card usa:
- Bottom gradient glow: `bg-gradient-to-t from-{color}/5 to-transparent`
- Icon container com `bg-{color}/10 text-{color}`

---

## Componentes - Novos

### 1. HealthScoreRing (`src/components/analytics/HealthScoreRing.tsx`)

**Substitui:** `HealthScoreGauge.tsx` (canvas speedometer)

```
Props: { score: number } // 0-100

Visual:
┌──────────────────┐
│    ┌─────────┐   │
│    │  ╭───╮  │   │
│    │  │ 78│  │   │ ← SVG ring, 120px, stroke 8px
│    │  ╰───╯  │   │ ← track: hsl(var(--muted)) opacity 20%
│    │ Saudável│   │ ← label colorido pela zone
│    └─────────┘   │
└──────────────────┘
```

- SVG, não canvas - respeita CSS variables e theming
- Ring animado com stroke-dashoffset transition (1200ms, ease-out cubic)
- Score em `text-2xl font-black` no centro
- Label da zone em `text-xs font-semibold` abaixo, cor da zone
- Tooltip info com explicação (reutilizar texto existente)
- Zonas: mesmas 5 do HealthScoreGauge atual
- `calculateHealthScore()` migra sem alteração

### 2. HeroKPICard (`src/components/analytics/HeroKPICard.tsx`)

**Card de métrica tier 1 - maior, com sparkline e semantic color.**

```
Props: {
  title: string
  value: number
  format: "currency" | "percent" | "number"
  trend?: { value: number; isPositive: boolean }
  accentColor: "emerald" | "blue" | "amber"
  delay?: number
}

Visual:
┌────────────────────────┐
│ RECEITA           [📈] │ ← metric-label + icon com bg-emerald-500/10
│                        │
│ R$ 2.1M               │ ← value-lg
│ ▲ +18% vs anterior    │ ← trend badge
│                        │
│ ▂▃▅▆▇█▅▃▂▅▇           │ ← mini sparkline (opcional, se dados disponíveis)
│                        │
│ ░░░░░░░░░░░░░░░░░░░░░ │ ← bg-gradient-to-t from-emerald-500/5
└────────────────────────┘
```

- Padding `p-6` (vs `p-5` do KPICard standard)
- Sem accent bar lateral - usa gradient glow no bottom
- Value usa `value-lg` (text-3xl)
- Sparkline: thin SVG polyline com dados dos últimos 6 meses (se disponíveis via hook)

### 3. UnifiedFunnel (`src/components/analytics/UnifiedFunnel.tsx`)

**Substitui:** `FunnelChart.tsx` (Marketing) + `FullFunnel.tsx` (Analytics)

```
Props: {
  steps: Array<{
    label: string
    value: number
    icon?: LucideIcon
    color: string        // hex or tailwind
    lostCount?: number
    avgDays?: number
  }>
  variant?: "compact" | "detailed"  // compact = hero section, detailed = pipeline section
}

Visual (compact - hero section):
┌──────────────────────────────────────────────────────────────┐
│ ████████████████████████████████████  Leads        1.847     │
│           ↓ 48%                                              │
│ ██████████████████████████           Agendamentos   892      │
│           ↓ 71%                                              │
│ ████████████████████                 Comparecimentos 634     │
│           ↓ 36%                                              │
│ ██████████████                       Vendas          227     │
└──────────────────────────────────────────────────────────────┘
```

- Barras alinhadas à esquerda (não centralizadas)
- Cor: gradiente sutil `opacity 0.12` no background, `3px` border-left sólida
- Gargalo (maior drop): `ring-2 ring-destructive/30` no bar
- Conversion rate entre stages: small text com seta
- Animated width com Framer Motion
- `variant="detailed"` adiciona: avg_days, lost_count, bottleneck highlight

### 4. AnalyticsSectionHeader (`src/components/analytics/AnalyticsSectionHeader.tsx`)

**Header para cada section do deep-dive.**

```
Props: { title: string; description: string; icon: LucideIcon }

Visual:
────────────────────────────── (border-t border-border/30)
                              (pt-8 mt-8)
📡 Aquisição                  ← section-heading + icon
De onde vêm seus leads        ← section-desc
e quanto custa cada um
```

---

## Componentes - Refatorados

### AnalyticsFilters.tsx (refatorado)

**Mudanças:**
- Agrupamento semântico: `<div>` para grupo tempo (esquerda) + `<div>` para grupo dimensão (direita)
- Sticky: `sticky top-0 z-10 bg-background/80 backdrop-blur-sm py-3 -mx-1 px-1 border-b border-border/20`
- Presets com active state: `data-[state=active]:bg-primary data-[state=active]:text-primary-foreground`
- Selects com `bg-transparent border-border/50` normal, `border-primary/30` hover
- Integrar dados de month/year do DashboardHeader (remover seletores inline do antigo Marketing)

### InsightCard.tsx (refatorado)

**Mudanças:**
- Remover `.slice(0, 40)` do TabAnalytics - o InsightCard recebe texto completo
- Usar `line-clamp-2` no value e `line-clamp-3` na description
- `whileHover`: expandir card para mostrar texto completo (remove line-clamp on hover via state)

### KPICard.tsx (mantido)

Continua sendo usado para Tier 2 (supporting KPIs). Sem alteração.

---

## Componentes - Removidos

| Componente | Razão |
|-----------|-------|
| `ResponseHeatmapPlaceholder.tsx` | Card vazio que diz "vá pra outra aba" - zero utilidade |
| `FunnelChart.tsx` (dashboard) | Substituído por `UnifiedFunnel` |
| `FullFunnel.tsx` (analytics) | Substituído por `UnifiedFunnel` |
| `HealthScoreGauge.tsx` | Substituído por `HealthScoreRing` |
| `TabMarketing.tsx` (dashboard tab) | Conteúdo migrado para TabAnalytics unificado |

**Nota:** `FunnelChart.tsx` pode ser usado em outros lugares (ex: TabVisaoGeral). Verificar dependências antes de deletar - se usado fora de Marketing/Analytics, manter e marcar como deprecated.

---

## Deep-Dive Sections - Layout por Section

### Aquisição

```
┌──────────────────────────────┬──────────────────────────────┐
│ Attribution Table            │ Origin Ranking               │
│ (tabela com barras conv.)    │ (leaderboard com podium)     │
│ [full height]                │ [full height]                │
├──────────────────────────────┴──────────────────────────────┤
│ Origin Cards (grid 1→2→3→4 cols)                            │
│ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐               │
│ │Meta Ads│ │ Site   │ │WhatsApp│ │Google  │               │
│ └────────┘ └────────┘ └────────┘ └────────┘               │
├──────────────────────────────┬──────────────────────────────┤
│ CAC by Origin Trend          │ Lead Quality by Origin        │
│ (line chart)                 │ (bar chart)                   │
└──────────────────────────────┴──────────────────────────────┘
```

**Dados from:** `useAnalyticsOverview` (attribution), `useMktByOrigin` (origins), `useAnalyticsComercial` (lead quality), `useAnalyticsFinanceiro` (CAC)

### Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│ Full Funnel (detailed variant, full-width)                   │
│ com avg_days, lost_count, bottleneck highlight               │
├──────────────────────────────┬──────────────────────────────┤
│ Stage Analysis               │ Pipeline Aging               │
│ (table/bars)                 │ (stacked bars)               │
├──────────────────────────────┬──────────────────────────────┤
│ Sales Velocity               │ Weighted Forecast            │
│ (flow diagram + metrics)     │ (bar + total)                │
├─────────────────────────────────────────────────────────────┤
│ Conversion Trends (full-width line chart)                    │
│ Weekly Pipeline Flow (full-width, below)                     │
└─────────────────────────────────────────────────────────────┘
```

**Dados from:** `useAnalyticsPipesFunis`, `useAnalyticsOverview` (sales_velocity)
**Pipeline selector** (existente) mantido no topo da section.

### Receita

```
┌──────────────────────────────┬──────────────────────────────┐
│ Revenue Composition          │ MRR Evolution                │
│ (donut + legend)             │ (area chart)                 │
├──────────────────────────────┬──────────────────────────────┤
│ Ticket Evolution             │ Projection 90d               │
│ (line chart)                 │ (projection area)            │
├──────────────────────────────┬──────────────────────────────┤
│ Seller Profitability         │ Unit Economics Cards         │
│ (bar chart)                  │ (6 mini cards grid)          │
├─────────────────────────────────────────────────────────────┤
│ CohortHeatmap (full-width - precisa de espaço horizontal)   │
└─────────────────────────────────────────────────────────────┘
```

**Dados from:** `useAnalyticsFinanceiro`, `useAnalyticsOverview` (unit_economics, cohort_data)

### Equipe

```
┌──────────────────────────────┬──────────────────────────────┐
│ Engagement KPIs (4 cards)    │ (span full-width)            │
├──────────────────────────────┬──────────────────────────────┤
│ Team Response Times          │ Hourly Response Pattern      │
│ (bar chart per member)       │ (heatmap by hour)            │
├──────────────────────────────┬──────────────────────────────┤
│ Speed-Conversion Correlation │ Copilot vs Human             │
│ (scatter plot)               │ (comparison bars)            │
├──────────────────────────────┬──────────────────────────────┤
│ Ranking Evolution            │ Radar Comparison             │
│ (multi-line chart)           │ (radar chart)                │
├──────────────────────────────┬──────────────────────────────┤
│ Win/Loss Analysis            │ Seller Trend                 │
│ (donut + reasons)            │ (multi-line chart)           │
├─────────────────────────────────────────────────────────────┤
│ Engagement Trends (full-width line chart)                    │
└─────────────────────────────────────────────────────────────┘
```

**Dados from:** `useAnalyticsEngajamento`, `useAnalyticsComercial`

---

## Data Flow

A tab unificada precisa de dados de **todos** os hooks antigos de Marketing + Analytics:

| Hook | Usado em |
|------|---------|
| `useMktByOrigin(month, year)` | Hero funnel, Aquisição (origin cards, ranking) |
| `useMktOriginConfigs(month, year)` | Aquisição (origin cards config) |
| `useAnalyticsOverview()` | Hero KPIs, Hero insights, Aquisição (attribution), Pipeline (velocity), Receita (unit economics, cohort) |
| `useAnalyticsFinanceiro()` | Receita (revenue, MRR, ticket, projection, seller profitability, CAC) |
| `useAnalyticsComercial()` | Equipe (radar, ranking, conversion matrix, lead quality, win/loss, seller trend) |
| `useAnalyticsPipesFunis(pipeline)` | Pipeline (all charts) |
| `useAnalyticsEngajamento()` | Hero (response time KPI), Equipe (all charts) |

**Importante:** Os hooks de deep-dive sections devem ser lazy-loaded - só chamar quando a section é selecionada. Usar `enabled: activeSection === "x"` no React Query.

---

## Migration Path

1. Criar `TabAnalyticsV2.tsx` como novo componente (não editar o antigo)
2. Importar no `Dashboard.tsx` no lugar de `TabAnalytics` + `TabMarketing`
3. Mover conteúdo de origin cards/ranking do antigo TabMarketing para section Aquisição
4. Mover charts das sub-tabs do antigo TabAnalytics para as 4 sections
5. Após validação, deletar componentes obsoletos
6. Componentes de charts internos (AttributionTable, CohortHeatmap, etc.) são **reutilizados sem alteração** - apenas o shell muda

---

## Decisoes Técnicas

1. **Novo componente vs editar:** Criar `TabAnalyticsV2.tsx` para permitir rollback fácil. Após validação, renomear para `TabAnalytics.tsx` e deletar o antigo.

2. **Lazy loading de sections:** Cada section deep-dive é um componente lazy. Os hooks internos usam `enabled` flag para não buscar dados de sections não visíveis.

3. **Month/year:** A tab recebe `month` e `year` do Dashboard.tsx. Sem seletor duplicado. Os hooks de marketing que precisam de month/year recebem via props.

4. **FunnelChart dependências:** O `FunnelChart` do dashboard é usado em `TabVisaoGeral` - NÃO deletar, mas o novo `UnifiedFunnel` substitui seu uso em Marketing/Analytics.

5. **HealthScoreGauge dependências:** Verificar se é usado fora de TabAnalytics. Se não, pode ser deletado. Se sim, manter e deprecar.

6. **Tokens de tipografia:** O objeto `AT` (analytics tokens) é importado por todos os componentes da seção. Não é um design system global - é scoped para analytics.


## Links relacionados

- [[Analytics Comercial]]
- [[Analytics UTMs]]

- [[MOC - Arquitetura]]

- [[Dashboard]]

- [[Ranking]]

- [[Meta Facebook]]

- [[WhatsApp Evolution]]

- [[Copilot]]

- [[00 - INDEX]]
- [[Visao Geral]]
