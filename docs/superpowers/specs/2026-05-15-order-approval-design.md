# Order Approval — Design Spec

**Date:** 2026-05-15
**Status:** Approved
**Author:** CTO + Claude

## Problem

Upsell orders enter the system from multiple sources (copilot, manual, ERP, pipe trigger, CSV import) with no human gate. Orders count in metrics immediately. No way to review before confirming as real sales.

## Solution

Every `upsell_order` starts as `pending`. Any org member can approve or reject. Only approved orders count in metrics and analytics.

## Schema

Add 4 columns to `upsell_orders`:

```sql
ALTER TABLE upsell_orders
  ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN approved_by UUID REFERENCES auth.users(id),
  ADD COLUMN approved_at TIMESTAMPTZ,
  ADD COLUMN approval_comment TEXT;

-- Backfill existing orders as approved (pre-feature data)
UPDATE upsell_orders
SET approval_status = 'approved',
    approved_at = created_at
WHERE approval_status = 'pending';

-- Partial index for pending queue
CREATE INDEX idx_upsell_orders_approval
  ON upsell_orders(organization_id, approval_status)
  WHERE approval_status = 'pending';
```

No changes to RLS. Existing `organization_id` policies cover access. Any org member can approve (no role restriction).

## Flow

### Order Creation
No changes to any source. All insertions use the column default `'pending'`:
- `useCreateOrder` (QuickOrderModal) — manual + copilot
- Trigger `auto_create_upsell_on_vendido` — pipe
- `erp-order-webhook` edge function — ERP
- CSV import — csv_import

### Approval Actions
- **Approve**: Sets `approval_status = 'approved'`, `approved_by = auth.uid()`, `approved_at = now()`
- **Reject**: Sets `approval_status = 'rejected'`, `approved_by`, `approved_at`, `approval_comment` (optional)
- **Bulk approve**: Same as approve but for array of order IDs in single transaction
- **Immutable**: Once decided, cannot be reversed. Wrong rejection → create new order.

### Metrics Impact
All queries that aggregate upsell_orders must add `WHERE approval_status = 'approved'`:
- `useCarteiraKPIs` — recurring revenue, avg ticket, order count
- `useCarteiraClients` — lifetime_value, order_count, last_order_at derived fields
- `CarteiraRevenueAtRisk` — revenue calculations
- `CarteiraCohortHeatmap` — retention cohorts
- `CarteiraVendedorRanking` — vendor performance
- Any RPC that aggregates upsell_orders (check `get_vendedor_ranking`, client health recalcs)

## UI

### Placement
3rd view toggle in Carteira page (Upsell.tsx), alongside "Clientes" and "Analytics". Toggle button shows badge with pending count.

### Approvals View — `CarteiraApprovals.tsx`
**Header row:**
- Left: "N pedidos pendentes — R$ X.XXX total"
- Right: "Aprovar todos (N)" button → AlertDialog confirmation

**Card list** — `OrderApprovalCard.tsx` per order:
- Top-left: Client name (bold), date + source badge (color-coded: copilot=purple, manual=amber, pipe=teal, erp=blue, csv=gray)
- Top-right: Total value in gold
- Middle: Product items as chips (name x quantity)
- Bottom: Two full-width buttons — "Aprovar" (green) / "Rejeitar" (red)
- Reject action: opens small popover with optional textarea for comment

**Empty state:** When zero pending — centered icon + "Nenhum pedido pendente" message.

**Source badge colors:**
| Source | Background | Text |
|--------|-----------|------|
| copilot | `#2a2a3a` | `#8b8bff` |
| manual | `#2a2a1a` | `#fbbf24` |
| pipe | `#1a2a2a` | `#2dd4bf` |
| erp | `#1a2a3a` | `#60a5fa` |
| csv_import | `#2a2a2a` | `#999` |

### Query key invalidation on approve/reject
- `['upsell_orders', orgId]`
- `['carteira-kpis', orgId]`
- `['carteira-clients', orgId]`
- `['pending-orders', orgId]` (own query)

## Hooks

### `useOrderApproval.ts`

```typescript
// Fetch pending orders for org
// Joins: upsell_clients (name, company), client_purchase_items (product details)
// Order: created_at DESC
usePendingOrders(orgId: string)

// Approve single order
useApproveOrder() → mutationFn({ orderId: string })

// Reject single order with optional comment
useRejectOrder() → mutationFn({ orderId: string, comment?: string })

// Bulk approve multiple orders
useBulkApproveOrders() → mutationFn({ orderIds: string[] })
```

## Components

| Component | Purpose |
|-----------|---------|
| `CarteiraApprovals.tsx` | View container: header + stats + card list + empty state |
| `OrderApprovalCard.tsx` | Single order card with actions |

Both in `src/components/carteira/`.

## Edge Cases

- **Zero pending**: Empty state with check icon
- **Concurrent approval**: Two users approve same order — second UPDATE is no-op (idempotent, status already approved)
- **Order created while viewing**: Realtime subscription on `upsell_orders` INSERT + UPDATE, filtered by `organization_id`
- **Large volume**: Cards are virtualized if >50 pending (unlikely in practice, but safe)
- **Types regen**: After migration, regen types to include new columns in `Tables<"upsell_orders">`

## Non-Goals

- No approval rules engine (conditions, thresholds) — every order is pending
- No auto-reject timer
- No notification system (push/email on new pending)
- No role-based approval permissions
- No ERP push on approval (manual separate action)
- No reverting decisions

## Files Modified

| File | Change |
|------|--------|
| `supabase/migrations/XXXXXXX_order_approval.sql` | New migration |
| `src/integrations/supabase/types.ts` | Regen |
| `src/hooks/useOrderApproval.ts` | New hook |
| `src/components/carteira/CarteiraApprovals.tsx` | New component |
| `src/components/carteira/OrderApprovalCard.tsx` | New component |
| `src/pages/Upsell.tsx` | Add 3rd view toggle + render CarteiraApprovals |
| `src/hooks/useCarteiraKPIs.ts` | Filter by approval_status='approved' |
| `src/hooks/useCarteiraClients.ts` | Filter by approval_status='approved' |
| `src/components/carteira/CarteiraRevenueAtRisk.tsx` | Filter approved |
| `src/components/carteira/CarteiraCohortHeatmap.tsx` | Filter approved |
| `src/components/carteira/CarteiraVendedorRanking.tsx` | Filter approved |
