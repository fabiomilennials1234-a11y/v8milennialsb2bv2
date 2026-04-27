# Feature: Workflow New Nodes + Retry

**Created:** 2026-04-06
**Scope:** Large
**Status:** Specifying

## Overview

Add two new workflow node types ("Esperar Janela Comercial" and "Definir Responsavel") and a retry mechanism for failed workflow executions.

## Requirements

### F1: Node "Esperar Janela Comercial"

A standalone flow-blocking node that pauses the workflow until the configured business window is active. Unlike the existing `time_window` condition mode (which branches true/false), this node has a single output — it simply gates the flow.

- **F1.1** New node type `wait_business_window` added to `WorkflowNodeType`
- **F1.2** Node data interface `WaitBusinessWindowNodeData` with:
  - `days: string[]` — active days (same format: "seg", "ter", etc.)
  - `startTime: string` — "HH:MM" window start
  - `endTime: string` — "HH:MM" window end
  - `timezone: string` — defaults to "America/Sao_Paulo"
- **F1.3** Visual node component with single input/output handles, distinct styling (amber/yellow color family — conceptually "timer/clock")
- **F1.4** Sidebar configuration panel with day-of-week checkboxes, time pickers, timezone selector
- **F1.5** Executor logic:
  - If inside window: pass through immediately (record step, continue)
  - If outside window: pause execution, set `next_run_at` to next window start (reuse `getNextSendTime()`), set `current_node_id` to self for re-evaluation on resume
  - On resume re-evaluation: don't increment loop counter (same pattern as existing time_window condition)
- **F1.6** Node appears in toolbar under "Controle de Fluxo" group
- **F1.7** Node registered in `WorkflowCanvas` nodeTypes, `WorkflowSidebar` renderPanel, `AutomacoesEditor` createDefaultNodeData
- **F1.8** `NODE_COLORS`, `NODE_LABELS` updated for new type

### F2: Node "Definir Responsavel"

A standalone node for assigning a responsible team member to the lead, with 3 distribution modes.

- **F2.1** New node type `assign_responsible` added to `WorkflowNodeType`
- **F2.2** Node data interface `AssignResponsibleNodeData` with:
  - `assignMode: "round_robin" | "random" | "manual"` — distribution strategy
  - `assigneeId?: string` — for manual mode
  - `assigneeName?: string` — display name for manual mode
  - `memberIds?: string[]` — subset of team members to distribute among (optional filter for round_robin/random)
  - `assignTarget: "responsible" | "sdr" | "closer"` — which field(s) to update on the lead
- **F2.3** Visual node component with single input/output, distinct styling (rose/pink color — "people/team")
- **F2.4** Sidebar configuration panel with:
  - Mode selector (Rotativo / Aleatorio / Manual)
  - For Manual: team member dropdown
  - For Round-robin/Random: optional multi-select of team members to include (empty = all active)
  - Target selector (Responsavel / SDR / Closer)
- **F2.5** Executor logic:
  - `round_robin`: least-loaded distribution (reuse existing org-scoped logic from `handleAssignResponsible`)
  - `random`: pick a random active team member from the filtered set
  - `manual`: use the configured `assigneeId`
  - Update the lead's `responsible_id` (and optionally `sdr_id`/`closer_id` based on `assignTarget`)
  - Record step with assigned member info
- **F2.6** Node appears in toolbar under a new "Equipe" group (or existing "Basico" — TBD in design)
- **F2.7** Registered in Canvas nodeTypes, Sidebar renderPanel, Editor createDefaultNodeData
- **F2.8** `NODE_COLORS`, `NODE_LABELS` updated

### F3: Retry Failed Executions

Allow users to retry a failed workflow execution from the point of failure.

- **F3.1** "Repetir" button visible on failed executions in `AutomacoesExecucoes.tsx` — in the table row AND inside the steps dialog
- **F3.2** Retry creates a new `workflow_executions` record with:
  - Same `workflow_id`, `lead_id`, `organization_id`
  - `current_node_id` set to the failed node (the node where the original execution failed)
  - `context` copied from the original execution
  - `loop_counters` copied from the original execution
  - `status: "running"`
  - Reference to original execution: `retry_of` column (FK to workflow_executions.id)
- **F3.3** The workflow executor already supports resuming from `currentNodeId` — no changes needed to the execution engine
- **F3.4** New mutation `useRetryWorkflowExecution` in `useWorkflows.ts`
- **F3.5** UI shows a badge "Retry de #xxx" when an execution was created from a retry
- **F3.6** DB migration adds `retry_of` column to `workflow_executions` (nullable UUID FK)
- **F3.7** Permission: same as existing workflow permissions (admin only via `assertIsAdmin`)

## Out of Scope

- Partial retry (selecting which specific node to restart from) — always restarts from the failed node
- Retry for non-failed statuses (completed, running, paused)
- Bulk retry (retry all failed executions at once)
- Editing the workflow definition before retry
- New node type for "wait for external event" (future feature)

## Technical Notes

- The `time_window` condition mode already exists and uses `getNextSendTime()` — F1 reuses the same function
- The `assign_responsible` action already exists — F2 extracts its logic into a standalone node handler
- The executor's resume-from-node logic is already battle-tested (delay, wait_response, time_window condition all use it)
- F3 leverages the existing `currentNodeId` resume mechanism — the retry is essentially "create a new execution that starts where the old one failed"

## Dependencies

- F1 and F2 are independent — can be implemented in parallel
- F3 is independent of F1/F2
- All three require the same type of changes: types → node → panel → executor → editor registration
