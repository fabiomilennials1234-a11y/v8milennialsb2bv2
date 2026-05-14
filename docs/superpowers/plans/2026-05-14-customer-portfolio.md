# Customer Portfolio & Reorder Management — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the existing upsell module into a full customer portfolio system with health scores, reorder prediction, copilot retention, and CSV import — feature-flagged per org.

**Architecture:** Extend `upsell_clients`/`upsell_orders` tables with health, cycle, and segment fields. New `client_alerts` + `client_purchase_items` tables. Cron edge function calculates health/segmentation daily. Frontend evolves Upsell page into Carteira with KPIs, 360 view, and quick order. Copilot gets retention toggle with auto-injected prompt. All gated behind `customer_portfolio` feature flag.

**Tech Stack:** Supabase (Postgres migrations, Edge Functions/Deno, RLS), React 18 + TypeScript, TanStack Query v5, shadcn/ui + Tailwind, Zod, Vitest

**Spec:** `docs/superpowers/specs/2026-05-14-customer-portfolio-design.md`

---

## File Structure

### Database (migrations)
- Create: `supabase/migrations/YYYYMMDD000000_customer_portfolio_schema.sql` — new columns on `upsell_clients`, `upsell_orders`, `copilot_agents`; new tables `client_purchase_items`, `client_alerts`; indexes; RLS
- Create: `supabase/migrations/YYYYMMDD000001_customer_portfolio_flag.sql` — feature flag insert

### Backend (Edge Functions)
- Create: `supabase/functions/calculate-portfolio-health/index.ts` — cron: health score, cycle, segment, alerts
- Create: `supabase/functions/_shared/portfolio-health.ts` — health score calculation logic (pure functions, testable)
- Modify: `supabase/functions/agent-message/engine/build-prompt.ts` — inject retention context when `retention_enabled`
- Modify: `supabase/functions/_shared/workflow-trigger.ts` — add `recompra_atrasada` docs (trigger type is dynamic, no code change needed)

### Frontend — Hooks
- Create: `src/hooks/usePortfolioHealth.ts` — fetch health scores, alerts, segments
- Create: `src/hooks/useClientAlerts.ts` — fetch/resolve client alerts
- Create: `src/hooks/useQuickOrder.ts` — create order with items, repeat last order
- Modify: `src/hooks/useUpsellClients.ts` — extend query to include new health/segment fields
- Modify: `src/hooks/useUpsellOrders.ts` — extend to include `client_purchase_items` + `source`

### Frontend — Pages & Components
- Modify: `src/pages/Upsell.tsx` — evolve into Carteira with KPI row, alert banner, tabs, new table
- Create: `src/components/carteira/CarteiraKPIs.tsx` — 5 KPI cards
- Create: `src/components/carteira/CarteiraAlertBanner.tsx` — urgent action banner
- Create: `src/components/carteira/CarteiraClientTable.tsx` — table with health, reorder, trend, segment
- Create: `src/components/carteira/CarteiraClientPreview.tsx` — sidebar preview on row click
- Create: `src/components/carteira/ClienteDetailPage.tsx` — full 360 view (new page or sheet)
- Create: `src/components/carteira/ClienteMetrics.tsx` — 6 metric cards
- Create: `src/components/carteira/ClienteReorderTimeline.tsx` — visual reorder progress bar
- Create: `src/components/carteira/ClienteCopilotSuggestion.tsx` — AI suggestion card
- Create: `src/components/carteira/ClienteProductsTable.tsx` — recurring products with trend
- Create: `src/components/carteira/ClienteOrderHistory.tsx` — orders timeline with gaps
- Create: `src/components/carteira/ClienteTimeline.tsx` — unified activity timeline
- Create: `src/components/carteira/QuickOrderModal.tsx` — repeat last order + manual entry
- Modify: `src/components/copilot/AgentConfigModal.tsx` — add retention toggle section
- Modify: `src/App.tsx` — add `/carteira/:clientId` route

### Tests
- Create: `tests/unit/portfolio-health.test.ts` — health score calculation unit tests
- Create: `tests/integration/portfolio-cron.test.ts` — cron processing integration test

---

## Task 1: Database Migration — Schema

**Files:**
- Create: `supabase/migrations/20260515000000_customer_portfolio_schema.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- ============================================
-- CUSTOMER PORTFOLIO — Schema Evolution
-- ============================================
-- Evolves upsell module with health scores, reorder prediction,
-- segmentation, and granular purchase items.
-- IMPACT: Adds columns to upsell_clients, upsell_orders, copilot_agents.
--         Creates new tables client_purchase_items, client_alerts.
--         No existing data modified.
-- ============================================

-- 1. NEW COLUMNS ON upsell_clients
ALTER TABLE upsell_clients
  ADD COLUMN IF NOT EXISTS reorder_cycle_days    INTEGER,
  ADD COLUMN IF NOT EXISTS days_since_last_order INTEGER,
  ADD COLUMN IF NOT EXISTS last_order_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_order_expected   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS order_count           INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifetime_value        NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_ticket            NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS health_score          INTEGER DEFAULT 100,
  ADD COLUMN IF NOT EXISTS health_status         TEXT DEFAULT 'saudavel',
  ADD COLUMN IF NOT EXISTS health_updated_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS segment               TEXT DEFAULT 'novo',
  ADD COLUMN IF NOT EXISTS company_id            UUID;

-- Constraints (idempotent via DO block)
DO $$ BEGIN
  ALTER TABLE upsell_clients
    ADD CONSTRAINT upsell_clients_health_status_check
    CHECK (health_status IN ('saudavel','atencao','risco','inativo'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE upsell_clients
    ADD CONSTRAINT upsell_clients_segment_check
    CHECK (segment IN ('ouro','prata','novo','resgate','dormindo'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE upsell_clients
    ADD CONSTRAINT upsell_clients_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Indexes for health/segment queries
CREATE INDEX IF NOT EXISTS idx_upsell_clients_health
  ON upsell_clients(organization_id, health_status);
CREATE INDEX IF NOT EXISTS idx_upsell_clients_segment
  ON upsell_clients(organization_id, segment);
CREATE INDEX IF NOT EXISTS idx_upsell_clients_next_order
  ON upsell_clients(organization_id, next_order_expected)
  WHERE is_active = true;

-- 2. NEW COLUMN ON upsell_orders
ALTER TABLE upsell_orders
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'pipe';

DO $$ BEGIN
  ALTER TABLE upsell_orders
    ADD CONSTRAINT upsell_orders_source_check
    CHECK (source IN ('pipe','manual','erp','copilot','csv_import'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. NEW COLUMNS ON copilot_agents
ALTER TABLE copilot_agents
  ADD COLUMN IF NOT EXISTS retention_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS retention_config  JSONB DEFAULT '{}';

-- 4. NEW TABLE: client_purchase_items
CREATE TABLE IF NOT EXISTS client_purchase_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES upsell_orders(id) ON DELETE CASCADE,
  product_id    UUID REFERENCES products(id) ON DELETE SET NULL,
  product_name  TEXT NOT NULL,
  quantity      NUMERIC(12,3) NOT NULL DEFAULT 1,
  unit_price    NUMERIC(12,2) NOT NULL,
  total_price   NUMERIC(14,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  unit          TEXT DEFAULT 'un',
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_items_order
  ON client_purchase_items(order_id);

-- 5. NEW TABLE: client_alerts
CREATE TABLE IF NOT EXISTS client_alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id       UUID NOT NULL REFERENCES upsell_clients(id) ON DELETE CASCADE,
  alert_type      TEXT NOT NULL CHECK (alert_type IN (
    'reorder_overdue','ticket_declining','product_missing',
    'cycle_stretching','engagement_cold','nps_low'
  )),
  severity        TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')),
  title           TEXT NOT NULL,
  description     TEXT,
  metadata        JSONB DEFAULT '{}',
  is_resolved     BOOLEAN DEFAULT false,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_alerts_org_active
  ON client_alerts(organization_id, is_resolved)
  WHERE is_resolved = false;
CREATE INDEX IF NOT EXISTS idx_client_alerts_client
  ON client_alerts(client_id, is_resolved);

-- 6. RLS for new tables

ALTER TABLE client_purchase_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "purchase_items_select" ON client_purchase_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM upsell_orders o
    JOIN upsell_clients c ON c.id = o.client_id
    WHERE o.id = client_purchase_items.order_id
    AND c.organization_id = public.get_user_organization_id()
  ));

CREATE POLICY "purchase_items_insert" ON client_purchase_items
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM upsell_orders o
    JOIN upsell_clients c ON c.id = o.client_id
    WHERE o.id = client_purchase_items.order_id
    AND c.organization_id = public.get_user_organization_id()
  ));

CREATE POLICY "purchase_items_update" ON client_purchase_items
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM upsell_orders o
    JOIN upsell_clients c ON c.id = o.client_id
    WHERE o.id = client_purchase_items.order_id
    AND c.organization_id = public.get_user_organization_id()
  ));

CREATE POLICY "purchase_items_delete" ON client_purchase_items
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM upsell_orders o
    JOIN upsell_clients c ON c.id = o.client_id
    WHERE o.id = client_purchase_items.order_id
    AND c.organization_id = public.get_user_organization_id()
  ));

ALTER TABLE client_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_alerts_select_org" ON client_alerts
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_organization_id());

CREATE POLICY "client_alerts_insert_org" ON client_alerts
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_organization_id());

CREATE POLICY "client_alerts_update_org" ON client_alerts
  FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_organization_id());

CREATE POLICY "client_alerts_delete_org" ON client_alerts
  FOR DELETE TO authenticated
  USING (organization_id = public.get_user_organization_id());

-- 7. SERVICE ROLE policies for cron (health calculator runs as service_role)
CREATE POLICY "purchase_items_service_all" ON client_purchase_items
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "client_alerts_service_all" ON client_alerts
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```

- [ ] **Step 2: Apply migration to dev**

```bash
supabase db push --linked
# OR
supabase migration up --linked
```

Expected: Migration applies cleanly. Verify with:
```bash
supabase db query --linked "SELECT column_name FROM information_schema.columns WHERE table_name = 'upsell_clients' AND column_name = 'health_score';"
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260515000000_customer_portfolio_schema.sql
git commit -m "feat(db): add customer portfolio schema — health score, segments, alerts, purchase items"
```

---

## Task 2: Feature Flag

**Files:**
- Create: `supabase/migrations/20260515000001_customer_portfolio_flag.sql`

- [ ] **Step 1: Write the migration**

```sql
INSERT INTO feature_flags (key, name, default_enabled, description, category)
VALUES (
  'customer_portfolio',
  'Customer Portfolio & Reorder',
  false,
  'Enables customer portfolio management: health scores, reorder prediction, retention copilot, and client 360 view',
  'features'
)
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 2: Apply to dev and verify**

```bash
supabase db query --linked "SELECT key, default_enabled FROM feature_flags WHERE key = 'customer_portfolio';"
```

Expected: `customer_portfolio | f`

- [ ] **Step 3: Register in frontend feature registry**

Modify: `src/lib/feature-registry.ts`

Add `"customer_portfolio"` to the `FeatureKey` type (alongside existing keys like `"carteira"`).

In `SIDEBAR_FEATURE_MAP`, update the `/upsell` entry to use `"customer_portfolio"` if it should gate the new Carteira features specifically, OR keep `"carteira"` if that's the existing subscription-level gate and use `customer_portfolio` as an additional backend-only flag.

**Decision:** Use `customer_portfolio` as the **backend cron/copilot gate**. The existing `"carteira"` subscription feature continues to gate sidebar visibility. Portfolio-specific UI elements (health badges, alert banner, 360 view) check `customer_portfolio` via `useOrgFeatures().hasFeature("customer_portfolio")`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260515000001_customer_portfolio_flag.sql src/lib/feature-registry.ts
git commit -m "feat: add customer_portfolio feature flag"
```

---

## Task 3: Health Score Calculator — Core Logic

**Files:**
- Create: `supabase/functions/_shared/portfolio-health.ts`
- Create: `tests/unit/portfolio-health.test.ts`

- [ ] **Step 1: Write failing tests for health score calculation**

Create `tests/unit/portfolio-health.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  calculateRecencyScore,
  calculateFrequencyScore,
  calculateTicketScore,
  calculateHealthScore,
  deriveHealthStatus,
  deriveSegment,
  detectSignals,
} from "../../supabase/functions/_shared/portfolio-health.ts";

describe("calculateRecencyScore", () => {
  it("returns 100 when within cycle", () => {
    expect(calculateRecencyScore(25, 30)).toBe(100);
  });

  it("returns 100 at exact cycle boundary", () => {
    expect(calculateRecencyScore(30, 30)).toBe(100);
  });

  it("decays linearly past cycle", () => {
    // 45 days since last, cycle is 30. Overdue by 15 days out of 30 buffer.
    // Score = max(0, 100 - ((45/30 - 1) * 100)) = max(0, 100 - 50) = 50
    expect(calculateRecencyScore(45, 30)).toBe(50);
  });

  it("returns 0 at 2x cycle", () => {
    expect(calculateRecencyScore(60, 30)).toBe(0);
  });

  it("returns 0 beyond 2x cycle", () => {
    expect(calculateRecencyScore(90, 30)).toBe(0);
  });
});

describe("calculateFrequencyScore", () => {
  it("returns 100 when frequency matches", () => {
    expect(calculateFrequencyScore(3, 3)).toBe(100);
  });

  it("caps at 100 when frequency exceeds", () => {
    expect(calculateFrequencyScore(5, 3)).toBe(100);
  });

  it("returns proportional score when frequency drops", () => {
    // 2 recent vs 3 historical = 67
    expect(calculateFrequencyScore(2, 3)).toBe(67);
  });

  it("returns 0 when no recent orders", () => {
    expect(calculateFrequencyScore(0, 3)).toBe(0);
  });
});

describe("calculateTicketScore", () => {
  it("returns 100 when ticket matches", () => {
    expect(calculateTicketScore(10000, 10000)).toBe(100);
  });

  it("caps at 100 when ticket exceeds", () => {
    expect(calculateTicketScore(15000, 10000)).toBe(100);
  });

  it("returns proportional score when ticket drops", () => {
    expect(calculateTicketScore(7000, 10000)).toBe(70);
  });
});

describe("calculateHealthScore", () => {
  it("returns weighted composite", () => {
    const score = calculateHealthScore({
      recency: 100,
      frequency: 100,
      ticket: 100,
      engagement: 100,
    });
    expect(score).toBe(100);
  });

  it("applies correct weights", () => {
    const score = calculateHealthScore({
      recency: 0,    // 35%
      frequency: 0,  // 25%
      ticket: 0,     // 25%
      engagement: 100, // 15%
    });
    expect(score).toBe(15);
  });
});

describe("deriveHealthStatus", () => {
  it("returns saudavel for 80+", () => {
    expect(deriveHealthStatus(85)).toBe("saudavel");
  });
  it("returns atencao for 60-79", () => {
    expect(deriveHealthStatus(65)).toBe("atencao");
  });
  it("returns risco for 30-59", () => {
    expect(deriveHealthStatus(45)).toBe("risco");
  });
  it("returns inativo for 0-29", () => {
    expect(deriveHealthStatus(20)).toBe("inativo");
  });
});

describe("deriveSegment", () => {
  it("returns ouro for high health + high ticket + many orders", () => {
    expect(deriveSegment(90, 15000, 10000, 8)).toBe("ouro");
  });
  it("returns prata for good health + stable + enough orders", () => {
    expect(deriveSegment(70, 8000, 10000, 5)).toBe("prata");
  });
  it("returns novo for few orders regardless of health", () => {
    expect(deriveSegment(90, 15000, 10000, 2)).toBe("novo");
  });
  it("returns resgate for low health + was active", () => {
    expect(deriveSegment(40, 8000, 10000, 7)).toBe("resgate");
  });
  it("returns dormindo for very low health", () => {
    expect(deriveSegment(15, 8000, 10000, 10)).toBe("dormindo");
  });
});

describe("detectSignals", () => {
  it("detects reorder_overdue", () => {
    const signals = detectSignals({
      daysSinceLastOrder: 40,
      cycleDays: 30,
      lastThreeTickets: [10000, 10000, 10000],
      historicalAvgTicket: 10000,
      productFrequencies: [],
      lastOrderProducts: [],
      daysSinceLastWhatsAppReply: 2,
      lastNpsScore: 4,
    });
    expect(signals.find((s) => s.type === "reorder_overdue")).toBeDefined();
    expect(signals.find((s) => s.type === "reorder_overdue")?.severity).toBe("critical");
  });

  it("detects ticket_declining with 3 consecutive drops", () => {
    const signals = detectSignals({
      daysSinceLastOrder: 10,
      cycleDays: 30,
      lastThreeTickets: [14000, 11000, 9000],
      historicalAvgTicket: 13000,
      productFrequencies: [],
      lastOrderProducts: [],
      daysSinceLastWhatsAppReply: 1,
      lastNpsScore: 5,
    });
    expect(signals.find((s) => s.type === "ticket_declining")).toBeDefined();
  });

  it("does not detect ticket_declining when not 3 consecutive", () => {
    const signals = detectSignals({
      daysSinceLastOrder: 10,
      cycleDays: 30,
      lastThreeTickets: [14000, 15000, 9000],
      historicalAvgTicket: 13000,
      productFrequencies: [],
      lastOrderProducts: [],
      daysSinceLastWhatsAppReply: 1,
      lastNpsScore: 5,
    });
    expect(signals.find((s) => s.type === "ticket_declining")).toBeUndefined();
  });

  it("detects product_missing", () => {
    const signals = detectSignals({
      daysSinceLastOrder: 10,
      cycleDays: 30,
      lastThreeTickets: [10000, 10000, 10000],
      historicalAvgTicket: 10000,
      productFrequencies: [
        { productName: "Resina Epoxi", appearsInPct: 100 },
        { productName: "Catalisador B2", appearsInPct: 90 },
      ],
      lastOrderProducts: ["Resina Epoxi"],
      daysSinceLastWhatsAppReply: 1,
      lastNpsScore: 5,
    });
    expect(signals.find((s) => s.type === "product_missing")).toBeDefined();
    expect(signals.find((s) => s.type === "product_missing")?.metadata?.productName).toBe("Catalisador B2");
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm run test:unit -- tests/unit/portfolio-health.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement portfolio-health.ts**

Create `supabase/functions/_shared/portfolio-health.ts`:

```typescript
export type HealthDimensions = {
  recency: number;
  frequency: number;
  ticket: number;
  engagement: number;
};

export type HealthStatus = "saudavel" | "atencao" | "risco" | "inativo";
export type Segment = "ouro" | "prata" | "novo" | "resgate" | "dormindo";

export type SignalType =
  | "reorder_overdue"
  | "ticket_declining"
  | "product_missing"
  | "cycle_stretching"
  | "engagement_cold"
  | "nps_low";

export type DetectedSignal = {
  type: SignalType;
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  metadata: Record<string, unknown>;
};

export type ProductFrequency = {
  productName: string;
  appearsInPct: number;
};

export type SignalInput = {
  daysSinceLastOrder: number;
  cycleDays: number;
  lastThreeTickets: number[];
  historicalAvgTicket: number;
  productFrequencies: ProductFrequency[];
  lastOrderProducts: string[];
  daysSinceLastWhatsAppReply: number | null;
  lastNpsScore: number | null;
};

const WEIGHTS = { recency: 0.35, frequency: 0.25, ticket: 0.25, engagement: 0.15 };

export function calculateRecencyScore(daysSinceLast: number, cycleDays: number): number {
  if (cycleDays <= 0) return 50;
  if (daysSinceLast <= cycleDays) return 100;
  const overdue = daysSinceLast / cycleDays - 1;
  return Math.max(0, Math.round(100 - overdue * 100));
}

export function calculateFrequencyScore(recentCount: number, historicalCount: number): number {
  if (historicalCount <= 0) return 50;
  return Math.min(100, Math.round((recentCount / historicalCount) * 100));
}

export function calculateTicketScore(recentAvg: number, historicalAvg: number): number {
  if (historicalAvg <= 0) return 50;
  return Math.min(100, Math.round((recentAvg / historicalAvg) * 100));
}

export function calculateHealthScore(dims: HealthDimensions): number {
  return Math.round(
    dims.recency * WEIGHTS.recency +
    dims.frequency * WEIGHTS.frequency +
    dims.ticket * WEIGHTS.ticket +
    dims.engagement * WEIGHTS.engagement
  );
}

export function deriveHealthStatus(score: number): HealthStatus {
  if (score >= 80) return "saudavel";
  if (score >= 60) return "atencao";
  if (score >= 30) return "risco";
  return "inativo";
}

export function deriveSegment(
  healthScore: number,
  avgTicket: number,
  orgAvgTicket: number,
  orderCount: number,
): Segment {
  if (orderCount < 3) return "novo";
  if (healthScore < 30) return "dormindo";
  if (healthScore < 60 && orderCount >= 5) return "resgate";
  if (healthScore >= 80 && avgTicket >= orgAvgTicket && orderCount >= 5) return "ouro";
  if (healthScore >= 60 && orderCount >= 3) return "prata";
  return "prata";
}

export function detectSignals(input: SignalInput): DetectedSignal[] {
  const signals: DetectedSignal[] = [];

  // Reorder overdue
  if (input.cycleDays > 0 && input.daysSinceLastOrder > input.cycleDays * 1.15) {
    const daysOverdue = Math.round(input.daysSinceLastOrder - input.cycleDays);
    signals.push({
      type: "reorder_overdue",
      severity: daysOverdue > 7 ? "critical" : "warning",
      title: `Recompra ${daysOverdue} dias atrasada`,
      description: `Ciclo médio: ${input.cycleDays}d. Último pedido há ${input.daysSinceLastOrder}d.`,
      metadata: { daysOverdue, cycleDays: input.cycleDays },
    });
  }

  // Ticket declining (3 consecutive drops)
  const t = input.lastThreeTickets;
  if (t.length === 3 && t[0] > t[1] && t[1] > t[2]) {
    const dropPct = Math.round((1 - t[2] / t[0]) * 100);
    signals.push({
      type: "ticket_declining",
      severity: "warning",
      title: `Ticket caindo ${dropPct}% em 3 pedidos`,
      description: `Sequência: R$${t[0].toLocaleString()} → R$${t[1].toLocaleString()} → R$${t[2].toLocaleString()}`,
      metadata: { tickets: t, dropPct },
    });
  }

  // Product missing
  for (const pf of input.productFrequencies) {
    if (pf.appearsInPct >= 80 && !input.lastOrderProducts.includes(pf.productName)) {
      signals.push({
        type: "product_missing",
        severity: "info",
        title: `Produto ausente: ${pf.productName}`,
        description: `Presente em ${pf.appearsInPct}% dos pedidos anteriores, ausente no último.`,
        metadata: { productName: pf.productName, historicalPct: pf.appearsInPct },
      });
    }
  }

  // Engagement cold
  if (
    input.daysSinceLastWhatsAppReply != null &&
    input.daysSinceLastWhatsAppReply > 7 &&
    input.daysSinceLastOrder > input.cycleDays
  ) {
    signals.push({
      type: "engagement_cold",
      severity: "critical",
      title: "Sem resposta há 7+ dias + recompra atrasada",
      description: `Última resposta WhatsApp há ${input.daysSinceLastWhatsAppReply} dias.`,
      metadata: { daysSinceReply: input.daysSinceLastWhatsAppReply },
    });
  }

  // NPS low
  if (input.lastNpsScore != null && input.lastNpsScore <= 2) {
    signals.push({
      type: "nps_low",
      severity: "critical",
      title: `NPS baixo: ${input.lastNpsScore}/5`,
      description: "Último feedback com nota ≤ 2. Escalar para contato humano.",
      metadata: { npsScore: input.lastNpsScore },
    });
  }

  return signals;
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm run test:unit -- tests/unit/portfolio-health.test.ts
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/portfolio-health.ts tests/unit/portfolio-health.test.ts
git commit -m "feat: add portfolio health score calculation with unit tests"
```

---

## Task 4: Health Score Cron Edge Function

**Files:**
- Create: `supabase/functions/calculate-portfolio-health/index.ts`

- [ ] **Step 1: Write the cron function**

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withSentry } from "../_shared/sentry.ts";
import { logRuntime } from "../_shared/logger.ts";
import {
  calculateRecencyScore,
  calculateFrequencyScore,
  calculateTicketScore,
  calculateHealthScore,
  deriveHealthStatus,
  deriveSegment,
  detectSignals,
  type SignalInput,
  type ProductFrequency,
} from "../_shared/portfolio-health.ts";

const BATCH_SIZE = 100;

Deno.serve(withSentry("calculate-portfolio-health", async (req: Request) => {
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (req.headers.get("x-cron-secret") !== cronSecret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Only process orgs with customer_portfolio flag ON
  const { data: enabledOrgs } = await supabase
    .from("organization_features")
    .select("organization_id")
    .eq("feature_key", "customer_portfolio")
    .eq("enabled", true);

  if (!enabledOrgs?.length) {
    // Check global default
    const { data: flag } = await supabase
      .from("feature_flags")
      .select("default_enabled")
      .eq("key", "customer_portfolio")
      .single();

    if (!flag?.default_enabled) {
      return new Response(JSON.stringify({ processed: 0, reason: "no orgs enabled" }));
    }
  }

  const orgIds = enabledOrgs?.map((o) => o.organization_id) ?? [];

  let totalProcessed = 0;
  let totalAlerts = 0;

  for (const orgId of orgIds) {
    try {
      const result = await processOrg(supabase, orgId);
      totalProcessed += result.clientsProcessed;
      totalAlerts += result.alertsCreated;
    } catch (err) {
      console.error(`[portfolio-health] Error processing org ${orgId}:`, err);
      await logRuntime(supabase, {
        module: "calculate-portfolio-health",
        action: "process_org",
        status: "error",
        organizationId: orgId,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await logRuntime(supabase, {
    module: "calculate-portfolio-health",
    action: "cron_complete",
    status: "success",
    payloadSnapshot: { orgsProcessed: orgIds.length, totalProcessed, totalAlerts },
  });

  return new Response(JSON.stringify({ orgsProcessed: orgIds.length, totalProcessed, totalAlerts }));
}));

async function processOrg(supabase: any, orgId: string) {
  let clientsProcessed = 0;
  let alertsCreated = 0;

  // Fetch active clients
  const { data: clients } = await supabase
    .from("upsell_clients")
    .select("id, lead_id")
    .eq("organization_id", orgId)
    .eq("is_active", true)
    .limit(BATCH_SIZE);

  if (!clients?.length) return { clientsProcessed: 0, alertsCreated: 0 };

  // Org-wide avg ticket for segment calculation
  const { data: orgAvgRow } = await supabase
    .from("upsell_orders")
    .select("sale_value")
    .eq("organization_id", orgId);
  const orgAvgTicket = orgAvgRow?.length
    ? orgAvgRow.reduce((s: number, r: any) => s + Number(r.sale_value), 0) / orgAvgRow.length
    : 0;

  for (const client of clients) {
    try {
      // Fetch orders for this client
      const { data: orders } = await supabase
        .from("upsell_orders")
        .select("id, sale_value, sold_at, product_name")
        .eq("client_id", client.id)
        .order("sold_at", { ascending: false });

      if (!orders?.length) continue;

      const orderCount = orders.length;
      const lifetimeValue = orders.reduce((s: number, o: any) => s + Number(o.sale_value), 0);
      const avgTicket = lifetimeValue / orderCount;

      // Calculate cycle
      let cycleDays = 30; // default
      if (orderCount >= 2) {
        const sortedDates = orders.map((o: any) => new Date(o.sold_at).getTime()).sort((a: number, b: number) => a - b);
        const gaps: number[] = [];
        for (let i = 1; i < sortedDates.length; i++) {
          gaps.push(Math.round((sortedDates[i] - sortedDates[i - 1]) / 86400000));
        }
        cycleDays = Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length);
      }

      const lastOrderAt = new Date(orders[0].sold_at);
      const daysSinceLastOrder = Math.round((Date.now() - lastOrderAt.getTime()) / 86400000);
      const nextOrderExpected = new Date(lastOrderAt.getTime() + cycleDays * 86400000);

      // Health score dimensions
      const recency = calculateRecencyScore(daysSinceLastOrder, cycleDays);

      // Frequency: orders in last 90 days vs historical rate
      const ninetyDaysAgo = Date.now() - 90 * 86400000;
      const recentOrders = orders.filter((o: any) => new Date(o.sold_at).getTime() > ninetyDaysAgo).length;
      const totalDays = Math.max(1, Math.round((Date.now() - new Date(orders[orders.length - 1].sold_at).getTime()) / 86400000));
      const historicalRate = (orderCount / totalDays) * 90;
      const frequency = calculateFrequencyScore(recentOrders, Math.round(historicalRate));

      // Ticket: avg of last 3 vs historical
      const lastThreeValues = orders.slice(0, 3).map((o: any) => Number(o.sale_value));
      const recentAvgTicket = lastThreeValues.reduce((s: number, v: number) => s + v, 0) / lastThreeValues.length;
      const ticket = calculateTicketScore(recentAvgTicket, avgTicket);

      // Engagement: simplified — check last WhatsApp reply
      let engagementScore = 50; // default neutral
      if (client.lead_id) {
        const { data: lastMsg } = await supabase
          .from("whatsapp_messages")
          .select("timestamp")
          .eq("phone_number", client.lead_id) // will need phone lookup
          .eq("direction", "incoming")
          .order("timestamp", { ascending: false })
          .limit(1);
        // Simplified: if replied in last 7 days = 100, else decays
        if (lastMsg?.length) {
          const daysSinceReply = Math.round((Date.now() - new Date(lastMsg[0].timestamp).getTime()) / 86400000);
          engagementScore = daysSinceReply <= 7 ? 100 : Math.max(0, 100 - (daysSinceReply - 7) * 5);
        }
      }

      const healthScore = orderCount < 3
        ? 70
        : calculateHealthScore({ recency, frequency, ticket, engagement: engagementScore });
      const healthStatus = deriveHealthStatus(healthScore);
      const segment = deriveSegment(healthScore, avgTicket, orgAvgTicket, orderCount);

      // Update client
      await supabase
        .from("upsell_clients")
        .update({
          reorder_cycle_days: cycleDays,
          days_since_last_order: daysSinceLastOrder,
          last_order_at: lastOrderAt.toISOString(),
          next_order_expected: nextOrderExpected.toISOString(),
          order_count: orderCount,
          lifetime_value: lifetimeValue,
          avg_ticket: avgTicket,
          health_score: healthScore,
          health_status: healthStatus,
          health_updated_at: new Date().toISOString(),
          segment,
        })
        .eq("id", client.id);

      // Detect signals
      const lastThreeTickets = orders.slice(0, 3).map((o: any) => Number(o.sale_value));

      // Product frequencies
      const productCounts: Record<string, number> = {};
      for (const o of orders) {
        productCounts[o.product_name] = (productCounts[o.product_name] || 0) + 1;
      }
      const productFrequencies: ProductFrequency[] = Object.entries(productCounts).map(
        ([name, count]) => ({ productName: name, appearsInPct: Math.round((count / orderCount) * 100) }),
      );
      const lastOrderProducts = orders
        .filter((o: any) => o.sold_at === orders[0].sold_at)
        .map((o: any) => o.product_name);

      const signalInput: SignalInput = {
        daysSinceLastOrder,
        cycleDays,
        lastThreeTickets,
        historicalAvgTicket: avgTicket,
        productFrequencies,
        lastOrderProducts,
        daysSinceLastWhatsAppReply: null,
        lastNpsScore: null,
      };

      const signals = detectSignals(signalInput);

      // Resolve old alerts that no longer apply
      const activeAlertTypes = signals.map((s) => s.type);
      await supabase
        .from("client_alerts")
        .update({ is_resolved: true, resolved_at: new Date().toISOString() })
        .eq("client_id", client.id)
        .eq("is_resolved", false)
        .not("alert_type", "in", `(${activeAlertTypes.map((t) => `"${t}"`).join(",")})`);

      // Create new alerts (only if not already active)
      for (const signal of signals) {
        const { data: existing } = await supabase
          .from("client_alerts")
          .select("id")
          .eq("client_id", client.id)
          .eq("alert_type", signal.type)
          .eq("is_resolved", false)
          .limit(1);

        if (!existing?.length) {
          await supabase.from("client_alerts").insert({
            organization_id: orgId,
            client_id: client.id,
            alert_type: signal.type,
            severity: signal.severity,
            title: signal.title,
            description: signal.description,
            metadata: signal.metadata,
          });
          alertsCreated++;
        }
      }

      clientsProcessed++;
    } catch (err) {
      console.error(`[portfolio-health] Error processing client ${client.id}:`, err);
    }
  }

  return { clientsProcessed, alertsCreated };
}
```

- [ ] **Step 2: Add to config.toml (no JWT verification for cron)**

Check if `calculate-portfolio-health` needs an entry in `supabase/config.toml` under `[functions.calculate-portfolio-health]` with `verify_jwt = false`.

- [ ] **Step 3: Deploy to dev and test**

```bash
supabase functions deploy calculate-portfolio-health --project-ref bcfadphgsibjzivtbjvc
```

Test manually:
```bash
curl -X POST https://bcfadphgsibjzivtbjvc.supabase.co/functions/v1/calculate-portfolio-health \
  -H "x-cron-secret: $CRON_SECRET"
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/calculate-portfolio-health/index.ts
git commit -m "feat: add portfolio health score cron calculator"
```

---

## Task 5: Frontend — Carteira KPIs & Alert Banner

**Files:**
- Create: `src/hooks/usePortfolioHealth.ts`
- Create: `src/hooks/useClientAlerts.ts`
- Create: `src/components/carteira/CarteiraKPIs.tsx`
- Create: `src/components/carteira/CarteiraAlertBanner.tsx`

- [ ] **Step 1: Create usePortfolioHealth hook**

```typescript
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";

export function usePortfolioHealth() {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ["portfolio-health", organizationId],
    queryFn: async () => {
      const { data: clients } = await supabase
        .from("upsell_clients")
        .select("id, health_score, health_status, segment, avg_ticket, lifetime_value, days_since_last_order, reorder_cycle_days, next_order_expected, order_count, is_active")
        .eq("organization_id", organizationId!)
        .eq("is_active", true);

      if (!clients?.length) return null;

      const totalRecurring = clients.reduce((s, c) => s + Number(c.avg_ticket || 0), 0);
      const overdueClients = clients.filter(
        (c) => c.days_since_last_order && c.reorder_cycle_days && c.days_since_last_order > c.reorder_cycle_days * 1.15,
      );
      const overdueRevenue = overdueClients.reduce((s, c) => s + Number(c.avg_ticket || 0), 0);
      const avgHealth = Math.round(clients.reduce((s, c) => s + (c.health_score || 0), 0) / clients.length);
      const avgTicket = Math.round(totalRecurring / clients.length);

      const now = Date.now();
      const weekFromNow = now + 7 * 86400000;
      const expectedThisWeek = clients.filter(
        (c) => c.next_order_expected && new Date(c.next_order_expected).getTime() <= weekFromNow && new Date(c.next_order_expected).getTime() >= now,
      ).length;

      return {
        totalClients: clients.length,
        totalRecurring,
        overdueCount: overdueClients.length,
        overdueRevenue,
        avgTicket,
        avgHealth,
        expectedThisWeek,
        clients,
      };
    },
    enabled: !!organizationId,
    staleTime: 60_000,
  });
}
```

- [ ] **Step 2: Create useClientAlerts hook**

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";

export function useClientAlerts(clientId?: string) {
  const { organizationId } = useOrganization();

  const query = useQuery({
    queryKey: ["client-alerts", organizationId, clientId],
    queryFn: async () => {
      let q = supabase
        .from("client_alerts")
        .select("*, client:upsell_clients(id, name, company)")
        .eq("organization_id", organizationId!)
        .eq("is_resolved", false)
        .order("created_at", { ascending: false });

      if (clientId) q = q.eq("client_id", clientId);

      const { data } = await q;
      return data ?? [];
    },
    enabled: !!organizationId,
    staleTime: 60_000,
  });

  const queryClient = useQueryClient();

  const resolveAlert = useMutation({
    mutationFn: async (alertId: string) => {
      await supabase
        .from("client_alerts")
        .update({ is_resolved: true, resolved_at: new Date().toISOString() })
        .eq("id", alertId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client-alerts"] });
    },
  });

  return { ...query, resolveAlert };
}
```

- [ ] **Step 3: Create CarteiraKPIs component**

Build `src/components/carteira/CarteiraKPIs.tsx` with 5 KPI cards (receita recorrente, previsão semana, recompra atrasada, ticket médio, health médio). Use data from `usePortfolioHealth`. Follow shadcn/ui Card patterns. Format currency with `Intl.NumberFormat('pt-BR')`.

- [ ] **Step 4: Create CarteiraAlertBanner component**

Build `src/components/carteira/CarteiraAlertBanner.tsx`. Shows when `overdueCount > 0`. Gold gradient background. Text: "{N} clientes com recompra atrasada — R$ {value} em risco". Button: "Ver detalhes". Use `useClientAlerts()` for count.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/usePortfolioHealth.ts src/hooks/useClientAlerts.ts src/components/carteira/
git commit -m "feat(ui): add carteira KPIs and alert banner components"
```

---

## Task 6: Frontend — Client Table with Health/Segment

**Files:**
- Create: `src/components/carteira/CarteiraClientTable.tsx`
- Create: `src/components/carteira/CarteiraClientPreview.tsx`
- Modify: `src/pages/Upsell.tsx`

- [ ] **Step 1: Create CarteiraClientTable**

Table component with columns: Cliente (name + company + order count), Health (badge with score and color), Recompra (status: "Em X dias" / "X dias atrasado"), Ticket Médio, Tendência (arrow + pct), Segmento (tag), Ações (WhatsApp, novo pedido, detalhes).

Use `usePortfolioHealth().clients` as data source. Each row clickable → sets `selectedClientId` state. Tabs filter by: all, expected this week, overdue, growing (trend > 0), new (segment === 'novo').

Health badge colors: `saudavel` = green, `atencao` = amber, `risco` = red, `inativo` = gray. Segment tags: `ouro` = gold bg, `prata` = slate, `novo` = blue, `resgate` = red, `dormindo` = gray.

- [ ] **Step 2: Create CarteiraClientPreview**

Sidebar component shown when a row is clicked. Shows: health ring (score with colored border), 4 preview metrics (cycle days, days since last, LTV, ticket trend), products list (from `upsell_client_products`), last 4 orders timeline (from `upsell_orders`), action buttons (WhatsApp, Novo Pedido, Ver 360).

- [ ] **Step 3: Modify Upsell.tsx to integrate new components**

When `customer_portfolio` flag is ON for the org, render the new Carteira layout:
- `<CarteiraKPIs />`
- `<CarteiraAlertBanner />`
- Tabs + `<CarteiraClientTable />`
- `<CarteiraClientPreview />` in a sidebar layout

When flag OFF, render existing Upsell UI unchanged.

Use `useOrgFeatures().hasFeature("customer_portfolio")` to conditionally render.

- [ ] **Step 4: Test in dev server**

```bash
npm run dev
```

Navigate to `/upsell`. Enable `customer_portfolio` flag for test org. Verify KPIs render, table shows with mock data, clicking a row shows preview sidebar.

- [ ] **Step 5: Commit**

```bash
git add src/components/carteira/ src/pages/Upsell.tsx
git commit -m "feat(ui): add carteira client table with health badges and preview sidebar"
```

---

## Task 7: Frontend — Client 360 Page

**Files:**
- Create: `src/components/carteira/ClienteDetailPage.tsx`
- Create: `src/components/carteira/ClienteMetrics.tsx`
- Create: `src/components/carteira/ClienteReorderTimeline.tsx`
- Create: `src/components/carteira/ClienteCopilotSuggestion.tsx`
- Create: `src/components/carteira/ClienteProductsTable.tsx`
- Create: `src/components/carteira/ClienteOrderHistory.tsx`
- Create: `src/components/carteira/ClienteTimeline.tsx`
- Modify: `src/App.tsx` — add route

- [ ] **Step 1: Create ClienteDetailPage**

Full-page component at `/carteira/:clientId`. Layout: header (avatar, name, company, meta, health ring, action buttons) → alert strip → 2-column grid of sub-components. Fetches client data via `useUpsellClients` + `usePortfolioHealth` + `useClientAlerts(clientId)`.

- [ ] **Step 2: Create sub-components**

**ClienteMetrics**: 6 cards in a 3×2 grid — LTV, ticket médio, ciclo, tendência, próx. pedido, NPS. Color-coded by status.

**ClienteReorderTimeline**: Visual progress bar showing position in reorder cycle. Green → amber → red gradient. Marker for current day. Labels: last order date, cycle length, overdue status.

**ClienteCopilotSuggestion**: Card with AI gradient background. Pre-built message based on active alerts and last order data. Buttons: "Enviar via WhatsApp", "Editar antes", "Copilot abordar sozinho". Message template uses client context (products, values, overdue days).

**ClienteProductsTable**: Table with columns: Produto, Frequência (% of orders), Último valor, Trend. Flag products with `appearsInPct >= 80` but absent from last order as "ausente".

**ClienteOrderHistory**: Timeline list of orders with date, order number, product list, value. Show gap in days between consecutive orders. Dot color: green if gap ≤ cycle, amber if slightly over, red if significantly over.

**ClienteTimeline**: Unified activity feed combining: orders (from `upsell_orders`), WhatsApp messages (from `whatsapp_messages` for the lead's phone), alerts (from `client_alerts`), notes (from a notes field or separate store). Each item has icon, timestamp, and description.

- [ ] **Step 3: Add route in App.tsx**

```tsx
const ClienteDetail = lazy(() => lazyRetry(() => import("./components/carteira/ClienteDetailPage")));

// Inside router, after /upsell route:
<Route path="/carteira/:clientId" element={
  <ProtectedRoute><SubscriptionProtectedRoute><MainLayout>
    <ClienteDetail />
  </MainLayout></SubscriptionProtectedRoute></ProtectedRoute>
} />
```

- [ ] **Step 4: Test in browser**

Navigate to `/carteira/{clientId}` with a real client ID. Verify all sections render. Check responsiveness. Verify alert strip shows active alerts.

- [ ] **Step 5: Commit**

```bash
git add src/components/carteira/ src/App.tsx
git commit -m "feat(ui): add client 360 detail page with metrics, copilot suggestion, and timeline"
```

---

## Task 8: Quick Order Modal

**Files:**
- Create: `src/components/carteira/QuickOrderModal.tsx`
- Create: `src/hooks/useQuickOrder.ts`

- [ ] **Step 1: Create useQuickOrder hook**

```typescript
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";

export type OrderLineItem = {
  product_id?: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  unit: string;
};

export function useLastOrder(clientId: string) {
  return useQuery({
    queryKey: ["last-order", clientId],
    queryFn: async () => {
      const { data: order } = await supabase
        .from("upsell_orders")
        .select("id, sale_value, sold_at, product_name, product_type")
        .eq("client_id", clientId)
        .order("sold_at", { ascending: false })
        .limit(1)
        .single();

      if (!order) return null;

      const { data: items } = await supabase
        .from("client_purchase_items")
        .select("*")
        .eq("order_id", order.id);

      return { order, items: items ?? [] };
    },
    enabled: !!clientId,
  });
}

export function useCreateOrder() {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      clientId: string;
      closerId?: string;
      items: OrderLineItem[];
      source: "manual" | "copilot";
    }) => {
      const totalValue = params.items.reduce((s, i) => s + i.quantity * i.unit_price, 0);

      // Create order
      const { data: order, error: orderError } = await supabase
        .from("upsell_orders")
        .insert({
          organization_id: organizationId!,
          client_id: params.clientId,
          closer_id: params.closerId,
          product_name: params.items.map((i) => i.product_name).join(", "),
          product_type: "unitario",
          sale_value: totalValue,
          source: params.source,
          origin: "upsell",
        })
        .select("id")
        .single();

      if (orderError) throw orderError;

      // Create line items
      if (params.items.length > 0) {
        const { error: itemsError } = await supabase
          .from("client_purchase_items")
          .insert(
            params.items.map((item) => ({
              order_id: order.id,
              product_id: item.product_id,
              product_name: item.product_name,
              quantity: item.quantity,
              unit_price: item.unit_price,
              unit: item.unit,
            })),
          );
        if (itemsError) throw itemsError;
      }

      return order;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["upsell_orders"] });
      queryClient.invalidateQueries({ queryKey: ["upsell_clients"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio-health"] });
      queryClient.invalidateQueries({ queryKey: ["last-order"] });
    },
  });
}
```

- [ ] **Step 2: Create QuickOrderModal**

Modal with:
- Client selector (if not pre-selected)
- "Repetir Último Pedido" green card (pre-populates from `useLastOrder`)
- Line items grid: product name (combobox from `products` table), quantity (number input), unit price, unit (select: un/kg/l/m/cx/pc), remove button
- Add line button
- Total calculated in real time
- "Confirmar Pedido" primary button

Use shadcn/ui Dialog, Table, Input, Select, Button components. Follow `NovaVendaModal.tsx` and `QuickSaleModal.tsx` patterns from existing upsell components.

- [ ] **Step 3: Wire into Carteira — add "Novo Pedido" button to header and row actions**

Header button opens QuickOrderModal without pre-selected client. Row action button opens with pre-selected clientId. Also accessible from Client 360 page.

- [ ] **Step 4: Test end-to-end**

Create a test order via Quick Order. Verify `upsell_orders` row created with `source: 'manual'`. Verify `client_purchase_items` rows created. Verify order appears in Client 360 history.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useQuickOrder.ts src/components/carteira/QuickOrderModal.tsx
git commit -m "feat(ui): add quick order modal with repeat-last-order shortcut"
```

---

## Task 9: Copilot Retention Switch

**Files:**
- Modify: `src/components/copilot/AgentConfigModal.tsx`
- Modify: `supabase/functions/agent-message/engine/build-prompt.ts`

- [ ] **Step 1: Add retention config section to AgentConfigModal**

In the "Geral" tab, after existing config sections, add a new section "Retenção & Carteira" (only visible when `customer_portfolio` flag is ON):

- Toggle: "Ativar retenção de clientes" (`retention_enabled`)
- Slider: "Frequência máxima de abordagem" (3-30 days, default 7) → `retention_config.max_frequency_days`
- Toggle: "Abordagem automática" (default on) → `retention_config.auto_approach`
- Toggle: "Clientes estratégicos: sempre alertar vendedor" (default off) → `retention_config.strategic_alert_only`

Save to `copilot_agents.retention_enabled` and `copilot_agents.retention_config` JSONB.

- [ ] **Step 2: Inject retention context in build-prompt.ts**

In `supabase/functions/agent-message/engine/build-prompt.ts`, after the business context section is built, add retention injection:

```typescript
// After existing businessContext processing:
if (capabilities.retention_enabled && leadId) {
  // Check if lead is an active client
  const { data: client } = await supabase
    .from("upsell_clients")
    .select("id, health_score, health_status, segment, reorder_cycle_days, days_since_last_order, last_order_at, avg_ticket")
    .eq("lead_id", leadId)
    .eq("is_active", true)
    .maybeSingle();

  if (client) {
    // Fetch last order products
    const { data: lastOrders } = await supabase
      .from("upsell_orders")
      .select("product_name, sale_value, sold_at")
      .eq("client_id", client.id)
      .order("sold_at", { ascending: false })
      .limit(3);

    // Fetch active alerts
    const { data: alerts } = await supabase
      .from("client_alerts")
      .select("alert_type, severity, title")
      .eq("client_id", client.id)
      .eq("is_resolved", false);

    const retentionConfig = capabilities.retention_config || {};
    const maxFreq = retentionConfig.max_frequency_days || 7;

    const retentionBlock = `
RETENÇÃO DE CLIENTES: Quando o contato for um cliente ativo (dados abaixo), priorize:
(1) Se recompra atrasada, ofereça renovação do último pedido com itens e valores.
(2) Se pós-entrega recente (3 dias), pergunte satisfação de 1 a 5.
(3) Se produto ausente detectado, sonde motivo sem ser invasivo.
(4) Se cliente pedir algo, interprete como pedido: confirme itens + quantidades + valores.
Nunca aborde retenção mais de 1x a cada ${maxFreq} dias.

DADOS DO CLIENTE:
- Health Score: ${client.health_score}/100 (${client.health_status})
- Segmento: ${client.segment}
- Ciclo de recompra: ${client.reorder_cycle_days} dias
- Dias desde último pedido: ${client.days_since_last_order}
- Ticket médio: R$ ${client.avg_ticket}
- Últimos pedidos: ${lastOrders?.map((o: any) => `${o.product_name} (R$${o.sale_value})`).join("; ") || "nenhum"}
- Alertas ativos: ${alerts?.map((a: any) => a.title).join("; ") || "nenhum"}`;

    // Append to prompt sections
    sections.push(retentionBlock);
  }
}
```

- [ ] **Step 3: Deploy agent-message to dev**

```bash
supabase functions deploy agent-message --project-ref bcfadphgsibjzivtbjvc
```

- [ ] **Step 4: Test with a copilot agent**

Enable `retention_enabled` on a test agent. Send a message from a lead who is also an `upsell_client`. Check logs for retention block in prompt. Verify AI response is contextual about reorder.

- [ ] **Step 5: Commit**

```bash
git add src/components/copilot/AgentConfigModal.tsx supabase/functions/agent-message/engine/build-prompt.ts
git commit -m "feat: add copilot retention switch with auto-injected portfolio context"
```

---

## Task 10: CSV Import Evolution

**Files:**
- Modify: `src/components/upsell/ImportUpsellClientsContent.tsx`

- [ ] **Step 1: Extend import fields to include order data**

Add new fields to `UPSELL_EXTRA_FIELDS` and `SYSTEM_FIELDS` in the existing import component:

```typescript
// New fields for portfolio import:
{ key: "produto", label: "Produto", required: false, scope: "order" },
{ key: "quantidade", label: "Quantidade", required: false, scope: "order" },
{ key: "valor_unitario", label: "Valor Unitário", required: false, scope: "order" },
{ key: "unidade", label: "Unidade", required: false, scope: "order" },
{ key: "data_pedido", label: "Data do Pedido", required: false, scope: "order" },
{ key: "cnpj", label: "CNPJ", required: false, scope: "client" },
```

- [ ] **Step 2: Add order grouping logic to import handler**

When order-scope fields are present in the CSV, group rows by client identifier (CNPJ or phone) and `data_pedido`. For each group:
1. Create/match `upsell_client` (existing logic)
2. Create `upsell_orders` with `source: 'csv_import'`
3. Create `client_purchase_items` for each row in the group

- [ ] **Step 3: Update template download**

Update `downloadUpsellImportTemplate()` to include the new columns in the template CSV.

- [ ] **Step 4: Test import with sample CSV**

Create test CSV with multiple clients and multiple orders per client. Import via UI. Verify `upsell_clients`, `upsell_orders`, and `client_purchase_items` are all created correctly. Run health cron to verify scores calculate.

- [ ] **Step 5: Commit**

```bash
git add src/components/upsell/ImportUpsellClientsContent.tsx
git commit -m "feat: extend CSV import to support order history with line items"
```

---

## Task 11: Workflow Trigger — recompra_atrasada

**Files:**
- Modify: `supabase/functions/calculate-portfolio-health/index.ts`

- [ ] **Step 1: Fire workflow trigger when reorder_overdue detected**

In the health cron, after creating a `reorder_overdue` alert, fire the workflow trigger:

```typescript
import { fireTrigger } from "../_shared/workflow-trigger.ts";

// Inside the signal detection loop, after creating the alert:
if (signal.type === "reorder_overdue") {
  await fireTrigger({
    supabase,
    organizationId: orgId,
    triggerType: "recompra_atrasada",
    leadId: client.lead_id,
    context: {
      client_id: client.id,
      days_overdue: signal.metadata.daysOverdue,
      cycle_days: signal.metadata.cycleDays,
      health_score: healthScore,
      segment,
      last_order_value: Number(orders[0]?.sale_value || 0),
      last_order_products: lastOrderProducts,
    },
  });
}
```

- [ ] **Step 2: Deploy and test**

```bash
supabase functions deploy calculate-portfolio-health --project-ref bcfadphgsibjzivtbjvc
```

Create a test workflow with trigger type `recompra_atrasada`. Run cron. Verify workflow execution created.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/calculate-portfolio-health/index.ts
git commit -m "feat: fire recompra_atrasada workflow trigger from health cron"
```

---

## Task 12: Regen Types & Final Integration Test

**Files:**
- Modify: `src/integrations/supabase/types.ts` (auto-generated)

- [ ] **Step 1: Regenerate Supabase types**

```bash
supabase gen types typescript --project-id bcfadphgsibjzivtbjvc > src/integrations/supabase/types.ts
```

- [ ] **Step 2: Fix any TypeScript errors from new fields**

Check hooks and components for type mismatches after regen. Update any `Tables<"upsell_clients">` usages that reference new fields.

- [ ] **Step 3: Full build check**

```bash
npm run build
```

Expected: No errors.

- [ ] **Step 4: Enable flag for test org and run end-to-end**

```sql
INSERT INTO organization_features (organization_id, feature_key, enabled)
VALUES ('6030520a-2ca7-477d-be89-55758e2cd808', 'customer_portfolio', true)
ON CONFLICT (organization_id, feature_key) DO UPDATE SET enabled = true;
```

Test flow:
1. Open `/upsell` → verify Carteira layout with KPIs
2. Click client → verify preview sidebar
3. Click "Ver 360" → verify detail page
4. Click "Novo Pedido" → create order via Quick Order
5. Run health cron → verify scores update
6. Check copilot agent config → verify retention toggle

- [ ] **Step 5: Commit**

```bash
git add src/integrations/supabase/types.ts
git commit -m "chore: regenerate supabase types with portfolio schema"
```
