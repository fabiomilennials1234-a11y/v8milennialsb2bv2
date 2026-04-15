---
tags:
  - torque-crm
  - spec
  - codebase
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: .specs/codebase/CONVENTIONS.md
---

# Code Conventions

Observed from analysis of 10+ representative files across pages, components, hooks, contexts, and integrations.

## Naming Conventions

**Files:**
- Pages: PascalCase `.tsx` (`Dashboard.tsx`, `Leads.tsx`, `Automacoes.tsx`, `PipeWhatsapp.tsx`)
- Components: PascalCase `.tsx` (`KPICard.tsx`, `KanbanCard.tsx`, `MainLayout.tsx`, `LeadDetailDrawer.tsx`)
- Hooks: camelCase with `use` prefix `.ts` (`useLeads.ts`, `useWorkflows.ts`, `useOrganization.ts`)
- Contexts: PascalCase with `Context` suffix `.tsx` (`AuthContext.tsx`, `OrgFeaturesContext.tsx`)
- Lib utilities: camelCase `.ts` (`utils.ts`, `permissions.ts`, `analytics.ts`)
- Types: camelCase `.ts` (`workflow.ts`, `copilot.ts`)
- UI primitives: kebab-case `.tsx` (`alert-dialog.tsx`, `dropdown-menu.tsx`) -- shadcn convention

**Functions/Methods:**
- React components: PascalCase named exports or default exports (`export default function Dashboard()`, `export function KanbanCard()`)
- Hooks: camelCase with `use` prefix (`useLeads`, `useOrganization`, `useWorkflows`)
- Event handlers: `handle` prefix (`handleSubmit`, `handleOpenDialog`, `handleToggle`, `handleDelete`)
- Mutations from hooks: verb-noun pattern (`createLead`, `updateLead`, `deleteLead`, `toggleWorkflow`)

**Variables:**
- Local state: camelCase (`selectedMonth`, `searchQuery`, `filterOrigin`, `isDialogOpen`, `editingLead`)
- Boolean state: `is` prefix (`isLoading`, `isReady`, `isDialogOpen`, `isImporting`)
- Refs: camelCase (`attachCalledForSession`)

**Constants:**
- Module-level maps: SCREAMING_SNAKE_CASE or camelCase depending on context
  - `LEADS_PAGE_SIZE = 50`, `BATCH_SIZE = 200`, `FETCH_PAGE_SIZE = 1000`
  - `TRIGGER_LABELS`, `TRIGGER_ICONS`, `PIPE_TABLES`, `CAMPAIGN_FEATURE`
  - `originLabels`, `originColors` (camelCase for display-mapping objects)

**Components:**
- Named export for reusable components: `export function KanbanCard()`, `export const KPICard = memo(KPICardBase)`
- Default export for page-level components: `export default function Dashboard()`, `export default function Leads()`
- Provider pattern: `export function AuthProvider({ children })`, `export function OrgFeaturesProvider({ children })`

## Code Organization

**Import ordering:** Observed pattern (not enforced by linter):
1. React core (`useState`, `useMemo`, `useCallback`, `useEffect`)
2. Third-party libraries (`framer-motion`, `lucide-react`, `date-fns`, `sonner`)
3. UI primitives from `@/components/ui/` (grouped by component)
4. Feature components from `@/components/[feature]/`
5. Hooks from `@/hooks/`
6. Contexts from `@/contexts/`
7. Lib utilities from `@/lib/`
8. Integrations from `@/integrations/`
9. Types (inline or from `@/types/`)
10. Relative imports (`./DashboardOutbound`)

Example from `Dashboard.tsx`:
```tsx
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { useOraculoChat } from "@/hooks/useOraculoChat";
import { useAuth } from "@/contexts/AuthContext";
import { useOrganization } from "@/hooks/useOrganization";
import { Skeleton } from "@/components/ui/skeleton";
import DashboardOutbound from "./DashboardOutbound";
```

**File structure (pages):**
1. Imports
2. Module-level constants/types (e.g., `originLabels`, `LeadFormData`)
3. Helper sub-components (inline, not extracted -- e.g., `StarRating` in Leads.tsx)
4. Main component as default export
5. State declarations at top of component
6. Hooks (data fetching, permissions)
7. Derived state (`useMemo`)
8. Event handlers
9. Early returns (loading, permission checks)
10. JSX return

**File structure (hooks):**
1. Imports
2. Exported type aliases (e.g., `export type Lead = Tables<"leads">`)
3. Constants
4. Exported hook functions
5. Internal helper functions (not exported)

## Type Safety

**Approach:** TypeScript throughout. Auto-generated Supabase types (`Tables<"leads">`, `TablesInsert<"leads">`, `TablesUpdate<"leads">`) used as the source of truth for database entities. Manual interfaces for component props and UI-specific shapes.

```tsx
// Auto-generated DB types used directly
export type Lead = Tables<"leads">;
export type LeadInsert = TablesInsert<"leads">;
export type LeadUpdate = TablesUpdate<"leads">;

// Manual interfaces for component props
interface KPICardProps {
  title: string;
  value: number;
  format?: "currency" | "number" | "percent" | "hours" | "minutes";
  icon: LucideIcon;
  trend?: { value: number; isPositive: boolean };
  delay?: number;
}

// Inline interfaces for form data
interface LeadFormData {
  name: string;
  company: string;
  email: string;
  phone: string;
  origin: string;
  rating: number;
  // ...
}
```

Supabase query results often cast with `as unknown as Workflow[]` when the auto-generated types diverge from runtime shape:
```tsx
return data as unknown as Workflow[];
```

Context types defined as interfaces with explicit undefined initial:
```tsx
const AuthContext = createContext<AuthContextType | undefined>(undefined);
```

## Error Handling

**Pattern:** Multi-layered, pragmatic.

1. **Hooks (mutations):** Try/catch in `mutationFn`, error classified by Postgres error code, user-facing toast via `sonner` or `useToast`:
```tsx
} catch (error: any) {
  if (error?.code === '42501' || error?.message?.includes('permission denied')) {
    toast.error("Erro de permissao. Verifique as politicas RLS no Supabase.");
  } else if (error?.code === '23503') {
    toast.error("Erro: organizacao nao encontrada.");
  } else {
    toast.error(`Erro ao salvar lead: ${error?.message || 'Erro desconhecido'}`);
  }
}
```

2. **Hooks (queries):** `if (error) throw error` pattern -- errors bubble to React Query's error boundary or component-level handling.

3. **Optimistic updates:** Full rollback pattern with `onMutate` snapshot + `onError` restore (see `useToggleLeadAI` in `useLeads.ts`).

4. **Permission guards:** Pre-check via `assertIsAdmin()` or `useCanPerformAction()` before mutation. RPC call `user_has_org_permission` for server-side verification.

5. **Console logging:** `console.error` with emoji prefix and structured context for debugging:
```tsx
console.error("Team member sem organization_id:", {
  currentTeamMember,
  hasTeamMember: !!currentTeamMember,
  organizationId: currentTeamMember?.organization_id,
});
```

6. **Silent failures:** External calls (like `attachToOrgByPendingInvite`) wrapped in try/catch with empty catch -- intentionally non-blocking.

7. **Loading states:** Skeleton components rendered during data fetch (not spinners, except for full-page loads which use `Loader2` spinner).

## Comments/Documentation

**Style:** Mixed Portuguese/English. JSDoc-style `/** */` blocks on hooks and exported functions describing purpose and security implications. Inline comments in Portuguese for business logic. Section separators using `// ===` or `// ---` comment blocks.

```tsx
/**
 * Fetch leads filtered by current user's organization -- COM PAGINACAO
 * SECURITY: Always filters by organization_id to ensure data isolation
 */
export function useLeads(page: number = 0) { ... }
```

```tsx
// SECURITY: Always override organization_id with current user's org
// Never trust the organization_id from the input
const securedLead = { ...lead, organization_id: organizationId };
```

```tsx
// PERMISSION: Apenas admin pode criar workflows
await assertIsAdmin();
```

```tsx
// Shadow leads nao aparecem na listagem ate serem promovidos
.or("is_shadow.is.null,is_shadow.eq.false")
```

```tsx
// =====================================================
// EXECUTIONS
// =====================================================
```

Security comments are the most consistent pattern -- `SECURITY:` and `PERMISSION:` prefixes are used throughout hooks to mark authorization-critical code.

## Path Aliasing

All internal imports use `@/` alias (mapped to `src/`):
```tsx
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { cn } from "@/lib/utils";
```

## State Management

- **Server state:** TanStack React Query (`useQuery`, `useMutation`, `useQueryClient`) for all Supabase data. Query keys follow `["entity", organizationId, ...params]` pattern.
- **Client state:** React `useState` for UI state (modals, filters, forms). No Redux/Zustand.
- **Persisted state:** Custom `usePersistedState` hook for filter state across sessions (scoped per org+user, TTL 24h).
- **Auth state:** React Context (`AuthContext`).
- **Feature flags:** React Context (`OrgFeaturesContext`) backed by Supabase RPC.

## UI Patterns

- **Component library:** shadcn/ui primitives from `@/components/ui/` (Radix-based).
- **Animations:** Framer Motion (`motion.div` with `initial/animate/transition`) for page transitions, card reveals, loading states.
- **Icons:** Lucide React exclusively.
- **Toasts:** Dual system -- `sonner` (`toast.success/error`) for simple notifications, Radix `useToast` for richer ones.
- **Styling:** Tailwind utility classes. Design tokens via CSS variables (`text-muted-foreground`, `bg-primary/10`, `text-chart-5`). `cn()` utility for conditional classes.
- **Responsive:** Mobile-first with `sm:`, `md:`, `lg:`, `xl:` breakpoints. Max width constraint at `1600px`.

## Security Conventions

- Every data query filters by `organization_id` from `useOrganization()` -- multi-tenant isolation at the hook level.
- Mutation hooks strip or override `organization_id` from user input to prevent cross-tenant tampering.
- Delete operations verify ownership before proceeding (`eq("organization_id", organizationId)`).
- Permission checks happen both client-side (hooks) and server-side (RPC + RLS).
- Comments explicitly mark security-critical code with `SECURITY:` prefix.

## Links relacionados

- [[MOC - Arquitetura]]

- [[Analise Logging SaaS]]

- [[Permissoes Sistema]]

- [[Dashboard]]

- [[Oraculo Comercial]]

- [[WhatsApp Evolution]]

- [[Copilot]]

- [[00 - INDEX]]
- [[Visao Geral]]
