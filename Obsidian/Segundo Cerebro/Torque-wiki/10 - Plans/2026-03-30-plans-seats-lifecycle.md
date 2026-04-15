---
tags:
  - torque-crm
  - docs
  - plan
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: docs/superpowers/plans/2026-03-30-plans-seats-lifecycle.md
---

# Plans, Seat Enforcement & Subscription Lifecycle - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Atualizar o Master UI para o novo modelo de pricing Torque, criar sistema de enforcement de seats por org, e implementar guards de lifecycle completos para subscription status em todas as rotas.

**Architecture:** Três frentes independentes que podem ser executadas em paralelo. Frente A atualiza tipos e componentes Master. Frente B cria RPC de seat usage + enforcement no backend e UI de seat management. Frente C estende o SubscriptionProtectedRoute para cobrir todas as rotas e automatiza transiçoes de status via DB functions.

**Tech Stack:** React + TypeScript, Supabase (Postgres migrations, Edge Functions, RPC), TanStack Query, shadcn/ui, Tailwind CSS.

---

## File Structure

### Frente A - Master UI (Pricing Model Update)

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/hooks/useMasterPlans.ts` | Extend `Plan` type with new pricing columns |
| Modify | `src/components/master/PlanEditor.tsx` | Replace legacy price fields with new pricing model UI |
| Modify | `src/components/master/BillingOverrideModal.tsx` | Fix pricing display for Torque plans |

### Frente B - Seat Enforcement

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `supabase/migrations/20260330000000_seat_enforcement.sql` | RPC `org_get_seat_usage`, trigger to block member activation beyond seats |
| Modify | `src/contexts/OrgFeaturesContext.tsx` | Expose seat usage data alongside features/limits |
| Create | `src/hooks/useSeatUsage.ts` | Hook to fetch and cache seat usage per org |
| Create | `src/components/team/SeatUsageBar.tsx` | Visual bar showing seats used vs. paid |
| Modify | `src/pages/Equipe.tsx` | Add SeatUsageBar, disable create button when at capacity |

### Frente C - Subscription Lifecycle Guards

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `supabase/migrations/20260330100000_subscription_lifecycle.sql` | Function to transition overdue→suspended, RPC for grace period check |
| Modify | `src/lib/subscription.ts` | Handle `overdue` status with grace period logic |
| Modify | `src/components/SubscriptionProtectedRoute.tsx` | Add `overdue` handling with grace banner |
| Create | `src/components/subscription/SubscriptionBlockedPage.tsx` | Full-page block for suspended/cancelled/expired orgs |
| Create | `src/components/subscription/OverdueBanner.tsx` | Dismissible warning banner for overdue orgs |
| Modify | `src/App.tsx` | Wrap all LayoutWrapper routes with subscription guard |

---

## Frente A - Master UI (Pricing Model Update)

---

### Task 1: Extend Plan type with new pricing columns

**Files:**
- Modify: `src/hooks/useMasterPlans.ts`

- [ ] **Step 1: Update the Plan interface**

Replace the current `Plan` interface with one that includes all pricing columns from the `20260830000000` migration:

```typescript
export interface Plan {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  // Legacy pricing (kept for backward compat)
  price_monthly: number;
  price_yearly: number;
  // New Torque pricing model
  price_per_user_monthly: number | null;
  base_price_monthly: number | null;
  min_users: number;
  included_users: number;
  included_copilots: number;
  extra_user_price: number;
  // Discounts
  discount_semester_pct: number;
  discount_annual_pct: number;
  discount_volume_pct: number;
  discount_volume_min: number;
  // Features & limits
  features: Record<string, boolean>;
  limits: Record<string, number>;
  is_active: boolean;
  is_default: boolean;
  position: number;
}
```

- [ ] **Step 2: Update useUpdatePlan to include new fields**

The existing `useUpdatePlan` mutation already uses `Partial<Plan>` so it will automatically accept the new fields. No code change needed beyond the type - verify by checking that the mutation function destructures `{ id, ...rest }` and passes `rest` to Supabase `.update()`.

- [ ] **Step 3: Verify the query returns new columns**

The existing `useMasterPlans` query uses `.select("*")` which already returns all columns. The only change needed is the type cast. Confirm the query:

```typescript
export function useMasterPlans() {
  return useQuery<Plan[]>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscription_plans")
        .select("*")
        .order("position");
      if (error) throw error;
      return data as Plan[];
    },
  });
}
```

No change needed - `select("*")` already returns everything. The type cast ensures TypeScript sees the new fields.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useMasterPlans.ts
git commit -m "feat(master): extend Plan type with Torque pricing columns"
```

---

### Task 2: Update PlanEditor for new pricing model

**Files:**
- Modify: `src/components/master/PlanEditor.tsx`

- [ ] **Step 1: Add state for new pricing fields**

Replace the legacy `priceMonthly` / `priceYearly` state with the full pricing model. After the existing state declarations (line ~35), replace with:

```typescript
// Pricing model state
const [pricePerUserMonthly, setPricePerUserMonthly] = useState<number | null>(plan.price_per_user_monthly);
const [basePriceMonthly, setBasePriceMonthly] = useState<number | null>(plan.base_price_monthly);
const [minUsers, setMinUsers] = useState(plan.min_users);
const [includedUsers, setIncludedUsers] = useState(plan.included_users);
const [includedCopilots, setIncludedCopilots] = useState(plan.included_copilots);
const [extraUserPrice, setExtraUserPrice] = useState(plan.extra_user_price);
// Discounts
const [discountSemesterPct, setDiscountSemesterPct] = useState(plan.discount_semester_pct);
const [discountAnnualPct, setDiscountAnnualPct] = useState(plan.discount_annual_pct);
const [discountVolumePct, setDiscountVolumePct] = useState(plan.discount_volume_pct);
const [discountVolumeMin, setDiscountVolumeMin] = useState(plan.discount_volume_min);
```

- [ ] **Step 2: Update the useEffect reset to include new fields**

Replace the existing `useEffect` (line ~45) that resets state on plan change:

```typescript
useEffect(() => {
  setDisplayName(plan.display_name);
  setDescription(plan.description ?? "");
  setIsActive(plan.is_active);
  setFeatures(plan.features);
  setLimits(plan.limits);
  // Pricing
  setPricePerUserMonthly(plan.price_per_user_monthly);
  setBasePriceMonthly(plan.base_price_monthly);
  setMinUsers(plan.min_users);
  setIncludedUsers(plan.included_users);
  setIncludedCopilots(plan.included_copilots);
  setExtraUserPrice(plan.extra_user_price);
  // Discounts
  setDiscountSemesterPct(plan.discount_semester_pct);
  setDiscountAnnualPct(plan.discount_annual_pct);
  setDiscountVolumePct(plan.discount_volume_pct);
  setDiscountVolumeMin(plan.discount_volume_min);
  setDirty(false);
}, [plan.id]);
```

- [ ] **Step 3: Update handleSave to persist new fields**

Replace the `handleSave` function:

```typescript
const handleSave = () => {
  updatePlan.mutate({
    id: plan.id,
    display_name: displayName,
    description: description || null,
    is_active: isActive,
    features,
    limits,
    // Pricing
    price_per_user_monthly: pricePerUserMonthly,
    base_price_monthly: basePriceMonthly,
    min_users: minUsers,
    included_users: includedUsers,
    included_copilots: includedCopilots,
    extra_user_price: extraUserPrice,
    // Legacy (computed for reference)
    price_monthly: basePriceMonthly ?? (pricePerUserMonthly ?? 0) * minUsers,
    price_yearly: 0,
    // Discounts
    discount_semester_pct: discountSemesterPct,
    discount_annual_pct: discountAnnualPct,
    discount_volume_pct: discountVolumePct,
    discount_volume_min: discountVolumeMin,
  });
  setDirty(false);
};
```

- [ ] **Step 4: Replace the "Geral" tab content with new pricing UI**

Replace the entire `TabsContent value="geral"` block. The new tab shows the pricing model (per-seat vs package), minimum users, included users/copilots, extra user price, and discount percentages:

```tsx
<TabsContent value="geral" className="space-y-6 mt-4">
  {/* Name & Slug */}
  <div className="grid grid-cols-2 gap-4">
    <div className="space-y-2">
      <Label>Nome de Exibição</Label>
      <Input
        value={displayName}
        onChange={(e) => { setDisplayName(e.target.value); markDirty(); }}
      />
    </div>
    <div className="space-y-2">
      <Label>Slug (não editável)</Label>
      <Input value={plan.name} disabled />
    </div>
  </div>
  <div className="space-y-2">
    <Label>Descrição</Label>
    <Textarea
      value={description}
      onChange={(e) => { setDescription(e.target.value); markDirty(); }}
      rows={2}
    />
  </div>

  {/* Pricing Model */}
  <div className="p-4 rounded-lg border space-y-4">
    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Modelo de Pricing</h3>

    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-2">
        <Label>Preço por Usuário/mês (R$)</Label>
        <Input
          type="number"
          value={pricePerUserMonthly ?? ""}
          placeholder="NULL = não é per-seat"
          onChange={(e) => {
            const v = e.target.value === "" ? null : parseFloat(e.target.value);
            setPricePerUserMonthly(v);
            markDirty();
          }}
        />
        <p className="text-xs text-muted-foreground">Planos per-seat (Torque 1.0 / 2.0)</p>
      </div>
      <div className="space-y-2">
        <Label>Preço Base Mensal (R$)</Label>
        <Input
          type="number"
          value={basePriceMonthly ?? ""}
          placeholder="NULL = não é package"
          onChange={(e) => {
            const v = e.target.value === "" ? null : parseFloat(e.target.value);
            setBasePriceMonthly(v);
            markDirty();
          }}
        />
        <p className="text-xs text-muted-foreground">Planos package (Torque V8)</p>
      </div>
    </div>

    <div className="grid grid-cols-4 gap-4">
      <div className="space-y-2">
        <Label>Mín. Usuários</Label>
        <Input
          type="number"
          value={minUsers}
          onChange={(e) => { setMinUsers(parseInt(e.target.value) || 1); markDirty(); }}
        />
      </div>
      <div className="space-y-2">
        <Label>Incluídos</Label>
        <Input
          type="number"
          value={includedUsers}
          onChange={(e) => { setIncludedUsers(parseInt(e.target.value) || 0); markDirty(); }}
        />
      </div>
      <div className="space-y-2">
        <Label>Copilots Incl.</Label>
        <Input
          type="number"
          value={includedCopilots}
          onChange={(e) => { setIncludedCopilots(parseInt(e.target.value) || 0); markDirty(); }}
        />
      </div>
      <div className="space-y-2">
        <Label>Extra/Usuário (R$)</Label>
        <Input
          type="number"
          value={extraUserPrice}
          onChange={(e) => { setExtraUserPrice(parseFloat(e.target.value) || 0); markDirty(); }}
        />
      </div>
    </div>
  </div>

  {/* Discounts */}
  <div className="p-4 rounded-lg border space-y-4">
    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Descontos</h3>
    <div className="grid grid-cols-4 gap-4">
      <div className="space-y-2">
        <Label>Semestral (%)</Label>
        <Input
          type="number"
          value={discountSemesterPct}
          onChange={(e) => { setDiscountSemesterPct(parseFloat(e.target.value) || 0); markDirty(); }}
        />
      </div>
      <div className="space-y-2">
        <Label>Anual (%)</Label>
        <Input
          type="number"
          value={discountAnnualPct}
          onChange={(e) => { setDiscountAnnualPct(parseFloat(e.target.value) || 0); markDirty(); }}
        />
      </div>
      <div className="space-y-2">
        <Label>Volume (%)</Label>
        <Input
          type="number"
          value={discountVolumePct}
          onChange={(e) => { setDiscountVolumePct(parseFloat(e.target.value) || 0); markDirty(); }}
        />
      </div>
      <div className="space-y-2">
        <Label>Volume Mín. Users</Label>
        <Input
          type="number"
          value={discountVolumeMin}
          onChange={(e) => { setDiscountVolumeMin(parseInt(e.target.value) || 1); markDirty(); }}
        />
      </div>
    </div>
  </div>

  {/* Active toggle */}
  <div className="flex items-center justify-between p-3 rounded-lg border">
    <div>
      <p className="text-sm font-medium">Plano Ativo</p>
      <p className="text-xs text-muted-foreground">Organizaçoes podem usar este plano</p>
    </div>
    <Switch checked={isActive} onCheckedChange={(v) => { setIsActive(v); markDirty(); }} />
  </div>
</TabsContent>
```

- [ ] **Step 5: Update the tabs layout from 5 to 6 tabs**

Replace the `TabsList` to include a "Pricing" tab, or keep as 5 and merge pricing into "Geral". Since the code above merges pricing into "Geral", keep the existing 5-tab layout - no change needed for TabsList.

- [ ] **Step 6: Remove old priceMonthly/priceYearly state variables**

Delete these lines (around lines 35-36):

```typescript
// DELETE these:
const [priceMonthly, setPriceMonthly] = useState(plan.price_monthly);
const [priceYearly, setPriceYearly] = useState(plan.price_yearly);
```

And remove the corresponding lines from the old useEffect and old handleSave.

- [ ] **Step 7: Commit**

```bash
git add src/components/master/PlanEditor.tsx
git commit -m "feat(master): update PlanEditor with Torque pricing model fields"
```

---

### Task 3: Fix BillingOverrideModal pricing display

**Files:**
- Modify: `src/components/master/BillingOverrideModal.tsx`

- [ ] **Step 1: Add a helper function for plan pricing label**

Add this helper inside the component, before the return statement:

```typescript
const formatPlanPrice = (plan: any) => {
  if (plan.price_per_user_monthly) {
    return `R$ ${plan.price_per_user_monthly}/usuário/mês (mín. ${plan.min_users})`;
  }
  if (plan.base_price_monthly) {
    return `R$ ${plan.base_price_monthly}/mês + R$ ${plan.extra_user_price}/extra`;
  }
  return `R$ ${plan.price_monthly}/mês`;
};
```

- [ ] **Step 2: Update the SelectItem to use the new helper**

Replace the plan SelectItem rendering (around line 235-244):

```tsx
{plans?.map((plan) => (
  <SelectItem key={plan.id} value={plan.name}>
    <div className="flex flex-col">
      <span>{plan.display_name}</span>
      <span className="text-xs text-muted-foreground">
        {formatPlanPrice(plan)}
      </span>
    </div>
  </SelectItem>
))}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/master/BillingOverrideModal.tsx
git commit -m "fix(master): show correct Torque pricing in BillingOverrideModal"
```

---

## Frente B - Seat Enforcement

---

### Task 4: Create seat usage RPC and DB enforcement

**Files:**
- Create: `supabase/migrations/20260330000000_seat_enforcement.sql`

- [ ] **Step 1: Write the migration**

```sql
-- ================================================================
-- Migration: Seat Enforcement
-- RPC para seat usage + trigger para impedir ativação além dos seats pagos.
-- Date: 2026-03-30
-- ================================================================

-- ============================================
-- 1. RPC: org_get_seat_usage
-- Retorna seats pagos vs. membros ativos para uma org.
-- ============================================

CREATE OR REPLACE FUNCTION public.org_get_seat_usage(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_paid_seats   INTEGER;
  v_active_count INTEGER;
  v_plan_limit   INTEGER;
  v_plan_name    TEXT;
BEGIN
  -- Seats pagos via org_subscriptions
  SELECT os.user_count, sp.name
  INTO v_paid_seats, v_plan_name
  FROM public.org_subscriptions os
  JOIN public.subscription_plans sp ON sp.id = os.plan_id
  WHERE os.organization_id = p_org_id
    AND os.cancelled_at IS NULL;

  -- Se não tem subscription, tenta pegar do plano da org (legacy)
  IF v_paid_seats IS NULL THEN
    SELECT
      COALESCE(
        (o.limit_overrides->>'max_users')::INTEGER,
        (sp.limits->>'max_users')::INTEGER,
        2 -- fallback
      ),
      COALESCE(sp.name, o.subscription_plan, 'free')
    INTO v_plan_limit, v_plan_name
    FROM public.organizations o
    LEFT JOIN public.subscription_plans sp ON sp.name = o.subscription_plan
    WHERE o.id = p_org_id;

    v_paid_seats := v_plan_limit;
  END IF;

  -- Membros ativos na org
  SELECT COUNT(*)::INTEGER
  INTO v_active_count
  FROM public.team_members
  WHERE organization_id = p_org_id
    AND is_active = true;

  RETURN jsonb_build_object(
    'paid_seats',    COALESCE(v_paid_seats, 0),
    'active_members', v_active_count,
    'plan_name',     COALESCE(v_plan_name, 'unknown'),
    'is_unlimited',  COALESCE(v_paid_seats, 0) = -1,
    'can_add',       COALESCE(v_paid_seats, 0) = -1 OR v_active_count < COALESCE(v_paid_seats, 0),
    'remaining',     CASE
                       WHEN COALESCE(v_paid_seats, 0) = -1 THEN -1
                       ELSE GREATEST(COALESCE(v_paid_seats, 0) - v_active_count, 0)
                     END
  );
END;
$$;

COMMENT ON FUNCTION public.org_get_seat_usage IS
  'Retorna uso de seats: paid_seats, active_members, can_add, remaining. '
  '-1 em paid_seats/remaining = ilimitado.';

GRANT EXECUTE ON FUNCTION public.org_get_seat_usage(UUID)
  TO authenticated, service_role;

-- ============================================
-- 2. Trigger: impedir ativação de team_member quando seats esgotados
-- ============================================

CREATE OR REPLACE FUNCTION public.enforce_seat_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_usage JSONB;
BEGIN
  -- Só checa quando ativando um membro (is_active false → true) ou criando ativo
  IF NEW.is_active = true AND (TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.is_active = false)) THEN
    v_usage := public.org_get_seat_usage(NEW.organization_id);

    -- Se não é ilimitado E já está no limite (sem contar o novo)
    IF NOT (v_usage->>'is_unlimited')::BOOLEAN
       AND (v_usage->>'active_members')::INTEGER >= (v_usage->>'paid_seats')::INTEGER
    THEN
      RAISE EXCEPTION 'Limite de seats atingido. Seats pagos: %, membros ativos: %.',
        (v_usage->>'paid_seats')::INTEGER,
        (v_usage->>'active_members')::INTEGER
      USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Aplicar trigger em team_members
DROP TRIGGER IF EXISTS trg_enforce_seat_limit ON public.team_members;
CREATE TRIGGER trg_enforce_seat_limit
  BEFORE INSERT OR UPDATE OF is_active
  ON public.team_members
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_seat_limit();

COMMENT ON FUNCTION public.enforce_seat_limit IS
  'Trigger que impede ativação de membros além dos seats pagos na org.';
```

- [ ] **Step 2: Verify migration syntax locally**

Run:
```bash
cd <repo-root> && npx supabase db lint --level warning 2>&1 | head -20
```

If supabase CLI is not available, verify the SQL manually by reading through for syntax issues.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260330000000_seat_enforcement.sql
git commit -m "feat(db): add seat enforcement RPC and trigger"
```

---

### Task 5: Create useSeatUsage hook

**Files:**
- Create: `src/hooks/useSeatUsage.ts`

- [ ] **Step 1: Write the hook**

```typescript
/**
 * useSeatUsage - hook que retorna uso de seats da org atual.
 * Chama a RPC org_get_seat_usage e cacheia por 2 minutos.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface SeatUsage {
  paid_seats: number;
  active_members: number;
  plan_name: string;
  is_unlimited: boolean;
  can_add: boolean;
  remaining: number;
}

export function useSeatUsage(organizationId: string | undefined) {
  return useQuery<SeatUsage>({
    queryKey: ["seat-usage", organizationId],
    queryFn: async () => {
      if (!organizationId) throw new Error("No organization ID");
      const { data, error } = await supabase.rpc("org_get_seat_usage", {
        p_org_id: organizationId,
      });
      if (error) throw error;
      return data as unknown as SeatUsage;
    },
    enabled: !!organizationId,
    staleTime: 1000 * 60 * 2, // 2 minutes
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useSeatUsage.ts
git commit -m "feat: add useSeatUsage hook for seat management"
```

---

### Task 6: Create SeatUsageBar component

**Files:**
- Create: `src/components/team/SeatUsageBar.tsx`

- [ ] **Step 1: Write the component**

```tsx
/**
 * SeatUsageBar - barra visual mostrando seats usados vs. pagos.
 */

import { Users } from "lucide-react";
import type { SeatUsage } from "@/hooks/useSeatUsage";

interface SeatUsageBarProps {
  usage: SeatUsage;
}

export function SeatUsageBar({ usage }: SeatUsageBarProps) {
  if (usage.is_unlimited) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Users className="w-4 h-4" />
        <span>{usage.active_members} membros ativos</span>
        <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
          Ilimitado
        </span>
      </div>
    );
  }

  const pct = Math.min((usage.active_members / usage.paid_seats) * 100, 100);
  const isAtLimit = usage.active_members >= usage.paid_seats;
  const isNearLimit = pct >= 80 && !isAtLimit;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4" />
          <span className="font-medium">
            {usage.active_members} / {usage.paid_seats} seats
          </span>
        </div>
        {isAtLimit && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-destructive/10 text-destructive font-medium">
            Limite atingido
          </span>
        )}
        {isNearLimit && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 font-medium">
            {usage.remaining} restante{usage.remaining !== 1 ? "s" : ""}
          </span>
        )}
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            isAtLimit
              ? "bg-destructive"
              : isNearLimit
                ? "bg-amber-500"
                : "bg-primary"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/team/SeatUsageBar.tsx
git commit -m "feat: add SeatUsageBar component for seat visualization"
```

---

### Task 7: Integrate seat usage into Equipe page

**Files:**
- Modify: `src/pages/Equipe.tsx`

- [ ] **Step 1: Import useSeatUsage and SeatUsageBar**

Add imports at the top of the file:

```typescript
import { useSeatUsage } from "@/hooks/useSeatUsage";
import { SeatUsageBar } from "@/components/team/SeatUsageBar";
```

- [ ] **Step 2: Call useSeatUsage in the component**

Inside the component function, near the existing hooks, add:

```typescript
const { data: seatUsage } = useSeatUsage(currentUser?.organization_id);
```

Where `currentUser` is the existing variable that holds the authenticated user's team_member record. Find the exact variable name by looking at how `organization_id` is referenced in the existing code.

- [ ] **Step 3: Add SeatUsageBar to the page header**

Find the page header section (near the "Adicionar Membro" button). Add the bar above the member table:

```tsx
{seatUsage && <SeatUsageBar usage={seatUsage} />}
```

- [ ] **Step 4: Disable the "Adicionar" button when at capacity**

Find the button that opens the create user dialog. Add a `disabled` prop:

```tsx
<Button
  onClick={() => setShowCreateDialog(true)}
  disabled={seatUsage ? !seatUsage.can_add : false}
>
```

If the button is already rendered, find the exact JSX and add the disabled condition. Also add a tooltip or message when disabled:

```tsx
{seatUsage && !seatUsage.can_add && (
  <p className="text-xs text-destructive">
    Limite de seats atingido. Faça upgrade para adicionar mais membros.
  </p>
)}
```

- [ ] **Step 5: Invalidate seat usage cache after member creation/deletion**

In the user creation success handler and the member deletion handler, add:

```typescript
queryClient.invalidateQueries({ queryKey: ["seat-usage"] });
```

Find the existing `queryClient` usage in the component (or import `useQueryClient` from `@tanstack/react-query`).

- [ ] **Step 6: Commit**

```bash
git add src/pages/Equipe.tsx
git commit -m "feat(equipe): integrate seat usage bar and enforce seat limits in UI"
```

---

## Frente C - Subscription Lifecycle Guards

---

### Task 8: Create subscription lifecycle DB functions

**Files:**
- Create: `supabase/migrations/20260330100000_subscription_lifecycle.sql`

- [ ] **Step 1: Write the migration**

```sql
-- ================================================================
-- Migration: Subscription Lifecycle Automation
-- Funçoes para transição automática de status de subscription.
-- Date: 2026-03-30
-- ================================================================

-- ============================================
-- 1. Function: Transicionar orgs overdue → suspended
-- Chamada via cron ou manualmente. Grace period = 7 dias.
-- ============================================

CREATE OR REPLACE FUNCTION public.process_overdue_subscriptions(
  p_grace_days INTEGER DEFAULT 7
)
RETURNS TABLE (
  organization_id UUID,
  org_name TEXT,
  days_overdue INTEGER,
  new_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH overdue_orgs AS (
    SELECT
      o.id,
      o.name,
      -- Dias desde o último pagamento overdue
      COALESCE(
        (SELECT EXTRACT(DAY FROM NOW() - MIN(ph.created_at))::INTEGER
         FROM public.payment_history ph
         WHERE ph.organization_id = o.id
           AND ph.status = 'overdue'
        ),
        0
      ) AS overdue_days
    FROM public.organizations o
    WHERE o.subscription_status = 'overdue'
  )
  UPDATE public.organizations org
  SET
    subscription_status = 'suspended',
    updated_at = NOW()
  FROM overdue_orgs oo
  WHERE org.id = oo.id
    AND oo.overdue_days >= p_grace_days
  RETURNING org.id, oo.name, oo.overdue_days, 'suspended'::TEXT;
END;
$$;

COMMENT ON FUNCTION public.process_overdue_subscriptions IS
  'Transiciona orgs overdue → suspended após grace period (default 7 dias). '
  'Retorna lista de orgs transicionadas.';

GRANT EXECUTE ON FUNCTION public.process_overdue_subscriptions(INTEGER)
  TO service_role;

-- ============================================
-- 2. RPC: org_get_subscription_status (batched, for frontend)
-- Retorna status completo da subscription para o guard no frontend.
-- ============================================

CREATE OR REPLACE FUNCTION public.org_get_subscription_status(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_org RECORD;
  v_overdue_since TIMESTAMPTZ;
  v_grace_remaining INTEGER;
BEGIN
  SELECT
    subscription_status,
    subscription_plan,
    subscription_expires_at,
    billing_override
  INTO v_org
  FROM public.organizations
  WHERE id = p_org_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'expired',
      'is_valid', false,
      'days_remaining', 0,
      'grace_remaining', 0
    );
  END IF;

  -- Se overdue, calcular dias de graça restantes
  IF v_org.subscription_status = 'overdue' THEN
    SELECT MIN(created_at)
    INTO v_overdue_since
    FROM public.payment_history
    WHERE organization_id = p_org_id
      AND status = 'overdue';

    IF v_overdue_since IS NOT NULL THEN
      v_grace_remaining := GREATEST(7 - EXTRACT(DAY FROM NOW() - v_overdue_since)::INTEGER, 0);
    ELSE
      v_grace_remaining := 7;
    END IF;
  ELSE
    v_grace_remaining := NULL;
  END IF;

  RETURN jsonb_build_object(
    'status',            v_org.subscription_status,
    'plan',              v_org.subscription_plan,
    'expires_at',        v_org.subscription_expires_at,
    'billing_override',  COALESCE(v_org.billing_override, false),
    'is_valid',          v_org.subscription_status IN ('active', 'trial', 'overdue')
                           OR COALESCE(v_org.billing_override, false),
    'days_remaining',    CASE
                           WHEN v_org.subscription_expires_at IS NOT NULL
                             THEN GREATEST(EXTRACT(DAY FROM v_org.subscription_expires_at - NOW())::INTEGER, 0)
                           ELSE NULL
                         END,
    'grace_remaining',   v_grace_remaining,
    'is_overdue',        v_org.subscription_status = 'overdue',
    'is_blocked',        v_org.subscription_status IN ('suspended', 'cancelled', 'expired')
                           AND NOT COALESCE(v_org.billing_override, false)
  );
END;
$$;

COMMENT ON FUNCTION public.org_get_subscription_status IS
  'Status completo da subscription para o frontend guard. '
  'Inclui grace_remaining para orgs overdue.';

GRANT EXECUTE ON FUNCTION public.org_get_subscription_status(UUID)
  TO authenticated, service_role;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260330100000_subscription_lifecycle.sql
git commit -m "feat(db): add subscription lifecycle functions and overdue processing"
```

---

### Task 9: Update subscription.ts to handle overdue status

**Files:**
- Modify: `src/lib/subscription.ts`

- [ ] **Step 1: Add 'overdue' to SubscriptionStatus type**

Update the `SubscriptionStatus` interface:

```typescript
export interface SubscriptionStatus {
  status: 'trial' | 'active' | 'overdue' | 'suspended' | 'cancelled' | 'expired';
  plan: string | null;
  expiresAt: string | null;
  isValid: boolean;
  daysRemaining: number | null;
  graceRemaining: number | null;
  isOverdue: boolean;
  isBlocked: boolean;
}
```

- [ ] **Step 2: Replace checkSubscription with RPC-based version**

Replace the entire `checkSubscription` function:

```typescript
export async function checkSubscription(
  organizationId: string
): Promise<SubscriptionStatus> {
  const { data, error } = await supabase.rpc("org_get_subscription_status", {
    p_org_id: organizationId,
  });

  if (error || !data) {
    return {
      status: 'expired',
      plan: null,
      expiresAt: null,
      isValid: false,
      daysRemaining: null,
      graceRemaining: null,
      isOverdue: false,
      isBlocked: true,
    };
  }

  const result = data as Record<string, any>;

  return {
    status: result.status,
    plan: result.plan,
    expiresAt: result.expires_at,
    isValid: result.is_valid,
    daysRemaining: result.days_remaining,
    graceRemaining: result.grace_remaining ?? null,
    isOverdue: result.is_overdue ?? false,
    isBlocked: result.is_blocked ?? false,
  };
}
```

- [ ] **Step 3: Keep checkCurrentUserSubscription and getCurrentOrganization unchanged**

These functions delegate to `checkSubscription` which now returns the new shape - no changes needed.

- [ ] **Step 4: Commit**

```bash
git add src/lib/subscription.ts
git commit -m "feat: update subscription.ts to use RPC with overdue/grace support"
```

---

### Task 10: Create OverdueBanner component

**Files:**
- Create: `src/components/subscription/OverdueBanner.tsx`

- [ ] **Step 1: Write the banner component**

```tsx
/**
 * OverdueBanner - banner de aviso para orgs com pagamento em atraso.
 * Mostra dias de graça restantes.
 */

import { AlertTriangle, X } from "lucide-react";
import { useState } from "react";

interface OverdueBannerProps {
  graceRemaining: number;
}

export function OverdueBanner({ graceRemaining }: OverdueBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
          <p className="text-sm text-amber-700 dark:text-amber-400">
            <strong>Pagamento em atraso.</strong>{" "}
            {graceRemaining > 0
              ? `Regularize em até ${graceRemaining} dia${graceRemaining !== 1 ? "s" : ""} para evitar a suspensão da conta.`
              : "Sua conta será suspensa em breve. Regularize o pagamento imediatamente."}
          </p>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="text-amber-500 hover:text-amber-600 shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/subscription/OverdueBanner.tsx
git commit -m "feat: add OverdueBanner component for overdue subscription warning"
```

---

### Task 11: Create SubscriptionBlockedPage component

**Files:**
- Create: `src/components/subscription/SubscriptionBlockedPage.tsx`

- [ ] **Step 1: Write the blocked page**

```tsx
/**
 * SubscriptionBlockedPage - página de bloqueio para orgs com subscription
 * suspensa, cancelada ou expirada.
 */

import { ShieldOff, CreditCard, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SubscriptionBlockedPageProps {
  status: "suspended" | "cancelled" | "expired";
  plan: string | null;
}

const STATUS_CONFIG = {
  suspended: {
    title: "Conta Suspensa",
    description: "Sua conta foi suspensa por falta de pagamento. Regularize para restaurar o acesso.",
    icon: ShieldOff,
    color: "text-destructive",
    bgColor: "bg-destructive/10",
  },
  cancelled: {
    title: "Assinatura Cancelada",
    description: "Sua assinatura foi cancelada. Entre em contato para reativar.",
    icon: CreditCard,
    color: "text-muted-foreground",
    bgColor: "bg-muted",
  },
  expired: {
    title: "Assinatura Expirada",
    description: "Sua assinatura expirou. Renove para continuar usando a plataforma.",
    icon: CreditCard,
    color: "text-amber-500",
    bgColor: "bg-amber-500/10",
  },
};

export function SubscriptionBlockedPage({ status, plan }: SubscriptionBlockedPageProps) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;

  const whatsappUrl = `https://wa.me/5511999999999?text=${encodeURIComponent(
    `Olá, preciso de ajuda com minha assinatura (status: ${status}, plano: ${plan || "N/A"}).`
  )}`;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className={`inline-flex p-4 rounded-full ${config.bgColor}`}>
          <Icon className={`w-12 h-12 ${config.color}`} />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold">{config.title}</h1>
          <p className="text-muted-foreground">{config.description}</p>
        </div>

        {plan && (
          <p className="text-sm text-muted-foreground">
            Plano: <strong className="capitalize">{plan}</strong>
          </p>
        )}

        <div className="flex flex-col gap-3">
          <Button asChild>
            <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="w-4 h-4 mr-2" />
              Falar com Suporte
            </a>
          </Button>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Tentar Novamente
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/subscription/SubscriptionBlockedPage.tsx
git commit -m "feat: add SubscriptionBlockedPage for suspended/cancelled/expired orgs"
```

---

### Task 12: Upgrade SubscriptionProtectedRoute to full lifecycle guard

**Files:**
- Modify: `src/components/SubscriptionProtectedRoute.tsx`

- [ ] **Step 1: Rewrite the component**

Replace the entire file content. The new version:
- Checks subscription for ALL authenticated users (not just copilot routes)
- Shows OverdueBanner for `overdue` status
- Shows SubscriptionBlockedPage for `suspended`/`cancelled`/`expired`
- Master and billing_override orgs bypass all checks
- The `requireActive` prop is kept for backward compat (copilot routes)

```tsx
/**
 * SubscriptionProtectedRoute - guard de lifecycle completo.
 *
 * - Master users bypass everything.
 * - billing_override orgs bypass everything.
 * - 'active' / 'trial' → allowed (trial blocked if requireActive=true and not admin).
 * - 'overdue' → allowed with OverdueBanner warning.
 * - 'suspended' / 'cancelled' / 'expired' → SubscriptionBlockedPage.
 */

import { ReactNode, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  checkCurrentUserSubscription,
  type SubscriptionStatus,
} from "@/lib/subscription";
import { useUserRole, useCanManageCopilot } from "@/hooks/useUserRole";
import { useMasterAuth } from "@/hooks/useMasterAuth";
import { Loader2 } from "lucide-react";
import { OverdueBanner } from "@/components/subscription/OverdueBanner";
import { SubscriptionBlockedPage } from "@/components/subscription/SubscriptionBlockedPage";

interface SubscriptionProtectedRouteProps {
  children: ReactNode;
  requireActive?: boolean;
}

export function SubscriptionProtectedRoute({
  children,
  requireActive = false,
}: SubscriptionProtectedRouteProps) {
  const { user, loading: authLoading } = useAuth();
  const { data: userRole, isLoading: roleLoading } = useUserRole();
  const { isMaster, isLoading: masterLoading } = useMasterAuth();
  const { canManage: canManageCopilot, isLoading: copilotLoading } =
    useCanManageCopilot();
  const [subscription, setSubscription] = useState<SubscriptionStatus | null>(
    null
  );
  const [loading, setLoading] = useState(true);

  const canBypassSubscription =
    isMaster || userRole?.role === "admin" || canManageCopilot;

  useEffect(() => {
    if (isMaster && !masterLoading) {
      setLoading(false);
      return;
    }
    if (!authLoading && !masterLoading && user) {
      checkCurrentUserSubscription()
        .then(setSubscription)
        .catch(() => setSubscription(null))
        .finally(() => setLoading(false));
    } else if (!authLoading && !user) {
      setLoading(false);
    }
  }, [user, authLoading, isMaster, masterLoading]);

  if (authLoading || loading || roleLoading || masterLoading || copilotLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Verificando subscription...</p>
        </div>
      </div>
    );
  }

  // Master bypasses everything
  if (isMaster) {
    return <>{children}</>;
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (!subscription) {
    return <Navigate to="/subscription-required" replace />;
  }

  // Blocked states - full-page block
  if (subscription.isBlocked) {
    return (
      <SubscriptionBlockedPage
        status={subscription.status as "suspended" | "cancelled" | "expired"}
        plan={subscription.plan}
      />
    );
  }

  // Trial + requireActive check (only for premium features like copilot creation)
  if (
    requireActive &&
    subscription.status === "trial" &&
    !canBypassSubscription
  ) {
    return (
      <Navigate to="/subscription-required?reason=trial_expired" replace />
    );
  }

  // Overdue - allow access but show warning banner
  if (subscription.isOverdue) {
    return (
      <>
        <OverdueBanner graceRemaining={subscription.graceRemaining ?? 0} />
        {children}
      </>
    );
  }

  // Active or trial - normal access
  return <>{children}</>;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/SubscriptionProtectedRoute.tsx
git commit -m "feat: upgrade SubscriptionProtectedRoute with full lifecycle guards"
```

---

### Task 13: Wrap all app routes with subscription guard

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Create a SubscriptionLayoutWrapper**

In `App.tsx`, modify the existing `LayoutWrapper` to include the subscription guard. Find the `LayoutWrapper` function (around line 135) and wrap it:

```tsx
function LayoutWrapper({ children }: { children: React.ReactNode }) {
  useAutoAdminAssignment();
  return (
    <OrgFeaturesProvider>
      <OnboardingGate>
        <SubscriptionProtectedRoute>
          <MainLayout>{children}</MainLayout>
        </SubscriptionProtectedRoute>
      </OnboardingGate>
    </OrgFeaturesProvider>
  );
}
```

This is a one-line change - wrapping `<MainLayout>` inside `<SubscriptionProtectedRoute>`. Every route that uses `LayoutWrapper` now gets subscription checking automatically. The import for `SubscriptionProtectedRoute` is already present in App.tsx (line 15).

- [ ] **Step 2: Remove redundant individual SubscriptionProtectedRoute wrappers**

The three copilot routes (lines 523-558) that currently have explicit `<SubscriptionProtectedRoute requireActive>` now need only the `requireActive` variant since the base check is in LayoutWrapper. Update them to avoid double-checking:

For `/copilot/novo`, `/copilot/:id/editar`, and `/copilot/novo-wizard`, change from:

```tsx
<ProtectedRoute>
  <SubscriptionProtectedRoute requireActive>
    <LayoutWrapper>
      <CopilotPlayground />
    </LayoutWrapper>
  </SubscriptionProtectedRoute>
</ProtectedRoute>
```

To:

```tsx
<ProtectedRoute>
  <LayoutWrapper>
    <SubscriptionProtectedRoute requireActive>
      <CopilotPlayground />
    </SubscriptionProtectedRoute>
  </LayoutWrapper>
</ProtectedRoute>
```

This way:
1. `LayoutWrapper` does the base subscription check (shows blocked page or overdue banner)
2. The inner `SubscriptionProtectedRoute requireActive` adds the trial→active check for premium features

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(routing): wrap all routes with subscription lifecycle guard"
```

---

### Task 14: Verify and test the full system

- [ ] **Step 1: Verify TypeScript compiles**

Run:
```bash
cd <repo-root> && npx tsc --noEmit 2>&1 | head -40
```

Fix any type errors found.

- [ ] **Step 2: Verify the app builds**

Run:
```bash
cd <repo-root> && npm run build 2>&1 | tail -20
```

Fix any build errors found.

- [ ] **Step 3: Manual test checklist**

Verify these scenarios:

**Master UI:**
- [ ] Go to `/master/plans` → see 3 Torque plans with correct pricing fields
- [ ] Edit a plan → verify new fields (price_per_user, base_price, discounts) are editable and saveable
- [ ] Open Billing Override modal on an org → verify dropdown shows correct pricing format

**Seat Enforcement:**
- [ ] Go to `/equipe` → see SeatUsageBar with correct counts
- [ ] Try to create a user when at seat limit → button should be disabled, error message shown
- [ ] If org has unlimited seats (-1) → bar shows "Ilimitado", button always enabled

**Subscription Lifecycle:**
- [ ] Org with status `active` → normal access, no banners
- [ ] Org with status `overdue` → access allowed, amber overdue banner shown at top
- [ ] Org with status `suspended` → SubscriptionBlockedPage shown (full block)
- [ ] Org with status `cancelled` → SubscriptionBlockedPage shown (full block)
- [ ] Master user → bypass all checks regardless of org status

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: resolve build and type issues from plans/seats/lifecycle implementation"
```

---

## Dependency Graph

```
Task 1 (Plan type) → Task 2 (PlanEditor) → Task 3 (BillingOverrideModal)
Task 4 (DB migration) → Task 5 (useSeatUsage) → Task 6 (SeatUsageBar) → Task 7 (Equipe integration)
Task 8 (DB lifecycle) → Task 9 (subscription.ts) → Task 10 (OverdueBanner) + Task 11 (BlockedPage) → Task 12 (Route guard) → Task 13 (App.tsx)
Task 13 → Task 14 (Verification)
```

Frentes A (Tasks 1-3), B (Tasks 4-7), and C (Tasks 8-13) can be executed **in parallel** up to their respective dependencies. Task 14 requires all three frentes.


## Links relacionados

- [[Checkout e Planos]]

- [[Visao Geral]]

- [[Gestao de Time]]

- [[Onboarding]]

- [[WhatsApp Evolution]]

- [[Copilot]]

- [[00 - INDEX]]
