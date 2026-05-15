# Wave 1 — Dados Corretos: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix incorrect/missing data in Carteira — trend column, real engagement scoring, proper TypeScript types, deduplicated format utils.

**Architecture:** 4 atomic commits. Start with refactors (formatBRL, types) to clean code, then add features (trend, engagement). All backend logic in shared pure functions with unit tests. Frontend renders data already computed by cron.

**Tech Stack:** TypeScript, React, Supabase Edge Functions (Deno), Vitest, Lucide icons

**Spec:** `docs/superpowers/specs/2026-05-15-carteira-wave1-dados-corretos-design.md`

---

### Task 1: Extract shared format utils

**Files:**
- Create: `src/lib/format.ts`
- Modify: `src/components/carteira/CarteiraKPIs.tsx`
- Modify: `src/components/carteira/CarteiraAlertBanner.tsx`
- Modify: `src/components/carteira/CarteiraClientTable.tsx`
- Modify: `src/components/carteira/CarteiraClientPreview.tsx`
- Modify: `src/components/carteira/ClienteMetrics.tsx`
- Modify: `src/components/carteira/ClienteOrderHistory.tsx`
- Modify: `src/components/carteira/ClienteTimeline.tsx`
- Modify: `src/components/carteira/ClienteProductsTable.tsx`
- Modify: `src/components/carteira/ClienteReorderTimeline.tsx`
- Modify: `src/components/carteira/ClienteCopilotSuggestion.tsx`
- Modify: `src/components/carteira/QuickOrderModal.tsx`

- [ ] **Step 1: Create `src/lib/format.ts`**

```ts
export function formatBRL(value: number, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits,
  }).format(value);
}

export function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  });
}

export function formatDateFull(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
  });
}

export function formatDateSafe(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDateLong(iso: string | null): string {
  if (!iso) return "em breve";
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
  });
}
```

- [ ] **Step 2: Replace in `CarteiraKPIs.tsx`**

Remove lines 3-8 (local `formatBRL`). Add import at top:

```ts
import { formatBRL } from "@/lib/format";
```

- [ ] **Step 3: Replace in `CarteiraAlertBanner.tsx`**

Remove lines 5-6 (local `formatBRL`). Add import:

```ts
import { formatBRL } from "@/lib/format";
```

- [ ] **Step 4: Replace in `CarteiraClientTable.tsx`**

Remove lines 43-48 (local `formatBRL`). Add import after line 9:

```ts
import { formatBRL } from "@/lib/format";
```

- [ ] **Step 5: Replace in `CarteiraClientPreview.tsx`**

Remove lines 19-24 (local `formatBRL`). Add import:

```ts
import { formatBRL } from "@/lib/format";
```

- [ ] **Step 6: Replace in `ClienteMetrics.tsx`**

Remove lines 30-35 (local `formatBRL`) and lines 37-41 (local `formatDate`). Add imports:

```ts
import { formatBRL, formatDateShort } from "@/lib/format";
```

Replace usage at line 125: `formatDate(client.next_order_expected)` → `formatDateShort(client.next_order_expected)`

- [ ] **Step 7: Replace in `ClienteOrderHistory.tsx`**

Remove lines 14-19 (local `formatBRL`) and lines 21-26 (local `formatDate`). Add imports:

```ts
import { formatBRL, formatDateFull } from "@/lib/format";
```

Replace usage: `formatDate(order.sold_at)` → `formatDateFull(order.sold_at)`

- [ ] **Step 8: Replace in `ClienteTimeline.tsx`**

Remove lines 22-27 (local `formatBRL`) and lines 29-36 (local `formatDateTime`). Add imports:

```ts
import { formatBRL, formatDateTime } from "@/lib/format";
```

- [ ] **Step 9: Replace in `ClienteProductsTable.tsx`**

Remove lines 21-26 (local `formatBRL`). Add import:

```ts
import { formatBRL } from "@/lib/format";
```

- [ ] **Step 10: Replace in `ClienteReorderTimeline.tsx`**

Remove lines 14-21 (local `formatDate`). Add import:

```ts
import { formatDateSafe } from "@/lib/format";
```

Replace usages: `formatDate(lastOrderAt)` → `formatDateSafe(lastOrderAt)` and `formatDate(nextOrderExpected)` → `formatDateSafe(nextOrderExpected)`

- [ ] **Step 11: Replace in `ClienteCopilotSuggestion.tsx`**

Remove lines 19-24 (local `formatDate`). Add import:

```ts
import { formatDateLong } from "@/lib/format";
```

Replace usage at line 54: `formatDate(nextOrderExpected)` → `formatDateLong(nextOrderExpected)`

- [ ] **Step 12: Replace in `QuickOrderModal.tsx`**

Remove lines 41-43 (local `formatBRL`). Add import:

```ts
import { formatBRL } from "@/lib/format";
```

Note: `QuickOrderModal` uses `value.toLocaleString(...)` instead of `Intl.NumberFormat`. The shared `formatBRL` with default `maximumFractionDigits=0` produces equivalent output. Replace directly.

- [ ] **Step 13: Verify no local format functions remain**

Run: `grep -rn "const formatBRL\|const formatDate\|const formatDateTime" src/components/carteira/`

Expected: 0 results

- [ ] **Step 14: Build check**

Run: `npm run build`

Expected: No errors

- [ ] **Step 15: Commit**

```bash
git add src/lib/format.ts src/components/carteira/
git commit -m "refactor(carteira): extract shared format utils

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Replace `any` types with proper Supabase table types

**Files:**
- Modify: `src/components/carteira/ClienteCopilotSuggestion.tsx`
- Modify: `src/components/carteira/ClienteProductsTable.tsx`
- Modify: `src/components/carteira/ClienteOrderHistory.tsx`
- Modify: `src/components/carteira/ClienteTimeline.tsx`
- Modify: `src/components/carteira/ClienteDetailPage.tsx`

- [ ] **Step 1: Type `ClienteCopilotSuggestion.tsx`**

Add import at top:

```ts
import type { Tables } from "@/integrations/supabase/types";
```

Replace interface (lines 9-14):

```ts
interface ClienteCopilotSuggestionProps {
  clientName: string;
  phone: string | null;
  alerts: Tables<"client_alerts">[];
  lastOrder: Tables<"upsell_orders"> | null;
  nextOrderExpected: string | null;
}
```

Update `buildSuggestion` signature:

```ts
function buildSuggestion(
  clientName: string,
  alerts: Tables<"client_alerts">[],
  lastOrder: Tables<"upsell_orders"> | null,
  nextOrderExpected: string | null,
): string {
```

Update field accesses inside `buildSuggestion`:
- `a.alert_type` stays (field exists on `client_alerts`)
- `lastOrder?.product_name` stays (field exists on `upsell_orders`)
- `lastOrder?.sold_at` stays (field exists on `upsell_orders`)

- [ ] **Step 2: Type `ClienteProductsTable.tsx`**

Add import at top:

```ts
import type { Tables } from "@/integrations/supabase/types";
```

Replace interface (line 15):

```ts
interface ClienteProductsTableProps {
  products: Tables<"upsell_client_products">[];
}
```

- [ ] **Step 3: Type `ClienteOrderHistory.tsx`**

Add import at top:

```ts
import type { Tables } from "@/integrations/supabase/types";
```

Replace interface (lines 8-10):

```ts
interface ClienteOrderHistoryProps {
  orders: Tables<"upsell_orders">[];
  cycleDays: number;
}
```

- [ ] **Step 4: Type `ClienteTimeline.tsx`**

Add import at top:

```ts
import type { Tables } from "@/integrations/supabase/types";
```

Replace interface (lines 8-10):

```ts
interface ClienteTimelineProps {
  orders: Tables<"upsell_orders">[];
  alerts: Tables<"client_alerts">[];
}
```

Update `TimelineItem` construction — verify field names match:
- `o.sold_at` → exists on `upsell_orders` ✓
- `o.created_at` → exists on `upsell_orders` ✓
- `o.product_name` → exists on `upsell_orders` ✓
- `o.total_value` → check: field is `sale_value` on `upsell_orders`. Fix:

```ts
value: o.sale_value != null ? Number(o.sale_value) : null,
```

- `a.created_at` → exists on `client_alerts` ✓
- `a.message` → check: field is `description` on `client_alerts`. Fix:

```ts
description: a.description ?? a.title ?? "Alerta gerado",
```

- `a.severity` → exists on `client_alerts` ✓

- [ ] **Step 5: Type `ClienteDetailPage.tsx`**

Add import at top:

```ts
import type { Tables } from "@/integrations/supabase/types";
```

Define derived type after imports:

```ts
type ClientWithLead = Tables<"upsell_clients"> & {
  lead: Pick<Tables<"leads">, "name" | "phone" | "email" | "company"> | null;
};
```

Type the query (line 52-63):

```ts
const { data: client, isLoading: loadingClient } = useQuery({
  queryKey: ["upsell-client-detail", clientId],
  queryFn: async () => {
    const { data } = await supabase
      .from("upsell_clients")
      .select("*, lead:leads(name, phone, email, company)")
      .eq("id", clientId!)
      .single();
    return data as ClientWithLead | null;
  },
  enabled: !!clientId,
});
```

Replace `as any` casts (lines 100-110):

```ts
const clientName = client?.name ?? client?.lead?.name ?? "Cliente";
const clientCompany = client?.company ?? client?.lead?.company ?? null;
const clientPhone = client?.lead?.phone ?? null;
```

- [ ] **Step 6: Verify zero `any` remaining**

Run: `grep -rn "any\[\]\|as any" src/components/carteira/`

Expected: 0 results in the 5 modified files (may still exist in other files like QuickOrderModal line 201 `lastOrderData.items.map((it: any)` — that's acceptable, not in scope)

- [ ] **Step 7: Build check**

Run: `npm run build`

Expected: No TypeScript errors

- [ ] **Step 8: Commit**

```bash
git add src/components/carteira/ClienteCopilotSuggestion.tsx src/components/carteira/ClienteProductsTable.tsx src/components/carteira/ClienteOrderHistory.tsx src/components/carteira/ClienteTimeline.tsx src/components/carteira/ClienteDetailPage.tsx
git commit -m "refactor(carteira): replace any types with Supabase table types

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Add trend calculation and display

**Files:**
- Create: `supabase/migrations/20261017000000_add_trend_column.sql`
- Modify: `supabase/functions/_shared/portfolio-health.ts`
- Modify: `supabase/functions/calculate-portfolio-health/index.ts`
- Modify: `src/components/carteira/CarteiraClientTable.tsx`
- Modify: `src/hooks/usePortfolioHealth.ts`
- Test: `tests/unit/portfolio-health.test.ts`

- [ ] **Step 1: Write failing tests for `deriveTrend`**

Add to `tests/unit/portfolio-health.test.ts`:

```ts
import {
  calculateRecencyScore,
  calculateFrequencyScore,
  calculateTicketScore,
  calculateHealthScore,
  deriveHealthStatus,
  deriveSegment,
  deriveTrend,
  detectSignals,
} from "../../supabase/functions/_shared/portfolio-health.ts";

// ... existing tests ...

describe("deriveTrend", () => {
  it("returns up when recent avg exceeds historical by >10%", () => {
    expect(deriveTrend([15000, 14000, 13000], 10000)).toBe("up");
  });

  it("returns down when recent avg is below historical by >10%", () => {
    expect(deriveTrend([7000, 8000, 9000], 12000)).toBe("down");
  });

  it("returns stable when recent avg is within ±10% of historical", () => {
    expect(deriveTrend([10500, 9800, 10200], 10000)).toBe("stable");
  });

  it("returns stable when fewer than 3 tickets", () => {
    expect(deriveTrend([15000, 14000], 10000)).toBe("stable");
  });

  it("returns stable when historicalAvg is 0", () => {
    expect(deriveTrend([15000, 14000, 13000], 0)).toBe("stable");
  });

  it("returns stable at exactly +10% boundary", () => {
    expect(deriveTrend([11000, 11000, 11000], 10000)).toBe("stable");
  });

  it("returns stable at exactly -10% boundary", () => {
    expect(deriveTrend([9000, 9000, 9000], 10000)).toBe("stable");
  });

  it("returns up when just above +10% boundary", () => {
    expect(deriveTrend([11001, 11001, 11001], 10000)).toBe("up");
  });

  it("returns down when just below -10% boundary", () => {
    expect(deriveTrend([8999, 8999, 8999], 10000)).toBe("down");
  });

  it("returns stable for empty array", () => {
    expect(deriveTrend([], 10000)).toBe("stable");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/portfolio-health.test.ts`

Expected: FAIL — `deriveTrend` is not exported

- [ ] **Step 3: Implement `deriveTrend` in shared lib**

Add to `supabase/functions/_shared/portfolio-health.ts` after `deriveSegment`:

```ts
export type Trend = "up" | "stable" | "down";

export function deriveTrend(
  lastThreeTickets: number[],
  historicalAvg: number,
): Trend {
  if (lastThreeTickets.length < 3 || historicalAvg <= 0) return "stable";
  const recentAvg =
    lastThreeTickets.reduce((s, v) => s + v, 0) / lastThreeTickets.length;
  if (recentAvg > historicalAvg * 1.1) return "up";
  if (recentAvg < historicalAvg * 0.9) return "down";
  return "stable";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/portfolio-health.test.ts`

Expected: ALL PASS

- [ ] **Step 5: Create migration**

Create `supabase/migrations/20261017000000_add_trend_column.sql`:

```sql
ALTER TABLE upsell_clients
  ADD COLUMN IF NOT EXISTS trend TEXT CHECK (trend IN ('up', 'stable', 'down'));
```

- [ ] **Step 6: Integrate into cron**

In `supabase/functions/calculate-portfolio-health/index.ts`:

Add import (line 26, alongside existing imports):

```ts
import {
  calculateFrequencyScore,
  calculateHealthScore,
  calculateRecencyScore,
  calculateTicketScore,
  deriveHealthStatus,
  deriveSegment,
  deriveTrend,
  detectSignals,
  type DetectedSignal,
  type ProductFrequency,
} from "../_shared/portfolio-health.ts";
```

After line 162 (`const segment = ...`), add:

```ts
  const trend = deriveTrend(lastThreeTickets, avgTicket);
```

In the `.update()` call (line 170-184), add `trend` to the object:

```ts
      trend,
```

(Add after `avg_ticket: avgTicket || null,` on line 183)

- [ ] **Step 7: Add `trend` to frontend hook select**

In `src/hooks/usePortfolioHealth.ts`, add `trend` to the select string (line 14):

```ts
        .select(
          "id, name, company, phone, email, lead_id, health_score, health_status, segment, avg_ticket, lifetime_value, days_since_last_order, reorder_cycle_days, next_order_expected, order_count, is_active, potencial, closer_id, first_sale_at, last_order_at, trend",
        )
```

- [ ] **Step 8: Add `trend` to `CarteiraClient` interface and render**

In `src/components/carteira/CarteiraClientTable.tsx`:

Add to imports (line 8):

```ts
import { MessageCircle, ClipboardList, ChevronRight, TrendingUp, TrendingDown, Minus } from "lucide-react";
```

Add to `CarteiraClient` interface (after line 26, `lead_id`):

```ts
  trend: string | null;
```

Replace the Tendência cell (line 249-251):

```tsx
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
```

- [ ] **Step 9: Build check**

Run: `npm run build`

Expected: No errors

- [ ] **Step 10: Commit**

```bash
git add supabase/migrations/20261017000000_add_trend_column.sql supabase/functions/_shared/portfolio-health.ts supabase/functions/calculate-portfolio-health/index.ts src/hooks/usePortfolioHealth.ts src/components/carteira/CarteiraClientTable.tsx tests/unit/portfolio-health.test.ts
git commit -m "feat(carteira): add trend calculation and display

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Wire real engagement score from WhatsApp + context summary

**Files:**
- Modify: `supabase/functions/_shared/portfolio-health.ts`
- Modify: `supabase/functions/calculate-portfolio-health/index.ts`
- Test: `tests/unit/portfolio-health.test.ts`

- [ ] **Step 1: Write failing tests for engagement functions**

Add to `tests/unit/portfolio-health.test.ts`:

```ts
import {
  calculateRecencyScore,
  calculateFrequencyScore,
  calculateTicketScore,
  calculateHealthScore,
  calculateEngagementScore,
  deriveHealthStatus,
  deriveSegment,
  deriveTrend,
  detectSignals,
} from "../../supabase/functions/_shared/portfolio-health.ts";

// ... existing tests ...

describe("whatsappRecencyToScore", () => {
  it("returns 100 for 0 days", () => {
    expect(calculateEngagementScore(null, 0)).toBe(100);
  });

  it("returns 100 for 3 days", () => {
    expect(calculateEngagementScore(null, 3)).toBe(100);
  });

  it("returns 75 for 7 days", () => {
    expect(calculateEngagementScore(null, 7)).toBe(75);
  });

  it("returns 50 for 14 days", () => {
    expect(calculateEngagementScore(null, 14)).toBe(50);
  });

  it("returns 25 for 30 days", () => {
    expect(calculateEngagementScore(null, 30)).toBe(25);
  });

  it("returns 0 for 60 days", () => {
    expect(calculateEngagementScore(null, 60)).toBe(0);
  });
});

describe("calculateEngagementScore", () => {
  it("returns weighted combo when both sources present", () => {
    // context=80 * 0.6 = 48, whatsapp(3d)=100 * 0.4 = 40 → 88
    expect(calculateEngagementScore(80, 3)).toBe(88);
  });

  it("returns weighted combo with low whatsapp recency", () => {
    // context=80 * 0.6 = 48, whatsapp(30d)=25 * 0.4 = 10 → 58
    expect(calculateEngagementScore(80, 30)).toBe(58);
  });

  it("returns context score only when whatsapp is null", () => {
    expect(calculateEngagementScore(75, null)).toBe(75);
  });

  it("returns whatsapp score only when context is null", () => {
    // 7 days → whatsappRecencyToScore = 75
    expect(calculateEngagementScore(null, 7)).toBe(75);
  });

  it("returns 50 fallback when both are null", () => {
    expect(calculateEngagementScore(null, null)).toBe(50);
  });

  it("handles context=0 as valid (not null)", () => {
    // context=0 * 0.6 = 0, whatsapp(3d)=100 * 0.4 = 40 → 40
    expect(calculateEngagementScore(0, 3)).toBe(40);
  });

  it("handles whatsapp=0 as valid (not null)", () => {
    // context=100 * 0.6 = 60, whatsapp(0d)=100 * 0.4 = 40 → 100
    expect(calculateEngagementScore(100, 0)).toBe(100);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/portfolio-health.test.ts`

Expected: FAIL — `calculateEngagementScore` is not exported

- [ ] **Step 3: Implement engagement functions in shared lib**

Add to `supabase/functions/_shared/portfolio-health.ts` after `deriveTrend`:

```ts
function whatsappRecencyToScore(days: number): number {
  if (days <= 3) return 100;
  if (days <= 7) return 75;
  if (days <= 14) return 50;
  if (days <= 30) return 25;
  return 0;
}

export function calculateEngagementScore(
  contextEngagement: number | null,
  daysSinceLastIncoming: number | null,
): number {
  const ctxScore = contextEngagement != null ? contextEngagement : null;
  const waScore =
    daysSinceLastIncoming != null
      ? whatsappRecencyToScore(daysSinceLastIncoming)
      : null;

  if (ctxScore != null && waScore != null) {
    return Math.round(ctxScore * 0.6 + waScore * 0.4);
  }
  if (ctxScore != null) return ctxScore;
  if (waScore != null) return waScore;
  return 50;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/portfolio-health.test.ts`

Expected: ALL PASS

- [ ] **Step 5: Integrate into cron — fetch engagement data**

In `supabase/functions/calculate-portfolio-health/index.ts`:

Add import:

```ts
import {
  calculateFrequencyScore,
  calculateHealthScore,
  calculateRecencyScore,
  calculateTicketScore,
  calculateEngagementScore,
  deriveHealthStatus,
  deriveSegment,
  deriveTrend,
  detectSignals,
  type DetectedSignal,
  type ProductFrequency,
} from "../_shared/portfolio-health.ts";
```

In `processClient()`, after the orders fetch block (after line 107), add engagement data queries. Guard on `client.lead_id`:

```ts
  // Fetch engagement data (requires lead_id)
  let engagementScore = ENGAGEMENT_DEFAULT;
  let daysSinceLastIncoming: number | null = null;

  if (client.lead_id) {
    const { data: ctxSummary } = await supabase
      .from("conversation_context_summary")
      .select("engagement_score")
      .eq("lead_id", client.lead_id)
      .maybeSingle();

    const { data: lastIncoming } = await supabase
      .from("whatsapp_messages")
      .select("timestamp")
      .eq("lead_id", client.lead_id)
      .eq("direction", "incoming")
      .order("timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();

    daysSinceLastIncoming = lastIncoming
      ? Math.round(daysBetween(new Date(lastIncoming.timestamp), now))
      : null;

    engagementScore = calculateEngagementScore(
      ctxSummary?.engagement_score ?? null,
      daysSinceLastIncoming,
    );
  }
```

- [ ] **Step 6: Replace ENGAGEMENT_DEFAULT in dims**

Replace line 154 (`engagement: ENGAGEMENT_DEFAULT`):

```ts
  const dims = {
    recency: recencyScore,
    frequency: frequencyScore,
    ticket: ticketScore,
    engagement: engagementScore,
  };
```

- [ ] **Step 7: Pass real whatsapp data to `detectSignals`**

Replace the `daysSinceLastWhatsAppReply: null` in the `detectSignals` call (around line 203):

```ts
    daysSinceLastWhatsAppReply: daysSinceLastIncoming,
```

- [ ] **Step 8: Run full test suite**

Run: `npx vitest run tests/unit/portfolio-health.test.ts`

Expected: ALL PASS (existing + new tests)

- [ ] **Step 9: Build check**

Run: `npm run build`

Expected: No errors

- [ ] **Step 10: Commit**

```bash
git add supabase/functions/_shared/portfolio-health.ts supabase/functions/calculate-portfolio-health/index.ts tests/unit/portfolio-health.test.ts
git commit -m "feat(carteira): wire real engagement score from WhatsApp + context summary

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
