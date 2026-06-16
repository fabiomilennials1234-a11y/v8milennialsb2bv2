---
date: 2026-06-09
type: fix
branch: fix/pipe-stage-ghost-leads
target: main
modules: [pipelines, leads, communication]
---

# Fix — leads caindo em "stage fantasma" no ingest externo (Make/n8n)

## Sintoma

Org TrooveBR: 7 leads de WhatsApp invisíveis no Kanban de Oportunidades. Todos em
`pipeline_entries.stage_key = "novo"` — uma etapa **desativada** (`is_active=false`).
A org usa `novo_lead` como 1ª etapa ativa; a seed `novo` foi desativada.

## Causa raiz

Dois problemas independentes que se somam:

1. **Ingest hardcoda `"novo"`.** `lead-webhook`, `_shared/lead-service.ts` e
   `webhook-orchestrator` gravavam `stage_key="novo"` (e `leads.pipe_whatsapp="novo"`)
   sem olhar as etapas reais da org. Orgs que renomearam/desativaram a seed `novo`
   (ex: `novo_lead`) recebiam todo lead novo num stage que o Kanban não renderiza
   (`usePipelineStages` filtra `is_active=true`). `place_in_pipe.stage` do Make
   também era gravado **sem validar** contra `pipeline_stages`.

2. **Delete de etapa deixava leads órfãos.** `useDeletePipelineStage` fazia
   soft-delete (`is_active=false`) sem migrar os leads que ainda estavam nela — o
   próprio dialog avisava "os leads continuarão com o status atual". Hard-delete
   **não** resolveria: o pipe canônico usa `stage_key` string (sem FK), então
   apagar a row deixaria a string órfã do mesmo jeito, e ainda perderia histórico
   / recuperabilidade.

## Fix

**Camada 1 — resolver no ingest (raiz).** Novo `resolveActiveStageKey()` em
`_shared/pipeline-adapter.ts`: resolve o stage-alvo contra as etapas ATIVAS da org
(usa o pedido se ativo; senão a 1ª etapa ativa por `position`; `null` se a org não
tem etapas → caller cai no seed estático). Aplicado em 5 call-sites:
`lead-webhook` (path default + `place_in_pipe`), `lead-service` (getOrCreate +
promote shadow), `webhook-orchestrator`. Lead nunca mais entra em stage fantasma
via ingest, **independente** do que o Make manda.

**Camada 2 — migrar-e-desativar no delete (defense-in-depth).** `useDeletePipelineStage`
agora conta leads na etapa; se houver, exige `migrateToStageKey` e migra
`pipeline_entries.stage_key` antes de desativar. Novo `usePipelineStageLeadCounts`
alimenta a UI. `ManagePipelineStagesModal` mostra um seletor de destino quando a
etapa tem leads e bloqueia o "Remover" até escolher.

**Camada 3 — cleanup TrooveBR.** Remap dos 7 leads `novo`→`novo_lead`
(`pipeline_entries`). Operação de dados em prod (executar separado, com OK do CTO).

## Gotcha registrada

- `DEFAULT_STAGES.whatsapp[0].id === "novo"` (`src/contracts/pipe/pipe-defaults.ts`).
  Orgs que customizam a 1ª etapa divergem da seed → o hardcode batia exatamente aí.
- Pipe canônico `pipe_*` = view sobre `pipeline_entries`; `status = stage_key`
  (string, sem FK). Migração de leads = `update pipeline_entries set stage_key`.

## Deploy

Edge functions afetadas (deploy manual, exige CTO):
`lead-webhook`, `webhook-orchestrator` (ambas usam `_shared/pipeline-adapter.ts` +
`_shared/lead-service.ts`, que vão junto no bundle).

## Testes

- `supabase/functions/_shared/pipeline-adapter.test.ts` (Deno) — 5 casos do resolver.
- `tests/unit/use-delete-pipeline-stage-migration.test.ts` (vitest) — 5 casos:
  etapa vazia, sem destino (throw), com destino (migra+desativa), destino==origem
  (throw), tally de counts. **5 passed.**
