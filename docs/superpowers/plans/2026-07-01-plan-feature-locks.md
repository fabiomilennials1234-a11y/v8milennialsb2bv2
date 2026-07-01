# Cadeados de feature por plano — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bloquear features fora do plano da org em 3 superfícies (sidebar, rota, in-page) com um padrão único de cadeado + upsell, mais backstop server-side nos writes que geram custo.

**Architecture:** `OrgFeaturesContext.hasFeature` é a fonte de verdade no frontend. Um helper puro deriva `feature → plano mínimo` de `subscription_plans.features`. Componentes reusáveis (`FeatureLock`, `FeatureRoute`, `UpgradeModal` v2) consomem isso. No backend, `org_has_feature()` (reusa `org_get_features_and_limits`) protege edge functions e triggers de INSERT.

**Tech Stack:** React 18 + TS, TanStack Query v5, Vitest + @testing-library/react, Supabase (Postgres RPC/triggers + Deno edge functions).

---

## File Structure

**Novos (frontend):**
- `src/modules/platform/lib/feature-unlock.ts` — helper puro `computeFeatureUnlockPlan`
- `src/modules/platform/components/feature-lock/FeatureLock.tsx` — wrapper de cadeado in-page
- `src/modules/platform/components/feature-lock/FeatureRoute.tsx` — route guard
- `src/modules/platform/components/feature-lock/FeatureLockedScreen.tsx` — tela cheia de upgrade
- `src/modules/platform/components/feature-lock/index.ts` — barrel interno

**Modificados (frontend):**
- `src/contexts/OrgFeaturesContext.tsx` — expõe `featureUnlockPlan`
- `src/shared/components/UpgradeModal.tsx` — v2 (deriva plano-alvo do DB)
- `src/modules/platform/index.ts` — exporta os novos componentes
- `src/modules/platform/components/layout/TopNavigation.tsx` — consome `FeatureLock`/modal v2
- `src/App.tsx` — envolve rotas gated em `FeatureRoute`

**Novos (backend):**
- `supabase/migrations/20270103000000_org_has_feature_and_guards.sql` — função + triggers
- `supabase/functions/_shared/assert-org-feature.ts` — helper Deno

**Modificados (backend):**
- `supabase/functions/mass-send-create/index.ts` — guard `whatsapp_bulk`
- `supabase/functions/cadastro-externo-push/index.ts` — guard `external_cadastro`

**Tests:**
- `tests/unit/feature-unlock.test.ts`
- `tests/unit/feature-lock.test.tsx`
- `tests/unit/feature-route.test.tsx`
- `tests/unit/org-features-context.test.ts` (atualizar mock existente)

---

## Task 1: Helper puro `computeFeatureUnlockPlan`

Deriva, para cada feature key presente em algum plano ativo, o plano mais barato (menor `position`) que a oferece.

**Files:**
- Create: `src/modules/platform/lib/feature-unlock.ts`
- Test: `tests/unit/feature-unlock.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/feature-unlock.test.ts
import { describe, it, expect } from "vitest";
import { computeFeatureUnlockPlan, type ActivePlan } from "@/modules/platform/lib/feature-unlock";

const PLANS: ActivePlan[] = [
  { name: "torque-1.0", display_name: "Torque Base", position: 10, features: { leads: true, funnels: true, chat: false, copilot: false } },
  { name: "torque-2.0", display_name: "Torque Automation", position: 20, features: { leads: true, funnels: true, chat: true, whatsapp_bulk: true, copilot: false } },
  { name: "torque-v8", display_name: "Torque Copilot", position: 30, features: { leads: true, funnels: true, chat: true, whatsapp_bulk: true, copilot: true, oraculo: true } },
];

describe("computeFeatureUnlockPlan", () => {
  it("maps a feature to the cheapest active plan that offers it", () => {
    const map = computeFeatureUnlockPlan(PLANS);
    expect(map.leads).toEqual({ name: "torque-1.0", display_name: "Torque Base" });
    expect(map.chat).toEqual({ name: "torque-2.0", display_name: "Torque Automation" });
    expect(map.copilot).toEqual({ name: "torque-v8", display_name: "Torque Copilot" });
  });

  it("ignores features that no plan offers (returns undefined)", () => {
    const map = computeFeatureUnlockPlan(PLANS);
    expect(map.oraculo).toEqual({ name: "torque-v8", display_name: "Torque Copilot" });
    expect(map.white_label).toBeUndefined();
  });

  it("returns an empty map for no plans", () => {
    expect(computeFeatureUnlockPlan([])).toEqual({});
  });

  it("treats only strict boolean true as offered", () => {
    const map = computeFeatureUnlockPlan([
      { name: "p", display_name: "P", position: 1, features: { x: "yes" as unknown as boolean, y: true } },
    ]);
    expect(map.x).toBeUndefined();
    expect(map.y).toEqual({ name: "p", display_name: "P" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- feature-unlock`
Expected: FAIL — `Cannot find module '@/modules/platform/lib/feature-unlock'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/modules/platform/lib/feature-unlock.ts
/**
 * Deriva, para cada feature key oferecida por algum plano ativo, o plano
 * mais barato (menor position) que a desbloqueia. Fonte de verdade para a
 * mensagem de upgrade ("disponível no Torque Automation").
 */

export interface ActivePlan {
  name: string;
  display_name: string;
  position: number;
  features: Record<string, boolean>;
}

export interface UnlockPlan {
  name: string;
  display_name: string;
}

export type FeatureUnlockMap = Record<string, UnlockPlan>;

export function computeFeatureUnlockPlan(plans: ActivePlan[]): FeatureUnlockMap {
  const sorted = [...plans].sort((a, b) => a.position - b.position);
  const map: FeatureUnlockMap = {};
  for (const plan of sorted) {
    for (const [key, enabled] of Object.entries(plan.features ?? {})) {
      if (enabled === true && !(key in map)) {
        map[key] = { name: plan.name, display_name: plan.display_name };
      }
    }
  }
  return map;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- feature-unlock`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/modules/platform/lib/feature-unlock.ts tests/unit/feature-unlock.test.ts
git commit -m "feat(platform): feature-unlock plan derivation helper"
```

---

## Task 2: `OrgFeaturesContext` expõe `featureUnlockPlan`

Adiciona uma segunda query (planos ativos, leitura direta — a policy `subscription_plans_select` já libera `authenticated`) e expõe o mapa.

**Files:**
- Modify: `src/contexts/OrgFeaturesContext.tsx`
- Test: `tests/unit/org-features-context.test.ts` (atualizar mock)

- [ ] **Step 1: Update the existing test mock + add a test**

No topo de `tests/unit/org-features-context.test.ts`, o mock do supabase só tem `rpc`. Substituir o bloco `vi.mock("@/integrations/supabase/client", ...)` por:

```ts
const mockRpc = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

// Query builder chainável que resolve na lista de planos ativos
function makeActivePlansQuery(plans: unknown[]) {
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.order = () => Promise.resolve({ data: plans, error: null });
  return builder;
}
```

No `beforeEach`, após `mockRpc.mockResolvedValue(...)`, adicionar:

```ts
mockFrom.mockReturnValue(
  makeActivePlansQuery([
    { name: "torque-2.0", display_name: "Torque Automation", position: 20, features: { chat: true } },
    { name: "torque-v8", display_name: "Torque Copilot", position: 30, features: { chat: true, copilot: true } },
  ])
);
```

Adicionar o teste ao final do `describe`:

```ts
it("exposes featureUnlockPlan derived from active plans", async () => {
  const qc = createQueryClient();
  const { result } = renderHook(() => useOrgFeatures(), { wrapper: createWrapper(qc) });

  await waitFor(() => expect(result.current.isReady).toBe(true));
  await waitFor(() =>
    expect(result.current.featureUnlockPlan.chat).toEqual({ name: "torque-2.0", display_name: "Torque Automation" })
  );
  expect(result.current.featureUnlockPlan.copilot).toEqual({ name: "torque-v8", display_name: "Torque Copilot" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- org-features-context`
Expected: FAIL — `featureUnlockPlan` is undefined on the context value.

- [ ] **Step 3: Implement — add query + expose map**

Em `src/contexts/OrgFeaturesContext.tsx`:

Adicionar import no topo:

```ts
import { computeFeatureUnlockPlan, type FeatureUnlockMap, type ActivePlan } from "@/modules/platform/lib/feature-unlock";
```

Adicionar ao `OrgFeaturesContextType` (após `allLimits`):

```ts
  /** Mapa feature → plano mínimo que a desbloqueia (para o UpgradeModal) */
  featureUnlockPlan: FeatureUnlockMap;
```

Dentro de `OrgFeaturesProvider`, após a query `data` existente, adicionar:

```ts
  const { data: activePlans } = useQuery<ActivePlan[]>({
    queryKey: ["active-plans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscription_plans")
        .select("name, display_name, position, features")
        .eq("is_active", true)
        .order("position");
      if (error) throw error;
      return (data ?? []) as unknown as ActivePlan[];
    },
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });
```

No `useMemo`, computar o mapa e incluí-lo no objeto retornado. Alterar a assinatura do `useMemo` para depender de `activePlans` também:

```ts
  const value = useMemo<OrgFeaturesContextType>(() => {
    const features = data?.features ?? {};
    const limits = data?.limits ?? {};
    const planName = data?.plan_name ?? "free";
    const isLoading = orgLoading || queryLoading;
    const isReady = !isLoading && !!data;
    const featureUnlockPlan = computeFeatureUnlockPlan(activePlans ?? []);

    return {
      // ...todos os campos existentes inalterados...
      featureUnlockPlan,
    };
  }, [data, orgLoading, queryLoading, activePlans]);
```

(Manter todos os helpers existentes — `hasFeature`, `checkLimit`, `canCreateCampaign`, etc. — sem alteração; apenas acrescentar `featureUnlockPlan` ao objeto e `activePlans` às deps.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- org-features-context`
Expected: PASS (todos, incluindo o novo)

- [ ] **Step 5: Commit**

```bash
git add src/contexts/OrgFeaturesContext.tsx tests/unit/org-features-context.test.ts
git commit -m "feat(platform): expose featureUnlockPlan from OrgFeaturesContext"
```

---

## Task 3: `UpgradeModal` v2 — deriva plano-alvo do DB

API nova: recebe `featureKey`; deriva label (de `FEATURES`) e plano-alvo (de `featureUnlockPlan`). Remove `PLAN_LABELS` legado e o número hardcoded.

**Files:**
- Modify: `src/shared/components/UpgradeModal.tsx`
- Test: `tests/unit/upgrade-modal.test.tsx` (Create)

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/upgrade-modal.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { UpgradeModal } from "@/shared/components/UpgradeModal";

vi.mock("@/contexts/OrgFeaturesContext", () => ({
  useOrgFeatures: () => ({
    planName: "torque-1.0",
    featureUnlockPlan: { copilot: { name: "torque-v8", display_name: "Torque Copilot" } },
  }),
}));

describe("UpgradeModal v2", () => {
  it("names the target plan that unlocks the feature", () => {
    render(<UpgradeModal open onOpenChange={() => {}} featureKey="copilot" />);
    expect(screen.getByText(/Torque Copilot/)).toBeInTheDocument();
  });

  it("shows the feature label from the registry", () => {
    render(<UpgradeModal open onOpenChange={() => {}} featureKey="copilot" />);
    // FEATURES: copilot → label "Copilot"
    expect(screen.getByText(/Copilot/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- upgrade-modal`
Expected: FAIL — `UpgradeModal` still requires `featureLabel` prop / no target plan text.

- [ ] **Step 3: Rewrite `UpgradeModal.tsx`**

```tsx
// src/shared/components/UpgradeModal.tsx
/**
 * UpgradeModal v2 — incentivo a upgrade quando o usuário toca uma feature
 * bloqueada pelo plano. Deriva o plano-alvo de featureUnlockPlan (DB).
 */

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles, Lock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useOrgFeatures } from "@/contexts/OrgFeaturesContext";
import { getFeatureMeta, type FeatureKey } from "@/modules/platform/lib/feature-registry";

interface UpgradeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  featureKey: FeatureKey;
}

export function UpgradeModal({ open, onOpenChange, featureKey }: UpgradeModalProps) {
  const navigate = useNavigate();
  const { featureUnlockPlan } = useOrgFeatures();

  const meta = getFeatureMeta(featureKey);
  const featureLabel = meta?.label ?? featureKey;
  const target = featureUnlockPlan[featureKey];
  const targetName = target?.display_name;

  const handleUpgrade = () => {
    const url = import.meta.env.VITE_UPGRADE_CONTACT_URL as string | undefined;
    if (url) {
      window.open(url, "_blank", "noopener");
    } else {
      // Fallback: configurações (aba de plano — a construir em slice futura)
      navigate("/configuracoes");
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center justify-center mb-3">
            <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Lock className="h-6 w-6 text-primary" />
            </div>
          </div>
          <DialogTitle className="text-xl text-center" style={{ letterSpacing: "-0.02em" }}>
            Desbloqueie {featureLabel}
          </DialogTitle>
          <DialogDescription className="text-center">
            {targetName
              ? <>Esse recurso está disponível no plano <strong>{targetName}</strong>.</>
              : <>Esse recurso não está disponível no seu plano atual.</>}
            {meta?.description && (
              <span className="block mt-1 text-muted-foreground">{meta.description}</span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-2">
          <p className="text-sm font-medium">
            {targetName
              ? <>Faça upgrade para o {targetName} e libere {featureLabel} e os demais recursos do plano.</>
              : <>Fale com nosso time para liberar {featureLabel}.</>}
          </p>
          <p className="text-xs text-muted-foreground">Nosso time resolve rápido.</p>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Voltar</Button>
          <Button
            className="gradient-primary gradient-primary-hover text-white font-semibold border-0"
            onClick={handleUpgrade}
          >
            <Sparkles className="w-4 h-4 mr-2" />
            {targetName ? `Fazer upgrade` : "Falar com Comercial"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- upgrade-modal`
Expected: PASS (2 tests)

> NOTE: quebra os call-sites antigos que passavam `featureLabel`/`featureDescription` (TopNavigation). Corrigido na Task 7. Se o `tsc`/build rodar entre tasks, esperar erro de tipo em TopNavigation até lá.

- [ ] **Step 5: Commit**

```bash
git add src/shared/components/UpgradeModal.tsx tests/unit/upgrade-modal.test.tsx
git commit -m "feat(platform): UpgradeModal v2 derives target plan from DB"
```

---

## Task 4: `<FeatureLock>` — cadeado in-page reusável

**Files:**
- Create: `src/modules/platform/components/feature-lock/FeatureLock.tsx`
- Create: `src/modules/platform/components/feature-lock/index.ts`
- Test: `tests/unit/feature-lock.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/feature-lock.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FeatureLock } from "@/modules/platform/components/feature-lock/FeatureLock";

let mockFeatures = { hasFeature: (_k: string) => true, isReady: true, featureUnlockPlan: {} as Record<string, unknown> };
vi.mock("@/contexts/OrgFeaturesContext", () => ({
  useOrgFeatures: () => mockFeatures,
}));

function renderLock(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("FeatureLock", () => {
  it("renders children untouched when the feature is unlocked", () => {
    mockFeatures = { hasFeature: () => true, isReady: true, featureUnlockPlan: {} };
    renderLock(<FeatureLock feature="copilot">Copilot</FeatureLock>);
    expect(screen.getByText("Copilot")).toBeInTheDocument();
    expect(screen.queryByTestId("feature-lock-icon")).not.toBeInTheDocument();
  });

  it("renders a padlock and blocks the click when locked", () => {
    mockFeatures = { hasFeature: () => false, isReady: true, featureUnlockPlan: {} };
    const onClick = vi.fn();
    renderLock(
      <FeatureLock feature="copilot">
        <button onClick={onClick}>Copilot</button>
      </FeatureLock>
    );
    expect(screen.getByTestId("feature-lock-icon")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Copilot"));
    expect(onClick).not.toHaveBeenCalled(); // click interceptado
    expect(screen.getByRole("dialog")).toBeInTheDocument(); // UpgradeModal abriu
  });

  it("does not lock while features are still loading", () => {
    mockFeatures = { hasFeature: () => false, isReady: false, featureUnlockPlan: {} };
    renderLock(<FeatureLock feature="copilot">Copilot</FeatureLock>);
    expect(screen.queryByTestId("feature-lock-icon")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- feature-lock`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `FeatureLock.tsx`**

```tsx
// src/modules/platform/components/feature-lock/FeatureLock.tsx
import { useState, type ReactNode, type MouseEvent } from "react";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOrgFeatures } from "@/contexts/OrgFeaturesContext";
import { UpgradeModal } from "@/shared/components/UpgradeModal";
import type { FeatureKey } from "@/modules/platform/lib/feature-registry";

type Variant = "inline" | "wrapper" | "iconOnly";

interface FeatureLockProps {
  feature: FeatureKey;
  children: ReactNode;
  variant?: Variant;
  className?: string;
}

/**
 * Envolve qualquer conteúdo gated. Feature liberada → renderiza children.
 * Bloqueada → adiciona cadeado, intercepta o click e abre o UpgradeModal.
 * Enquanto features carregam (!isReady) → não trava (evita flash de cadeado).
 */
export function FeatureLock({ feature, children, variant = "inline", className }: FeatureLockProps) {
  const { hasFeature, isReady } = useOrgFeatures();
  const [modalOpen, setModalOpen] = useState(false);

  const locked = isReady && !hasFeature(feature);

  if (!locked) return <>{children}</>;

  const intercept = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setModalOpen(true);
  };

  const icon = <Lock data-testid="feature-lock-icon" className="w-3 h-3 text-amber-500 shrink-0" />;

  return (
    <>
      <span
        onClickCapture={intercept}
        aria-disabled
        className={cn(
          "inline-flex items-center gap-1.5",
          variant !== "iconOnly" && "[&_*]:pointer-events-none cursor-not-allowed opacity-90",
          className
        )}
      >
        {variant !== "iconOnly" && children}
        {icon}
      </span>
      <UpgradeModal open={modalOpen} onOpenChange={setModalOpen} featureKey={feature} />
    </>
  );
}
```

- [ ] **Step 4: Create the internal barrel**

```ts
// src/modules/platform/components/feature-lock/index.ts
export { FeatureLock } from "./FeatureLock";
export { FeatureRoute } from "./FeatureRoute";
export { FeatureLockedScreen } from "./FeatureLockedScreen";
```

> NOTE: `FeatureRoute`/`FeatureLockedScreen` são criados na Task 5. Se rodar `tsc` entre tasks, o barrel quebra até lá — deixar o barrel só com `FeatureLock` até a Task 5 se preferir commits verdes. Alternativa: commitar o barrel completo na Task 5.

Para manter commits verdes, nesta task o barrel exporta só `FeatureLock`:

```ts
// src/modules/platform/components/feature-lock/index.ts
export { FeatureLock } from "./FeatureLock";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:unit -- feature-lock`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add src/modules/platform/components/feature-lock/ tests/unit/feature-lock.test.tsx
git commit -m "feat(platform): FeatureLock in-page padlock component"
```

---

## Task 5: `<FeatureRoute>` + `<FeatureLockedScreen>` — route guard

**Files:**
- Create: `src/modules/platform/components/feature-lock/FeatureLockedScreen.tsx`
- Create: `src/modules/platform/components/feature-lock/FeatureRoute.tsx`
- Modify: `src/modules/platform/components/feature-lock/index.ts`
- Test: `tests/unit/feature-route.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// tests/unit/feature-route.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FeatureRoute } from "@/modules/platform/components/feature-lock/FeatureRoute";

let mockFeatures = { hasFeature: (_k: string) => true, isReady: true, featureUnlockPlan: {} as Record<string, unknown> };
vi.mock("@/contexts/OrgFeaturesContext", () => ({
  useOrgFeatures: () => mockFeatures,
}));

function renderRoute(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("FeatureRoute", () => {
  it("renders the module when the feature is unlocked", () => {
    mockFeatures = { hasFeature: () => true, isReady: true, featureUnlockPlan: {} };
    renderRoute(<FeatureRoute feature="copilot"><div>MODULE</div></FeatureRoute>);
    expect(screen.getByText("MODULE")).toBeInTheDocument();
  });

  it("renders the locked screen instead of the module when locked", () => {
    mockFeatures = { hasFeature: () => false, isReady: true, featureUnlockPlan: {} };
    renderRoute(<FeatureRoute feature="copilot"><div>MODULE</div></FeatureRoute>);
    expect(screen.queryByText("MODULE")).not.toBeInTheDocument();
    expect(screen.getByTestId("feature-locked-screen")).toBeInTheDocument();
  });

  it("renders the module while loading (no flash of lock)", () => {
    mockFeatures = { hasFeature: () => false, isReady: false, featureUnlockPlan: {} };
    renderRoute(<FeatureRoute feature="copilot"><div>MODULE</div></FeatureRoute>);
    expect(screen.getByText("MODULE")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- feature-route`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `FeatureLockedScreen.tsx`**

```tsx
// src/modules/platform/components/feature-lock/FeatureLockedScreen.tsx
import { Lock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useOrgFeatures } from "@/contexts/OrgFeaturesContext";
import { getFeatureMeta, type FeatureKey } from "@/modules/platform/lib/feature-registry";

/** Tela cheia mostrada no lugar de um módulo bloqueado (route guard). */
export function FeatureLockedScreen({ feature }: { feature: FeatureKey }) {
  const navigate = useNavigate();
  const { featureUnlockPlan } = useOrgFeatures();
  const meta = getFeatureMeta(feature);
  const label = meta?.label ?? feature;
  const target = featureUnlockPlan[feature]?.display_name;

  const handleUpgrade = () => {
    const url = import.meta.env.VITE_UPGRADE_CONTACT_URL as string | undefined;
    if (url) window.open(url, "_blank", "noopener");
    else navigate("/configuracoes");
  };

  return (
    <div
      data-testid="feature-locked-screen"
      className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6"
    >
      <div className="h-16 w-16 rounded-2xl bg-amber-500/10 flex items-center justify-center mb-5">
        <Lock className="h-8 w-8 text-amber-500" />
      </div>
      <h2 className="text-2xl font-semibold tracking-tight mb-2">{label} está bloqueado</h2>
      <p className="text-muted-foreground max-w-md mb-6">
        {target
          ? <>Disponível no plano <strong>{target}</strong>. {meta?.description}</>
          : <>Esse recurso não está no seu plano atual. {meta?.description}</>}
      </p>
      <Button
        className="gradient-primary gradient-primary-hover text-white font-semibold border-0"
        onClick={handleUpgrade}
      >
        <Sparkles className="w-4 h-4 mr-2" />
        {target ? "Fazer upgrade" : "Falar com Comercial"}
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Implement `FeatureRoute.tsx`**

```tsx
// src/modules/platform/components/feature-lock/FeatureRoute.tsx
import type { ReactNode } from "react";
import { useOrgFeatures } from "@/contexts/OrgFeaturesContext";
import { SIDEBAR_FEATURE_MAP, type FeatureKey } from "@/modules/platform/lib/feature-registry";
import { FeatureLockedScreen } from "./FeatureLockedScreen";

interface FeatureRouteProps {
  children: ReactNode;
  /** Feature key explícita. Se ausente, resolve por `path` via SIDEBAR_FEATURE_MAP. */
  feature?: FeatureKey;
  path?: string;
}

/**
 * Envolve uma rota. Feature liberada (ou ainda carregando) → renderiza o
 * módulo. Bloqueada → renderiza FeatureLockedScreen. Fecha o bypass de URL.
 */
export function FeatureRoute({ children, feature, path }: FeatureRouteProps) {
  const { hasFeature, isReady } = useOrgFeatures();
  const key = feature ?? (path ? SIDEBAR_FEATURE_MAP[path] : undefined);

  // Sem feature key mapeada → rota não é gated.
  if (!key) return <>{children}</>;
  // Ainda carregando → não bloqueia (evita flash).
  if (!isReady) return <>{children}</>;
  if (hasFeature(key)) return <>{children}</>;

  return <FeatureLockedScreen feature={key} />;
}
```

- [ ] **Step 5: Update the internal barrel to full**

```ts
// src/modules/platform/components/feature-lock/index.ts
export { FeatureLock } from "./FeatureLock";
export { FeatureRoute } from "./FeatureRoute";
export { FeatureLockedScreen } from "./FeatureLockedScreen";
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test:unit -- feature-route`
Expected: PASS (3 tests)

- [ ] **Step 7: Commit**

```bash
git add src/modules/platform/components/feature-lock/ tests/unit/feature-route.test.tsx
git commit -m "feat(platform): FeatureRoute guard + FeatureLockedScreen"
```

---

## Task 6: Exporta no barrel do módulo + envolve rotas gated em `App.tsx`

**Files:**
- Modify: `src/modules/platform/index.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Export from the module barrel**

Em `src/modules/platform/index.ts`, adicionar (junto aos demais exports de components):

```ts
export { FeatureLock, FeatureRoute, FeatureLockedScreen } from "./components/feature-lock";
export { computeFeatureUnlockPlan } from "./lib/feature-unlock";
export type { FeatureUnlockMap, UnlockPlan, ActivePlan } from "./lib/feature-unlock";
```

- [ ] **Step 2: Import `FeatureRoute` in `App.tsx`**

Adicionar ao import existente de `@/modules/platform` (ou criar um import nomeado):

```ts
import { FeatureRoute } from "@/modules/platform";
```

- [ ] **Step 3: Wrap the gated routes**

Em `src/App.tsx`, envolver o `element` de cada rota gated com `<FeatureRoute feature="...">`. Aplicar às rotas cujo path está em `SIDEBAR_FEATURE_MAP`. Exemplos (manter os wrappers de auth/layout existentes por fora; só o conteúdo do módulo entra no `FeatureRoute`):

```tsx
// Copilot
<Route path="/copilot" element={<FeatureRoute feature="copilot"><Copilot /></FeatureRoute>} />
// Chat WhatsApp
<Route path="/chat-whatsapp" element={<FeatureRoute feature="chat"><ChatWhatsApp /></FeatureRoute>} />
// Carteira / Upsell
<Route path="/upsell" element={<FeatureRoute feature="carteira"><Upsell /></FeatureRoute>} />
// Analytics
<Route path="/analytics" element={<FeatureRoute feature="analytics"><AnalyticsPage /></FeatureRoute>} />
// Templates
<Route path="/templates" element={<FeatureRoute feature="message_templates"><MessageTemplates /></FeatureRoute>} />
// Negócios
<Route path="/negocios" element={<FeatureRoute feature="deals"><Negocios /></FeatureRoute>} />
// TV Dashboard
<Route path="/tv" element={<FeatureRoute feature="tv_dashboard"><TVDashboard /></FeatureRoute>} />
```

Regras:
- Só envolver rotas cujo módulo é gated por plano. NÃO envolver `/`, `/auth`, `/configuracoes`, rotas master (`/master/*`), onboarding.
- Para os pipes de funil (`/pipe-whatsapp`, `/pipe-confirmacao`, `/pipe-propostas`, `/funis`) usar `feature="funnels"`.
- Preservar quaisquer wrappers existentes (`ProtectedRoute`, layout) — `FeatureRoute` fica por dentro deles, envolvendo só o componente de página.

- [ ] **Step 4: Manual verification**

Run: `npm run build`
Expected: build passa (sem erros de tipo). Confere que os `element` gated compilam com `FeatureRoute`.

- [ ] **Step 5: Commit**

```bash
git add src/modules/platform/index.ts src/App.tsx
git commit -m "feat(platform): gate module routes with FeatureRoute (closes URL bypass)"
```

---

## Task 7: `TopNavigation` consome `FeatureLock` + modal v2

Remove a lógica manual de `<Lock>` + `handleLockedClick` + a chamada antiga do `UpgradeModal` (que passava `featureLabel`). Passa a usar `FeatureLock variant="inline"` nos itens de nav e o modal v2 por dentro dele.

**Files:**
- Modify: `src/modules/platform/components/layout/TopNavigation.tsx`

- [ ] **Step 1: Replace the UpgradeModal call site**

O `UpgradeModal` no fim do componente (linhas ~997-1001) passava `featureLabel`/`description`. Como agora cada item bloqueado usa `FeatureLock` (que tem seu próprio modal por feature), remover o `UpgradeModal` global e o estado `upgradeModal`/`setUpgradeModal` e `handleLockedClick`.

Remover:
```tsx
const [upgradeModal, setUpgradeModal] = useState<{ open: boolean; label: string; description?: string }>({ open: false, label: "" });
// ...
const handleLockedClick = (e, label) => { ... setUpgradeModal(...) };
// ...
<UpgradeModal open={upgradeModal.open} onOpenChange={...} featureLabel={...} .../>
```

- [ ] **Step 2: Render nav items through FeatureLock**

Para cada item de nav, quando `isLocked(item.path)` for true, envolver o label com `FeatureLock` usando a feature key resolvida por `SIDEBAR_FEATURE_MAP[item.path]`. Criar um helper local:

```tsx
import { FeatureLock } from "@/modules/platform/components/feature-lock";
import { SIDEBAR_FEATURE_MAP, type FeatureKey } from "@/modules/platform/lib/feature-registry";

// resolve a feature key de um path (inclui sub-itens de funil)
const featureForPath = (path: string): FeatureKey | undefined => SIDEBAR_FEATURE_MAP[path];
```

Substituir os blocos que hoje renderizam manualmente `<Lock className="text-amber-500..."/>` + `onClick={(e) => handleLockedClick(e, label)}` por:

```tsx
{locked ? (
  <FeatureLock feature={featureForPath(item.path)!} variant="inline">
    <span className="flex items-center gap-2">{item.icon}{item.label}</span>
  </FeatureLock>
) : (
  /* render normal do item (Link/NavLink existente) */
)}
```

Aplicar o mesmo padrão a TODOS os pontos que hoje usam `isLocked` + `<Lock>` (itens top-level, filhos, admin — as ocorrências nas linhas ~428, 461, 548, 583, 615, 667, 715, 749, 882). O `FeatureLock` cuida do cadeado + click + modal; o código manual sai.

- [ ] **Step 3: Verify build + existing behavior**

Run: `npm run build`
Expected: passa. `Lock` import antigo pode ficar não usado — remover se o lint acusar.

Run: `npm run test:unit`
Expected: suíte verde (nenhum teste de TopNavigation quebrado; se houver, ajustar seletor para o `data-testid="feature-lock-icon"`).

- [ ] **Step 4: Commit**

```bash
git add src/modules/platform/components/layout/TopNavigation.tsx
git commit -m "refactor(platform): TopNavigation uses FeatureLock for plan gating"
```

---

## Task 8: Migration `org_has_feature` + triggers de INSERT

Função definer (reusa `org_get_features_and_limits` para bater com o frontend) + `search_path` pinado. Triggers `BEFORE INSERT` nas 3 tabelas cujo write gera custo e é feito por insert direto do frontend.

**Files:**
- Create: `supabase/migrations/20270103000000_org_has_feature_and_guards.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 20270103000000_org_has_feature_and_guards.sql
-- Backstop server-side de gating por plano.
--
-- org_has_feature reusa org_get_features_and_limits (mesma resolução que o
-- frontend: plano base + organization_features overrides + feature_flags
-- default), então nunca diverge do hasFeature do cliente.
-- search_path pinado (classe dos 58 definers — hardening).

CREATE OR REPLACE FUNCTION public.org_has_feature(p_org_id uuid, p_feature_key text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, extensions
AS $$
  SELECT COALESCE(
    (public.org_get_features_and_limits(p_org_id) -> 'features' ->> p_feature_key)::boolean,
    false
  );
$$;

COMMENT ON FUNCTION public.org_has_feature(uuid, text) IS
  'True se a org tem a feature liberada no plano (reusa org_get_features_and_limits).';

-- ── Trigger genérico de guard de INSERT ──────────────────────
-- Cada trigger passa a feature_key esperada via TG_ARGV[0].
CREATE OR REPLACE FUNCTION public.enforce_feature_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_feature text := TG_ARGV[0];
BEGIN
  IF NOT public.org_has_feature(NEW.organization_id, v_feature) THEN
    RAISE EXCEPTION 'feature_locked: % indisponível no plano da organização', v_feature
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- copilot_agents → feature "copilot"
DROP TRIGGER IF EXISTS trg_enforce_feature_copilot ON public.copilot_agents;
CREATE TRIGGER trg_enforce_feature_copilot
  BEFORE INSERT ON public.copilot_agents
  FOR EACH ROW EXECUTE FUNCTION public.enforce_feature_on_insert('copilot');

-- custom_pipelines → feature "funnels_custom"
DROP TRIGGER IF EXISTS trg_enforce_feature_custom_funnels ON public.custom_pipelines;
CREATE TRIGGER trg_enforce_feature_custom_funnels
  BEFORE INSERT ON public.custom_pipelines
  FOR EACH ROW EXECUTE FUNCTION public.enforce_feature_on_insert('funnels_custom');

-- message_templates → feature "message_templates"
DROP TRIGGER IF EXISTS trg_enforce_feature_templates ON public.message_templates;
CREATE TRIGGER trg_enforce_feature_templates
  BEFORE INSERT ON public.message_templates
  FOR EACH ROW EXECUTE FUNCTION public.enforce_feature_on_insert('message_templates');
```

> Pré-condição a verificar antes de aplicar: `copilot_agents`, `custom_pipelines`, `message_templates` têm coluna `organization_id`. As três são multi-tenant (confirmado no data model). Se alguma usar outro nome, ajustar o trigger (ou usar uma versão específica que leia a coluna certa).

- [ ] **Step 2: Apply to DEV and smoke-test**

Run:
```bash
supabase db push --linked --project-ref bcfadphgsibjzivtbjvc
```
Expected: migration aplica sem erro.

> Se DEV estiver com quota 402 (ver memory `project_dev_supabase_quota_restricted`), aplicar via Management API com o token `sbp_` (segunda linha do `.env.development`), endpoint `POST /v1/projects/<ref>/database/query`, header `User-Agent` obrigatório.

- [ ] **Step 3: Manual matrix check (read-only)**

Rodar via `mcp__torque-mcp__db_read_sql` (ou psql) contra uma org sabidamente em plano Base e outra em Copilot:

```sql
SELECT
  public.org_has_feature('<org-base-uuid>', 'copilot')   AS base_copilot,   -- espera false
  public.org_has_feature('<org-v8-uuid>',   'copilot')   AS v8_copilot,     -- espera true
  public.org_has_feature('<org-base-uuid>', 'leads')     AS base_leads;     -- espera true
```
Expected: `base_copilot=false`, `v8_copilot=true`, `base_leads=true`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20270103000000_org_has_feature_and_guards.sql
git commit -m "feat(billing): org_has_feature + INSERT guards for plan-gated writes"
```

---

## Task 9: Guards nas edge functions que queimam dinheiro

Helper Deno compartilhado + guard no topo dos handlers de `mass-send-create` (whatsapp_bulk) e `cadastro-externo-push` (external_cadastro).

**Files:**
- Create: `supabase/functions/_shared/assert-org-feature.ts`
- Modify: `supabase/functions/mass-send-create/index.ts`
- Modify: `supabase/functions/cadastro-externo-push/index.ts`

- [ ] **Step 1: Implement the shared helper**

```ts
// supabase/functions/_shared/assert-org-feature.ts
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/** Erro lançado quando a org não tem a feature liberada. */
export class FeatureLockedError extends Error {
  constructor(public feature: string) {
    super(`feature_locked: ${feature}`);
    this.name = "FeatureLockedError";
  }
}

/**
 * Lança FeatureLockedError se a org não tiver a feature no plano.
 * Usa o client service_role para chamar a RPC org_has_feature.
 */
export async function assertOrgFeature(
  admin: SupabaseClient,
  organizationId: string,
  feature: string,
): Promise<void> {
  const { data, error } = await admin.rpc("org_has_feature", {
    p_org_id: organizationId,
    p_feature_key: feature,
  });
  if (error) throw error;
  if (data !== true) throw new FeatureLockedError(feature);
}
```

- [ ] **Step 2: Guard `mass-send-create`**

Em `supabase/functions/mass-send-create/index.ts`, após resolver o `organization_id` autenticado (e o client admin/service_role já existente) e ANTES de criar o job de disparo, inserir:

```ts
import { assertOrgFeature, FeatureLockedError } from "../_shared/assert-org-feature.ts";

// ...dentro do handler, após ter organizationId + admin client:
try {
  await assertOrgFeature(admin, organizationId, "whatsapp_bulk");
} catch (e) {
  if (e instanceof FeatureLockedError) {
    return new Response(
      JSON.stringify({ error: "feature_locked", feature: "whatsapp_bulk" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  throw e;
}
```

Usar o objeto de headers CORS já existente no arquivo (`corsHeaders`/`getCorsHeaders(req)` conforme o padrão do arquivo).

- [ ] **Step 3: Guard `cadastro-externo-push`**

Mesmo padrão em `supabase/functions/cadastro-externo-push/index.ts`, com a feature `"external_cadastro"`:

```ts
import { assertOrgFeature, FeatureLockedError } from "../_shared/assert-org-feature.ts";

try {
  await assertOrgFeature(admin, organizationId, "external_cadastro");
} catch (e) {
  if (e instanceof FeatureLockedError) {
    return new Response(
      JSON.stringify({ error: "feature_locked", feature: "external_cadastro" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  throw e;
}
```

- [ ] **Step 4: Typecheck the edge functions**

Run:
```bash
deno check supabase/functions/mass-send-create/index.ts supabase/functions/cadastro-externo-push/index.ts
```
Expected: sem erros de tipo.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/assert-org-feature.ts supabase/functions/mass-send-create/index.ts supabase/functions/cadastro-externo-push/index.ts
git commit -m "feat(billing): server-side feature guard on mass-send + cadastro-externo"
```

---

## Task 10: Full suite + PR

- [ ] **Step 1: Run the whole unit suite**

Run: `npm run test:unit`
Expected: verde. Reportar counts literais do runner.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: passa.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: sem erros novos (remover imports órfãos, ex. `Lock` antigo em TopNavigation).

- [ ] **Step 4: Push + PR**

```bash
git push -u origin feat/plan-feature-locks
gh pr create --base main --head feat/plan-feature-locks --title "feat(billing): cadeados de feature por plano" --body "Ver docs/superpowers/specs/2026-07-01-plan-feature-locks-design.md"
```

> Deploy (edge functions + migration em prod) é MANUAL e exige autorização explícita do CTO na sessão. NÃO aplicar em prod dentro do fluxo de execução deste plano.

---

## Deferred (follow-up, fora deste ciclo)

- Aba "Plano" rica em `Configuracoes` (comparação Base/Automation/Copilot + histórico) — hoje o `UpgradeModal` v2 cobre o upsell.
- Migração dos ~16 call-sites in-page restantes para `FeatureLock` (só os críticos entram agora; resto conforme forem tocados).
- `VITE_UPGRADE_CONTACT_URL` — CTO define o destino final (WhatsApp comercial ou aba de plano).
- Estender triggers de guard a funis temporários se virarem tabela própria.
