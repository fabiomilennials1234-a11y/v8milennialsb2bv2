# Carteira Wave 2 — Tabela World-Class: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the Carteira table into a server-side sorted, paginated, exportable data grid powered by Postgres RPCs.

**Architecture:** Two new Postgres RPCs handle all data: `get_portfolio_kpis` for aggregate stats (KPI cards, tab counts, alert banner) and `get_portfolio_clients` for paginated/sorted/filtered client rows. Two new React hooks consume these RPCs. The monolithic `usePortfolioHealth` hook is removed. Sort, pagination, and export are managed inside the table component.

**Tech Stack:** PostgreSQL (RPCs via plpgsql), Supabase JS client (`.rpc()`), TanStack Query v5, React 18, shadcn/ui, Lucide icons.

**Parallelism:** Task 1 first. Tasks 2+3 can run in parallel. Task 4 last.

---

## Task 1: Foundation — RPCs + Hooks

**Files:**
- Create: `supabase/migrations/20261018000000_portfolio_rpcs.sql`
- Create: `src/hooks/usePortfolioKPIs.ts`
- Create: `src/hooks/usePortfolioClients.ts`

- [ ] **Step 1: Create migration file with both RPCs**

Create `supabase/migrations/20261018000000_portfolio_rpcs.sql`:

```sql
-- =============================================================================
-- Wave 2: Portfolio RPCs for KPIs and paginated client list
-- =============================================================================

-- -----------------------------------------------------------------------------
-- get_portfolio_kpis: aggregate stats for KPI cards, alert banner, tab counts
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_portfolio_kpis(p_org_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'total_clients',      COUNT(*)::int,
    'total_recurring',    COALESCE(SUM(avg_ticket), 0)::numeric,
    'overdue_count',      COUNT(*) FILTER (
                            WHERE days_since_last_order IS NOT NULL
                              AND reorder_cycle_days IS NOT NULL
                              AND days_since_last_order > reorder_cycle_days * 1.15
                          )::int,
    'overdue_revenue',    COALESCE(SUM(avg_ticket) FILTER (
                            WHERE days_since_last_order IS NOT NULL
                              AND reorder_cycle_days IS NOT NULL
                              AND days_since_last_order > reorder_cycle_days * 1.15
                          ), 0)::numeric,
    'avg_health',         COALESCE(ROUND(AVG(health_score)), 0)::int,
    'avg_ticket',         CASE WHEN COUNT(*) > 0
                            THEN ROUND(COALESCE(SUM(avg_ticket), 0) / COUNT(*))::numeric
                            ELSE 0
                          END,
    'expected_this_week', COUNT(*) FILTER (
                            WHERE next_order_expected IS NOT NULL
                              AND next_order_expected >= NOW()
                              AND next_order_expected <= NOW() + INTERVAL '7 days'
                          )::int,
    'segment_counts',     jsonb_build_object(
                            'ouro',     COUNT(*) FILTER (WHERE segment = 'ouro')::int,
                            'prata',    COUNT(*) FILTER (WHERE segment = 'prata')::int,
                            'novo',     COUNT(*) FILTER (WHERE segment = 'novo')::int,
                            'resgate',  COUNT(*) FILTER (WHERE segment = 'resgate')::int,
                            'dormindo', COUNT(*) FILTER (WHERE segment = 'dormindo')::int
                          )
  )
  FROM upsell_clients
  WHERE organization_id = p_org_id
    AND is_active = true;
$$;

-- -----------------------------------------------------------------------------
-- get_portfolio_clients: paginated, sorted, filtered client list
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_portfolio_clients(
  p_org_id    UUID,
  p_filter    TEXT    DEFAULT 'all',
  p_search    TEXT    DEFAULT '',
  p_sort_by   TEXT    DEFAULT 'name',
  p_sort_dir  TEXT    DEFAULT 'asc',
  p_page      INT     DEFAULT 1,
  p_page_size INT     DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offset       INT := (p_page - 1) * p_page_size;
  v_total        INT;
  v_rows         JSONB;
  v_allowed_sorts TEXT[] := ARRAY[
    'name', 'health_score', 'avg_ticket', 'days_since_last_order',
    'next_order_expected', 'lifetime_value', 'order_count'
  ];
  v_sort         TEXT;
  v_dir          TEXT;
  v_where        TEXT;
BEGIN
  -- Validate sort column (whitelist prevents injection)
  IF p_sort_by = ANY(v_allowed_sorts) THEN
    v_sort := p_sort_by;
  ELSE
    v_sort := 'name';
  END IF;

  IF lower(p_sort_dir) = 'desc' THEN
    v_dir := 'DESC';
  ELSE
    v_dir := 'ASC';
  END IF;

  -- Base WHERE (org scoping + active only)
  v_where := format('organization_id = %L AND is_active = true', p_org_id);

  -- Search filter (name or company ILIKE)
  IF p_search IS NOT NULL AND p_search <> '' THEN
    v_where := v_where || format(
      ' AND (name ILIKE %L OR company ILIKE %L)',
      '%' || p_search || '%',
      '%' || p_search || '%'
    );
  END IF;

  -- Tab filter
  IF p_filter = 'overdue' THEN
    v_where := v_where
      || ' AND days_since_last_order IS NOT NULL'
      || ' AND reorder_cycle_days IS NOT NULL'
      || ' AND days_since_last_order > reorder_cycle_days * 1.15';
  ELSIF p_filter = 'expected' THEN
    v_where := v_where
      || ' AND next_order_expected IS NOT NULL'
      || ' AND next_order_expected >= NOW()'
      || ' AND next_order_expected <= NOW() + INTERVAL ''7 days''';
  ELSIF p_filter IN ('ouro', 'prata', 'novo', 'resgate', 'dormindo') THEN
    v_where := v_where || format(' AND segment = %L', p_filter);
  END IF;
  -- 'all' or unknown → no additional filter

  -- Count total matching rows
  EXECUTE format('SELECT COUNT(*)::int FROM upsell_clients WHERE %s', v_where)
    INTO v_total;

  -- Fetch paginated rows
  EXECUTE format(
    $q$
    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
    FROM (
      SELECT id, name, company, phone, health_score, health_status, segment,
             avg_ticket, days_since_last_order, reorder_cycle_days,
             next_order_expected, order_count, lifetime_value, lead_id, trend
      FROM upsell_clients
      WHERE %s
      ORDER BY %I %s NULLS LAST
      LIMIT %s OFFSET %s
    ) t
    $q$,
    v_where, v_sort, v_dir, p_page_size, v_offset
  ) INTO v_rows;

  RETURN jsonb_build_object(
    'rows',        COALESCE(v_rows, '[]'::jsonb),
    'total',       v_total,
    'page',        p_page,
    'page_size',   p_page_size,
    'total_pages', GREATEST(CEIL(v_total::numeric / p_page_size)::int, 1)
  );
END;
$$;

-- Grant execute to authenticated users (RLS bypassed by SECURITY DEFINER, org scoped in function)
GRANT EXECUTE ON FUNCTION get_portfolio_kpis(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_portfolio_clients(UUID, TEXT, TEXT, TEXT, TEXT, INT, INT) TO authenticated, service_role;
```

- [ ] **Step 2: Create `usePortfolioKPIs` hook**

Create `src/hooks/usePortfolioKPIs.ts`:

```typescript
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";

export interface PortfolioKPIs {
  total_clients: number;
  total_recurring: number;
  overdue_count: number;
  overdue_revenue: number;
  avg_health: number;
  avg_ticket: number;
  expected_this_week: number;
  segment_counts: {
    ouro: number;
    prata: number;
    novo: number;
    resgate: number;
    dormindo: number;
  };
}

export function usePortfolioKPIs() {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ["portfolio-kpis", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_portfolio_kpis", {
        p_org_id: organizationId!,
      });
      if (error) throw error;
      return data as PortfolioKPIs;
    },
    enabled: !!organizationId,
    staleTime: 60_000,
  });
}
```

- [ ] **Step 3: Create `usePortfolioClients` hook**

Create `src/hooks/usePortfolioClients.ts`:

```typescript
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";

export interface PortfolioClientRow {
  id: string;
  name: string;
  company: string | null;
  phone: string | null;
  health_score: number | null;
  health_status: string | null;
  segment: string | null;
  avg_ticket: number | null;
  days_since_last_order: number | null;
  reorder_cycle_days: number | null;
  next_order_expected: string | null;
  order_count: number | null;
  lifetime_value: number | null;
  lead_id: string | null;
  trend: string | null;
}

export interface PortfolioClientsResponse {
  rows: PortfolioClientRow[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export type SortColumn =
  | "name"
  | "health_score"
  | "avg_ticket"
  | "days_since_last_order"
  | "next_order_expected"
  | "lifetime_value"
  | "order_count";

export interface UsePortfolioClientsParams {
  filter?: string;
  search?: string;
  sortBy?: SortColumn;
  sortDir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export function usePortfolioClients(params: UsePortfolioClientsParams = {}) {
  const { organizationId } = useOrganization();
  const {
    filter = "all",
    search = "",
    sortBy = "name",
    sortDir = "asc",
    page = 1,
    pageSize = 50,
  } = params;

  return useQuery({
    queryKey: [
      "portfolio-clients",
      organizationId,
      { filter, search, sortBy, sortDir, page, pageSize },
    ],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_portfolio_clients", {
        p_org_id: organizationId!,
        p_filter: filter,
        p_search: search,
        p_sort_by: sortBy,
        p_sort_dir: sortDir,
        p_page: page,
        p_page_size: pageSize,
      });
      if (error) throw error;
      return data as PortfolioClientsResponse;
    },
    enabled: !!organizationId,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}
```

- [ ] **Step 4: Verify hooks compile**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`

If type errors on `.rpc()` call (generated types don't know about new RPCs yet), that's expected — the RPCs exist at runtime but not in the generated type file. The cast `as PortfolioKPIs` / `as PortfolioClientsResponse` handles this.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261018000000_portfolio_rpcs.sql \
  src/hooks/usePortfolioKPIs.ts \
  src/hooks/usePortfolioClients.ts
git commit -m "feat(carteira): add portfolio RPCs and new query hooks

Two Postgres RPCs: get_portfolio_kpis (aggregate stats) and
get_portfolio_clients (paginated, sorted, filtered list).
Two React hooks: usePortfolioKPIs and usePortfolioClients.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Migrate KPI Consumers

**Depends on:** Task 1 complete
**Can run in parallel with:** Task 3

**Files:**
- Modify: `src/components/carteira/CarteiraKPIs.tsx`
- Modify: `src/components/carteira/CarteiraAlertBanner.tsx`

- [ ] **Step 1: Migrate CarteiraKPIs to usePortfolioKPIs**

Replace the import and data access in `src/components/carteira/CarteiraKPIs.tsx`:

```typescript
// REPLACE this import:
// import { usePortfolioHealth } from "@/hooks/usePortfolioHealth";
// WITH:
import { usePortfolioKPIs } from "@/hooks/usePortfolioKPIs";
```

Replace the hook call inside the component (currently line 28):

```typescript
// REPLACE:
// const { data, isLoading } = usePortfolioHealth();
// WITH:
const { data, isLoading } = usePortfolioKPIs();
```

Replace the data destructuring (currently around line 57):

```typescript
// REPLACE:
// const { totalClients, totalRecurring, expectedThisWeek, overdueCount, avgHealth } = data;
// const avgTicket = totalClients > 0 ? totalRecurring / totalClients : 0;
// WITH:
const {
  total_clients: totalClients,
  total_recurring: totalRecurring,
  expected_this_week: expectedThisWeek,
  overdue_count: overdueCount,
  avg_health: avgHealth,
  avg_ticket: avgTicket,
} = data;
```

No other changes needed — the KPI cards use the same variable names.

- [ ] **Step 2: Migrate CarteiraAlertBanner to usePortfolioKPIs**

In `src/components/carteira/CarteiraAlertBanner.tsx`:

```typescript
// REPLACE this import:
// import { usePortfolioHealth } from "@/hooks/usePortfolioHealth";
// WITH:
import { usePortfolioKPIs } from "@/hooks/usePortfolioKPIs";
```

Replace the hook call and data access (currently lines 12-14):

```typescript
// REPLACE:
// const { data } = usePortfolioHealth();
// if (!data || data.overdueCount === 0) return null;
// const { overdueCount, overdueRevenue } = data;
// WITH:
const { data } = usePortfolioKPIs();
if (!data || data.overdue_count === 0) return null;
const { overdue_count: overdueCount, overdue_revenue: overdueRevenue } = data;
```

Rest of the component uses `overdueCount` and `overdueRevenue` unchanged.

- [ ] **Step 3: Verify both components compile**

Run: `npx tsc --noEmit --pretty 2>&1 | grep -E "CarteiraKPIs|CarteiraAlertBanner"`
Expected: no errors for these files.

- [ ] **Step 4: Commit**

```bash
git add src/components/carteira/CarteiraKPIs.tsx \
  src/components/carteira/CarteiraAlertBanner.tsx
git commit -m "refactor(carteira): migrate KPI consumers to usePortfolioKPIs

CarteiraKPIs and CarteiraAlertBanner now use the new RPC-based
hook instead of the monolithic usePortfolioHealth.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Refactor CarteiraClientTable — Sort, Pagination, Export

**Depends on:** Task 1 complete
**Can run in parallel with:** Task 2

**Files:**
- Modify: `src/components/carteira/CarteiraClientTable.tsx`

This is the largest task. The table becomes self-contained: it owns its data via `usePortfolioClients()`, manages sort + pagination state internally, and provides CSV export. The parent only passes `filter` and `searchQuery` as props.

- [ ] **Step 1: Rewrite CarteiraClientTable**

Replace the entire contents of `src/components/carteira/CarteiraClientTable.tsx` with the following. Key changes from the original:

1. Removes `clients` prop — fetches its own data via `usePortfolioClients()`
2. Removes `CarteiraClient` interface export — consumers use `PortfolioClientRow` from hook
3. Adds sort state + clickable headers with indicators
4. Adds pagination bar at bottom
5. Adds export CSV button
6. Exposes `onSelectClient` with full `PortfolioClientRow` object (not just id)

```typescript
import { useState, useCallback } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  MessageCircle,
  ClipboardList,
  ChevronRight,
  ChevronLeft,
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Download,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import {
  usePortfolioClients,
  type PortfolioClientRow,
  type SortColumn,
} from "@/hooks/usePortfolioClients";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";

export type { PortfolioClientRow };

// ─── Props ──────────────────────────────────────────────────────────────────

interface CarteiraClientTableProps {
  selectedClientId: string | null;
  onSelectClient: (client: PortfolioClientRow | null) => void;
  onWhatsApp?: (client: PortfolioClientRow) => void;
  onNewOrder?: (clientId: string) => void;
  onViewDetail?: (clientId: string) => void;
  searchQuery: string;
  filter: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

const SORTABLE_COLUMNS: { key: SortColumn; label: string }[] = [
  { key: "name", label: "Cliente" },
  { key: "health_score", label: "Health" },
  { key: "days_since_last_order", label: "Recompra" },
  { key: "avg_ticket", label: "Ticket médio" },
  { key: "lifetime_value", label: "LTV" },
  { key: "order_count", label: "Pedidos" },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function healthConfig(status: string | null, score: number | null) {
  const s = score ?? 0;
  if (status === "saudavel" || (!status && s >= 80))
    return { label: String(s), bg: "bg-[#052e16]", text: "text-[#22c55e]", dot: "bg-[#22c55e]" };
  if (status === "atencao" || (!status && s >= 60))
    return { label: String(s), bg: "bg-[#422006]", text: "text-[#f59e0b]", dot: "bg-[#f59e0b]" };
  if (status === "risco" || (!status && s > 0))
    return { label: String(s), bg: "bg-[#450a0a]", text: "text-[#ef4444]", dot: "bg-[#ef4444]" };
  if (status === "inativo")
    return { label: String(s), bg: "bg-[#172554]", text: "text-[#3b82f6]", dot: "bg-[#3b82f6]" };
  return { label: "—", bg: "bg-zinc-800", text: "text-zinc-500", dot: "bg-zinc-500" };
}

function segmentConfig(segment: string | null) {
  switch (segment) {
    case "ouro":
      return { label: "OURO", className: "bg-[#422006] text-[#eab308]" };
    case "prata":
      return { label: "PRATA", className: "bg-[#1e293b] text-[#94a3b8]" };
    case "novo":
      return { label: "NOVO", className: "bg-[#172554] text-[#60a5fa]" };
    case "resgate":
      return { label: "RESGATE", className: "bg-[#450a0a] text-[#f87171]" };
    case "dormindo":
      return { label: "DORMINDO", className: "bg-zinc-800 text-zinc-400" };
    default:
      return null;
  }
}

function recompraCell(
  daysSinceLast: number | null,
  cycleDays: number | null,
  nextExpected: string | null,
) {
  if (!cycleDays) return { label: "—", className: "text-[#71717a]" };

  if (nextExpected) {
    const diff = Math.round(
      (new Date(nextExpected).getTime() - Date.now()) / 86_400_000,
    );
    if (diff < 0)
      return { label: `${Math.abs(diff)} dias atrasado`, className: "text-[#ef4444] font-semibold" };
    if (diff <= 3)
      return { label: `Em ${diff} dias`, className: "text-[#f59e0b]" };
    return { label: `Em ${diff} dias`, className: "text-[#22c55e]" };
  }

  if (daysSinceLast !== null && cycleDays) {
    const overdue = daysSinceLast - cycleDays;
    if (overdue > 0)
      return { label: `${overdue} dias atrasado`, className: "text-[#ef4444] font-semibold" };
    const remaining = cycleDays - daysSinceLast;
    if (remaining <= 3)
      return { label: `Em ${remaining} dias`, className: "text-[#f59e0b]" };
    return { label: `Em ${remaining} dias`, className: "text-[#22c55e]" };
  }

  return { label: "—", className: "text-[#71717a]" };
}

async function downloadCSV(
  orgId: string,
  filter: string,
  search: string,
) {
  const { data, error } = await supabase.rpc("get_portfolio_clients", {
    p_org_id: orgId,
    p_filter: filter,
    p_search: search,
    p_sort_by: "name",
    p_sort_dir: "asc",
    p_page: 1,
    p_page_size: 10000,
  });
  if (error) throw error;

  const response = data as { rows: PortfolioClientRow[] };
  const headers = [
    "Nome",
    "Empresa",
    "Health Score",
    "Status",
    "Segmento",
    "Ticket Médio",
    "Dias Sem Pedido",
    "Próximo Pedido",
    "LTV",
    "Tendência",
  ];

  const csvRows = response.rows.map((r) =>
    [
      `"${(r.name ?? "").replace(/"/g, '""')}"`,
      `"${(r.company ?? "").replace(/"/g, '""')}"`,
      r.health_score ?? "",
      r.health_status ?? "",
      r.segment ?? "",
      r.avg_ticket ?? "",
      r.days_since_last_order ?? "",
      r.next_order_expected ? r.next_order_expected.slice(0, 10) : "",
      r.lifetime_value ?? "",
      r.trend ?? "",
    ].join(","),
  );

  const csv = [headers.join(","), ...csvRows].join("\n");
  const blob = new Blob(["﻿" + csv], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `carteira-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Component ──────────────────────────────────────────────────────────────

const iconBtnClass =
  "w-[30px] h-[30px] rounded-md border border-[#3f3f46] bg-transparent text-[#a1a1aa] hover:bg-[#27272a] hover:text-[#fafafa] transition-colors flex items-center justify-center";

const thBase =
  "h-auto text-[11px] font-semibold uppercase tracking-wider py-2.5";

export function CarteiraClientTable({
  selectedClientId,
  onSelectClient,
  onWhatsApp,
  onNewOrder,
  onViewDetail,
  searchQuery,
  filter,
}: CarteiraClientTableProps) {
  const { organizationId } = useOrganization();
  const [sortBy, setSortBy] = useState<SortColumn | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  // Reset page when filter/search changes
  const prevFilter = useState(filter)[0];
  const prevSearch = useState(searchQuery)[0];
  if (filter !== prevFilter || searchQuery !== prevSearch) {
    setPage(1);
  }

  const { data, isLoading, isFetching } = usePortfolioClients({
    filter,
    search: searchQuery,
    sortBy: sortBy ?? "name",
    sortDir,
    page,
    pageSize: PAGE_SIZE,
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.total_pages ?? 1;

  const handleSort = useCallback(
    (col: SortColumn) => {
      if (sortBy === col) {
        if (sortDir === "asc") {
          setSortDir("desc");
        } else {
          setSortBy(null);
          setSortDir("asc");
        }
      } else {
        setSortBy(col);
        setSortDir("asc");
      }
      setPage(1);
      onSelectClient(null);
    },
    [sortBy, sortDir, onSelectClient],
  );

  const handleExport = useCallback(async () => {
    if (!organizationId) return;
    setExporting(true);
    try {
      await downloadCSV(organizationId, filter, searchQuery);
    } finally {
      setExporting(false);
    }
  }, [organizationId, filter, searchQuery]);

  function SortIcon({ col }: { col: SortColumn }) {
    if (sortBy !== col) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-0 group-hover:opacity-50" />;
    if (sortDir === "asc") return <ArrowUp className="w-3 h-3 ml-1" />;
    return <ArrowDown className="w-3 h-3 ml-1" />;
  }

  function SortableHeader({ col, label, className }: { col: SortColumn; label: string; className?: string }) {
    return (
      <TableHead
        className={cn(
          thBase,
          "cursor-pointer select-none group transition-colors hover:text-[#a1a1aa]",
          sortBy === col ? "text-[#fafafa]" : "text-[#71717a]",
          className,
        )}
        onClick={() => handleSort(col)}
      >
        <span className="inline-flex items-center">
          {label}
          <SortIcon col={col} />
        </span>
      </TableHead>
    );
  }

  // ── Loading skeleton ────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="rounded-xl border border-[#27272a] bg-[#18181b] overflow-hidden">
        <div className="divide-y divide-[#27272a]">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex gap-4 px-4 py-3.5 animate-pulse">
              <div className="h-4 bg-zinc-800 rounded w-40" />
              <div className="h-4 bg-zinc-800 rounded w-14" />
              <div className="h-4 bg-zinc-800 rounded w-24" />
              <div className="h-4 bg-zinc-800 rounded w-20" />
              <div className="h-4 bg-zinc-800 rounded w-16" />
              <div className="h-4 bg-zinc-800 rounded w-16" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Empty state ─────────────────────────────────────────────────────────
  if (rows.length === 0 && !isFetching) {
    return (
      <div className="rounded-xl border border-[#27272a] bg-[#18181b] py-16 text-center">
        <p className="text-sm text-[#71717a]">Nenhum cliente encontrado.</p>
      </div>
    );
  }

  // ── Pagination range ────────────────────────────────────────────────────
  const from = (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="space-y-0">
      {/* Export button */}
      <div className="flex justify-end mb-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={exporting || total === 0}
          className="gap-2 text-[13px]"
        >
          {exporting ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Download className="w-3.5 h-3.5" />
          )}
          Exportar
        </Button>
      </div>

      <div className="rounded-xl border border-[#27272a] bg-[#18181b] overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-[#27272a] hover:bg-transparent bg-[#111113]">
              <SortableHeader col="name" label="Cliente" className="pl-4" />
              <SortableHeader col="health_score" label="Health" />
              <SortableHeader col="days_since_last_order" label="Recompra" />
              <SortableHeader col="avg_ticket" label="Ticket médio" />
              <TableHead className={cn(thBase, "text-[#71717a]")}>
                Tendência
              </TableHead>
              <TableHead className={cn(thBase, "text-[#71717a]")}>
                Segmento
              </TableHead>
              <TableHead className={cn(thBase, "text-[#71717a] pr-4 w-[100px]")} />
            </TableRow>
          </TableHeader>

          <TableBody>
            {rows.map((client) => {
              const isSelected = client.id === selectedClientId;
              const health = healthConfig(client.health_status, client.health_score);
              const segment = segmentConfig(client.segment);
              const recompra = recompraCell(
                client.days_since_last_order,
                client.reorder_cycle_days,
                client.next_order_expected,
              );

              return (
                <TableRow
                  key={client.id}
                  onClick={() =>
                    onSelectClient(isSelected ? null : client)
                  }
                  className={cn(
                    "border-[#1e1e21] cursor-pointer transition-colors",
                    isSelected ? "bg-[#232326]" : "hover:bg-[#1c1c1f]",
                  )}
                >
                  <TableCell className="py-3 pl-4">
                    <div className="flex flex-col gap-px min-w-0">
                      <span className="text-sm font-semibold text-[#fafafa] truncate max-w-[220px]">
                        {client.name}
                      </span>
                      <span className="text-xs text-[#71717a] truncate max-w-[220px]">
                        {[
                          client.order_count
                            ? `${client.order_count} pedido${client.order_count !== 1 ? "s" : ""}`
                            : null,
                          client.company,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </span>
                    </div>
                  </TableCell>

                  <TableCell className="py-3">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium",
                        health.bg,
                        health.text,
                      )}
                    >
                      <span className={cn("w-1.5 h-1.5 rounded-full", health.dot)} />
                      {health.label}
                    </span>
                  </TableCell>

                  <TableCell className="py-3">
                    <span className={cn("text-[13px]", recompra.className)}>
                      {recompra.label}
                    </span>
                  </TableCell>

                  <TableCell className="py-3">
                    <span className={cn("text-sm", client.avg_ticket != null ? "text-[#fafafa]" : "text-[#3f3f46]")}>
                      {client.avg_ticket != null ? formatBRL(client.avg_ticket) : "—"}
                    </span>
                  </TableCell>

                  <TableCell className="py-3">
                    {client.trend === "up" && (
                      <span className="inline-flex items-center gap-1 text-[13px] font-medium text-[#22c55e]">
                        <TrendingUp className="w-3.5 h-3.5" />
                        Subindo
                      </span>
                    )}
                    {client.trend === "down" && (
                      <span className="inline-flex items-center gap-1 text-[13px] font-medium text-[#ef4444]">
                        <TrendingDown className="w-3.5 h-3.5" />
                        Caindo
                      </span>
                    )}
                    {client.trend === "stable" && (
                      <span className="inline-flex items-center gap-1 text-[13px] text-[#71717a]">
                        <Minus className="w-3.5 h-3.5" />
                        Estável
                      </span>
                    )}
                    {!client.trend && (
                      <span className="text-[13px] text-[#3f3f46]">—</span>
                    )}
                  </TableCell>

                  <TableCell className="py-3">
                    {segment ? (
                      <span
                        className={cn(
                          "px-2.5 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wide",
                          segment.className,
                        )}
                      >
                        {segment.label}
                      </span>
                    ) : (
                      <span className="text-[#71717a] text-sm">—</span>
                    )}
                  </TableCell>

                  <TableCell className="py-3 pr-4">
                    <div className="flex gap-1">
                      {onWhatsApp && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onWhatsApp(client);
                          }}
                          className={iconBtnClass}
                          title="WhatsApp"
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {onNewOrder && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onNewOrder(client.id);
                          }}
                          className={iconBtnClass}
                          title="Novo pedido"
                        >
                          <ClipboardList className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {onViewDetail && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onViewDetail(client.id);
                          }}
                          className={iconBtnClass}
                          title="Detalhes"
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        {/* Pagination bar */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-[#27272a] px-4 py-2.5">
            <span className="text-[13px] text-[#71717a] tabular-nums">
              Mostrando {from}–{to} de {total}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPage((p) => p - 1);
                  onSelectClient(null);
                }}
                disabled={page <= 1}
                className="h-7 px-2 text-[13px] gap-1"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Anterior
              </Button>
              <span className="text-[13px] text-[#a1a1aa] tabular-nums">
                {page} / {totalPages}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPage((p) => p + 1);
                  onSelectClient(null);
                }}
                disabled={page >= totalPages}
                className="h-7 px-2 text-[13px] gap-1"
              >
                Próxima
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

**Important implementation notes for the agent:**

1. The `page` reset on filter/search change uses a pattern with `useState` to detect prop changes. A cleaner approach is using `useEffect`:

```typescript
useEffect(() => {
  setPage(1);
  onSelectClient(null);
}, [filter, searchQuery]);
```

Add this `useEffect` and remove the inline prop-change detection. Import `useEffect` from React.

2. `onSelectClient` now passes the full `PortfolioClientRow` (or `null` for deselect) instead of just `string`. This enables the preview to receive client data without a separate query.

3. `onWhatsApp` also changed to pass the full client object (needed for phone number in preview).

- [ ] **Step 2: Verify the table compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | grep "CarteiraClientTable"`

Expect: type errors from Upsell.tsx (still using old API). That's resolved in Task 4.

- [ ] **Step 3: Commit**

```bash
git add src/components/carteira/CarteiraClientTable.tsx
git commit -m "feat(carteira): add server-side sorting, pagination, and CSV export

Table now owns its data via usePortfolioClients() RPC hook.
Sort: clickable headers cycle none→asc→desc for 6 columns.
Pagination: 50/page with Previous/Next controls.
Export: CSV download of all filtered data via Blob.
onSelectClient now passes full client object for preview.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Page Integration + Preview Migration + Cleanup

**Depends on:** Tasks 2 and 3 both complete

**Files:**
- Modify: `src/pages/Upsell.tsx`
- Modify: `src/components/carteira/CarteiraClientPreview.tsx`
- Delete: `src/hooks/usePortfolioHealth.ts`

- [ ] **Step 1: Migrate CarteiraClientPreview to receive client as prop**

The preview currently calls `usePortfolioHealth()` to find a client by id from the full list. With server-side pagination, this won't work — the client may not be on the current page. Change to receive the full client object as a prop.

In `src/components/carteira/CarteiraClientPreview.tsx`:

Replace the import:
```typescript
// REMOVE:
// import { usePortfolioHealth } from "@/hooks/usePortfolioHealth";
// ADD:
import type { PortfolioClientRow } from "@/hooks/usePortfolioClients";
```

Replace the interface:
```typescript
// REPLACE:
// interface CarteiraClientPreviewProps {
//   clientId: string;
//   onClose: () => void;
//   onViewDetail: (clientId: string) => void;
//   onNewOrder: (clientId: string) => void;
// }
// WITH:
interface CarteiraClientPreviewProps {
  client: PortfolioClientRow;
  onClose: () => void;
  onViewDetail: (clientId: string) => void;
  onNewOrder: (clientId: string) => void;
}
```

Replace the component signature and remove the hook call + find:
```typescript
// REPLACE:
// export function CarteiraClientPreview({
//   clientId,
//   onClose,
//   onViewDetail,
//   onNewOrder,
// }: CarteiraClientPreviewProps) {
//   const { data: portfolioData } = usePortfolioHealth();
//   const { data: alerts = [], resolveAlert } = useClientAlerts(clientId);
//   const client = portfolioData?.clients?.find((c) => c.id === clientId);
// WITH:
export function CarteiraClientPreview({
  client,
  onClose,
  onViewDetail,
  onNewOrder,
}: CarteiraClientPreviewProps) {
  const { data: alerts = [], resolveAlert } = useClientAlerts(client.id);
```

Replace all `clientId` references in the component body with `client.id`:
- Line ~216 (onViewDetail): `onViewDetail(clientId)` → `onViewDetail(client.id)`
- Line ~229 (onNewOrder): `onNewOrder(clientId)` → `onNewOrder(client.id)`

Fix the WhatsApp button (currently uses `(client as any).phone`):
```typescript
// REPLACE:
// const phone = (client as any).phone;
// WITH:
const phone = client.phone;
```

The `score` derivation (line ~65) uses optional chaining `client?.health_score ?? 0`. Since `client` is now always defined (not found from a list), remove the optional chaining:
```typescript
const score = client.health_score ?? 0;
const status = client.health_status ?? null;
```

- [ ] **Step 2: Migrate Upsell.tsx**

In `src/pages/Upsell.tsx`:

Replace imports:
```typescript
// REMOVE these:
// import { usePortfolioHealth } from "@/hooks/usePortfolioHealth";
// import { CarteiraClientTable } from "@/components/carteira/CarteiraClientTable";
// ADD:
import { usePortfolioKPIs } from "@/hooks/usePortfolioKPIs";
import { CarteiraClientTable, type PortfolioClientRow } from "@/components/carteira/CarteiraClientTable";
```

Replace state + hook (currently lines 67-71):
```typescript
// REMOVE:
// const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
// ...
// const [quickOrderClientId, setQuickOrderClientId] = useState<string | null>(null);
// const { data: portfolioData } = usePortfolioHealth();
// ADD:
const [selectedClient, setSelectedClient] = useState<PortfolioClientRow | null>(null);
const [carteiraSearch, setCarteiraSearch] = useState("");
const [carteiraFilter, setCarteiraFilter] = useState("all");
const [quickOrderClientId, setQuickOrderClientId] = useState<string | null>(null);
const { data: kpiData } = usePortfolioKPIs();
```

Replace tabCounts computation (currently lines 73-86):
```typescript
// REMOVE the useMemo with portfolioData?.clients loop
// ADD:
const tabCounts = useMemo(() => {
  if (!kpiData) return {} as Record<string, number>;
  return {
    all: kpiData.total_clients,
    overdue: kpiData.overdue_count,
    expected: kpiData.expected_this_week,
    ...kpiData.segment_counts,
  };
}, [kpiData]);
```

Replace subtitle text (currently line 99-101):
```typescript
// REPLACE:
// {portfolioData
//   ? `${portfolioData.totalClients} clientes ativos · ${new Intl.NumberFormat(...).format(portfolioData.totalRecurring)}/mês recorrente`
// WITH:
{kpiData
  ? `${kpiData.total_clients} clientes ativos · ${new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(kpiData.total_recurring)}/mês recorrente`
  : "Health score, recompra e gestão de carteira"}
```

Replace tab filter onClick to clear selection (lines ~143-145):
```typescript
// REPLACE setSelectedClientId(null) with:
setSelectedClient(null);
```

Replace the CarteiraClientTable usage (lines ~188-201):
```typescript
<CarteiraClientTable
  selectedClientId={selectedClient?.id ?? null}
  onSelectClient={(client) => setSelectedClient(client)}
  onNewOrder={(id) => {
    setQuickOrderClientId(id);
    setNovaVendaOpen(true);
  }}
  onViewDetail={(id) => navigate(`/carteira/${id}`)}
  searchQuery={carteiraSearch}
  filter={carteiraFilter}
/>
```

Note: `onWhatsApp` is not passed from Upsell — the table handles it internally via the action button, or it can be added. Looking at the original code, `onWhatsApp` was never passed from Upsell.tsx. Confirmed.

Replace the CarteiraClientPreview usage (lines ~204-214):
```typescript
// REPLACE:
// {selectedClientId && (
//   <CarteiraClientPreview
//     clientId={selectedClientId}
//     onClose={() => setSelectedClientId(null)}
//     onViewDetail={(id) => navigate(`/carteira/${id}`)}
//     onNewOrder={(id) => {
//       setQuickOrderClientId(id);
//       setNovaVendaOpen(true);
//     }}
//   />
// )}
// WITH:
{selectedClient && (
  <CarteiraClientPreview
    client={selectedClient}
    onClose={() => setSelectedClient(null)}
    onViewDetail={(id) => navigate(`/carteira/${id}`)}
    onNewOrder={(id) => {
      setQuickOrderClientId(id);
      setNovaVendaOpen(true);
    }}
  />
)}
```

- [ ] **Step 3: Delete usePortfolioHealth.ts**

```bash
rm src/hooks/usePortfolioHealth.ts
```

- [ ] **Step 4: Verify full build compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -40`
Expected: 0 errors (or only pre-existing errors unrelated to carteira)

Also run: `grep -r "usePortfolioHealth" src/ --include="*.ts" --include="*.tsx"`
Expected: no matches (all consumers migrated)

- [ ] **Step 5: Run dev server and verify visually**

Run: `npm run dev`

Verify:
1. Navigate to Carteira page
2. KPI cards load correctly (values match before the change)
3. Table loads with data
4. Click column headers → sort arrows appear, data reorders
5. If >50 clients, pagination bar shows with page controls
6. Change tabs (Ouro, Recompra atrasada, etc) → table filters, page resets to 1
7. Search box → table filters by name/company
8. Click "Exportar" → CSV downloads with correct filtered data
9. Click a table row → preview sidebar opens with correct client data
10. Preview shows health ring, metrics, alerts, WhatsApp button
11. Close preview, navigate pages → no stale state

- [ ] **Step 6: Commit**

```bash
git add src/pages/Upsell.tsx \
  src/components/carteira/CarteiraClientPreview.tsx
git rm src/hooks/usePortfolioHealth.ts
git commit -m "refactor(carteira): complete Wave 2 — migrate page, preview, remove old hook

Upsell.tsx uses usePortfolioKPIs for tab counts and subtitle stats.
CarteiraClientPreview receives client as prop (no list dependency).
usePortfolioHealth removed — all consumers migrated.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Deployment

After all 4 tasks complete:

1. **Deploy migration to dev:**
   ```bash
   supabase db push --project-ref bcfadphgsibjzivtbjvc
   ```

2. **Test on dev environment** — verify RPCs return correct data

3. **Deploy migration to prod:**
   ```bash
   supabase db push --project-ref jsjsmuncfkbsbzqzqhfq
   ```

4. **Push frontend** — push to main triggers Docker build via CI/CD
