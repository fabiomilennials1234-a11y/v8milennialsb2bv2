---
tags:
  - torque-crm
  - spec
  - features
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: .specs/features/workflow-new-nodes/tasks.md
---

# Tasks: Workflow New Nodes + Retry

**Created:** 2026-04-06

## Task Graph

```
T1 (types) ──────┬──→ T3 (node WBW) ──→ T5 (panel WBW) ──→ T7 (register WBW)
                  │                                            │
                  ├──→ T4 (node AR) ───→ T6 (panel AR) ───→ T8 (register AR)
                  │                                            │
T2 (migration) ──┤                                            ├──→ T11 (executor) ──→ T12 (verify)
                  │                                            │
                  └──→ T9 (retry hook) ──→ T10 (retry UI) ───┘
```

`[P]` = parallelizable with other `[P]` tasks at same level

---

## T1: Type Definitions [P with T2]
**What:** Add new node types, data interfaces, colors, labels to `src/types/workflow.ts`
**Where:** `src/types/workflow.ts`
**Depends on:** Nothing
**Done when:**
- `WorkflowNodeType` includes `"wait_business_window" | "assign_responsible"`
- `WaitBusinessWindowNodeData` interface defined (days, startTime, endTime, timezone)
- `AssignResponsibleNodeData` interface defined (assignMode, assignTarget, assigneeId, assigneeName, memberIds)
- `WorkflowNodeData` union updated
- `NODE_COLORS` has entries for both
- `NODE_LABELS` has entries for both
- TypeScript compiles clean
**Gate:** `npx tsc --noEmit`

## T2: Database Migration [P with T1]
**What:** Create migration for round_robin_state table and retry_of column
**Where:** `supabase/migrations/`
**Depends on:** Nothing
**Done when:**
- `workflow_round_robin_state` table created with (workflow_id, node_id, last_member_index, org_id)
- UNIQUE constraint on (workflow_id, node_id)
- RLS policies for org-scoped access
- `retry_of` nullable UUID column added to `workflow_executions`
- FK from `retry_of` to `workflow_executions(id)`
- Index on `retry_of`
**Gate:** Migration SQL is syntactically valid

## T3: WaitBusinessWindow Node Component [P with T4]
**What:** Create visual node component
**Where:** `src/components/automacoes/nodes/WaitBusinessWindowNode.tsx` (NEW)
**Depends on:** T1
**Done when:**
- Uses BaseNode with amber color scheme
- CalendarClock icon from lucide-react
- Shows configured days + time range as subtitle
- Handles empty/default state gracefully
- Memo-wrapped for React Flow performance
**Gate:** `npx tsc --noEmit`

## T4: AssignResponsible Node Component [P with T3]
**What:** Create visual node component
**Where:** `src/components/automacoes/nodes/AssignResponsibleNode.tsx` (NEW)
**Depends on:** T1
**Done when:**
- Uses BaseNode with rose color scheme
- UserRoundPlus icon from lucide-react
- Shows mode label + target as subtitle
- Handles empty/default state gracefully
- Memo-wrapped
**Gate:** `npx tsc --noEmit`

## T5: WaitBusinessWindow Panel [P with T6]
**What:** Create sidebar configuration panel
**Where:** `src/components/automacoes/sidebar-panels/WaitBusinessWindowPanel.tsx` (NEW)
**Depends on:** T1
**Done when:**
- Label input
- Day-of-week checkboxes using WEEKDAY_OPTIONS
- Start/end time inputs (HH:MM)
- Timezone select with common BR timezones
- Calls onUpdate with properly typed data
**Gate:** `npx tsc --noEmit`

## T6: AssignResponsible Panel [P with T5]
**What:** Create sidebar configuration panel
**Where:** `src/components/automacoes/sidebar-panels/AssignResponsiblePanel.tsx` (NEW)
**Depends on:** T1
**Done when:**
- Label input
- Mode radio: Rotativo / Aleatório / Manual
- Target radio: Responsável / SDR / Closer
- Manual mode: team member select (useTeamMembers hook)
- Round-robin/Random mode: optional multi-select of team members
- Calls onUpdate with properly typed data
**Gate:** `npx tsc --noEmit`

## T7: Register WaitBusinessWindow in Editor [P with T8]
**What:** Wire up the node into Canvas, Sidebar, Editor, Toolbar
**Where:** WorkflowCanvas.tsx, WorkflowSidebar.tsx, AutomacoesEditor.tsx, WorkflowToolbar.tsx
**Depends on:** T3, T5
**Done when:**
- Canvas imports + registers WaitBusinessWindowNode
- Sidebar imports + renders WaitBusinessWindowPanel
- Editor has createDefaultNodeData case for "wait_business_window"
- Toolbar has entry in "Controle de Fluxo" group
- TypeScript compiles clean
**Gate:** `npx tsc --noEmit`

## T8: Register AssignResponsible in Editor [P with T7]
**What:** Wire up the node into Canvas, Sidebar, Editor, Toolbar
**Where:** WorkflowCanvas.tsx, WorkflowSidebar.tsx, AutomacoesEditor.tsx, WorkflowToolbar.tsx
**Depends on:** T4, T6
**Done when:**
- Canvas imports + registers AssignResponsibleNode
- Sidebar imports + renders AssignResponsiblePanel
- Editor has createDefaultNodeData case for "assign_responsible"
- Toolbar has entry in new "Equipe" group
- TypeScript compiles clean
**Gate:** `npx tsc --noEmit`

## T9: Retry Hook [P with T7, T8]
**What:** Add useRetryWorkflowExecution mutation
**Where:** `src/hooks/useWorkflows.ts`
**Depends on:** T2 (migration for retry_of column)
**Done when:**
- Mutation takes executionId
- Fetches original execution data
- Validates status is "failed"
- Creates new execution with retry_of, current_node_id = failed node, status = running
- Invalidates workflow-executions queries
- Admin permission check via assertIsAdmin
**Gate:** `npx tsc --noEmit`

## T10: Retry UI
**What:** Add retry button and retry badge to executions page
**Where:** `src/pages/AutomacoesExecucoes.tsx`
**Depends on:** T9
**Done when:**
- "Repetir" button (RotateCw icon) on failed execution rows
- "Repetir a partir daqui" in StepsDialog for failed executions
- Confirmation dialog before retry
- Badge "Retry" with original execution reference when retry_of is set
- Loading state during retry mutation
- Toast on success/error
**Gate:** `npx tsc --noEmit`

## T11: Executor Logic
**What:** Add executor cases for both new node types
**Where:** `supabase/functions/_shared/workflow-executor.ts`, `supabase/functions/_shared/workflow-action-handler.ts`
**Depends on:** T2 (for round_robin_state table)
**Done when:**
- Executor handles `wait_business_window`: uses getNextSendTime, pauses if outside window, passes if inside
- Executor handles `assign_responsible`: calls new handler function
- Handler `handleAssignResponsibleNode()` implements:
  - round_robin: sequential via workflow_round_robin_state table with advisory lock
  - random: Math.random from eligible members
  - manual: use configured assigneeId
- Updates lead's responsible_id/sdr_id/closer_id based on assignTarget
- Records steps with appropriate data
- Error handling consistent with other nodes

## T12: Verification
**What:** End-to-end type check + manual verification checklist
**Depends on:** T7, T8, T10, T11
**Done when:**
- `npx tsc --noEmit` passes
- Vite dev server starts without errors
- Checklist verified:
  - [ ] Both nodes appear in toolbar dropdown
  - [ ] Both nodes render on canvas
  - [ ] Both sidebar panels show and save config
  - [ ] Retry button appears on failed executions
  - [ ] Types are consistent across frontend and executor

---

## Status Tracker

| Task | Status | Notes |
|------|--------|-------|
| T1 | completed | Types added to workflow.ts |
| T2 | completed | Migration 20260903000000 with round_robin_state + retry_of + RPC |
| T3 | completed | WaitBusinessWindowNode.tsx created |
| T4 | completed | AssignResponsibleNode.tsx created |
| T5 | completed | WaitBusinessWindowPanel.tsx created |
| T6 | completed | AssignResponsiblePanel.tsx created |
| T7 | completed | Registered in Canvas, Sidebar, Editor, Toolbar |
| T8 | completed | Registered in Canvas, Sidebar, Editor, Toolbar |
| T9 | completed | useRetryWorkflowExecution hook added |
| T10 | completed | Retry button + confirmation + badge in executions page |
| T11 | completed | Executor cases for wait_business_window + assign_responsible |
| T12 | completed | tsc --noEmit: 0 errors, vite build: success |


## Links relacionados

- [[MOC - Arquitetura]]

- [[Permissoes Sistema]]

- [[Workflow Builder]]

- [[00 - INDEX]]
- [[Visao Geral]]
