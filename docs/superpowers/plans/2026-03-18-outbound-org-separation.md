# Outbound Organization Separation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce outbound member visibility restrictions (4 modules only), build a dedicated outbound dashboard with metrics/milestones/badges, add admin milestone configuration, and clean up legacy roles.

**Architecture:** Sidebar filtering is a simple whitelist check on `org_type + role` in `Sidebar.tsx`. Dashboard routing conditionally renders `<DashboardOutbound />` for outbound members. Milestones reuse the existing `badges` table (milestones ARE badges with criteria). Auto-unlock runs client-side on dashboard load.

**Tech Stack:** React, TypeScript, Supabase (PostgREST), TanStack Query, Tailwind CSS, shadcn/ui, Lucide icons.

**Spec:** `docs/superpowers/specs/2026-03-18-outbound-org-separation-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|----------------|
| `src/pages/DashboardOutbound.tsx` | Page component for outbound member dashboard — composes the 3 sections |
| `src/components/dashboard-outbound/OutboundMetricCards.tsx` | 4 metric cards (leads, response rate, meetings, sales) |
| `src/components/dashboard-outbound/MilestoneTracker.tsx` | Speedometer-style monthly milestones list |
| `src/components/dashboard-outbound/BadgeGrid.tsx` | Grid of unlocked/locked badges |
| `src/hooks/useOutboundMetrics.ts` | Queries for leads count, response rate, meetings, sales (current + previous month) |
| `src/hooks/useMilestoneAutoUnlock.ts` | Client-side auto-unlock logic: compare metrics vs badge criteria, insert user_badges |
| `src/components/settings/MilestonesConfig.tsx` | Admin config UI for creating/editing/deleting milestones (badges with criteria) |

### Modified Files
| File | Change |
|------|--------|
| `src/components/layout/Sidebar.tsx` | Add outbound member whitelist filter |
| `src/pages/Dashboard.tsx` | Route to `<DashboardOutbound />` for outbound members |
| `src/pages/Configuracoes.tsx` | Add "Marcos & Badges" tab for outbound admin |
| `src/pages/master/MasterUsers.tsx` | Remove legacy role options (agency/bdr/cliente), use admin/member only |
| `src/hooks/useMasterOrganizations.ts` | Remove DEFAULT_SIDEBAR_PERMISSIONS seeding (no longer needed) |
| `src/hooks/useUserRole.ts` | Remove deprecated `useIsAgency`, `useIsBDR`, `useIsCliente` stubs |

### Unchanged Files (already correct)
| File | Status |
|------|--------|
| `src/pages/Equipe.tsx` | Already uses admin/member only |
| `src/hooks/useBadges.ts` | Already has full CRUD — no changes needed |
| `src/hooks/useOrganization.ts` | Already returns `orgType` |

---

## Task 1: Sidebar Outbound Member Whitelist

**Files:**
- Modify: `src/components/layout/Sidebar.tsx:80-200`

- [ ] **Step 1: Add the outbound member whitelist constant**

After line 106 (`const FUNIS_PATHS = ...`), add:

```typescript
/** Outbound members only see these paths — all others are hidden */
const OUTBOUND_MEMBER_ALLOWED_PATHS = [
  "/",              // Central de Comando (DashboardOutbound)
  "/chat",          // Chat WhatsApp
  "/pipe-whatsapp", // Funil Qualificação
  "/pipe-confirmacao", // Funil Confirmação
  "/pipe-propostas",   // Funil Propostas
  "/funis",            // Funis parent
  "/follow-ups",       // Revisão
] as const;
```

- [ ] **Step 2: Import useOrganization in Sidebar**

At line 42 (imports section), add:

```typescript
import { useOrganization } from "@/hooks/useOrganization";
```

- [ ] **Step 3: Add org context and filter logic inside Sidebar component**

Inside `Sidebar()` function, after line 177 (`const role = userRole?.role;`), add:

```typescript
const { orgType } = useOrganization();
const isOutboundMember = orgType === "outbound" && role === "member";
```

Then modify the rendering of `navItems` — find where `navItems` are mapped/filtered and wrap with:

```typescript
const visibleNavItems = isOutboundMember
  ? navItems.filter((item) =>
      OUTBOUND_MEMBER_ALLOWED_PATHS.some((p) => item.path === p || item.children?.some((c) => OUTBOUND_MEMBER_ALLOWED_PATHS.includes(c.path as any)))
    )
  : navItems;

const visibleAdminItems = isOutboundMember ? [] : adminNavItems;
const visibleBottomItems = isOutboundMember ? [] : bottomNavItems;
```

Replace all references to `navItems`, `adminNavItems`, and `bottomNavItems` in the JSX render with `visibleNavItems`, `visibleAdminItems`, `visibleBottomItems`.

Also filter Funis subitems for outbound members — hide "Carteira" (upsell):

```typescript
const visibleFunisSubItems = isOutboundMember
  ? funisSubItems.filter((s) => OUTBOUND_MEMBER_ALLOWED_PATHS.includes(s.path as any))
  : funisSubItems;
```

- [ ] **Step 4: Test manually**

Log in as a member of an outbound org. Verify:
- Only 4 modules visible: Central de Comando, Chat, Funis (Qualificação/Confirmação/Propostas), Revisão
- No Campanhas, Marketing, Leads, Pódio, Comissões, Copilot, Automações, Pilotos, Produtos, TV, Pitstop
- Log in as admin of outbound org → full sidebar visible
- Log in as CRM user → no change

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/Sidebar.tsx
git commit -m "feat: restrict sidebar for outbound members to 4 allowed modules"
```

---

## Task 2: Outbound Metrics Hook

**Files:**
- Create: `src/hooks/useOutboundMetrics.ts`

- [ ] **Step 1: Create the hook file**

```typescript
/**
 * useOutboundMetrics — Queries dashboard metrics for outbound members
 *
 * Returns current month + previous month values for comparison arrows.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";

export interface OutboundMetrics {
  leadsRecebidos: number;
  leadsRecebidosPrev: number;
  taxaResposta: number;       // 0-100 percentage
  taxaRespostaPrev: number;
  reunioesAgendadas: number;
  reunioesAgendadasPrev: number;
  vendasFechadas: number;
  vendasFechadasPrev: number;
}

function getMonthRange(year: number, month: number) {
  const start = new Date(year, month - 1, 1).toISOString();
  const end = new Date(year, month, 0, 23, 59, 59).toISOString();
  return { start, end };
}

export function useOutboundMetrics() {
  const { organizationId, isReady } = useOrganization();

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;

  return useQuery({
    queryKey: ["outbound-metrics", organizationId, year, month],
    queryFn: async (): Promise<OutboundMetrics> => {
      if (!organizationId) throw new Error("No org");

      const curr = getMonthRange(year, month);
      const prev = getMonthRange(prevYear, prevMonth);

      // 1. Leads recebidos (leads created this month in this org)
      const [leadsNow, leadsPrev] = await Promise.all([
        supabase.from("leads").select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .gte("created_at", curr.start).lte("created_at", curr.end)
          .or("is_shadow.is.null,is_shadow.eq.false"),
        supabase.from("leads").select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .gte("created_at", prev.start).lte("created_at", prev.end)
          .or("is_shadow.is.null,is_shadow.eq.false"),
      ]);

      // 2. Taxa de resposta: leads with at least 1 conversation reply
      const [respondedNow, respondedPrev] = await Promise.all([
        supabase.from("leads").select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .gte("created_at", curr.start).lte("created_at", curr.end)
          .not("last_message_at", "is", null),
        supabase.from("leads").select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .gte("created_at", prev.start).lte("created_at", prev.end)
          .not("last_message_at", "is", null),
      ]);

      const leadsRecebidos = leadsNow.count ?? 0;
      const leadsRecebidosPrev = leadsPrev.count ?? 0;
      const respondidos = respondedNow.count ?? 0;
      const respondidosPrev = respondedPrev.count ?? 0;

      const taxaResposta = leadsRecebidos > 0 ? Math.round((respondidos / leadsRecebidos) * 100) : 0;
      const taxaRespostaPrev = leadsRecebidosPrev > 0 ? Math.round((respondidosPrev / leadsRecebidosPrev) * 100) : 0;

      // 3. Reuniões agendadas (pipe_confirmacao entries this month)
      const [reunioesNow, reunioesPrev] = await Promise.all([
        supabase.from("pipe_confirmacao").select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .gte("created_at", curr.start).lte("created_at", curr.end),
        supabase.from("pipe_confirmacao").select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .gte("created_at", prev.start).lte("created_at", prev.end),
      ]);

      // 4. Vendas fechadas (pipe_propostas with status vendido)
      const [vendasNow, vendasPrev] = await Promise.all([
        supabase.from("pipe_propostas").select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .eq("status", "vendido")
          .gte("created_at", curr.start).lte("created_at", curr.end),
        supabase.from("pipe_propostas").select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .eq("status", "vendido")
          .gte("created_at", prev.start).lte("created_at", prev.end),
      ]);

      return {
        leadsRecebidos,
        leadsRecebidosPrev,
        taxaResposta,
        taxaRespostaPrev,
        reunioesAgendadas: reunioesNow.count ?? 0,
        reunioesAgendadasPrev: reunioesPrev.count ?? 0,
        vendasFechadas: vendasNow.count ?? 0,
        vendasFechadasPrev: vendasPrev.count ?? 0,
      };
    },
    enabled: isReady,
    staleTime: 2 * 60 * 1000,
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useOutboundMetrics.ts
git commit -m "feat: add useOutboundMetrics hook for outbound dashboard"
```

---

## Task 3: Milestone Auto-Unlock Hook

**Files:**
- Create: `src/hooks/useMilestoneAutoUnlock.ts`

- [ ] **Step 1: Create the hook**

```typescript
/**
 * useMilestoneAutoUnlock — Checks if outbound member achieved any milestones
 * and auto-unlocks the corresponding badges.
 *
 * Runs on dashboard load. Compares current month metrics vs badge criteria.
 */

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useBadges, useUserBadges, useUnlockBadge } from "./useBadges";
import { useOutboundMetrics } from "./useOutboundMetrics";
import { useOrganization } from "./useOrganization";

export function useMilestoneAutoUnlock() {
  const { teamMemberId } = useOrganization();
  const { data: badges } = useBadges();
  const { data: userBadges } = useUserBadges(teamMemberId);
  const { data: metrics } = useOutboundMetrics();
  const unlockBadge = useUnlockBadge();
  const checkedRef = useRef(false);

  useEffect(() => {
    if (!badges || !userBadges || !metrics || !teamMemberId || checkedRef.current) return;
    checkedRef.current = true;

    const unlockedIds = new Set(userBadges.map((ub) => ub.badge_id));

    // Map criteria_type to current metric value
    const criteriaMap: Record<string, number> = {
      leads_recebidos: metrics.leadsRecebidos,
      leads_respondidos: metrics.taxaResposta > 0 ? Math.round((metrics.taxaResposta / 100) * metrics.leadsRecebidos) : 0,
      reunioes_agendadas: metrics.reunioesAgendadas,
      vendas_count: metrics.vendasFechadas,
      // faturamento_total requires separate query — skip for now
    };

    for (const badge of badges) {
      if (unlockedIds.has(badge.id)) continue;
      if (!badge.criteria_type || !badge.criteria_value) continue;

      const currentValue = criteriaMap[badge.criteria_type];
      if (currentValue === undefined) continue;

      if (currentValue >= badge.criteria_value) {
        unlockBadge.mutate(
          { badgeId: badge.id, teamMemberId },
          {
            onSuccess: () => {
              toast.success(`Badge desbloqueado: ${badge.name}!`, {
                description: `Parabéns! Você conquistou o marco "${badge.name}"`,
                duration: 8000,
              });
            },
          }
        );
      }
    }
  }, [badges, userBadges, metrics, teamMemberId]);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useMilestoneAutoUnlock.ts
git commit -m "feat: add milestone auto-unlock logic for outbound dashboard"
```

---

## Task 4: Dashboard Outbound Components

**Files:**
- Create: `src/components/dashboard-outbound/OutboundMetricCards.tsx`
- Create: `src/components/dashboard-outbound/MilestoneTracker.tsx`
- Create: `src/components/dashboard-outbound/BadgeGrid.tsx`

- [ ] **Step 1: Create OutboundMetricCards**

```typescript
import { Fuel, MessageSquare, Calendar, DollarSign, TrendingUp, TrendingDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { OutboundMetrics } from "@/hooks/useOutboundMetrics";

interface Props {
  metrics: OutboundMetrics;
}

function Trend({ current, previous }: { current: number; previous: number }) {
  if (previous === 0) return null;
  const diff = current - previous;
  const pct = Math.round((diff / previous) * 100);
  const isUp = diff >= 0;
  return (
    <span className={`flex items-center gap-1 text-xs ${isUp ? "text-green-500" : "text-red-500"}`}>
      {isUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {isUp ? "+" : ""}{pct}%
    </span>
  );
}

const cards = [
  { key: "leadsRecebidos" as const, prevKey: "leadsRecebidosPrev" as const, label: "Leads Recebidos", icon: Fuel, suffix: "" },
  { key: "taxaResposta" as const, prevKey: "taxaRespostaPrev" as const, label: "Taxa de Resposta", icon: MessageSquare, suffix: "%" },
  { key: "reunioesAgendadas" as const, prevKey: "reunioesAgendadasPrev" as const, label: "Reuniões Agendadas", icon: Calendar, suffix: "" },
  { key: "vendasFechadas" as const, prevKey: "vendasFechadasPrev" as const, label: "Vendas Fechadas", icon: DollarSign, suffix: "" },
];

export function OutboundMetricCards({ metrics }: Props) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map(({ key, prevKey, label, icon: Icon, suffix }) => (
        <Card key={key}>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <Icon className="w-5 h-5 text-muted-foreground" />
              <Trend current={metrics[key]} previous={metrics[prevKey]} />
            </div>
            <p className="text-2xl font-bold">{metrics[key]}{suffix}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create MilestoneTracker**

```typescript
import { CheckCircle2, Circle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Badge, UserBadge } from "@/hooks/useBadges";
import { MILESTONE_ICONS } from "./milestone-icons";

interface Props {
  badges: Badge[];
  userBadges: UserBadge[];
}

export function MilestoneTracker({ badges, userBadges }: Props) {
  const unlockedIds = new Set(userBadges.map((ub) => ub.badge_id));
  // Only show badges that have criteria (milestones)
  const milestones = badges.filter((b) => b.criteria_type && b.criteria_value > 0);

  if (milestones.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Marcos do Mês</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Nenhum marco configurado ainda.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Marcos do Mês</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {milestones.map((m) => {
          const achieved = unlockedIds.has(m.id);
          const IconComp = MILESTONE_ICONS[m.icon ?? "target"] ?? MILESTONE_ICONS.target;
          return (
            <div
              key={m.id}
              className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                achieved ? "bg-primary/10 border-primary/30" : "bg-muted/30 border-border"
              }`}
            >
              <IconComp className={`w-5 h-5 ${achieved ? "text-primary" : "text-muted-foreground"}`} />
              <div className="flex-1">
                <p className={`text-sm font-medium ${achieved ? "text-primary" : ""}`}>{m.name}</p>
                {m.description && <p className="text-xs text-muted-foreground">{m.description}</p>}
              </div>
              {achieved ? (
                <CheckCircle2 className="w-5 h-5 text-primary" />
              ) : (
                <Circle className="w-5 h-5 text-muted-foreground/40" />
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Create milestone-icons helper**

Create `src/components/dashboard-outbound/milestone-icons.ts`:

```typescript
import { Flame, Target, Trophy, Star, Zap, Award, Crown, Shield } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const MILESTONE_ICONS: Record<string, LucideIcon> = {
  flame: Flame,
  target: Target,
  trophy: Trophy,
  star: Star,
  zap: Zap,
  award: Award,
  crown: Crown,
  shield: Shield,
};

export const MILESTONE_ICON_OPTIONS = Object.keys(MILESTONE_ICONS);
```

- [ ] **Step 4: Create BadgeGrid**

```typescript
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Badge, UserBadge } from "@/hooks/useBadges";
import { MILESTONE_ICONS } from "./milestone-icons";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Props {
  badges: Badge[];
  userBadges: UserBadge[];
}

export function BadgeGrid({ badges, userBadges }: Props) {
  const unlockedMap = new Map(userBadges.map((ub) => [ub.badge_id, ub.unlocked_at]));

  if (badges.length === 0) return null;

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Badges</CardTitle></CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
          {badges.map((badge) => {
            const unlocked = unlockedMap.has(badge.id);
            const unlockedAt = unlockedMap.get(badge.id);
            const IconComp = MILESTONE_ICONS[badge.icon ?? "target"] ?? MILESTONE_ICONS.target;
            return (
              <div
                key={badge.id}
                className={`flex flex-col items-center gap-1 p-3 rounded-lg border text-center transition-all ${
                  unlocked ? "bg-primary/5 border-primary/30" : "opacity-40 grayscale"
                }`}
                title={unlocked && unlockedAt ? `Conquistado em ${format(new Date(unlockedAt), "dd/MM/yyyy", { locale: ptBR })}` : "Ainda não conquistado"}
              >
                <IconComp className={`w-8 h-8 ${unlocked ? "text-primary" : "text-muted-foreground"}`} />
                <p className="text-xs font-medium leading-tight">{badge.name}</p>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard-outbound/
git commit -m "feat: add outbound dashboard components (metrics, milestones, badges)"
```

---

## Task 5: DashboardOutbound Page + Dashboard Routing

**Files:**
- Create: `src/pages/DashboardOutbound.tsx`
- Modify: `src/pages/Dashboard.tsx:47-80`

- [ ] **Step 1: Create DashboardOutbound page**

```typescript
import { motion } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";
import { useOutboundMetrics } from "@/hooks/useOutboundMetrics";
import { useBadges, useUserBadges } from "@/hooks/useBadges";
import { useOrganization } from "@/hooks/useOrganization";
import { useMilestoneAutoUnlock } from "@/hooks/useMilestoneAutoUnlock";
import { OutboundMetricCards } from "@/components/dashboard-outbound/OutboundMetricCards";
import { MilestoneTracker } from "@/components/dashboard-outbound/MilestoneTracker";
import { BadgeGrid } from "@/components/dashboard-outbound/BadgeGrid";
import { useAuth } from "@/contexts/AuthContext";

export default function DashboardOutbound() {
  const { user } = useAuth();
  const { teamMemberId } = useOrganization();
  const { data: metrics, isLoading: metricsLoading } = useOutboundMetrics();
  const { data: badges = [], isLoading: badgesLoading } = useBadges();
  const { data: userBadges = [] } = useUserBadges(teamMemberId);

  // Auto-unlock milestones on load
  useMilestoneAutoUnlock();

  const userName = user?.user_metadata?.full_name?.split(" ")[0] || "Usuário";
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";

  if (metricsLoading || badgesLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="p-6 space-y-6"
    >
      <h1 className="text-2xl font-bold">
        {greeting}, {userName}
      </h1>

      {metrics && <OutboundMetricCards metrics={metrics} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <MilestoneTracker badges={badges} userBadges={userBadges} />
        <BadgeGrid badges={badges} userBadges={userBadges} />
      </div>
    </motion.div>
  );
}
```

- [ ] **Step 2: Add routing in Dashboard.tsx**

At the top of `Dashboard.tsx`, add import:

```typescript
import DashboardOutbound from "./DashboardOutbound";
```

Then inside `Dashboard()`, after the hooks block (around line 72) and before the greeting function, add an early return:

```typescript
// Outbound members get their own dashboard
if (orgType === "outbound" && role === "member") {
  return <DashboardOutbound />;
}
```

This must come AFTER all hooks are called (Rules of Hooks) but BEFORE the CRM dashboard JSX.

- [ ] **Step 3: Test manually**

- Log in as outbound member → sees DashboardOutbound with metrics, milestones, badges
- Log in as outbound admin → sees standard CRM dashboard
- Log in as CRM user → sees standard CRM dashboard

- [ ] **Step 4: Commit**

```bash
git add src/pages/DashboardOutbound.tsx src/pages/Dashboard.tsx
git commit -m "feat: add DashboardOutbound page and route outbound members to it"
```

---

## Task 6: Milestones Config for Outbound Admin

**Files:**
- Create: `src/components/settings/MilestonesConfig.tsx`
- Modify: `src/pages/Configuracoes.tsx`

- [ ] **Step 1: Create MilestonesConfig component**

```typescript
import { useState } from "react";
import { Plus, Trash2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { useBadges, useCreateBadge, useDeleteBadge } from "@/hooks/useBadges";
import { MILESTONE_ICONS, MILESTONE_ICON_OPTIONS } from "@/components/dashboard-outbound/milestone-icons";

const CRITERIA_TYPES = [
  { value: "leads_recebidos", label: "Leads recebidos" },
  { value: "leads_respondidos", label: "Leads respondidos" },
  { value: "reunioes_agendadas", label: "Reuniões agendadas" },
  { value: "vendas_count", label: "Vendas fechadas" },
  { value: "faturamento_total", label: "Faturamento total (R$)" },
];

export function MilestonesConfig() {
  const { data: badges = [] } = useBadges();
  const createBadge = useCreateBadge();
  const deleteBadge = useDeleteBadge();

  const [name, setName] = useState("");
  const [icon, setIcon] = useState("target");
  const [criteriaType, setCriteriaType] = useState("leads_recebidos");
  const [criteriaValue, setCriteriaValue] = useState("");

  const milestones = badges.filter((b) => !b.is_system);

  const handleCreate = async () => {
    if (!name.trim() || !criteriaValue) {
      toast.error("Preencha nome e valor do marco");
      return;
    }
    try {
      await createBadge.mutateAsync({
        name: name.trim(),
        description: `Meta: ${criteriaValue} ${CRITERIA_TYPES.find((c) => c.value === criteriaType)?.label ?? ""}`,
        icon,
        criteria_type: criteriaType,
        criteria_value: Number(criteriaValue),
      });
      toast.success("Marco criado!");
      setName("");
      setCriteriaValue("");
    } catch (err: any) {
      toast.error("Erro ao criar marco", { description: err?.message });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteBadge.mutateAsync(id);
      toast.success("Marco removido");
    } catch (err: any) {
      toast.error("Erro ao remover", { description: err?.message });
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Criar Novo Marco</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input placeholder="Nome do marco" value={name} onChange={(e) => setName(e.target.value)} />
            <Select value={icon} onValueChange={setIcon}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MILESTONE_ICON_OPTIONS.map((key) => {
                  const Icon = MILESTONE_ICONS[key];
                  return (
                    <SelectItem key={key} value={key}>
                      <div className="flex items-center gap-2"><Icon className="w-4 h-4" />{key}</div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <Select value={criteriaType} onValueChange={setCriteriaType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CRITERIA_TYPES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input type="number" placeholder="Valor alvo" value={criteriaValue} onChange={(e) => setCriteriaValue(e.target.value)} />
          </div>
          <Button onClick={handleCreate} disabled={createBadge.isPending}>
            <Plus className="w-4 h-4 mr-2" />
            {createBadge.isPending ? "Criando..." : "Criar Marco"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Marcos Configurados ({milestones.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {milestones.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum marco criado.</p>
          ) : (
            <div className="space-y-2">
              {milestones.map((m) => {
                const Icon = MILESTONE_ICONS[m.icon ?? "target"] ?? MILESTONE_ICONS.target;
                return (
                  <div key={m.id} className="flex items-center justify-between p-3 rounded-lg border">
                    <div className="flex items-center gap-3">
                      <Icon className="w-5 h-5 text-primary" />
                      <div>
                        <p className="text-sm font-medium">{m.name}</p>
                        <p className="text-xs text-muted-foreground">{m.criteria_type}: {m.criteria_value}</p>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(m.id)}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Add Milestones tab to Configuracoes.tsx**

Import at top:

```typescript
import { MilestonesConfig } from "@/components/settings/MilestonesConfig";
import { useOrganization } from "@/hooks/useOrganization";
```

Inside the component, get org context:

```typescript
const { orgType } = useOrganization();
```

Add a new tab after the existing ones (after the "ajuda" tab, around line 515). Only render when `orgType === "outbound"`:

```typescript
{orgType === "outbound" && (
  <>
    <TabsTrigger value="marcos">Marcos & Badges</TabsTrigger>
    {/* ... in TabsContent area: */}
    <TabsContent value="marcos"><MilestonesConfig /></TabsContent>
  </>
)}
```

- [ ] **Step 3: Test manually**

- Log in as outbound admin → Configurações shows "Marcos & Badges" tab
- Create a milestone → appears in list
- Delete a milestone → removed
- Log in as CRM admin → tab NOT visible

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/MilestonesConfig.tsx src/pages/Configuracoes.tsx
git commit -m "feat: add milestones configuration for outbound admin in settings"
```

---

## Task 7: Role Cleanup in Master Panel

**Files:**
- Modify: `src/pages/master/MasterUsers.tsx:237-249`
- Modify: `src/hooks/useMasterOrganizations.ts:112-206`
- Modify: `src/hooks/useUserRole.ts:165-180`

- [ ] **Step 1: Simplify MasterUsers role selection**

In `MasterUsers.tsx`, find `getRolesForOrgType()` (around line 237) and replace:

```typescript
function getRolesForOrgType(_orgType?: string): { value: string; label: string }[] {
  return [
    { value: "admin", label: "Admin" },
    { value: "member", label: "Membro" },
  ];
}
```

This removes all legacy role options (agency/bdr/cliente). The function parameter is kept for API compatibility but ignored.

- [ ] **Step 2: Remove DEFAULT_SIDEBAR_PERMISSIONS from useMasterOrganizations**

In `useMasterOrganizations.ts`, find `DEFAULT_SIDEBAR_PERMISSIONS` (around line 112-128) and the seeding logic (around line 173-179). Remove or comment out:

- The `DEFAULT_SIDEBAR_PERMISSIONS` constant
- The `client_sidebar_permissions` insert block in the org creation mutation

Keep the badge seeding logic (lines 189-206) — it's still needed for outbound orgs.

- [ ] **Step 3: Remove deprecated role hooks from useUserRole**

In `useUserRole.ts`, find and remove the deprecated hooks (around lines 165-180):

```typescript
// DELETE these:
export function useIsAgency() { ... }
export function useIsBDR() { ... }
export function useIsCliente() { ... }
```

Then search the codebase for imports of these hooks and remove them:

```bash
grep -r "useIsAgency\|useIsBDR\|useIsCliente" src/ --include="*.ts" --include="*.tsx"
```

Remove any imports found.

- [ ] **Step 4: Test manually**

- Master panel → create user in outbound org → only admin/member roles available
- Master panel → create user in CRM org → only admin/member roles available
- No console errors from removed hooks

- [ ] **Step 5: Commit**

```bash
git add src/pages/master/MasterUsers.tsx src/hooks/useMasterOrganizations.ts src/hooks/useUserRole.ts
git commit -m "fix: remove legacy role options and deprecated role hooks"
```

---

## Task 8: Final Integration Test

- [ ] **Step 1: Full flow test as outbound member**

1. Log in as member of outbound org
2. Sidebar shows only: Central de Comando, Chat, Funis (Qualificação/Confirmação/Propostas), Revisão
3. Dashboard shows OutboundMetricCards, MilestoneTracker, BadgeGrid
4. Navigate to Chat → works
5. Navigate to Funis → works
6. Navigate to Follow-ups → works
7. Try navigating to /leads directly in URL → should still work (RLS protects data) but it's not in sidebar

- [ ] **Step 2: Full flow test as outbound admin**

1. Log in as admin of outbound org
2. Sidebar shows ALL modules (full access)
3. Dashboard shows standard CRM dashboard
4. Configurações → "Marcos & Badges" tab visible
5. Create a milestone → appears in milestone list
6. Switch to member view (different user) → milestone visible in dashboard

- [ ] **Step 3: Full flow test as CRM user**

1. Log in as CRM admin or member
2. Sidebar unchanged from current behavior
3. Dashboard unchanged
4. Configurações → NO "Marcos & Badges" tab

- [ ] **Step 4: Push to develop**

```bash
git push origin develop
```
