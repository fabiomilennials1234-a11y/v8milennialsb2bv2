---
tags:
  - torque-crm
  - spec
  - features
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: .specs/features/workflow-new-nodes/design.md
---

# Design: Workflow New Nodes + Retry

**Created:** 2026-04-06

## Architecture Decisions

### AD1: Pure Sequential Round-Robin

The current `assign_responsible` action uses least-loaded distribution. The new node uses **pure sequential round-robin** (A→B→C→A→B→C).

**Implementation:** A state table `workflow_round_robin_state` tracks the `last_member_index` per workflow+node combination. On each execution:
1. Acquire advisory lock on `(workflow_id, node_id)` hash
2. Read current `last_member_index`
3. Pick `members[(last_member_index + 1) % members.length]`
4. Update `last_member_index`
5. Release lock (at transaction end)

This ensures correct ordering even under concurrent executions.

### AD2: Standalone Node Types

Both new nodes are first-class node types (not action subtypes). This means:
- Own entry in `WorkflowNodeType` union
- Own `*NodeData` interface
- Own React node component
- Own sidebar panel
- Own case in executor switch
- Own entry in Canvas `nodeTypes`, Sidebar `renderPanel`, Editor `createDefaultNodeData`

This follows the same pattern as `wait_response`, `split_ab`, `webhook_call`, `goto`.

### AD3: Retry via New Execution

Retry creates a **new** execution record (not restarting in-place). Benefits:
- Full audit trail preserved
- Original failed execution remains unchanged
- `retry_of` FK provides traceability
- Executor's existing resume-from-node logic handles the rest

## Component Map

### Types (src/types/workflow.ts)

```
WorkflowNodeType += "wait_business_window" | "assign_responsible"

+WaitBusinessWindowNodeData {
  type: "wait_business_window"
  label: string
  days: string[]          // ["seg","ter","qua","qui","sex"]
  startTime: string       // "08:00"
  endTime: string         // "18:00"
  timezone: string        // "America/Sao_Paulo"
}

+AssignResponsibleNodeData {
  type: "assign_responsible"
  label: string
  assignMode: "round_robin" | "random" | "manual"
  assignTarget: "responsible" | "sdr" | "closer"
  assigneeId?: string     // manual mode
  assigneeName?: string   // manual mode display
  memberIds?: string[]    // filter for round_robin/random (empty = all active)
}

WorkflowNodeData += WaitBusinessWindowNodeData | AssignResponsibleNodeData
NODE_COLORS += wait_business_window: amber, assign_responsible: rose
NODE_LABELS += wait_business_window: "Janela Comercial", assign_responsible: "Definir Responsável"
```

### Node Components (src/components/automacoes/nodes/)

**WaitBusinessWindowNode.tsx** - Uses BaseNode. Icon: CalendarClock (amber). Shows configured days + time range as subtitle. Single input/output handles.

**AssignResponsibleNode.tsx** - Uses BaseNode. Icon: UserRoundPlus (rose). Shows mode + target as subtitle. Single input/output handles.

### Sidebar Panels (src/components/automacoes/sidebar-panels/)

**WaitBusinessWindowPanel.tsx:**
- Day checkboxes (WEEKDAY_OPTIONS from workflow.ts)
- Start time input (HH:MM)
- End time input (HH:MM)
- Timezone select (America/Sao_Paulo default, show common BR timezones)

**AssignResponsiblePanel.tsx:**
- Mode selector: radio group (Rotativo / Aleatório / Manual)
- Target selector: radio group (Responsável / SDR / Closer)
- Conditional fields:
  - Manual: team member select dropdown (useTeamMembers hook)
  - Round-robin/Random: multi-select of team members (optional, empty = all)

### Executor (supabase/functions/_shared/workflow-executor.ts)

Two new cases in the main switch:

**case "wait_business_window":**
- Extract days, startTime, endTime, timezone from node.data
- Call `getNextSendTime()` with current time
- If inside window → record step "success", continue to next nodes
- If outside → record step, set `next_run_at` to nextSend, `current_node_id` = self, return paused
- On resume: skip loop counter increment (same as time_window condition pattern)

**case "assign_responsible":**
- Call new helper `handleAssignResponsibleNode()` in workflow-action-handler.ts
- Modes: round_robin (sequential via state table), random (Math.random), manual (fixed)
- Update lead's responsible_id/sdr_id/closer_id based on assignTarget
- Record step with assigned member info
- Continue to next nodes on success, fail execution on error

### Database

**Migration: workflow_round_robin_state table**
```sql
CREATE TABLE workflow_round_robin_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  node_id text NOT NULL,
  last_member_index integer NOT NULL DEFAULT -1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workflow_id, node_id)
);
-- RLS: org-scoped
```

**Migration: retry_of column**
```sql
ALTER TABLE workflow_executions
  ADD COLUMN retry_of uuid REFERENCES workflow_executions(id);
CREATE INDEX idx_workflow_executions_retry_of ON workflow_executions(retry_of);
```

### Hooks (src/hooks/useWorkflows.ts)

**+useRetryWorkflowExecution** mutation:
- Takes `executionId`
- Fetches the failed execution (workflow_id, lead_id, org_id, current_node_id, context, loop_counters)
- Inserts new execution with `retry_of`, `current_node_id` = failed node, `status` = "running", `next_run_at` = now
- Invalidates execution queries

### Executions UI (src/pages/AutomacoesExecucoes.tsx)

- "Repetir" button in table row for failed executions (RotateCw icon)
- "Repetir a partir daqui" button in StepsDialog header when execution is failed
- Badge "Retry" with link to original execution when `retry_of` is set
- Confirmation dialog before retry

## File Change Summary

| File | Change |
|------|--------|
| `src/types/workflow.ts` | +2 node types, +2 data interfaces, +colors, +labels |
| `src/components/automacoes/nodes/WaitBusinessWindowNode.tsx` | NEW |
| `src/components/automacoes/nodes/AssignResponsibleNode.tsx` | NEW |
| `src/components/automacoes/sidebar-panels/WaitBusinessWindowPanel.tsx` | NEW |
| `src/components/automacoes/sidebar-panels/AssignResponsiblePanel.tsx` | NEW |
| `src/components/automacoes/WorkflowCanvas.tsx` | +2 imports, +2 nodeTypes entries |
| `src/components/automacoes/WorkflowSidebar.tsx` | +2 imports, +2 renderPanel cases |
| `src/pages/AutomacoesEditor.tsx` | +2 imports, +2 createDefaultNodeData cases |
| `src/components/automacoes/WorkflowToolbar.tsx` | +2 entries in ADD_NODE_GROUPS |
| `supabase/functions/_shared/workflow-executor.ts` | +2 cases in switch |
| `supabase/functions/_shared/workflow-action-handler.ts` | +handleAssignResponsibleNode helper |
| `src/hooks/useWorkflows.ts` | +useRetryWorkflowExecution mutation |
| `src/pages/AutomacoesExecucoes.tsx` | +retry button, +retry badge, +confirmation |
| `supabase/migrations/XXXXXX_workflow_new_nodes.sql` | NEW: round_robin_state table + retry_of column |


## Links relacionados

- [[MOC - Arquitetura]]

- [[Webhooks]]

- [[Permissoes Sistema]]

- [[Workflow Builder]]

- [[00 - INDEX]]
- [[Visao Geral]]
