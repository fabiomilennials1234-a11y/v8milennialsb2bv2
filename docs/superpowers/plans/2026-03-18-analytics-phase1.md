# Analytics Module — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Analytics module infrastructure (routing, filters, layout) and the Comercial tab with 6 chart/table components, backed by a Supabase RPC function.

**Architecture:** Single `/analytics` route with tabbed layout. Global filters (date range, member, origin) persist across tabs via shared hook with `usePersistedState`. Data fetched via Supabase RPC functions, one per tab, using TanStack Query. Comercial tab is built first because it has the richest existing data.

**Tech Stack:** React 18 + TypeScript, Vite, Supabase (RPC + Postgres), TanStack Query v5, Recharts, shadcn/ui (Radix), Framer Motion, Tailwind CSS.

**Spec:** `docs/superpowers/specs/2026-03-18-analytics-design.md`

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `src/pages/Analytics.tsx` | Main page: tab navigation, global filter bar, lazy tab rendering |
| `src/hooks/useAnalyticsFilters.ts` | Shared filter state (date range, member, origin, comparison toggle) via `usePersistedState` |
| `src/hooks/useAnalyticsComercial.ts` | TanStack Query hook calling `get_analytics_commercial_metrics` RPC |
| `src/components/analytics/AnalyticsFilters.tsx` | Global filter bar UI: date presets, member select, origin select, comparison toggle |
| `src/components/analytics/AnalyticsEmptyState.tsx` | Reusable empty state for charts with insufficient data |
| `src/components/analytics/AnalyticsErrorBoundary.tsx` | Per-component error boundary with retry |
| `src/components/analytics/tabs/ComercialTab.tsx` | Comercial tab layout: arranges 6 chart components in grid |
| `src/components/analytics/charts/RadarComparison.tsx` | Seller comparison radar chart (Recharts RadarChart) |
| `src/components/analytics/charts/RankingEvolution.tsx` | Ranking history table with colored position badges |
| `src/components/analytics/charts/ConversionMatrix.tsx` | Seller × funnel transition heatmap table |
| `src/components/analytics/charts/LeadQualityByOrigin.tsx` | Origin quality score cards |
| `src/components/analytics/charts/WinLossAnalysis.tsx` | Win/Loss reasons split panel with bars |
| `src/components/analytics/charts/SellerTrend.tsx` | Diverging bar chart: seller performance vs average |
| `supabase/migrations/XXXXXX_add_loss_reason_and_analytics_indexes.sql` | Schema: add `loss_reason` to `pipe_propostas`, add indexes |

### Modified Files

| File | Change |
|------|--------|
| `src/lib/feature-registry.ts` | Add `"analytics"` to `FeatureKey`, `FEATURES`, and sub-path mapping |
| `src/App.tsx` | Add lazy import + route for `/analytics` |
| `src/components/layout/Sidebar.tsx` | Add Analytics nav item after Marketing |

---

## Task 1: Feature Registry — Register `analytics` Feature

**Files:**
- Modify: `src/lib/feature-registry.ts`

- [ ] **Step 1: Add `analytics` to `FeatureKey` union type**

In `src/lib/feature-registry.ts`, add `"analytics"` to the `FeatureKey` type union, after `"marketing"`:

```typescript
export type FeatureKey =
  // Modules (sidebar)
  | "chat"
  | "funnels"
  | "review"
  | "leads"
  | "copilot"
  | "commissions"
  | "performance"
  | "marketing"
  | "analytics"          // ← ADD THIS
  | "tv_dashboard"
  | "products"
  // ... rest stays the same
```

- [ ] **Step 2: Add to FEATURES catalog**

Add to the `FEATURES` array, after the marketing entry:

```typescript
{
  key: "analytics",
  label: "Analytics",
  description: "Painel de inteligência com métricas avançadas de vendas, financeiro e engajamento",
  icon: "BarChart3",
  category: "modules",
  sidebarPath: "/analytics",
},
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/feature-registry.ts
git commit -m "feat(analytics): register analytics feature key in feature registry"
```

---

## Task 2: Sidebar — Add Analytics Navigation Item

**Files:**
- Modify: `src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Add import for BarChart3 icon**

Add `BarChart3` to the lucide-react import:

```typescript
import { ..., BarChart3 } from "lucide-react";
```

- [ ] **Step 2: Add Analytics to navItems array**

Insert after the Marketing item:

```typescript
{ label: "Analytics", icon: BarChart3, path: "/analytics" },
```

- [ ] **Step 3: Verify in dev server**

Run: `npm run dev`
Check: Analytics icon appears in sidebar after Marketing. Clicking it navigates to `/analytics` (will show 404 until page is created).

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/Sidebar.tsx
git commit -m "feat(analytics): add Analytics item to sidebar navigation"
```

---

## Task 3: Routing — Add Analytics Page Route

**Files:**
- Create: `src/pages/Analytics.tsx` (stub)
- Modify: `src/App.tsx`

- [ ] **Step 1: Create stub Analytics page**

Create `src/pages/Analytics.tsx`:

```typescript
export default function Analytics() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Analytics</h1>
      <p className="text-muted-foreground">Em construção...</p>
    </div>
  );
}
```

- [ ] **Step 2: Add lazy import and route in App.tsx**

Add lazy import with other pages:

```typescript
const Analytics = lazy(() => lazyRetry(() => import("./pages/Analytics")));
```

Add route with other protected routes:

```typescript
<Route
  path="/analytics"
  element={
    <ProtectedRoute>
      <LayoutWrapper>
        <PermissionProtectedRoute featureKey="analytics.view">
          <Analytics />
        </PermissionProtectedRoute>
      </LayoutWrapper>
    </ProtectedRoute>
  }
/>
```

- [ ] **Step 3: Verify navigation works**

Run: `npm run dev`
Check: Click "Analytics" in sidebar → shows stub page with "Analytics" heading.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Analytics.tsx src/App.tsx
git commit -m "feat(analytics): add /analytics route with protected page stub"
```

---

## Task 4: Schema Migration — Add `loss_reason` and Indexes

**Files:**
- Create: `supabase/migrations/XXXXXX_add_loss_reason_and_analytics_indexes.sql`

- [ ] **Step 1: Create migration file**

Create `supabase/migrations/20260319000000_add_loss_reason_and_analytics_indexes.sql`:

```sql
-- Add loss_reason field to pipe_propostas for Win/Loss analysis
ALTER TABLE pipe_propostas
  ADD COLUMN IF NOT EXISTS loss_reason text;

-- Comment for documentation
COMMENT ON COLUMN pipe_propostas.loss_reason IS
  'Motivo de perda do deal. Valores comuns: sem_budget, concorrencia, timing, follow_up_fraco, produto_nao_adequado, outro';

-- Indexes for analytics time-series queries
CREATE INDEX IF NOT EXISTS idx_pipe_propostas_org_closed
  ON pipe_propostas (organization_id, closed_at)
  WHERE closed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pipe_whatsapp_org_created
  ON pipe_whatsapp (organization_id, created_at);

CREATE INDEX IF NOT EXISTS idx_pipe_confirmacao_org_meeting
  ON pipe_confirmacao (organization_id, meeting_date)
  WHERE meeting_date IS NOT NULL;

-- Seed analytics feature into plan_features for all active plans
-- This enables the analytics module for organizations on these plans
INSERT INTO plan_features (plan_id, feature_key, enabled)
SELECT id, 'analytics', true
FROM subscription_plans
WHERE is_active = true
ON CONFLICT DO NOTHING;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260319000000_add_loss_reason_and_analytics_indexes.sql
git commit -m "feat(analytics): add loss_reason column and analytics indexes migration"
```

---

## Task 5: Shared Hook — `useAnalyticsFilters`

**Files:**
- Create: `src/hooks/useAnalyticsFilters.ts`

- [ ] **Step 1: Create the filter hook**

Create `src/hooks/useAnalyticsFilters.ts`:

```typescript
import { useCallback } from "react";
import { usePersistedState } from "./usePersistedState";
import {
  startOfDay,
  endOfDay,
  subDays,
  subMonths,
  differenceInDays,
  format,
} from "date-fns";

export type DatePreset = "hoje" | "7d" | "30d" | "90d" | "custom";

export interface AnalyticsFilters {
  /** Date range */
  startDate: string; // ISO string
  endDate: string;   // ISO string
  preset: DatePreset;

  /** Comparison */
  compareEnabled: boolean;
  compareStartDate: string;
  compareEndDate: string;

  /** Filters */
  memberId: string | null;   // null = all
  origin: string | null;     // null = all
}

function getPresetDates(preset: DatePreset): { start: Date; end: Date } {
  const now = new Date();
  const end = endOfDay(now);
  switch (preset) {
    case "hoje":
      return { start: startOfDay(now), end };
    case "7d":
      return { start: startOfDay(subDays(now, 6)), end };
    case "30d":
      return { start: startOfDay(subDays(now, 29)), end };
    case "90d":
      return { start: startOfDay(subDays(now, 89)), end };
    default:
      return { start: startOfDay(subDays(now, 29)), end };
  }
}

function getComparisonDates(start: Date, end: Date): { start: Date; end: Date } {
  const days = differenceInDays(end, start) + 1;
  const compEnd = startOfDay(subDays(start, 1));
  const compStart = startOfDay(subDays(compEnd, days - 1));
  return { start: compStart, end: endOfDay(compEnd) };
}

const defaultPreset: DatePreset = "30d";
const defaultDates = getPresetDates(defaultPreset);

const DEFAULT_FILTERS: AnalyticsFilters = {
  startDate: defaultDates.start.toISOString(),
  endDate: defaultDates.end.toISOString(),
  preset: defaultPreset,
  compareEnabled: false,
  compareStartDate: "",
  compareEndDate: "",
  memberId: null,
  origin: null,
};

export function useAnalyticsFilters() {
  const [filters, setFilters, clearFilters] = usePersistedState<AnalyticsFilters>(
    "analytics-filters",
    DEFAULT_FILTERS,
  );

  const setPreset = useCallback(
    (preset: DatePreset) => {
      const dates = getPresetDates(preset);
      const comp = getComparisonDates(dates.start, dates.end);
      setFilters((prev) => ({
        ...prev,
        preset,
        startDate: dates.start.toISOString(),
        endDate: dates.end.toISOString(),
        compareStartDate: comp.start.toISOString(),
        compareEndDate: comp.end.toISOString(),
      }));
    },
    [setFilters],
  );

  const setCustomRange = useCallback(
    (start: Date, end: Date) => {
      const comp = getComparisonDates(start, end);
      setFilters((prev) => ({
        ...prev,
        preset: "custom" as DatePreset,
        startDate: startOfDay(start).toISOString(),
        endDate: endOfDay(end).toISOString(),
        compareStartDate: comp.start.toISOString(),
        compareEndDate: comp.end.toISOString(),
      }));
    },
    [setFilters],
  );

  const toggleCompare = useCallback(() => {
    setFilters((prev) => {
      if (!prev.compareEnabled) {
        const start = new Date(prev.startDate);
        const end = new Date(prev.endDate);
        const comp = getComparisonDates(start, end);
        return {
          ...prev,
          compareEnabled: true,
          compareStartDate: comp.start.toISOString(),
          compareEndDate: comp.end.toISOString(),
        };
      }
      return { ...prev, compareEnabled: false };
    });
  }, [setFilters]);

  const setMemberId = useCallback(
    (id: string | null) => setFilters((prev) => ({ ...prev, memberId: id })),
    [setFilters],
  );

  const setOrigin = useCallback(
    (origin: string | null) => setFilters((prev) => ({ ...prev, origin })),
    [setFilters],
  );

  /** Formatted strings for RPC calls */
  const startStr = format(new Date(filters.startDate), "yyyy-MM-dd");
  const endStr = format(new Date(filters.endDate), "yyyy-MM-dd");
  const compareStartStr = filters.compareStartDate
    ? format(new Date(filters.compareStartDate), "yyyy-MM-dd")
    : null;
  const compareEndStr = filters.compareEndDate
    ? format(new Date(filters.compareEndDate), "yyyy-MM-dd")
    : null;

  return {
    filters,
    startStr,
    endStr,
    compareStartStr,
    compareEndStr,
    setPreset,
    setCustomRange,
    toggleCompare,
    setMemberId,
    setOrigin,
    clearFilters,
  };
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useAnalyticsFilters.ts
git commit -m "feat(analytics): add useAnalyticsFilters hook with date presets and comparison logic"
```

---

## Task 6: Shared Components — Empty State and Error Boundary

**Files:**
- Create: `src/components/analytics/AnalyticsEmptyState.tsx`
- Create: `src/components/analytics/AnalyticsErrorBoundary.tsx`

- [ ] **Step 1: Create AnalyticsEmptyState**

Create `src/components/analytics/AnalyticsEmptyState.tsx`:

```typescript
import { BarChart3 } from "lucide-react";

interface AnalyticsEmptyStateProps {
  message: string;
  detail?: string;
}

export function AnalyticsEmptyState({ message, detail }: AnalyticsEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="rounded-full bg-muted p-4 mb-4">
        <BarChart3 className="h-8 w-8 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium text-muted-foreground">{message}</p>
      {detail && <p className="text-xs text-muted-foreground/60 mt-1">{detail}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Create AnalyticsErrorBoundary**

Create `src/components/analytics/AnalyticsErrorBoundary.tsx`:

```typescript
import { Component, type ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class AnalyticsErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  handleRetry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center py-8 text-center rounded-xl border border-border bg-card">
          <AlertCircle className="h-6 w-6 text-destructive mb-2" />
          <p className="text-sm text-muted-foreground mb-3">
            Erro ao carregar dados.
          </p>
          <Button variant="outline" size="sm" onClick={this.handleRetry}>
            <RefreshCw className="h-3 w-3 mr-1" />
            Tentar novamente
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/analytics/AnalyticsEmptyState.tsx src/components/analytics/AnalyticsErrorBoundary.tsx
git commit -m "feat(analytics): add shared AnalyticsEmptyState and AnalyticsErrorBoundary components"
```

---

## Task 7: Global Filters UI — `AnalyticsFilters`

**Files:**
- Create: `src/components/analytics/AnalyticsFilters.tsx`

- [ ] **Step 1: Create the filter bar component**

Create `src/components/analytics/AnalyticsFilters.tsx`:

```typescript
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarDays, GitCompare } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTeamMembers } from "@/hooks/useTeamMembers";
import { type DatePreset, useAnalyticsFilters } from "@/hooks/useAnalyticsFilters";

const PRESETS: { value: DatePreset; label: string }[] = [
  { value: "hoje", label: "Hoje" },
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
  { value: "90d", label: "90 dias" },
];

const ORIGINS = [
  { value: "google_ads", label: "Google Ads" },
  { value: "meta_ads", label: "Meta Ads" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "site", label: "Site" },
  { value: "remarketing", label: "Remarketing" },
  { value: "cal", label: "Calendário" },
  { value: "outro", label: "Outro" },
];

export function AnalyticsFilters() {
  const {
    filters,
    setPreset,
    toggleCompare,
    setMemberId,
    setOrigin,
  } = useAnalyticsFilters();

  const { data: teamMembers } = useTeamMembers();

  const dateLabel = `${format(new Date(filters.startDate), "dd MMM", { locale: ptBR })} — ${format(new Date(filters.endDate), "dd MMM yyyy", { locale: ptBR })}`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Date presets */}
      <div className="flex items-center gap-1 rounded-lg border border-border p-1">
        {PRESETS.map((p) => (
          <Button
            key={p.value}
            variant={filters.preset === p.value ? "default" : "ghost"}
            size="sm"
            className="h-7 px-3 text-xs"
            onClick={() => setPreset(p.value)}
          >
            {p.label}
          </Button>
        ))}
      </div>

      {/* Date range label */}
      <div className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground">
        <CalendarDays className="h-3.5 w-3.5" />
        {dateLabel}
      </div>

      {/* Compare toggle */}
      <Button
        variant={filters.compareEnabled ? "default" : "outline"}
        size="sm"
        className="h-8 text-xs"
        onClick={toggleCompare}
      >
        <GitCompare className="h-3.5 w-3.5 mr-1" />
        vs anterior
      </Button>

      {/* Member filter */}
      <Select
        value={filters.memberId ?? "all"}
        onValueChange={(v) => setMemberId(v === "all" ? null : v)}
      >
        <SelectTrigger className="w-[180px] h-8 text-xs">
          <SelectValue placeholder="Todos os vendedores" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos os vendedores</SelectItem>
          {teamMembers
            ?.filter((m) => m.is_active)
            .map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>

      {/* Origin filter */}
      <Select
        value={filters.origin ?? "all"}
        onValueChange={(v) => setOrigin(v === "all" ? null : v)}
      >
        <SelectTrigger className="w-[160px] h-8 text-xs">
          <SelectValue placeholder="Todas as origens" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todas as origens</SelectItem>
          {ORIGINS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/analytics/AnalyticsFilters.tsx
git commit -m "feat(analytics): add AnalyticsFilters bar with date presets, member, and origin selectors"
```

---

## Task 8: Analytics Page — Tab Layout

**Files:**
- Modify: `src/pages/Analytics.tsx`

- [ ] **Step 1: Build full page with tabs**

Replace `src/pages/Analytics.tsx` with:

```typescript
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AnalyticsFilters } from "@/components/analytics/AnalyticsFilters";
import { ComercialTab } from "@/components/analytics/tabs/ComercialTab";

export default function Analytics() {
  const [activeTab, setActiveTab] = useState("comercial");

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
      </div>

      {/* Global Filters */}
      <AnalyticsFilters />

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview" disabled>
            Visão Geral
          </TabsTrigger>
          <TabsTrigger value="financeiro" disabled>
            Financeiro
          </TabsTrigger>
          <TabsTrigger value="comercial">Comercial</TabsTrigger>
          <TabsTrigger value="pipes" disabled>
            Pipes & Funis
          </TabsTrigger>
          <TabsTrigger value="engajamento" disabled>
            Engajamento
          </TabsTrigger>
        </TabsList>

        <TabsContent value="comercial" className="space-y-4">
          <ComercialTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

Note: Other tabs are `disabled` — they will be enabled in Phases 2 and 3.

- [ ] **Step 2: Create ComercialTab stub**

Create `src/components/analytics/tabs/ComercialTab.tsx`:

```typescript
export function ComercialTab() {
  return (
    <div className="text-muted-foreground text-sm">
      Comercial tab — components coming next.
    </div>
  );
}
```

- [ ] **Step 3: Verify page renders**

Run: `npm run dev`
Navigate to `/analytics`. Should show: heading, filter bar, tab bar with Comercial active, stub text.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Analytics.tsx src/components/analytics/tabs/ComercialTab.tsx
git commit -m "feat(analytics): build Analytics page with tab layout and ComercialTab stub"
```

---

## Task 9: Supabase RPC — `get_analytics_commercial_metrics`

**Files:**
- Create: `supabase/migrations/20260319000001_analytics_commercial_rpc.sql`

- [ ] **Step 1: Create the RPC function**

Create `supabase/migrations/20260319000001_analytics_commercial_rpc.sql`:

```sql
CREATE OR REPLACE FUNCTION get_analytics_commercial_metrics(
  p_org_id uuid,
  p_start_date date,
  p_end_date date,
  p_member_id uuid DEFAULT NULL,
  p_origin text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
BEGIN
  WITH
  -- Team members
  members AS (
    SELECT id, name FROM team_members
    WHERE organization_id = p_org_id AND is_active = true
  ),
  -- Per-member: leads handled (via pipe_whatsapp.sdr_id)
  member_leads AS (
    SELECT pw.sdr_id AS member_id, COUNT(DISTINCT l.id) AS leads_handled
    FROM pipe_whatsapp pw
    JOIN leads l ON l.id = pw.lead_id
    WHERE pw.organization_id = p_org_id
      AND l.created_at >= p_start_date
      AND l.created_at < (p_end_date + interval '1 day')
      AND (p_origin IS NULL OR l.origin = p_origin)
      AND (p_member_id IS NULL OR pw.sdr_id = p_member_id)
    GROUP BY pw.sdr_id
  ),
  -- Per-member: meetings attended
  member_meetings AS (
    SELECT
      COALESCE(pc.responsible_id, pc.sdr_id) AS member_id,
      COUNT(DISTINCT pc.id) AS meetings_attended
    FROM pipe_confirmacao pc
    JOIN leads l ON l.id = pc.lead_id
    WHERE pc.organization_id = p_org_id
      AND pc.created_at >= p_start_date
      AND pc.created_at < (p_end_date + interval '1 day')
      AND pc.status = 'compareceu'
      AND (p_origin IS NULL OR l.origin = p_origin)
      AND (p_member_id IS NULL OR pc.responsible_id = p_member_id OR pc.sdr_id = p_member_id)
    GROUP BY COALESCE(pc.responsible_id, pc.sdr_id)
  ),
  -- Per-member: proposals and deals
  member_proposals AS (
    SELECT
      pp.closer_id AS member_id,
      COUNT(DISTINCT pp.id) AS proposals_total,
      COUNT(DISTINCT pp.id) FILTER (WHERE pp.status = 'vendido') AS deals_won,
      COALESCE(SUM(pp.sale_value) FILTER (WHERE pp.status = 'vendido'), 0) AS revenue,
      AVG(pp.sale_value) FILTER (WHERE pp.status = 'vendido') AS avg_ticket
    FROM pipe_propostas pp
    JOIN leads l ON l.id = pp.lead_id
    WHERE pp.organization_id = p_org_id
      AND pp.created_at >= p_start_date
      AND pp.created_at < (p_end_date + interval '1 day')
      AND (p_origin IS NULL OR l.origin = p_origin)
      AND (p_member_id IS NULL OR pp.closer_id = p_member_id)
    GROUP BY pp.closer_id
  ),
  -- Assembled member stats
  member_stats AS (
    SELECT
      m.id AS member_id,
      m.name AS member_name,
      COALESCE(ml.leads_handled, 0) AS leads_handled,
      COALESCE(mm.meetings_attended, 0) AS meetings_attended,
      COALESCE(mp.proposals_total, 0) AS proposals_total,
      COALESCE(mp.deals_won, 0) AS deals_won,
      COALESCE(mp.revenue, 0) AS revenue,
      COALESCE(mp.avg_ticket, 0) AS avg_ticket
    FROM members m
    LEFT JOIN member_leads ml ON ml.member_id = m.id
    LEFT JOIN member_meetings mm ON mm.member_id = m.id
    LEFT JOIN member_proposals mp ON mp.member_id = m.id
  ),
  -- All proposals in period (for loss reasons and totals)
  period_proposals AS (
    SELECT pp.id, pp.status, pp.loss_reason
    FROM pipe_propostas pp
    JOIN leads l ON l.id = pp.lead_id
    WHERE pp.organization_id = p_org_id
      AND pp.created_at >= p_start_date
      AND pp.created_at < (p_end_date + interval '1 day')
      AND (p_member_id IS NULL OR pp.closer_id = p_member_id)
      AND (p_origin IS NULL OR l.origin = p_origin)
  ),
  -- Loss reasons
  loss_reasons AS (
    SELECT pp.loss_reason, COUNT(*) AS cnt
    FROM period_proposals pp
    WHERE pp.status = 'perdido'
      AND pp.loss_reason IS NOT NULL AND pp.loss_reason != ''
    GROUP BY pp.loss_reason
    ORDER BY cnt DESC
    LIMIT 4
  ),
  -- Lead quality by origin
  origin_quality AS (
    SELECT
      l.origin,
      COUNT(DISTINCT l.id) AS lead_count,
      COUNT(DISTINCT pp.id) FILTER (WHERE pp.status = 'vendido') AS won_count,
      COALESCE(AVG(pp.sale_value) FILTER (WHERE pp.status = 'vendido'), 0) AS avg_ticket,
      CASE WHEN COUNT(DISTINCT l.id) > 0
        THEN ROUND(COUNT(DISTINCT pp.id) FILTER (WHERE pp.status = 'vendido')::numeric / COUNT(DISTINCT l.id) * 100, 1)
        ELSE 0
      END AS conversion_rate
    FROM leads l
    LEFT JOIN pipe_propostas pp ON pp.lead_id = l.id AND pp.organization_id = p_org_id
    WHERE l.organization_id = p_org_id
      AND l.created_at >= p_start_date
      AND l.created_at < (p_end_date + interval '1 day')
    GROUP BY l.origin
    HAVING COUNT(DISTINCT l.id) >= 5
    ORDER BY conversion_rate DESC
  ),
  -- Total leads in period
  total_leads_count AS (
    SELECT COUNT(DISTINCT l.id) AS cnt
    FROM leads l
    WHERE l.organization_id = p_org_id
      AND l.created_at >= p_start_date
      AND l.created_at < (p_end_date + interval '1 day')
      AND (p_origin IS NULL OR l.origin = p_origin)
  )
  SELECT jsonb_build_object(
    'member_stats', COALESCE((SELECT jsonb_agg(row_to_json(ms)) FROM member_stats ms), '[]'::jsonb),
    'loss_reasons', COALESCE((SELECT jsonb_agg(row_to_json(lr)) FROM loss_reasons lr), '[]'::jsonb),
    'origin_quality', COALESCE((SELECT jsonb_agg(row_to_json(oq)) FROM origin_quality oq), '[]'::jsonb),
    'total_leads', (SELECT cnt FROM total_leads_count),
    'total_won', (SELECT COUNT(*) FROM period_proposals WHERE status = 'vendido'),
    'total_lost', (SELECT COUNT(*) FROM period_proposals WHERE status = 'perdido'),
    'total_loss_reasons', (SELECT COUNT(*) FROM period_proposals WHERE status = 'perdido' AND loss_reason IS NOT NULL AND loss_reason != '')
  ) INTO result;

  RETURN result;
END;
$$;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260319000001_analytics_commercial_rpc.sql
git commit -m "feat(analytics): add get_analytics_commercial_metrics RPC function"
```

---

## Task 10: Data Hook — `useAnalyticsComercial`

**Files:**
- Create: `src/hooks/useAnalyticsComercial.ts`

- [ ] **Step 1: Create the hook**

Create `src/hooks/useAnalyticsComercial.ts`:

```typescript
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";
import { useAnalyticsFilters } from "./useAnalyticsFilters";

export interface MemberStat {
  member_id: string;
  member_name: string;
  leads_handled: number;
  meetings_attended: number;
  proposals_total: number;
  deals_won: number;
  revenue: number;
  avg_ticket: number;
}

export interface LossReason {
  loss_reason: string;
  cnt: number;
}

export interface OriginQuality {
  origin: string;
  lead_count: number;
  won_count: number;
  avg_ticket: number;
  conversion_rate: number;
}

export interface CommercialMetrics {
  member_stats: MemberStat[];
  loss_reasons: LossReason[];
  origin_quality: OriginQuality[];
  total_leads: number;
  total_won: number;
  total_lost: number;
  total_loss_reasons: number;
}

const EMPTY: CommercialMetrics = {
  member_stats: [],
  loss_reasons: [],
  origin_quality: [],
  total_leads: 0,
  total_won: 0,
  total_lost: 0,
  total_loss_reasons: 0,
};

export function useAnalyticsComercial() {
  const { organizationId, isReady } = useOrganization();
  const { filters, startStr, endStr } = useAnalyticsFilters();

  return useQuery({
    queryKey: [
      "analytics-comercial",
      organizationId,
      startStr,
      endStr,
      filters.memberId,
      filters.origin,
    ],
    queryFn: async (): Promise<CommercialMetrics> => {
      const { data, error } = await supabase.rpc(
        "get_analytics_commercial_metrics" as any,
        {
          p_org_id: organizationId,
          p_start_date: startStr,
          p_end_date: endStr,
          p_member_id: filters.memberId,
          p_origin: filters.origin,
        },
      );

      if (error) {
        console.error("❌ [useAnalyticsComercial] RPC error:", error.message);
        return EMPTY;
      }

      const raw = Array.isArray(data) && data.length > 0 ? data[0] : data;
      return (raw as CommercialMetrics) ?? EMPTY;
    },
    enabled: isReady && !!organizationId,
    staleTime: 5 * 60 * 1000,
  });
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useAnalyticsComercial.ts
git commit -m "feat(analytics): add useAnalyticsComercial hook with TanStack Query"
```

---

## Task 11: Chart — Radar Comparison

**Files:**
- Create: `src/components/analytics/charts/RadarComparison.tsx`

- [ ] **Step 1: Build the component**

Create `src/components/analytics/charts/RadarComparison.tsx`:

```typescript
import { useState } from "react";
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users } from "lucide-react";
import { type MemberStat } from "@/hooks/useAnalyticsComercial";
import { AnalyticsEmptyState } from "../AnalyticsEmptyState";

interface Props {
  members: MemberStat[];
}

const COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
];

function normalize(value: number, max: number): number {
  if (max === 0) return 0;
  return Math.round((value / max) * 100);
}

export function RadarComparison({ members }: Props) {
  const [selected, setSelected] = useState<string[]>(
    members.slice(0, 2).map((m) => m.member_id),
  );

  if (members.length < 2) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm">Perfil Comparativo</CardTitle></CardHeader>
        <CardContent>
          <AnalyticsEmptyState message="Necessário pelo menos 2 vendedores." />
        </CardContent>
      </Card>
    );
  }

  const toggle = (id: string) => {
    setSelected((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length < 4
          ? [...prev, id]
          : prev,
    );
  };

  const maxes = {
    volume: Math.max(...members.map((m) => m.leads_handled)),
    conversion: Math.max(...members.map((m) => (m.leads_handled > 0 ? m.deals_won / m.leads_handled : 0))),
    ticket: Math.max(...members.map((m) => m.avg_ticket)),
    velocity: Math.max(...members.map((m) => m.deals_won)),
    meetings: Math.max(...members.map((m) => m.meetings_attended)),
    proposals: Math.max(...members.map((m) => m.proposals_total)),
  };

  const radarData = [
    { axis: "Volume", ...Object.fromEntries(selected.map((id) => {
      const m = members.find((x) => x.member_id === id)!;
      return [id, normalize(m.leads_handled, maxes.volume)];
    }))},
    { axis: "Conversão", ...Object.fromEntries(selected.map((id) => {
      const m = members.find((x) => x.member_id === id)!;
      const rate = m.leads_handled > 0 ? m.deals_won / m.leads_handled : 0;
      return [id, normalize(rate, maxes.conversion)];
    }))},
    { axis: "Ticket", ...Object.fromEntries(selected.map((id) => {
      const m = members.find((x) => x.member_id === id)!;
      return [id, normalize(m.avg_ticket, maxes.ticket)];
    }))},
    // Note: spec calls for Velocidade/Retenção/Resposta dimensions, but those require
    // data from Phases 2-3. Using Vendas/Reuniões/Propostas as Phase 1 proxy.
    { axis: "Vendas", ...Object.fromEntries(selected.map((id) => {
      const m = members.find((x) => x.member_id === id)!;
      return [id, normalize(m.deals_won, maxes.velocity)];
    }))},
    { axis: "Reuniões", ...Object.fromEntries(selected.map((id) => {
      const m = members.find((x) => x.member_id === id)!;
      return [id, normalize(m.meetings_attended, maxes.meetings)];
    }))},
    { axis: "Propostas", ...Object.fromEntries(selected.map((id) => {
      const m = members.find((x) => x.member_id === id)!;
      return [id, normalize(m.proposals_total, maxes.proposals)];
    }))},
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Users className="h-4 w-4" />
            Perfil Comparativo
          </CardTitle>
          <div className="flex flex-wrap gap-1">
            {members.map((m, i) => (
              <Badge
                key={m.member_id}
                variant={selected.includes(m.member_id) ? "default" : "outline"}
                className="cursor-pointer text-xs"
                style={selected.includes(m.member_id) ? { backgroundColor: COLORS[selected.indexOf(m.member_id)] } : {}}
                onClick={() => toggle(m.member_id)}
              >
                {m.member_name.split(" ")[0]}
              </Badge>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={280}>
          <RadarChart data={radarData}>
            <PolarGrid className="stroke-border" />
            <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
            <PolarRadiusAxis tick={false} domain={[0, 100]} />
            {selected.map((id, i) => (
              <Radar
                key={id}
                dataKey={id}
                name={members.find((m) => m.member_id === id)?.member_name.split(" ")[0] ?? ""}
                stroke={COLORS[i]}
                fill={COLORS[i]}
                fillOpacity={0.15}
                strokeWidth={2}
              />
            ))}
            <Legend wrapperStyle={{ fontSize: "11px" }} />
          </RadarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/analytics/charts/RadarComparison.tsx
git commit -m "feat(analytics): add RadarComparison chart for seller profile comparison"
```

---

## Task 12: Chart — Ranking Evolution

**Files:**
- Create: `src/components/analytics/charts/RankingEvolution.tsx`

- [ ] **Step 1: Build the component**

Create `src/components/analytics/charts/RankingEvolution.tsx`:

```typescript
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Medal } from "lucide-react";
import { type MemberStat } from "@/hooks/useAnalyticsComercial";
import { AnalyticsEmptyState } from "../AnalyticsEmptyState";

interface Props {
  members: MemberStat[];
}

const POSITION_COLORS: Record<number, string> = {
  1: "bg-chart-1 text-white",
  2: "bg-chart-2 text-white",
  3: "bg-chart-3 text-white",
  4: "bg-orange-500 text-white",
  5: "bg-destructive text-white",
};

export function RankingEvolution({ members }: Props) {
  if (members.length < 2) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm">Ranking</CardTitle></CardHeader>
        <CardContent>
          <AnalyticsEmptyState message="Necessário pelo menos 2 vendedores com dados." />
        </CardContent>
      </Card>
    );
  }

  // Sort by revenue descending to get current ranking
  const ranked = [...members].sort((a, b) => b.revenue - a.revenue);

  return (
    <Card>
      <CardHeader className="pb-2">
        {/* Note: spec calls for 6-month historical ranking. Phase 1 shows current ranking
            only since historical monthly snapshots require additional data aggregation. */}
        <CardTitle className="text-sm flex items-center gap-2">
          <Medal className="h-4 w-4" />
          Ranking Atual — Por Receita
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {ranked.map((m, idx) => {
            const pos = idx + 1;
            const colorClass = POSITION_COLORS[pos] ?? "bg-muted text-muted-foreground";
            return (
              <div key={m.member_id} className="flex items-center gap-3">
                <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${colorClass}`}>
                  {pos}°
                </span>
                <span className="flex-1 text-sm">{m.member_name}</span>
                <span className="text-sm font-semibold tabular-nums">
                  R$ {(m.revenue / 1000).toFixed(0)}K
                </span>
                <span className="text-xs text-muted-foreground tabular-nums w-16 text-right">
                  {m.deals_won} vendas
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/analytics/charts/RankingEvolution.tsx
git commit -m "feat(analytics): add RankingEvolution component for seller ranking"
```

---

## Task 13: Chart — Conversion Matrix

**Files:**
- Create: `src/components/analytics/charts/ConversionMatrix.tsx`

- [ ] **Step 1: Build the component**

Create `src/components/analytics/charts/ConversionMatrix.tsx`:

```typescript
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Grid3X3 } from "lucide-react";
import { type MemberStat } from "@/hooks/useAnalyticsComercial";
import { AnalyticsEmptyState } from "../AnalyticsEmptyState";

interface Props {
  members: MemberStat[];
  totalLeads: number;
}

function pct(num: number, den: number): string {
  if (den === 0) return "—";
  return `${Math.round((num / den) * 100)}%`;
}

function cellColor(value: number, avg: number): string {
  if (value === 0) return "";
  if (value >= avg * 1.1) return "bg-success/10 text-success font-semibold";
  if (value <= avg * 0.9) return "bg-destructive/10 text-destructive";
  return "text-muted-foreground";
}

export function ConversionMatrix({ members, totalLeads }: Props) {
  if (members.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm">Matriz de Conversão</CardTitle></CardHeader>
        <CardContent>
          <AnalyticsEmptyState message="Sem dados de vendedores no período." />
        </CardContent>
      </Card>
    );
  }

  // Calculate averages
  const avgLeadsToMeetings = members.reduce((s, m) => s + (m.leads_handled > 0 ? m.meetings_attended / m.leads_handled : 0), 0) / members.length;
  const avgMeetingsToProposals = members.reduce((s, m) => s + (m.meetings_attended > 0 ? m.proposals_total / m.meetings_attended : 0), 0) / members.length;
  const avgProposalsToWon = members.reduce((s, m) => s + (m.proposals_total > 0 ? m.deals_won / m.proposals_total : 0), 0) / members.length;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Grid3X3 className="h-4 w-4" />
          Matriz de Conversão — Vendedor × Etapa
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Vendedor</th>
                <th className="text-center py-2 px-3 font-medium text-muted-foreground">Lead→Reunião</th>
                <th className="text-center py-2 px-3 font-medium text-muted-foreground">Reunião→Prop</th>
                <th className="text-center py-2 px-3 font-medium text-muted-foreground">Prop→Venda</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const lToM = m.leads_handled > 0 ? m.meetings_attended / m.leads_handled : 0;
                const mToP = m.meetings_attended > 0 ? m.proposals_total / m.meetings_attended : 0;
                const pToW = m.proposals_total > 0 ? m.deals_won / m.proposals_total : 0;
                return (
                  <tr key={m.member_id} className="border-b border-border/50">
                    <td className="py-2 pr-4">{m.member_name}</td>
                    <td className={`text-center py-2 px-3 rounded ${cellColor(lToM, avgLeadsToMeetings)}`}>
                      {pct(m.meetings_attended, m.leads_handled)}
                    </td>
                    <td className={`text-center py-2 px-3 rounded ${cellColor(mToP, avgMeetingsToProposals)}`}>
                      {pct(m.proposals_total, m.meetings_attended)}
                    </td>
                    <td className={`text-center py-2 px-3 rounded ${cellColor(pToW, avgProposalsToWon)}`}>
                      {pct(m.deals_won, m.proposals_total)}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t border-border">
                <td className="py-2 pr-4 text-muted-foreground italic">Média</td>
                <td className="text-center py-2 px-3 text-muted-foreground">{Math.round(avgLeadsToMeetings * 100)}%</td>
                <td className="text-center py-2 px-3 text-muted-foreground">{Math.round(avgMeetingsToProposals * 100)}%</td>
                <td className="text-center py-2 px-3 text-muted-foreground">{Math.round(avgProposalsToWon * 100)}%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/analytics/charts/ConversionMatrix.tsx
git commit -m "feat(analytics): add ConversionMatrix heatmap table component"
```

---

## Task 14: Chart — Lead Quality by Origin

**Files:**
- Create: `src/components/analytics/charts/LeadQualityByOrigin.tsx`

- [ ] **Step 1: Build the component**

Create `src/components/analytics/charts/LeadQualityByOrigin.tsx`:

```typescript
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles } from "lucide-react";
import { type OriginQuality } from "@/hooks/useAnalyticsComercial";
import { AnalyticsEmptyState } from "../AnalyticsEmptyState";

interface Props {
  origins: OriginQuality[];
}

const ORIGIN_LABELS: Record<string, string> = {
  google_ads: "Google Ads",
  meta_ads: "Meta Ads",
  whatsapp: "WhatsApp",
  site: "Site",
  remarketing: "Remarketing",
  cal: "Calendário",
  outro: "Outro",
};

function qualityScore(o: OriginQuality): number {
  // Weighted: conversion 40%, ticket 30%, volume 30%
  const maxConv = 50; // theoretical max
  const maxTicket = 100000;
  const maxVol = 500;
  const convScore = Math.min(o.conversion_rate / maxConv, 1) * 4;
  const ticketScore = Math.min(o.avg_ticket / maxTicket, 1) * 3;
  const volScore = Math.min(o.lead_count / maxVol, 1) * 3;
  return Math.min(Math.round((convScore + ticketScore + volScore) * 10) / 10, 10);
}

function scoreColor(score: number): string {
  if (score >= 7) return "bg-success/15 text-success";
  if (score >= 4) return "bg-orange-500/15 text-orange-500";
  return "bg-destructive/15 text-destructive";
}

export function LeadQualityByOrigin({ origins }: Props) {
  if (origins.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm">Qualidade por Origem</CardTitle></CardHeader>
        <CardContent>
          <AnalyticsEmptyState message="Sem dados suficientes por origem." detail="Necessário pelo menos 5 leads por origem." />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          Qualidade de Lead por Origem
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {origins.map((o) => {
          const score = qualityScore(o);
          return (
            <div key={o.origin} className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">{ORIGIN_LABELS[o.origin] ?? o.origin}</span>
                <Badge className={`text-xs ${scoreColor(score)}`}>
                  Score: {score.toFixed(1)}/10
                </Badge>
              </div>
              <div className="grid grid-cols-4 gap-4 text-xs">
                <div>
                  <span className="text-muted-foreground">Conv. final</span>
                  <div className="font-semibold">{o.conversion_rate}%</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Ticket médio</span>
                  <div className="font-semibold">R$ {(o.avg_ticket / 1000).toFixed(0)}K</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Leads</span>
                  <div className="font-semibold">{o.lead_count}</div>
                </div>
                <div>
                  <span className="text-muted-foreground">Vendas</span>
                  <div className="font-semibold">{o.won_count}</div>
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/analytics/charts/LeadQualityByOrigin.tsx
git commit -m "feat(analytics): add LeadQualityByOrigin scored cards component"
```

---

## Task 15: Chart — Win/Loss Analysis

**Files:**
- Create: `src/components/analytics/charts/WinLossAnalysis.tsx`

- [ ] **Step 1: Build the component**

Create `src/components/analytics/charts/WinLossAnalysis.tsx`:

```typescript
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Scale } from "lucide-react";
import { type LossReason } from "@/hooks/useAnalyticsComercial";
import { AnalyticsEmptyState } from "../AnalyticsEmptyState";

interface Props {
  lossReasons: LossReason[];
  totalLost: number;
  totalLossReasons: number;
}

const REASON_LABELS: Record<string, string> = {
  sem_budget: "Sem budget",
  concorrencia: "Concorrência",
  timing: "Timing errado",
  follow_up_fraco: "Follow-up fraco",
  produto_nao_adequado: "Produto não adequado",
  outro: "Outro",
};

export function WinLossAnalysis({ lossReasons, totalLost, totalLossReasons }: Props) {
  if (totalLossReasons < 20) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Scale className="h-4 w-4" />
            Análise Win/Loss
          </CardTitle>
        </CardHeader>
        <CardContent>
          <AnalyticsEmptyState
            message="Dados insuficientes para análise Win/Loss"
            detail={`${totalLossReasons} de 20 motivos de perda registrados. Preencha o motivo ao mover deals para "Perdido".`}
          />
        </CardContent>
      </Card>
    );
  }

  const totalReasons = lossReasons.reduce((s, r) => s + r.cnt, 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Scale className="h-4 w-4" />
          Motivos de Perda
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {lossReasons.map((r) => {
          const pct = totalReasons > 0 ? Math.round((r.cnt / totalReasons) * 100) : 0;
          return (
            <div key={r.loss_reason}>
              <div className="flex justify-between mb-1">
                <span className="text-xs text-muted-foreground">
                  {REASON_LABELS[r.loss_reason] ?? r.loss_reason}
                </span>
                <span className="text-xs font-medium">{pct}%</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-destructive rounded-full transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
        <div className="text-xs text-muted-foreground pt-2 border-t border-border">
          {totalLost} deals perdidos no período ({totalLossReasons} com motivo registrado)
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/analytics/charts/WinLossAnalysis.tsx
git commit -m "feat(analytics): add WinLossAnalysis component with minimum data threshold"
```

---

## Task 16: Chart — Seller Trend (Diverging Bar)

**Files:**
- Create: `src/components/analytics/charts/SellerTrend.tsx`

- [ ] **Step 1: Build the component**

Create `src/components/analytics/charts/SellerTrend.tsx`:

```typescript
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp } from "lucide-react";
import { type MemberStat } from "@/hooks/useAnalyticsComercial";
import { AnalyticsEmptyState } from "../AnalyticsEmptyState";

interface Props {
  members: MemberStat[];
}

export function SellerTrend({ members }: Props) {
  if (members.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm">Tendência Individual</CardTitle></CardHeader>
        <CardContent>
          <AnalyticsEmptyState message="Sem dados de vendedores." />
        </CardContent>
      </Card>
    );
  }

  const avgRevenue = members.reduce((s, m) => s + m.revenue, 0) / members.length;

  const sorted = [...members]
    .map((m) => ({
      ...m,
      deviation: avgRevenue > 0 ? ((m.revenue - avgRevenue) / avgRevenue) * 100 : 0,
    }))
    .sort((a, b) => b.deviation - a.deviation);

  const maxAbs = Math.max(...sorted.map((m) => Math.abs(m.deviation)), 1);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          Tendência Individual — vs Média do Time
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {sorted.map((m) => {
          const pct = m.deviation;
          const isPositive = pct >= 0;
          const barWidth = Math.min(Math.abs(pct) / maxAbs * 50, 50);

          let color = "bg-success";
          let textColor = "text-success";
          if (pct < -10) { color = "bg-destructive"; textColor = "text-destructive"; }
          else if (pct < 0) { color = "bg-orange-500"; textColor = "text-orange-500"; }

          return (
            <div key={m.member_id} className="flex items-center gap-3">
              <span className="text-xs w-20 truncate">{m.member_name}</span>
              <div className="flex-1 relative h-5">
                {/* Center line */}
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border" />
                {/* Bar */}
                <div
                  className={`absolute top-0.5 h-4 rounded ${color}`}
                  style={{
                    [isPositive ? "left" : "right"]: "50%",
                    width: `${barWidth}%`,
                  }}
                />
              </div>
              <span className={`text-xs font-semibold w-14 text-right tabular-nums ${textColor}`}>
                {isPositive ? "+" : ""}{Math.round(pct)}%
              </span>
            </div>
          );
        })}
        <div className="text-[10px] text-muted-foreground text-center pt-1">
          Linha central = média do time. Barras mostram desvio individual.
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/analytics/charts/SellerTrend.tsx
git commit -m "feat(analytics): add SellerTrend diverging bar chart component"
```

---

## Task 17: Assemble Comercial Tab

**Files:**
- Modify: `src/components/analytics/tabs/ComercialTab.tsx`

- [ ] **Step 1: Wire all components together**

Replace `src/components/analytics/tabs/ComercialTab.tsx`:

```typescript
import { Loader2 } from "lucide-react";
import { useAnalyticsComercial } from "@/hooks/useAnalyticsComercial";
import { AnalyticsErrorBoundary } from "../AnalyticsErrorBoundary";
import { RadarComparison } from "../charts/RadarComparison";
import { RankingEvolution } from "../charts/RankingEvolution";
import { ConversionMatrix } from "../charts/ConversionMatrix";
import { LeadQualityByOrigin } from "../charts/LeadQualityByOrigin";
import { WinLossAnalysis } from "../charts/WinLossAnalysis";
import { SellerTrend } from "../charts/SellerTrend";

export function ComercialTab() {
  const { data, isLoading } = useAnalyticsComercial();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-4">
      {/* Row 1: Radar + Ranking */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AnalyticsErrorBoundary>
          <RadarComparison members={data.member_stats} />
        </AnalyticsErrorBoundary>
        <AnalyticsErrorBoundary>
          <RankingEvolution members={data.member_stats} />
        </AnalyticsErrorBoundary>
      </div>

      {/* Row 2: Conversion Matrix + Lead Quality */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AnalyticsErrorBoundary>
          <ConversionMatrix
            members={data.member_stats}
            totalLeads={data.total_leads}
          />
        </AnalyticsErrorBoundary>
        <AnalyticsErrorBoundary>
          <LeadQualityByOrigin origins={data.origin_quality} />
        </AnalyticsErrorBoundary>
      </div>

      {/* Row 3: Win/Loss + Seller Trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AnalyticsErrorBoundary>
          <WinLossAnalysis
            lossReasons={data.loss_reasons}
            totalLost={data.total_lost}
            totalLossReasons={data.total_loss_reasons}
          />
        </AnalyticsErrorBoundary>
        <AnalyticsErrorBoundary>
          <SellerTrend members={data.member_stats} />
        </AnalyticsErrorBoundary>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify full page renders**

Run: `npm run dev`
Navigate to `/analytics`. Should show: filter bar, Comercial tab with 6 chart components (may show empty states if no RPC data yet).

- [ ] **Step 3: Verify build passes**

Run: `npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/analytics/tabs/ComercialTab.tsx
git commit -m "feat(analytics): assemble ComercialTab with all 6 chart components"
```

---

## Task 18: Loss Reason UI on Deal Closure

**Files:**
- Modify: The component responsible for moving deals to "perdido" status in PipePropostas (find via `grep -r "perdido" src/components/` — likely in the kanban card or status change modal)

- [ ] **Step 1: Find the deal closure flow**

Search the codebase for where deals are moved to "perdido" status:
```bash
grep -rn "perdido" src/components/ --include="*.tsx" | head -20
```

Identify the component/modal that handles status changes in the Propostas pipeline.

- [ ] **Step 2: Add loss_reason select to the closure modal**

When a deal is moved to "perdido" status, show a `Select` dropdown with common reasons before confirming:

```typescript
const LOSS_REASONS = [
  { value: "sem_budget", label: "Sem budget" },
  { value: "concorrencia", label: "Concorrência" },
  { value: "timing", label: "Timing errado" },
  { value: "follow_up_fraco", label: "Follow-up fraco" },
  { value: "produto_nao_adequado", label: "Produto não adequado" },
  { value: "outro", label: "Outro" },
];
```

Add a `Select` component that appears only when the target status is "perdido". The selected reason is saved to `pipe_propostas.loss_reason` via the same update query that changes the status.

- [ ] **Step 3: Update the status change handler**

In the handler that updates `pipe_propostas.status` to "perdido", also set `loss_reason`:

```typescript
const { error } = await supabase
  .from("pipe_propostas")
  .update({ status: "perdido", loss_reason: selectedReason })
  .eq("id", proposalId);
```

- [ ] **Step 4: Verify the flow works**

Run: `npm run dev`
Navigate to Propostas pipeline. Move a card to "Perdido". Verify the reason dropdown appears and the value is saved.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(analytics): add loss_reason dropdown when closing deals as perdido"
```

---

## Task 19: Final Verification

- [ ] **Step 1: Run type check**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Run tests**

Run: `npm run test:run`
Expected: All existing tests still pass.

- [ ] **Step 4: Manual smoke test**

1. Navigate to `/analytics`
2. Verify filter bar shows date presets, member dropdown, origin dropdown, compare toggle
3. Verify Comercial tab is active, other tabs are disabled
4. Verify chart components render (with data or empty states)
5. Verify sidebar shows Analytics icon
6. Verify clicking other sidebar items still works

- [ ] **Step 5: Final commit if any fixes needed**

Only if previous steps revealed issues that were fixed.

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Feature registry | `feature-registry.ts` |
| 2 | Sidebar nav item | `Sidebar.tsx` |
| 3 | Route + page stub | `Analytics.tsx`, `App.tsx` |
| 4 | Schema migration | `migrations/...sql` |
| 5 | Filter hook | `useAnalyticsFilters.ts` |
| 6 | Shared components | `AnalyticsEmptyState.tsx`, `AnalyticsErrorBoundary.tsx` |
| 7 | Filter UI | `AnalyticsFilters.tsx` |
| 8 | Page with tabs | `Analytics.tsx`, `ComercialTab.tsx` stub |
| 9 | RPC function | `migrations/...sql` |
| 10 | Data hook | `useAnalyticsComercial.ts` |
| 11 | Radar chart | `RadarComparison.tsx` |
| 12 | Ranking table | `RankingEvolution.tsx` |
| 13 | Conversion matrix | `ConversionMatrix.tsx` |
| 14 | Lead quality cards | `LeadQualityByOrigin.tsx` |
| 15 | Win/Loss bars | `WinLossAnalysis.tsx` |
| 16 | Seller trend bars | `SellerTrend.tsx` |
| 17 | Assemble tab | `ComercialTab.tsx` |
| 18 | Loss reason UI | PipePropostas status change modal |
| 19 | Final verification | — |
