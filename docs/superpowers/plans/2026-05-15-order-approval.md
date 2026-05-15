# Order Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every upsell_order starts as pending and requires human approval before counting in metrics.

**Architecture:** 4 new columns on `upsell_orders` (approval_status, approved_by, approved_at, approval_comment). Edge function `calculate-portfolio-health` and view `portfolio_retention_cohorts` filter to approved only. Auto-move trigger fires on approval, not insertion. New hook `useOrderApproval.ts` + 2 components render approval cards in a 3rd view toggle on the Carteira page.

**Tech Stack:** Supabase (Postgres migration), React 18, TanStack Query v5, shadcn/ui, Tailwind, Lucide icons.

**Spec:** `docs/superpowers/specs/2026-05-15-order-approval-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `supabase/migrations/20261021000000_order_approval.sql` | Create | Schema: columns, backfill, index, view update, trigger update |
| `supabase/functions/calculate-portfolio-health/index.ts` | Modify | Filter upsell_orders by approval_status='approved' |
| `src/hooks/useOrderApproval.ts` | Create | Hooks: pending query, approve, reject, bulk approve |
| `src/components/carteira/CarteiraApprovals.tsx` | Create | Approvals view container |
| `src/components/carteira/OrderApprovalCard.tsx` | Create | Single order card with approve/reject |
| `src/pages/Upsell.tsx` | Modify | 3rd view toggle, pending count badge, render CarteiraApprovals |
| `src/integrations/supabase/types.ts` | Regen | After migration applied |

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20261021000000_order_approval.sql`

- [ ] **Step 1: Write migration file**

```sql
-- 1. Add approval columns
ALTER TABLE upsell_orders
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approval_comment TEXT;

-- 2. Backfill existing orders as approved (pre-feature data)
UPDATE upsell_orders
SET approval_status = 'approved',
    approved_at = created_at
WHERE approval_status = 'pending';

-- 3. Partial index for pending queue
CREATE INDEX IF NOT EXISTS idx_upsell_orders_approval
  ON upsell_orders(organization_id, approval_status)
  WHERE approval_status = 'pending';

-- 4. Update auto-move trigger: fire on UPDATE to approved, not on INSERT
CREATE OR REPLACE FUNCTION handle_upsell_order_auto_move()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_org_id UUID;
  v_target_stage TEXT;
BEGIN
  -- Only act when approval_status changes to 'approved'
  IF TG_OP = 'INSERT' THEN
    -- New rows start pending; skip auto-move
    IF NEW.approval_status <> 'approved' THEN
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.approval_status <> 'approved' OR OLD.approval_status = 'approved' THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT organization_id INTO v_org_id
  FROM upsell_clients
  WHERE id = NEW.client_id;

  IF v_org_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT stage_key INTO v_target_stage
  FROM pipeline_stages
  WHERE organization_id = v_org_id
    AND pipeline_type = 'upsell_base'
    AND is_active = true
    AND auto_move_min_days IS NOT NULL
    AND auto_move_max_days IS NOT NULL
    AND 0 >= auto_move_min_days
    AND 0 <= auto_move_max_days
  ORDER BY position ASC
  LIMIT 1;

  IF v_target_stage IS NOT NULL THEN
    UPDATE upsell_clients
    SET tipo_cliente_tempo = v_target_stage,
        updated_at = NOW()
    WHERE id = NEW.client_id
      AND tipo_cliente_tempo IS DISTINCT FROM v_target_stage;
  END IF;

  RETURN NEW;
END;
$$;

-- Re-create trigger to also fire on UPDATE
DROP TRIGGER IF EXISTS trg_upsell_order_auto_move ON upsell_orders;
CREATE TRIGGER trg_upsell_order_auto_move
  AFTER INSERT OR UPDATE OF approval_status ON upsell_orders
  FOR EACH ROW
  EXECUTE FUNCTION handle_upsell_order_auto_move();

-- 5. Update retention cohorts view: only count approved orders
CREATE OR REPLACE VIEW portfolio_retention_cohorts AS
WITH cohort_base AS (
  SELECT
    c.id AS client_id,
    c.organization_id,
    c.closer_id,
    c.segment,
    date_trunc('month', c.first_sale_at) AS cohort_month,
    c.first_sale_at
  FROM upsell_clients c
  WHERE c.is_active = true
    AND c.first_sale_at IS NOT NULL
),
months AS (
  SELECT generate_series(0, 11) AS month_offset
),
cohort_orders AS (
  SELECT
    cb.client_id,
    cb.organization_id,
    cb.cohort_month,
    cb.closer_id,
    cb.segment,
    m.month_offset,
    EXISTS (
      SELECT 1 FROM upsell_orders o
      WHERE o.client_id = cb.client_id
        AND o.approval_status = 'approved'
        AND date_trunc('month', o.sold_at) = cb.cohort_month + (m.month_offset || ' months')::interval
    ) AS had_order
  FROM cohort_base cb
  CROSS JOIN months m
  WHERE cb.cohort_month + (m.month_offset || ' months')::interval <= date_trunc('month', now())
)
SELECT
  organization_id,
  cohort_month,
  closer_id,
  segment,
  month_offset,
  COUNT(DISTINCT client_id) FILTER (WHERE had_order) AS active_clients,
  COUNT(DISTINCT client_id) AS total_clients,
  ROUND(
    COUNT(DISTINCT client_id) FILTER (WHERE had_order)::numeric
    / NULLIF(COUNT(DISTINCT client_id), 0) * 100
  ) AS retention_pct
FROM cohort_orders
GROUP BY organization_id, cohort_month, closer_id, segment, month_offset;
```

- [ ] **Step 2: Apply migration to dev**

Run: `supabase db push --project-ref bcfadphgsibjzivtbjvc`
Expected: Migration applied, 4 columns added, existing orders backfilled as approved.

- [ ] **Step 3: Regen TypeScript types**

Run: `supabase gen types typescript --project-id bcfadphgsibjzivtbjvc > src/integrations/supabase/types.ts`
Expected: `upsell_orders` type now includes `approval_status`, `approved_by`, `approved_at`, `approval_comment`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261021000000_order_approval.sql src/integrations/supabase/types.ts
git commit -m "feat(carteira): add order approval schema — columns, trigger, cohort view"
```

---

### Task 2: Filter approved orders in portfolio health edge function

**Files:**
- Modify: `supabase/functions/calculate-portfolio-health/index.ts:106-110` (per-client order fetch)
- Modify: `supabase/functions/calculate-portfolio-health/index.ts:440-443` (org-wide avg ticket)

- [ ] **Step 1: Add approval filter to per-client order fetch (line 106-110)**

Current code at line 106-110:
```typescript
  const { data: orders, error: ordersError } = await supabase
    .from("upsell_orders")
    .select("id, sale_value, sold_at, product_name")
    .eq("client_id", client.id)
    .order("sold_at", { ascending: true });
```

Change to:
```typescript
  const { data: orders, error: ordersError } = await supabase
    .from("upsell_orders")
    .select("id, sale_value, sold_at, product_name")
    .eq("client_id", client.id)
    .eq("approval_status", "approved")
    .order("sold_at", { ascending: true });
```

- [ ] **Step 2: Add approval filter to org-wide avg ticket (line 440-443)**

Current code at line 440-443:
```typescript
  const { data: ticketData } = await supabase
    .from("upsell_orders")
    .select("sale_value")
    .eq("organization_id", orgId);
```

Change to:
```typescript
  const { data: ticketData } = await supabase
    .from("upsell_orders")
    .select("sale_value")
    .eq("organization_id", orgId)
    .eq("approval_status", "approved");
```

- [ ] **Step 3: Deploy edge function to dev**

Run: `supabase functions deploy calculate-portfolio-health --project-ref bcfadphgsibjzivtbjvc`
Expected: Function deployed, now only counts approved orders.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/calculate-portfolio-health/index.ts
git commit -m "feat(carteira): filter approved orders in portfolio health calculation"
```

---

### Task 3: useOrderApproval hook

**Files:**
- Create: `src/hooks/useOrderApproval.ts`

- [ ] **Step 1: Create the hook file**

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface PendingOrder {
  id: string;
  client_id: string;
  client_name: string;
  client_company: string | null;
  product_name: string;
  sale_value: number;
  source: string | null;
  sold_at: string;
  created_at: string;
  items: {
    id: string;
    product_name: string;
    quantity: number;
    unit_price: number;
    unit: string;
  }[];
}

export function usePendingOrders() {
  const { organizationId } = useOrganization();

  return useQuery<PendingOrder[]>({
    queryKey: ["pending-orders", organizationId],
    queryFn: async () => {
      const { data: orders, error } = await supabase
        .from("upsell_orders")
        .select(`
          id, client_id, product_name, sale_value, source, sold_at, created_at,
          upsell_clients!inner(name, company)
        `)
        .eq("organization_id", organizationId!)
        .eq("approval_status", "pending")
        .order("created_at", { ascending: false });

      if (error) throw error;

      const orderIds = (orders ?? []).map((o: any) => o.id);
      let itemsMap: Record<string, any[]> = {};

      if (orderIds.length > 0) {
        const { data: items } = await supabase
          .from("client_purchase_items")
          .select("id, order_id, product_name, quantity, unit_price, unit")
          .in("order_id", orderIds);

        for (const item of items ?? []) {
          if (!itemsMap[item.order_id]) itemsMap[item.order_id] = [];
          itemsMap[item.order_id].push(item);
        }
      }

      return (orders ?? []).map((o: any) => ({
        id: o.id,
        client_id: o.client_id,
        client_name: o.upsell_clients.name,
        client_company: o.upsell_clients.company,
        product_name: o.product_name,
        sale_value: o.sale_value,
        source: o.source,
        sold_at: o.sold_at,
        created_at: o.created_at,
        items: itemsMap[o.id] ?? [],
      }));
    },
    enabled: !!organizationId,
  });
}

export function useApproveOrder() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ orderId }: { orderId: string }) => {
      const { error } = await supabase
        .from("upsell_orders")
        .update({
          approval_status: "approved",
          approved_by: user!.id,
          approved_at: new Date().toISOString(),
        })
        .eq("id", orderId)
        .eq("approval_status", "pending");

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pedido aprovado");
      queryClient.invalidateQueries({ queryKey: ["pending-orders", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["upsell_orders"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio-kpis"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio-clients"] });
    },
  });
}

export function useRejectOrder() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ orderId, comment }: { orderId: string; comment?: string }) => {
      const { error } = await supabase
        .from("upsell_orders")
        .update({
          approval_status: "rejected",
          approved_by: user!.id,
          approved_at: new Date().toISOString(),
          approval_comment: comment ?? null,
        })
        .eq("id", orderId)
        .eq("approval_status", "pending");

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pedido rejeitado");
      queryClient.invalidateQueries({ queryKey: ["pending-orders", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["upsell_orders"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio-kpis"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio-clients"] });
    },
  });
}

export function useBulkApproveOrders() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ orderIds }: { orderIds: string[] }) => {
      const { error } = await supabase
        .from("upsell_orders")
        .update({
          approval_status: "approved",
          approved_by: user!.id,
          approved_at: new Date().toISOString(),
        })
        .in("id", orderIds)
        .eq("approval_status", "pending");

      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      toast.success(`${vars.orderIds.length} pedidos aprovados`);
      queryClient.invalidateQueries({ queryKey: ["pending-orders", organizationId] });
      queryClient.invalidateQueries({ queryKey: ["upsell_orders"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio-kpis"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio-clients"] });
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useOrderApproval.ts
git commit -m "feat(carteira): add useOrderApproval hook — pending query, approve, reject, bulk"
```

---

### Task 4: OrderApprovalCard component

**Files:**
- Create: `src/components/carteira/OrderApprovalCard.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { PendingOrder } from "@/hooks/useOrderApproval";

const SOURCE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  copilot: { bg: "bg-[#2a2a3a]", text: "text-[#8b8bff]", label: "Copilot" },
  manual: { bg: "bg-[#2a2a1a]", text: "text-[#fbbf24]", label: "Manual" },
  pipe: { bg: "bg-[#1a2a2a]", text: "text-[#2dd4bf]", label: "Pipe" },
  erp: { bg: "bg-[#1a2a3a]", text: "text-[#60a5fa]", label: "ERP" },
  csv_import: { bg: "bg-[#2a2a2a]", text: "text-muted-foreground", label: "CSV" },
};

interface OrderApprovalCardProps {
  order: PendingOrder;
  onApprove: (orderId: string) => void;
  onReject: (orderId: string, comment?: string) => void;
  isApproving?: boolean;
  isRejecting?: boolean;
}

export function OrderApprovalCard({
  order,
  onApprove,
  onReject,
  isApproving,
  isRejecting,
}: OrderApprovalCardProps) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectComment, setRejectComment] = useState("");

  const source = SOURCE_STYLES[order.source ?? ""] ?? SOURCE_STYLES.csv_import;
  const dateStr = new Date(order.created_at).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
  const valueStr = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(order.sale_value);

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-3">
      {/* Header: client + value */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground">
            {order.client_name}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {dateStr}
            {" · "}
            <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium", source.bg, source.text)}>
              {source.label}
            </span>
          </p>
        </div>
        <span className="text-base font-bold text-primary">{valueStr}</span>
      </div>

      {/* Items chips */}
      {order.items.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {order.items.map((item) => (
            <span
              key={item.id}
              className="bg-muted px-2.5 py-0.5 rounded text-[11px] text-muted-foreground"
            >
              {item.product_name} x{item.quantity}
            </span>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          variant="ghost"
          className="flex-1 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 hover:text-emerald-300"
          onClick={() => onApprove(order.id)}
          disabled={isApproving || isRejecting}
        >
          <Check className="w-4 h-4 mr-1.5" />
          Aprovar
        </Button>

        <Popover open={rejectOpen} onOpenChange={setRejectOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              className="flex-1 bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300"
              disabled={isApproving || isRejecting}
            >
              <X className="w-4 h-4 mr-1.5" />
              Rejeitar
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-3" align="end">
            <Textarea
              placeholder="Motivo (opcional)"
              value={rejectComment}
              onChange={(e) => setRejectComment(e.target.value)}
              rows={2}
              className="text-xs mb-2"
            />
            <Button
              variant="destructive"
              size="sm"
              className="w-full"
              disabled={isRejecting}
              onClick={() => {
                onReject(order.id, rejectComment || undefined);
                setRejectComment("");
                setRejectOpen(false);
              }}
            >
              Confirmar rejeição
            </Button>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/carteira/OrderApprovalCard.tsx
git commit -m "feat(carteira): add OrderApprovalCard component"
```

---

### Task 5: CarteiraApprovals view container

**Files:**
- Create: `src/components/carteira/CarteiraApprovals.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { OrderApprovalCard } from "./OrderApprovalCard";
import {
  usePendingOrders,
  useApproveOrder,
  useRejectOrder,
  useBulkApproveOrders,
} from "@/hooks/useOrderApproval";

export function CarteiraApprovals() {
  const { data: orders = [], isLoading } = usePendingOrders();
  const approveOrder = useApproveOrder();
  const rejectOrder = useRejectOrder();
  const bulkApprove = useBulkApproveOrders();

  const totalValue = orders.reduce((s, o) => s + o.sale_value, 0);
  const totalStr = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(totalValue);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">
        Carregando pedidos…
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <CheckCircle2 className="w-10 h-10 text-emerald-500/60" />
        <p className="text-sm text-muted-foreground">Nenhum pedido pendente</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-foreground">
          <span className="font-semibold">{orders.length} pedidos</span>
          {" pendentes — "}
          <span className="text-muted-foreground">{totalStr} total</span>
        </p>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
              disabled={bulkApprove.isPending}
            >
              Aprovar todos ({orders.length})
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Aprovar todos os pedidos?</AlertDialogTitle>
              <AlertDialogDescription>
                {orders.length} pedidos ({totalStr}) serão aprovados e passarão a contar
                nas métricas da carteira. Esta ação não pode ser revertida.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={() =>
                  bulkApprove.mutate({ orderIds: orders.map((o) => o.id) })
                }
              >
                Aprovar todos
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* Card list */}
      <div className="space-y-3">
        {orders.map((order) => (
          <OrderApprovalCard
            key={order.id}
            order={order}
            onApprove={(id) => approveOrder.mutate({ orderId: id })}
            onReject={(id, comment) => rejectOrder.mutate({ orderId: id, comment })}
            isApproving={approveOrder.isPending}
            isRejecting={rejectOrder.isPending}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/carteira/CarteiraApprovals.tsx
git commit -m "feat(carteira): add CarteiraApprovals view container"
```

---

### Task 6: Wire approvals view into Upsell.tsx

**Files:**
- Modify: `src/pages/Upsell.tsx:1-4` (imports)
- Modify: `src/pages/Upsell.tsx:78` (state type)
- Modify: `src/pages/Upsell.tsx:82-83` (realtime subscriptions)
- Modify: `src/pages/Upsell.tsx:190-215` (view toggle)
- Modify: `src/pages/Upsell.tsx:267-275` (conditional render)

- [ ] **Step 1: Add imports at top of file (after line 4)**

Add after the existing lucide import line (line 4):

```typescript
import { ClipboardCheck } from "lucide-react";
```

Add after the CarteiraVendedorRanking import (line 29):

```typescript
import { CarteiraApprovals } from "@/components/carteira/CarteiraApprovals";
import { usePendingOrders } from "@/hooks/useOrderApproval";
```

- [ ] **Step 2: Expand carteiraView type (line 78)**

Change:
```typescript
  const [carteiraView, setCarteiraView] = useState<"clientes" | "analytics">("clientes");
```

To:
```typescript
  const [carteiraView, setCarteiraView] = useState<"clientes" | "analytics" | "aprovacoes">("clientes");
```

- [ ] **Step 3: Add pending count query (after line 83)**

Add after the realtime subscriptions:

```typescript
  const { data: pendingOrders = [] } = usePendingOrders();
  const pendingCount = pendingOrders.length;
```

Also add `"pending-orders"` to the upsell_orders realtime subscription. Change line 83:

```typescript
  useRealtimeSubscription("upsell_orders", ["portfolio-clients", "portfolio-kpis", "pending-orders"]);
```

- [ ] **Step 4: Add 3rd view toggle button (after the Analytics button, line 203-214)**

After the closing `</button>` of Analytics (line 214), and before the closing `</div>` of the toggle container, add:

```tsx
            <button
              onClick={() => setCarteiraView("aprovacoes")}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-r-md transition-colors",
                carteiraView === "aprovacoes"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-muted-foreground",
              )}
            >
              <ClipboardCheck className="w-3.5 h-3.5" />
              Aprovações
              {pendingCount > 0 && (
                <span className="ml-1 bg-primary/15 text-primary text-[10px] font-semibold px-1.5 py-px rounded-full">
                  {pendingCount}
                </span>
              )}
            </button>
```

Also: remove `rounded-r-md` from the Analytics button and add `rounded-none` instead (since it's now the middle button). The Clientes button keeps `rounded-l-md`.

Change the Analytics button className from:
```
"flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-r-md transition-colors",
```
To:
```
"flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors",
```

- [ ] **Step 5: Add CarteiraApprovals render branch (after the analytics block, line 267-275)**

Change the ternary at line 218 to handle 3 views. Replace the entire block from line 218 to line 275:

```tsx
        {carteiraView === "clientes" ? (
          <>
            {/* Main content: table + optional sidebar */}
            <div className="flex gap-4 items-start">
              <div className="flex-1 min-w-0">
                <CarteiraClientTable
                  selectedClientId={selectedClient?.id ?? null}
                  onSelectClient={(client) => setSelectedClient(client)}
                  onWhatsApp={(client) => {
                    if (client.lead_id) {
                      navigate(`/chat?lead=${client.lead_id}`);
                    } else if (client.phone) {
                      window.open(
                        `https://wa.me/${client.phone.replace(/\D/g, "")}`,
                        "_blank",
                      );
                    }
                  }}
                  onNewOrder={(id) => {
                    setQuickOrderClientId(id);
                    setNovaVendaOpen(true);
                  }}
                  onViewDetail={(id) => navigate(`/carteira/${id}`)}
                  searchQuery={carteiraSearch}
                  filter={carteiraFilter}
                  bulk={bulk}
                  onRowsChange={setCurrentRows}
                />
              </div>

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
            </div>

            {/* Bulk action bar */}
            <CarteiraBulkBar
              selectedClients={currentRows.filter((r) => bulk.isSelected(r.id))}
              onClear={bulk.clearSelection}
            />
          </>
        ) : carteiraView === "analytics" ? (
          <div className="space-y-6">
            <CarteiraRevenueAtRisk />
            <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-6">
              <CarteiraCohortHeatmap />
              <CarteiraVendedorRanking />
            </div>
          </div>
        ) : (
          <CarteiraApprovals />
        )}
```

- [ ] **Step 6: Verify dev server renders correctly**

Run: `npm run dev`
Navigate to Carteira page. Verify:
1. Three view toggle buttons: Clientes | Analytics | Aprovações
2. Aprovações shows pending count badge (if any pending orders exist)
3. Clicking Aprovações shows the approval cards or empty state
4. Approve/reject actions work and cards disappear

- [ ] **Step 7: Commit**

```bash
git add src/pages/Upsell.tsx
git commit -m "feat(carteira): wire approvals view — 3rd toggle with pending badge"
```

---

### Task 7: Verify end-to-end & build

- [ ] **Step 1: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: Build succeeds. Check for Vite chunk warnings.

- [ ] **Step 3: Manual E2E test**

1. Create order via QuickOrderModal → verify it appears in Aprovações view as pending
2. Approve → card disappears, verify order now counts in KPIs/analytics
3. Create another order → reject with comment → card disappears, order does NOT count in metrics
4. Test "Aprovar todos" with 2+ pending orders → confirm dialog → all approved

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(carteira): post-review adjustments for order approval"
```
