# Split A/B Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the Split A/B node from a blind random router into a traceable experiment with persistent assignment, per-variant funnel metrics, and a comparison dashboard.

**Architecture:** Two new DB tables (`workflow_split_assignments` for sticky lead-to-variant mapping, `workflow_split_events` for funnel tracking). The executor records assignment + downstream events. A Postgres RPC aggregates metrics. The frontend adds a `SplitAbAnalytics` panel inside `AutomacoesExecucoes`.

**Tech Stack:** Supabase (Postgres + Edge Functions/Deno), React, TanStack Query, shadcn/ui, Recharts (already in project).

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `supabase/migrations/20260831000000_workflow_split_ab_analytics.sql` | Tables, indexes, RLS, aggregation RPC |
| Modify | `supabase/functions/_shared/workflow-executor.ts` | Sticky assignment, event recording |
| Create | `src/hooks/useSplitAbMetrics.ts` | Frontend hook to call metrics RPC |
| Create | `src/components/automacoes/SplitAbAnalytics.tsx` | Variant comparison dashboard component |
| Modify | `src/pages/AutomacoesExecucoes.tsx` | Integrate analytics panel |
| Modify | `src/types/workflow.ts` | Add metric types |

---

### Task 1: Database Migration — Tables, RLS, Indexes, and RPC

**Files:**
- Create: `supabase/migrations/20260831000000_workflow_split_ab_analytics.sql`

- [ ] **Step 1: Create the migration file with assignment table**

```sql
-- =====================================================
-- Split A/B Analytics — assignment + events + metrics RPC
-- =====================================================

-- 1. Sticky assignments: one variant per lead per split node
CREATE TABLE IF NOT EXISTS public.workflow_split_assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workflow_id     UUID NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  node_id         TEXT NOT NULL,
  lead_id         UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  variant_id      TEXT NOT NULL,
  variant_label   TEXT NOT NULL,
  execution_id    UUID NOT NULL REFERENCES public.workflow_executions(id) ON DELETE CASCADE,
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workflow_id, node_id, lead_id)
);

CREATE INDEX idx_wsa_org       ON public.workflow_split_assignments(organization_id);
CREATE INDEX idx_wsa_workflow  ON public.workflow_split_assignments(workflow_id);
CREATE INDEX idx_wsa_node      ON public.workflow_split_assignments(workflow_id, node_id);
CREATE INDEX idx_wsa_lead      ON public.workflow_split_assignments(lead_id);
CREATE INDEX idx_wsa_variant   ON public.workflow_split_assignments(workflow_id, node_id, variant_id);

-- 2. Funnel events: what happened AFTER a lead entered a variant path
CREATE TABLE IF NOT EXISTS public.workflow_split_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  assignment_id   UUID NOT NULL REFERENCES public.workflow_split_assignments(id) ON DELETE CASCADE,
  execution_id    UUID NOT NULL REFERENCES public.workflow_executions(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL,
  node_id         TEXT,
  node_type       TEXT,
  metadata        JSONB DEFAULT '{}'::JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wse_assignment ON public.workflow_split_events(assignment_id);
CREATE INDEX idx_wse_org        ON public.workflow_split_events(organization_id);
CREATE INDEX idx_wse_type       ON public.workflow_split_events(event_type);

-- 3. RLS
ALTER TABLE public.workflow_split_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_split_events ENABLE ROW LEVEL SECURITY;

-- Assignments RLS
CREATE POLICY "wsa_select" ON public.workflow_split_assignments FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "wsa_insert" ON public.workflow_split_assignments FOR INSERT
  WITH CHECK (organization_id IN (
    SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "wsa_service_role" ON public.workflow_split_assignments FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Events RLS
CREATE POLICY "wse_select" ON public.workflow_split_events FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "wse_insert" ON public.workflow_split_events FOR INSERT
  WITH CHECK (organization_id IN (
    SELECT organization_id FROM public.team_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "wse_service_role" ON public.workflow_split_events FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
```

- [ ] **Step 2: Add the aggregation RPC to the same migration file**

Append after the RLS policies:

```sql
-- 4. Metrics RPC — aggregates assignment + execution funnel per variant
CREATE OR REPLACE FUNCTION public.get_split_ab_metrics(
  p_workflow_id UUID,
  p_node_id    TEXT,
  p_org_id     UUID
)
RETURNS TABLE (
  variant_id       TEXT,
  variant_label    TEXT,
  total_leads      BIGINT,
  total_executions BIGINT,
  messages_sent    BIGINT,
  completed        BIGINT,
  failed           BIGINT,
  waiting_response BIGINT,
  in_progress      BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  WITH assignments AS (
    SELECT
      a.variant_id,
      a.variant_label,
      a.lead_id,
      a.execution_id
    FROM public.workflow_split_assignments a
    WHERE a.workflow_id = p_workflow_id
      AND a.node_id    = p_node_id
      AND a.organization_id = p_org_id
  ),
  exec_status AS (
    SELECT
      a.variant_id,
      a.variant_label,
      a.execution_id,
      we.status
    FROM assignments a
    JOIN public.workflow_executions we ON we.id = a.execution_id
  ),
  msg_counts AS (
    SELECT
      a.variant_id,
      COUNT(DISTINCT e.id) AS cnt
    FROM assignments a
    JOIN public.workflow_split_events e
      ON e.assignment_id IN (
        SELECT sa.id FROM public.workflow_split_assignments sa
        WHERE sa.workflow_id = p_workflow_id
          AND sa.node_id = p_node_id
          AND sa.organization_id = p_org_id
          AND sa.variant_id = a.variant_id
      )
      AND e.event_type = 'message_sent'
    GROUP BY a.variant_id
  )
  SELECT
    es.variant_id,
    es.variant_label,
    COUNT(DISTINCT a2.lead_id)::BIGINT AS total_leads,
    COUNT(DISTINCT es.execution_id)::BIGINT AS total_executions,
    COALESCE(mc.cnt, 0)::BIGINT AS messages_sent,
    COUNT(DISTINCT es.execution_id) FILTER (WHERE es.status = 'completed')::BIGINT AS completed,
    COUNT(DISTINCT es.execution_id) FILTER (WHERE es.status IN ('failed', 'loop_limit_reached'))::BIGINT AS failed,
    COUNT(DISTINCT es.execution_id) FILTER (WHERE es.status = 'waiting_response')::BIGINT AS waiting_response,
    COUNT(DISTINCT es.execution_id) FILTER (WHERE es.status IN ('running', 'processing', 'paused'))::BIGINT AS in_progress
  FROM exec_status es
  JOIN assignments a2 ON a2.variant_id = es.variant_id
  LEFT JOIN msg_counts mc ON mc.variant_id = es.variant_id
  GROUP BY es.variant_id, es.variant_label, mc.cnt
  ORDER BY total_leads DESC;
$$;

COMMENT ON FUNCTION public.get_split_ab_metrics IS
  'Returns per-variant funnel metrics for a split A/B node. Filters by org for multi-tenant safety.';
```

- [ ] **Step 3: Verify migration file is complete and syntactically correct**

Review the full file for typos, missing semicolons, or broken references.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260831000000_workflow_split_ab_analytics.sql
git commit -m "feat(db): add split A/B assignment, events tables and metrics RPC"
```

---

### Task 2: Executor — Sticky Assignment + Event Recording

**Files:**
- Modify: `supabase/functions/_shared/workflow-executor.ts:286-336` (split_ab case)
- Modify: `supabase/functions/_shared/workflow-executor.ts:140-158` (action case — add event recording)

- [ ] **Step 1: Add helper functions at the bottom of workflow-executor.ts**

Add before the closing of the file (after `resolveWebhookBody`):

```typescript
/**
 * Resolve or create a sticky split assignment for a lead.
 * If the lead was already assigned to a variant in this split node,
 * return the same variant (deterministic). Otherwise, do weighted
 * random selection and persist.
 */
async function resolveOrCreateSplitAssignment(
  supabase: SupabaseClient,
  params: {
    organizationId: string;
    workflowId: string;
    nodeId: string;
    leadId: string;
    executionId: string;
    variants: { id: string; label: string; percentage: number }[];
  },
): Promise<{ variant: { id: string; label: string; percentage: number }; roll: number | null; reused: boolean }> {
  const { organizationId, workflowId, nodeId, leadId, executionId, variants } = params;

  // 1. Check existing assignment
  const { data: existing } = await supabase
    .from("workflow_split_assignments")
    .select("variant_id, variant_label")
    .eq("workflow_id", workflowId)
    .eq("node_id", nodeId)
    .eq("lead_id", leadId)
    .maybeSingle();

  if (existing) {
    // Find the variant in current config (it may have been renamed but id is stable)
    const matched = variants.find(v => v.id === existing.variant_id);
    if (matched) {
      return { variant: matched, roll: null, reused: true };
    }
    // Variant was deleted from config — fall through to new assignment
  }

  // 2. Weighted random selection
  const roll = Math.random() * 100;
  let cumulative = 0;
  let chosenVariant = variants[0];
  for (const v of variants) {
    cumulative += v.percentage;
    if (roll < cumulative) {
      chosenVariant = v;
      break;
    }
  }

  // 3. Persist assignment (upsert to handle race conditions)
  await supabase
    .from("workflow_split_assignments")
    .upsert({
      organization_id: organizationId,
      workflow_id: workflowId,
      node_id: nodeId,
      lead_id: leadId,
      variant_id: chosenVariant.id,
      variant_label: chosenVariant.label,
      execution_id: executionId,
    }, { onConflict: "workflow_id,node_id,lead_id" });

  return { variant: chosenVariant, roll: Math.round(roll * 100) / 100, reused: false };
}

/**
 * Record a split funnel event (message_sent, action_completed, action_failed, etc.)
 */
async function recordSplitEvent(
  supabase: SupabaseClient,
  params: {
    organizationId: string;
    workflowId: string;
    nodeId: string;
    leadId: string;
    executionId: string;
    eventType: string;
    stepNodeId?: string;
    stepNodeType?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    // Find the assignment for this execution path
    const { data: assignment } = await supabase
      .from("workflow_split_assignments")
      .select("id")
      .eq("workflow_id", params.workflowId)
      .eq("lead_id", params.leadId)
      .limit(1)
      .maybeSingle();

    if (!assignment) return; // Lead not in a split — skip

    await supabase.from("workflow_split_events").insert({
      organization_id: params.organizationId,
      assignment_id: assignment.id,
      execution_id: params.executionId,
      event_type: params.eventType,
      node_id: params.stepNodeId || null,
      node_type: params.stepNodeType || null,
      metadata: params.metadata || {},
    });
  } catch (err) {
    console.warn("[workflow-executor] Failed to record split event:", err);
  }
}
```

- [ ] **Step 2: Replace the split_ab case in the main switch (lines 286-336)**

Replace the entire `case "split_ab"` block with:

```typescript
        case "split_ab": {
          // Support both new variants[] format and legacy splitPercentA format
          let variants: { id: string; label: string; percentage: number }[];

          if (Array.isArray(node.data.variants) && (node.data.variants as any[]).length > 0) {
            variants = node.data.variants as { id: string; label: string; percentage: number }[];
          } else {
            // Legacy migration: convert splitPercentA to 2-variant format
            const percentA = Number(node.data.splitPercentA) || 50;
            variants = [
              { id: "a", label: (node.data.variantALabel as string) || "A", percentage: percentA },
              { id: "b", label: (node.data.variantBLabel as string) || "B", percentage: 100 - percentA },
            ];
          }

          // Sticky assignment: same lead always gets same variant in this split
          const { variant: chosenVariant, roll, reused } = await resolveOrCreateSplitAssignment(
            supabase,
            {
              organizationId,
              workflowId: params.workflowId,
              nodeId: nodeId,
              leadId,
              executionId,
              variants,
            },
          );

          // Find the edge matching this variant
          const outEdges = edgeMap.get(nodeId) || [];
          let nextNodeId: string | undefined;

          // Try exact match first: variant_{id}
          const exactEdge = outEdges.find(e => e.sourceHandle === `variant_${chosenVariant.id}`);
          if (exactEdge) {
            nextNodeId = exactEdge.target;
          } else {
            // Legacy fallback: sourceHandle contains the variant id (e.g., "a" or "b")
            const legacyEdge = outEdges.find(e =>
              e.sourceHandle?.toLowerCase().includes(chosenVariant.id.toLowerCase())
            );
            nextNodeId = legacyEdge?.target || outEdges[0]?.target;
          }

          await recordStep(supabase, executionId, node, "success",
            { variants, variantCount: variants.length },
            {
              chosenVariant: chosenVariant.label,
              chosenVariantId: chosenVariant.id,
              roll,
              reused,
              nextNodeId: nextNodeId || null,
            },
          );

          if (!nextNodeId) {
            console.warn(`[workflow-executor] split_ab node ${nodeId}: no edge found for variant ${chosenVariant.id}, skipping`);
          } else {
            nextNodes.push(nextNodeId);
          }
          break;
        }
```

- [ ] **Step 3: Add event recording to the action case (after line 149)**

Inside the `case "action"` block, after `await recordStep(...)`, add event recording for message-type actions. Find the line `nextNodes.push(...getNextNodes(nodeId, edgeMap));` (line 156) and insert BEFORE it:

```typescript
          // Record split funnel event if this action is a message
          const actionType = (node.data.actionType as string) || "";
          if (actionType === "send_message" || actionType === "send_template" || actionType === "send_media") {
            await recordSplitEvent(supabase, {
              organizationId,
              workflowId: params.workflowId,
              nodeId,
              leadId,
              executionId,
              eventType: result.success ? "message_sent" : "message_failed",
              stepNodeId: nodeId,
              stepNodeType: node.type,
            });
          }
```

- [ ] **Step 4: Add the workflowId to the ExecuteWorkflowParams destructuring**

At line 60, add `workflowId` to the destructured params (it's already in the interface but not destructured — it's used via `params.workflowId` in the `processExecution` call). In the destructuring at line 60-68, `workflowId` is NOT listed. Add it:

Change:
```typescript
  const {
    supabase,
    executionId,
    organizationId,
    leadId,
    definition,
    loopLimit,
    context,
  } = params;
```

To:
```typescript
  const {
    supabase,
    executionId,
    workflowId,
    organizationId,
    leadId,
    definition,
    loopLimit,
    context,
  } = params;
```

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/workflow-executor.ts
git commit -m "feat(executor): add sticky split assignment and funnel event recording"
```

---

### Task 3: TypeScript Types for Metrics

**Files:**
- Modify: `src/types/workflow.ts` (append after `distributePercentages`)

- [ ] **Step 1: Add the SplitAbMetrics type**

Append after the `distributePercentages` function (after line 403):

```typescript
/** Metrics returned by get_split_ab_metrics RPC */
export interface SplitAbVariantMetrics {
  variant_id: string;
  variant_label: string;
  total_leads: number;
  total_executions: number;
  messages_sent: number;
  completed: number;
  failed: number;
  waiting_response: number;
  in_progress: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types/workflow.ts
git commit -m "feat(types): add SplitAbVariantMetrics interface"
```

---

### Task 4: Frontend Hook — useSplitAbMetrics

**Files:**
- Create: `src/hooks/useSplitAbMetrics.ts`

- [ ] **Step 1: Create the hook file**

```typescript
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import type { SplitAbVariantMetrics } from "@/types/workflow";

export function useSplitAbMetrics(workflowId: string | undefined, nodeId: string | undefined) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["split-ab-metrics", workflowId, nodeId, organizationId],
    queryFn: async () => {
      if (!workflowId || !nodeId || !organizationId) return [];

      const { data, error } = await supabase.rpc("get_split_ab_metrics", {
        p_workflow_id: workflowId,
        p_node_id: nodeId,
        p_org_id: organizationId,
      });

      if (error) throw error;
      return (data || []) as SplitAbVariantMetrics[];
    },
    enabled: isReady && !!organizationId && !!workflowId && !!nodeId,
    refetchInterval: 30_000, // Auto-refresh every 30s
  });
}

export function useSplitAbNodes(workflowId: string | undefined) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["split-ab-nodes", workflowId, organizationId],
    queryFn: async () => {
      if (!workflowId || !organizationId) return [];

      const { data: workflow, error } = await supabase
        .from("workflows")
        .select("definition")
        .eq("id", workflowId)
        .eq("organization_id", organizationId)
        .maybeSingle();

      if (error || !workflow) return [];

      const definition = workflow.definition as { nodes: Array<{ id: string; type: string; data: Record<string, unknown> }> };
      return (definition.nodes || [])
        .filter(n => n.type === "split_ab")
        .map(n => ({
          id: n.id,
          label: (n.data.label as string) || "Split A/B",
        }));
    },
    enabled: isReady && !!organizationId && !!workflowId,
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useSplitAbMetrics.ts
git commit -m "feat(hooks): add useSplitAbMetrics and useSplitAbNodes hooks"
```

---

### Task 5: Analytics UI Component — SplitAbAnalytics

**Files:**
- Create: `src/components/automacoes/SplitAbAnalytics.tsx`

- [ ] **Step 1: Create the analytics component**

```tsx
import { useState } from "react";
import { useSplitAbMetrics, useSplitAbNodes } from "@/hooks/useSplitAbMetrics";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { FlaskConical, Users, CheckCircle2, XCircle, Clock, MessageSquare, TrendingUp } from "lucide-react";
import type { SplitAbVariantMetrics } from "@/types/workflow";

interface SplitAbAnalyticsProps {
  workflowId: string;
}

export default function SplitAbAnalytics({ workflowId }: SplitAbAnalyticsProps) {
  const { data: splitNodes, isLoading: isLoadingNodes } = useSplitAbNodes(workflowId);
  const [selectedNodeId, setSelectedNodeId] = useState<string>("");

  // Auto-select first split node
  const nodeId = selectedNodeId || splitNodes?.[0]?.id || "";
  const { data: metrics, isLoading: isLoadingMetrics } = useSplitAbMetrics(workflowId, nodeId || undefined);

  if (isLoadingNodes) {
    return <Skeleton className="h-48 w-full" />;
  }

  if (!splitNodes?.length) {
    return null; // No split nodes in this workflow — hide panel entirely
  }

  const totalLeads = metrics?.reduce((s, m) => s + m.total_leads, 0) ?? 0;
  const totalExecs = metrics?.reduce((s, m) => s + m.total_executions, 0) ?? 0;

  // Determine best-performing variant by completion rate
  const withRates = (metrics || []).map(m => ({
    ...m,
    completionRate: m.total_executions > 0 ? (m.completed / m.total_executions) * 100 : 0,
    failureRate: m.total_executions > 0 ? (m.failed / m.total_executions) * 100 : 0,
  }));
  const bestVariant = withRates.length > 0
    ? withRates.reduce((best, curr) => curr.completionRate > best.completionRate ? curr : best)
    : null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-5 w-5 text-purple-500" />
          <h3 className="text-lg font-semibold">Split A/B — Experimento</h3>
        </div>

        {splitNodes.length > 1 && (
          <Select value={nodeId} onValueChange={setSelectedNodeId}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Selecionar split" />
            </SelectTrigger>
            <SelectContent>
              {splitNodes.map(n => (
                <SelectItem key={n.id} value={n.id}>{n.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {isLoadingMetrics ? (
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : !metrics?.length ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Nenhuma execucao registrada para este split ainda.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Summary row */}
          <div className="grid grid-cols-3 gap-4">
            <SummaryCard icon={Users} label="Leads totais" value={totalLeads} />
            <SummaryCard icon={MessageSquare} label="Execucoes" value={totalExecs} />
            {bestVariant && bestVariant.total_executions > 0 && (
              <Card className="border-green-200 bg-green-50/50">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <TrendingUp className="h-4 w-4 text-green-600" />
                    Melhor variante
                  </div>
                  <p className="text-xl font-bold text-green-700 mt-1">{bestVariant.variant_label}</p>
                  <p className="text-xs text-green-600">{bestVariant.completionRate.toFixed(1)}% concluidos</p>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Variant comparison cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {withRates.map(variant => (
              <VariantCard
                key={variant.variant_id}
                variant={variant}
                isBest={bestVariant?.variant_id === variant.variant_id && withRates.length > 1}
                totalLeads={totalLeads}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon className="h-4 w-4" />
          {label}
        </div>
        <p className="text-2xl font-bold mt-1">{value}</p>
      </CardContent>
    </Card>
  );
}

function VariantCard({
  variant,
  isBest,
  totalLeads,
}: {
  variant: SplitAbVariantMetrics & { completionRate: number; failureRate: number };
  isBest: boolean;
  totalLeads: number;
}) {
  const trafficShare = totalLeads > 0 ? ((variant.total_leads / totalLeads) * 100).toFixed(1) : "0.0";

  return (
    <Card className={isBest ? "border-green-300 ring-1 ring-green-200" : ""}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            {variant.variant_label}
            {isBest && <Badge variant="outline" className="text-green-700 border-green-300 text-xs">Melhor</Badge>}
          </CardTitle>
          <Badge variant="secondary" className="text-xs">{trafficShare}% do trafego</Badge>
        </div>
        <CardDescription>{variant.total_leads} leads | {variant.total_executions} execucoes</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Funnel bars */}
        <FunnelRow icon={MessageSquare} label="Mensagens enviadas" value={variant.messages_sent} color="text-blue-600" />
        <FunnelRow icon={CheckCircle2} label="Concluidos" value={variant.completed} color="text-green-600" pct={variant.completionRate} />
        <FunnelRow icon={XCircle} label="Falhas" value={variant.failed} color="text-red-600" pct={variant.failureRate} />
        <FunnelRow icon={Clock} label="Aguardando resposta" value={variant.waiting_response} color="text-yellow-600" />
        <FunnelRow icon={Clock} label="Em andamento" value={variant.in_progress} color="text-blue-400" />
      </CardContent>
    </Card>
  );
}

function FunnelRow({
  icon: Icon,
  label,
  value,
  color,
  pct,
}: {
  icon: typeof CheckCircle2;
  label: string;
  value: number;
  color: string;
  pct?: number;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <div className="flex items-center gap-2">
        <Icon className={`h-3.5 w-3.5 ${color}`} />
        <span className="text-muted-foreground">{label}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="font-medium">{value}</span>
        {pct !== undefined && <span className="text-xs text-muted-foreground">({pct.toFixed(1)}%)</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/automacoes/SplitAbAnalytics.tsx
git commit -m "feat(ui): add SplitAbAnalytics comparison dashboard component"
```

---

### Task 6: Integrate Analytics into AutomacoesExecucoes

**Files:**
- Modify: `src/pages/AutomacoesExecucoes.tsx`

- [ ] **Step 1: Add the import at the top of AutomacoesExecucoes.tsx**

After the existing imports (after line 23), add:

```typescript
import SplitAbAnalytics from "@/components/automacoes/SplitAbAnalytics";
```

- [ ] **Step 2: Add the analytics panel between the stats summary and the executions table**

After the closing `</div>` of the stats summary grid (after line 101), add:

```tsx
      {/* Split A/B Analytics */}
      {id && <SplitAbAnalytics workflowId={id} />}
```

- [ ] **Step 3: Enhance the StepsDialog to show split variant info nicely**

In the `StepsDialog` component, find the `output_data` rendering block (lines 250-254). Replace the generic JSON render with a conditional for split_ab steps:

```tsx
                    {step.node_type === "split_ab" && step.output_data && (
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className="text-xs">
                          Variante: {(step.output_data as any).chosenVariant}
                        </Badge>
                        {(step.output_data as any).reused && (
                          <Badge variant="secondary" className="text-xs">Reutilizada</Badge>
                        )}
                        {(step.output_data as any).roll != null && (
                          <span className="text-xs text-muted-foreground">
                            Roll: {(step.output_data as any).roll}
                          </span>
                        )}
                      </div>
                    )}

                    {step.node_type !== "split_ab" && step.output_data && Object.keys(step.output_data).length > 0 && (
                      <pre className="text-xs bg-muted p-2 rounded mt-1 overflow-x-auto">
                        {JSON.stringify(step.output_data, null, 2)}
                      </pre>
                    )}
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/AutomacoesExecucoes.tsx
git commit -m "feat(execucoes): integrate SplitAbAnalytics panel and improve split step display"
```

---

### Task 7: Build Validation

**Files:** None (validation only)

- [ ] **Step 1: Run TypeScript compilation**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 2: Run the dev build**

```bash
npm run build
```

Expected: successful build with no errors.

- [ ] **Step 3: Fix any build errors**

If there are TypeScript or build errors, fix them in the relevant files.

- [ ] **Step 4: Commit any fixes**

```bash
git add -u
git commit -m "fix: resolve build errors in split A/B analytics"
```

---

### Task 8: Manual Verification Checklist

- [ ] **Step 1: Verify migration file is valid SQL**

Read the migration file and confirm:
- All table references exist (organizations, workflows, leads, workflow_executions)
- UNIQUE constraint on `(workflow_id, node_id, lead_id)` is correct
- RLS policies cover SELECT, INSERT, and service_role
- RPC function signature matches what the hook calls
- Indexes cover the query patterns in the RPC

- [ ] **Step 2: Verify executor backwards compatibility**

Read `workflow-executor.ts` and confirm:
- Legacy `splitPercentA` format is still handled
- Legacy edge resolution (`sourceHandle` containing variant id) is still handled
- `workflowId` is available in scope (destructured from params)
- The `resolveOrCreateSplitAssignment` function gracefully handles missing tables (try/catch in upsert)
- The `recordSplitEvent` function uses try/catch and doesn't break execution on failure

- [ ] **Step 3: Verify frontend component renders correctly**

Read `SplitAbAnalytics.tsx` and confirm:
- Returns `null` when no split nodes exist (doesn't break non-split workflows)
- Handles empty metrics gracefully
- All imports reference existing modules
- Component is properly exported as default

- [ ] **Step 4: Verify the integration in AutomacoesExecucoes**

Read `AutomacoesExecucoes.tsx` and confirm:
- Import path is correct
- `SplitAbAnalytics` receives `workflowId` from `useParams`
- The split step display in `StepsDialog` handles missing `output_data` gracefully
- Existing functionality is preserved (table, stats, dialog)

---

## Architecture Decisions

### Sticky Assignment Strategy
- **Rule:** One variant per lead per split node (`UNIQUE(workflow_id, node_id, lead_id)`).
- **Rationale:** If a lead re-enters the same workflow, they always get the same variant, enabling reliable A/B comparison at the lead level.
- **Edge case — deleted variant:** If the admin removes a variant from the config, the next execution for that lead falls through to a new random assignment. The old assignment row is orphaned but harmless (the RPC joins on `variant_id` text match so orphaned assignments with non-existent variant IDs simply won't appear in metrics).

### Event Recording Strategy
- **Only message-type actions** emit `message_sent`/`message_failed` events. This avoids flooding the events table with internal routing steps.
- **Completion/failure status** is derived from `workflow_executions.status` via the RPC join — not from events. This means the funnel metrics are always consistent with the execution engine's final status.

### Performance Considerations
- The RPC uses `SECURITY DEFINER` to bypass per-row RLS checks internally, while still requiring `p_org_id` parameter for multi-tenant filtering.
- Indexes on `(workflow_id, node_id)` and `(workflow_id, node_id, variant_id)` ensure the RPC query hits indexes.
- Frontend auto-refreshes every 30s — acceptable for an analytics panel.

### Residual Risks
1. **Split events for non-split workflows:** The `recordSplitEvent` function does a lookup query on every message action. For workflows without splits, this is one extra query per action step that returns nothing. This is acceptable but could be optimized later with an execution-level flag.
2. **RPC complexity:** The aggregation RPC has 3 CTEs. For workflows with >10K executions, performance should be monitored. An index on `workflow_split_assignments(workflow_id, node_id, organization_id)` covers the main filter.
3. **No real-time variant percentage enforcement:** The sticky assignment means actual traffic distribution may drift from configured percentages over time as leads accumulate. This is by design — statistical A/B testing prioritizes consistency over exact distribution.
