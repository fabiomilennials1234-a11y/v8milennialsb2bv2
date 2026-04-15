---
tags:
  - torque-crm
  - docs
  - plan
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: docs/superpowers/plans/2026-03-30-condition-time-window.md
---

# Condition Time Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve the condition node to support time/day/hour windows that pause and reschedule workflow executions outside the configured window, instead of routing to the false branch.

**Architecture:** Add a `conditionMode` field to `ConditionNodeData` (`"field"` for existing behavior, `"time_window"` for temporal). The executor detects mode - for time windows, it uses the existing `followupSchedule.ts` helpers to check if "now" is inside the window and, if not, sets `next_run_at` to the next valid window start (same pause/resume pattern as the delay node). The ConditionPanel gets a mode toggle that shows either the current field/operator/value form or a new time window configuration form.

**Tech Stack:** Supabase (Deno Edge Functions), React, shadcn/ui, Tailwind CSS. Reuses `followupSchedule.ts` helpers (`getLocalTimeInRuleTz`, `parseTimeHHMM`, `getNextWindowStartUtc`).

---

## Architecture Decisions

### Why `conditionMode` instead of a new node type?

The spec requires the condition node to gain temporal capability without breaking existing workflows. Adding a mode field is retrocompatible: existing conditions have no `conditionMode` and default to `"field"`. No new node type registration, no new edge routing logic, no new toolbar entry.

### Why reuse `followupSchedule.ts`?

The helpers `getLocalTimeInRuleTz`, `parseTimeHHMM`, `utcForLocalInTz`, and `getNextWindowStartUtc` already solve timezone-aware window calculation with DST handling. They're battle-tested in the followup system. No duplication needed.

### Pause/resume semantics

Time window conditions that fire outside the window use the **exact same pattern** as the delay node: set `next_run_at` on the execution, set `current_node_id` to the condition node itself (so it re-evaluates on resume), and return `"paused"`. The cron worker picks it up when the time arrives.

The key difference from delay: `current_node_id` points to the condition node itself (not the next node), so when resumed, the condition re-evaluates - if it's now inside the window, it follows the true edge.

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/types/workflow.ts` | Add `conditionMode`, `TimeWindowConfig` type |
| Modify | `src/components/automacoes/sidebar-panels/ConditionPanel.tsx` | Add mode toggle + time window config UI |
| Modify | `supabase/functions/_shared/workflow-executor.ts` | Handle time window mode in condition case |
| Modify | `src/pages/AutomacoesEditor.tsx` | Update default condition data |

---

### Task 1: Type Definitions

**Files:**
- Modify: `src/types/workflow.ts`

- [ ] **Step 1: Add TimeWindowConfig and update ConditionNodeData**

After the `ConditionOperator` type (line 122), add:

```typescript
export type ConditionMode = "field" | "time_window";

export interface TimeWindowConfig {
  days: string[];           // ["seg","ter","qua","qui","sex"] - same format as followupSchedule
  startTime: string;        // "HH:MM" e.g. "08:00"
  endTime: string;          // "HH:MM" e.g. "18:00"
  timezone: string;         // e.g. "America/Sao_Paulo"
}
```

Update `ConditionNodeData` (line 313-320) - add optional fields:

```typescript
export interface ConditionNodeData {
  type: "condition";
  label: string;
  field: string;
  operator: ConditionOperator;
  value: string;
  conditionMode?: ConditionMode;       // undefined or "field" = legacy behavior
  timeWindow?: TimeWindowConfig;
  [key: string]: unknown;
}
```

- [ ] **Step 2: Add day labels constant**

After the `TimeWindowConfig` interface, add:

```typescript
export const WEEKDAY_OPTIONS = [
  { value: "seg", label: "Seg" },
  { value: "ter", label: "Ter" },
  { value: "qua", label: "Qua" },
  { value: "qui", label: "Qui" },
  { value: "sex", label: "Sex" },
  { value: "sab", label: "Sab" },
  { value: "dom", label: "Dom" },
] as const;
```

- [ ] **Step 3: Commit**

```bash
git add src/types/workflow.ts
git commit -m "feat(types): add ConditionMode and TimeWindowConfig for temporal conditions"
```

---

### Task 2: Condition Panel UI - Mode Toggle + Time Window Form

**Files:**
- Modify: `src/components/automacoes/sidebar-panels/ConditionPanel.tsx`

- [ ] **Step 1: Replace the entire ConditionPanel with mode-aware version**

```tsx
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CONDITION_OPERATOR_LABELS, WEEKDAY_OPTIONS } from "@/types/workflow";
import type { ConditionNodeData, ConditionOperator, ConditionMode } from "@/types/workflow";
import { Clock, Filter } from "lucide-react";
import { cn } from "@/lib/utils";

interface ConditionPanelProps {
  data: ConditionNodeData;
  onUpdate: (updates: Partial<ConditionNodeData>) => void;
}

const FIELD_OPTIONS = [
  { value: "name", label: "Nome do Lead" },
  { value: "company", label: "Empresa" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Telefone" },
  { value: "origin", label: "Origem" },
  { value: "rating", label: "Rating" },
  { value: "faturamento", label: "Faturamento" },
  { value: "segment", label: "Segmento" },
  { value: "urgency", label: "Urgencia" },
  { value: "score", label: "Score" },
  { value: "tag", label: "Tag" },
  { value: "stage", label: "Estagio" },
  { value: "sdr_id", label: "Responsavel (Qualificacao)" },
  { value: "closer_id", label: "Responsavel (Propostas)" },
  { value: "last_message", label: "Ultima mensagem" },
  { value: "message_count", label: "Qtd. mensagens" },
  { value: "days_since_contact", label: "Dias sem contato" },
  { value: "custom", label: "Campo customizado" },
];

const NO_VALUE_OPERATORS: ConditionOperator[] = ["is_empty", "is_not_empty"];

const TIMEZONE_OPTIONS = [
  { value: "America/Sao_Paulo", label: "Brasilia (GMT-3)" },
  { value: "America/Manaus", label: "Manaus (GMT-4)" },
  { value: "America/Belem", label: "Belem (GMT-3)" },
  { value: "America/Fortaleza", label: "Fortaleza (GMT-3)" },
  { value: "America/Recife", label: "Recife (GMT-3)" },
  { value: "America/Cuiaba", label: "Cuiaba (GMT-4)" },
  { value: "America/Rio_Branco", label: "Rio Branco (GMT-5)" },
  { value: "America/Noronha", label: "Noronha (GMT-2)" },
];

export function ConditionPanel({ data, onUpdate }: ConditionPanelProps) {
  const mode: ConditionMode = data.conditionMode || "field";
  const needsValue = !NO_VALUE_OPERATORS.includes(data.operator);

  const timeWindow = data.timeWindow || {
    days: ["seg", "ter", "qua", "qui", "sex"],
    startTime: "08:00",
    endTime: "18:00",
    timezone: "America/Sao_Paulo",
  };

  const handleModeChange = (newMode: ConditionMode) => {
    onUpdate({ conditionMode: newMode });
    if (newMode === "time_window" && !data.timeWindow) {
      onUpdate({
        conditionMode: newMode,
        label: data.label || "Janela de horario",
        timeWindow: {
          days: ["seg", "ter", "qua", "qui", "sex"],
          startTime: "08:00",
          endTime: "18:00",
          timezone: "America/Sao_Paulo",
        },
      });
    }
  };

  const toggleDay = (day: string) => {
    const current = timeWindow.days;
    const updated = current.includes(day)
      ? current.filter(d => d !== day)
      : [...current, day];
    if (updated.length === 0) return; // must have at least one day
    onUpdate({ timeWindow: { ...timeWindow, days: updated } });
  };

  return (
    <div className="space-y-4">
      {/* Label */}
      <div className="space-y-2">
        <Label>Nome</Label>
        <Input
          value={data.label || ""}
          onChange={(e) => onUpdate({ label: e.target.value })}
          placeholder={mode === "time_window" ? "Ex: Horario comercial" : "Ex: Score maior que 50?"}
        />
      </div>

      {/* Mode toggle */}
      <div className="space-y-2">
        <Label>Tipo de condicao</Label>
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant={mode === "field" ? "default" : "outline"}
            size="sm"
            className="justify-start gap-2"
            onClick={() => handleModeChange("field")}
          >
            <Filter className="w-3.5 h-3.5" />
            Campo
          </Button>
          <Button
            type="button"
            variant={mode === "time_window" ? "default" : "outline"}
            size="sm"
            className="justify-start gap-2"
            onClick={() => handleModeChange("time_window")}
          >
            <Clock className="w-3.5 h-3.5" />
            Horario
          </Button>
        </div>
      </div>

      {/* Field mode - existing behavior */}
      {mode === "field" && (
        <>
          <div className="space-y-2">
            <Label>Campo</Label>
            <Select
              value={data.field || ""}
              onValueChange={(v) => onUpdate({ field: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione o campo" />
              </SelectTrigger>
              <SelectContent>
                {FIELD_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {data.field === "custom" && (
            <div className="space-y-2">
              <Label>Nome do campo customizado</Label>
              <Input
                value={data.field === "custom" ? (data as any).customFieldName || "" : ""}
                onChange={(e) =>
                  onUpdate({ field: `custom.${e.target.value}` } as any)
                }
                placeholder="Ex: cargo"
              />
            </div>
          )}

          <div className="space-y-2">
            <Label>Operador</Label>
            <Select
              value={data.operator || ""}
              onValueChange={(v) => onUpdate({ operator: v as ConditionOperator })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione o operador" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CONDITION_OPERATOR_LABELS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {needsValue && (
            <div className="space-y-2">
              <Label>Valor</Label>
              <Input
                value={data.value || ""}
                onChange={(e) => onUpdate({ value: e.target.value })}
                placeholder="Ex: 50"
              />
            </div>
          )}
        </>
      )}

      {/* Time window mode */}
      {mode === "time_window" && (
        <>
          {/* Days */}
          <div className="space-y-2">
            <Label>Dias permitidos</Label>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAY_OPTIONS.map((d) => (
                <Badge
                  key={d.value}
                  variant={timeWindow.days.includes(d.value) ? "default" : "outline"}
                  className={cn(
                    "cursor-pointer select-none px-2.5 py-1 text-xs",
                    timeWindow.days.includes(d.value)
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted"
                  )}
                  onClick={() => toggleDay(d.value)}
                >
                  {d.label}
                </Badge>
              ))}
            </div>
          </div>

          {/* Time range */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Inicio</Label>
              <Input
                type="time"
                value={timeWindow.startTime}
                onChange={(e) => onUpdate({ timeWindow: { ...timeWindow, startTime: e.target.value } })}
              />
            </div>
            <div className="space-y-2">
              <Label>Fim</Label>
              <Input
                type="time"
                value={timeWindow.endTime}
                onChange={(e) => onUpdate({ timeWindow: { ...timeWindow, endTime: e.target.value } })}
              />
            </div>
          </div>

          {/* Timezone */}
          <div className="space-y-2">
            <Label>Timezone</Label>
            <Select
              value={timeWindow.timezone}
              onValueChange={(v) => onUpdate({ timeWindow: { ...timeWindow, timezone: v } })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONE_OPTIONS.map((tz) => (
                  <SelectItem key={tz.value} value={tz.value}>
                    {tz.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Behavior note */}
          <div className="rounded-md bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800/40 p-3">
            <p className="text-xs text-blue-700 dark:text-blue-400">
              <strong>Fora da janela:</strong> o fluxo ficara pausado e sera retomado automaticamente no proximo horario permitido.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/automacoes/sidebar-panels/ConditionPanel.tsx
git commit -m "feat(ui): add time window mode to ConditionPanel"
```

---

### Task 3: Executor - Handle Time Window Condition

**Files:**
- Modify: `supabase/functions/_shared/workflow-executor.ts` - the `case "condition"` block (lines 160-197)

- [ ] **Step 1: Add time window import**

At the top of `workflow-executor.ts`, after the existing imports (around line 3), add:

```typescript
import { getNextSendTime } from "./followupSchedule.ts";
```

- [ ] **Step 2: Replace the condition case**

Replace the entire `case "condition"` block (lines 160-197) with:

```typescript
        case "condition": {
          const conditionMode = (node.data.conditionMode as string) || "field";

          if (conditionMode === "time_window") {
            // ── Time window condition: check if "now" is inside the configured window ──
            const tw = node.data.timeWindow as {
              days?: string[];
              startTime?: string;
              endTime?: string;
              timezone?: string;
            } | undefined;

            const days = tw?.days || ["seg", "ter", "qua", "qui", "sex"];
            const startTime = tw?.startTime || "08:00";
            const endTime = tw?.endTime || "18:00";
            const timezone = tw?.timezone || "America/Sao_Paulo";

            const nextSend = getNextSendTime(
              {
                sendOnlyBusinessHours: true,
                businessHoursStart: startTime,
                businessHoursEnd: endTime,
                sendDays: days,
                timezone,
              },
              new Date(),
            );

            const now = Date.now();
            const isInsideWindow = nextSend.getTime() <= now + 1000; // 1s tolerance

            if (isInsideWindow) {
              // Inside window - follow true path
              await recordStep(supabase, executionId, node, "success",
                { conditionMode: "time_window", days, startTime, endTime, timezone },
                { result: true, insideWindow: true, evaluatedAt: new Date().toISOString() },
              );

              const outEdges = edgeMap.get(nodeId) || [];
              const trueEdge = outEdges.find(e =>
                e.sourceHandle?.toLowerCase().includes("true") ||
                e.sourceHandle?.toLowerCase().includes("yes") ||
                e.sourceHandle === "a" ||
                e.sourceHandle === "source-true"
              );
              const nextNodeId = trueEdge?.target || outEdges[0]?.target;
              if (nextNodeId) nextNodes.push(nextNodeId);
            } else {
              // Outside window - pause and schedule resume at next window start
              const nextRunAt = nextSend.toISOString();

              await recordStep(supabase, executionId, node, "success",
                { conditionMode: "time_window", days, startTime, endTime, timezone },
                { result: "paused_until_window", insideWindow: false, nextRunAt, evaluatedAt: new Date().toISOString() },
              );

              // Pause execution: set current_node_id to THIS node so it re-evaluates on resume
              await supabase.from("workflow_executions").update({
                status: "running",
                current_node_id: nodeId,
                next_run_at: nextRunAt,
                loop_counters: loopCounters,
              }).eq("id", executionId);

              return { success: true, status: "paused", stepsExecuted };
            }
          } else {
            // ── Field condition: existing behavior unchanged ──
            const condResult = await evaluateCondition(supabase, leadId, {
              field: node.data.field as string || "",
              operator: node.data.operator as string || "equals",
              value: node.data.value as string || "",
            });

            await recordStep(supabase, executionId, node, "success",
              { field: node.data.field, operator: node.data.operator, value: node.data.value },
              { result: condResult },
            );

            const outEdges = edgeMap.get(nodeId) || [];
            let nextNodeId: string | undefined;

            if (condResult) {
              const trueEdge = outEdges.find(e =>
                e.sourceHandle?.toLowerCase().includes("true") ||
                e.sourceHandle?.toLowerCase().includes("yes") ||
                e.sourceHandle === "a" ||
                e.sourceHandle === "source-true"
              );
              nextNodeId = trueEdge?.target || outEdges[0]?.target;
            } else {
              const falseEdge = outEdges.find(e =>
                e.sourceHandle?.toLowerCase().includes("false") ||
                e.sourceHandle?.toLowerCase().includes("no") ||
                e.sourceHandle === "b" ||
                e.sourceHandle === "source-false"
              );
              nextNodeId = falseEdge?.target || outEdges[1]?.target || outEdges[0]?.target;
            }

            if (nextNodeId) nextNodes.push(nextNodeId);
          }
          break;
        }
```

Key design points:
- **`current_node_id = nodeId`** (the condition node itself) - when resumed, the executor will re-enter this same node and re-evaluate. If the window is now open, it proceeds. If still closed (edge case: cron fired slightly early), it reschedules again.
- **`status: "running"`** matches the delay node pattern - the `next_run_at` timestamp is the scheduling signal.
- **1s tolerance** on `isInsideWindow` handles clock precision between `getNextSendTime` calculation and `Date.now()`.
- Field conditions are 100% identical to the original code.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/workflow-executor.ts
git commit -m "feat(executor): handle time_window condition with pause/resume scheduling"
```

---

### Task 4: Update Default Condition Data in Editor

**Files:**
- Modify: `src/pages/AutomacoesEditor.tsx`

- [ ] **Step 1: Update default condition node data**

Find the condition case in `getDefaultNodeData` (around line 51-52):

```typescript
    case "condition":
      return { type: "condition", label: "Condição", field: "", operator: "equals", value: "" } as ConditionNodeData;
```

Update to include `conditionMode`:

```typescript
    case "condition":
      return { type: "condition", label: "Condição", field: "", operator: "equals", value: "", conditionMode: "field" } as ConditionNodeData;
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/AutomacoesEditor.tsx
git commit -m "feat(editor): set default conditionMode for new condition nodes"
```

---

### Task 5: Build Validation

- [ ] **Step 1: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 2: Production build**

```bash
npm run build
```

Expected: successful build.

- [ ] **Step 3: Fix any errors if needed**

---

### Task 6: Final Review

- [ ] **Step 1: Verify backwards compatibility**

Read `workflow-executor.ts` condition case and confirm:
- `conditionMode` defaults to `"field"` when undefined → existing workflows work as before
- Field condition branch is identical to original code
- No new imports break the Deno runtime (`followupSchedule.ts` already exists as a Deno module)

- [ ] **Step 2: Verify pause/resume correctness**

- `current_node_id` is set to the condition node itself (not the next node) → on resume, executor re-enters the condition and re-evaluates
- `next_run_at` is set to the UTC timestamp of the next window start
- `status` remains `"running"` → claim RPC picks it up when `next_run_at <= now()`
- `loopCounters` are preserved → no infinite loop risk (the loop counter already incremented for this node visit)

- [ ] **Step 3: Verify time window calculation correctness**

- `getNextSendTime` returns "now" if inside the window → `isInsideWindow` is true
- `getNextSendTime` returns next window start if outside → `isInsideWindow` is false, `next_run_at` is correct
- Timezone is passed through from config → no hardcoded timezone in executor
- Day-of-week filtering works via `sendDays` parameter

- [ ] **Step 4: Verify UI correctness**

- Mode toggle shows "Campo" (field icon) and "Horario" (clock icon)
- Default time window is weekdays 08:00-18:00 Sao Paulo
- Day badges are toggleable with visual feedback
- Time inputs use `type="time"` (native browser picker)
- Timezone dropdown includes Brazilian timezone options
- Info box explains the pause behavior clearly

---

## Residual Risks

1. **Loop counter on re-evaluation:** When the condition node is re-entered after resume, `loopCounters[nodeId]` increments again. With `loopLimit` default of 100, a workflow could theoretically be paused and resumed up to 99 times on the same time-window node before hitting the limit. This is acceptable for the expected use case (1-2 pauses per execution).

2. **Cron granularity:** The cron worker runs every 1 minute. A time window starting at 08:00 means the execution resumes at 08:00 + up to 60s. This is acceptable for business-hours scheduling.

3. **No false path for time windows:** The current design always follows the true path (or pauses). There is no "expired" or "timeout" branch. If a user wants "do X during business hours, do Y otherwise", they should use a field condition with a delay node, not a time window condition. This is by design - the spec says "outside the window = pause, not false".


## Links relacionados

- [[Workflow Builder]]

- [[00 - INDEX]]
