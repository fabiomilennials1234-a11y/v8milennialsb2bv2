---
type: changelog
title: torque-mcp S7 (workflow builder DSL) + trigger "Antes de uma data" (Fatia 1)
status: shipped
created: 2026-06-25
updated: 2026-06-25
tags: [changelog, torque-mcp, workflows, mcp, automacoes, prod]
related: ["[[ADR-2026-06-22-torque-mcp-interno]]", "[[2026-05-27-slice-08-workflows]]"]
owner: Gabriel
---

# torque-mcp S7 — workflow builder + trigger "Antes de uma data" (Fatia 1)

Dois trabalhos sobre o domínio **Workflows** mergeados em `main`: a superfície MCP pra
montar/editar automações por IA (S7) e um novo gatilho temporal `scheduled_date`.

## Mudanças

### torque-mcp S7 — `workflow.*` tools (DSL declarativa) — PR #912 (`ea7fa669`)
- **`_shared/workflow-schema/`** (novo, Deno+Zod, single source of truth): uma **DSL
  declarativa → compilador determinístico** (sem `Date.now`/`Math.random` — `runMutation`
  re-hasheia o plano no confirm) que gera o DAG `{nodes,edges}` do executor com handles
  canônicos (`yes`/`no`, `replied`/`timeout`, `variant_<id>`, `error`). A IA descreve a
  intenção (trigger + passos + ramos then/else, replied/timeout, variantes de split,
  terminais goto/end); **nunca escreve ids/handles/posições**.
- **Validador Zod em camadas**: graph integrity (estrita) pra todos; required-config pras
  ações curadas de alta frequência; passthrough pro long tail. Ciclos são permitidos
  (workflows são grafo dirigido **com ciclos limitados**, não DAG), mas um loop "quente"
  sem `delay`/`wait` gera **warning**.
- **Enums portados** de `src/types/workflow.ts` para o engine Deno, com **parity test**
  guardando drift entre os dois contratos.
- **`torque-mcp/tools/workflow.ts`**: `workflow.get` / `workflow.validate` (readonly) e
  `workflow.build` (create+edit) / `workflow.set_active` (mutating, atrás de
  `TORQUE_MCP_ALLOW_MUTATIONS`) via `runMutation` (dry-run → confirm → audit-first).
  Escreve via **master JWT** sob a RLS existente `master_all_workflows` — **sem RPC
  SECURITY DEFINER (anti-bypass), sem service_role, sem migration nova**.
- **Safety**: DAG inválido nunca é escrito (nenhum `confirm_token` é cunhado) e workflows
  são criados/editados **INATIVOS** salvo ativação explícita confirmada. Edit model = full
  re-spec (sem decompiler no v1); `goto` reservado, ainda não emitido.

### Trigger "Antes de uma data" (`scheduled_date`) — Fatia 1 — PR #896 → #914 (`e77a5b44`)
Tracer bullet ponta-a-ponta da âncora `antes_da_reuniao` (unidade: dias):
- **Tipos**: `scheduled_date` em `WorkflowTriggerType` / `TRIGGER_LABELS` /
  `TRIGGER_CATEGORIES` (grupo Pipeline) + `TriggerConfigScheduledDate` + `ScheduledDispatchItem`.
- **Migration**: ledger `scheduled_date_dispatch_log` com unicidade
  `(workflow_id, lead_id, meeting_date, item_key)` + RLS por org (write `service_role`).
- **Função pura `planScheduledDateDispatches`** (sem I/O): offset→segundos, `send_time` no
  fuso da org, janela perdida, reunião passada, dedup + re-arme por `meeting_date`.
- **Casca `processScheduledDateTriggers`** espelha `processCronTriggers`; chamada no modo
  `cron_triggers` do `process-workflow-executions` (pg_cron ~1 min).
- **UI**: bloco `scheduled_date` no `TriggerPanel` (pipe + multi-etapa + lista de disparos).
- `item_key` estável por índice → editar a config afeta **só os pendentes**.

## Arquivos tocados

**S7 (#912):**
- `supabase/functions/_shared/workflow-schema/` — **novo** módulo: `dsl.ts`, `dsl-schema.ts`,
  `compiler.ts`, `validator.ts`, `enums.ts`, `definition.ts`, `index.ts` (+ `.test.ts` de cada).
- `supabase/functions/torque-mcp/tools/workflow.ts` (+ `workflow.test.ts`) — **novo**. As 4 tools.
- `supabase/functions/torque-mcp/index.ts` — registro das tools (+10 linhas).
- `supabase/functions/deno.json` — adiciona `zod@3.23.8`.
- `CONTEXT.md` — termo *Workflow* afiado (grafo dirigido com ciclos limitados).
- `docs/adr/0013-workflow-builder-mcp-declarative-dsl.md` — **novo** (status accepted).
- Total: 17 arquivos, +1939/−2.

**Fatia 1 (#914):**
- `src/types/workflow.ts` — tipos `scheduled_date`.
- `supabase/functions/_shared/workflow-trigger.ts` — planner puro + casca.
- `supabase/functions/process-workflow-executions/index.ts` — wiring no modo `cron_triggers`.
- `supabase/migrations/20261222000000_scheduled_date_dispatch_log.sql` — **novo** ledger + RLS.
- `src/.../sidebar-panels/TriggerPanel.tsx` — bloco de UI.
- `tests/unit/workflow-trigger-scheduled-date.test.ts` — **novo**.
- Total: 6 arquivos, +889/−5.

## Decisões

- **A tool de build vive no `torque-mcp` (ops/interno), mutating** — não no `crm-mcp`
  customer-facing (seria a 1ª escrita de cliente, amplia risco multi-tenant; exige ADR
  própria). Escreve sob `master_all_workflows` via master JWT, sem RPC e sem migration.
  Detalhe em `docs/adr/0013`.
- **Input declarativo (DSL) compilado pela tool, não definição crua `{nodes,edges}`** — a
  IA erra wiring de edge/handle silenciosamente; o compilador determinístico elimina essa
  classe de bug.

## Verificação

- **S7**: `deno test _shared/workflow-schema/ torque-mcp/` → **101 passed | 0 failed** (34
  novos); `deno lint`/`deno fmt --check` clean. Nada aplicado/deployado (default dev).
- **Fatia 1**: 17 casos de teste (planner: dispara/janela/passada/dedup/re-arme/audiência/
  unidades; shell: insere execução+ledger, dedup, vazio).
- Ambos os commits confirmados em `origin/main`.

## Follow-ups

- **S7**: reconectar o MCP (`/mcp`) para o Claude enxergar as 4 tools novas; deploy do
  `torque-mcp` em dev/prod (precisa `SUPABASE_ACCESS_TOKEN` de `.env.development`).
- **Trigger `scheduled_date`**: âncora `ao_marcar` fica para a **Fatia 2 (#897)**; docs
  formais (CONTEXT.md + ADR) para a **Fatia 4 (#899)**.
