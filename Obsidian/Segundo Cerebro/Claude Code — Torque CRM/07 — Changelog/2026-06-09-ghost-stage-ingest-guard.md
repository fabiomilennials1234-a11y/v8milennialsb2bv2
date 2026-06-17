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

---

# Camada 4 (2026-06-17) — guard no chokepoint de INSERT das views pipe_*

branch: `fix/ghost-stage-unguarded-lead-create` · target: main

## Sintoma (reincidência da mesma classe)

Org "Dna de Almas" (`d67ae17a-815d-476d-b3a9-287c7b267997`): lead "Flávia Luiza
Barros Machado" (`a544c1fa-5428-4324-bbe1-5ae94033b879`, `origin='outro'`,
`phone=null`, criado 2026-06-17 22:36) caiu em `pipeline_entries.stage_key='novo'`
— etapa DESATIVADA nessa org (migrada pro Funil B, 1ª etapa ativa = `novo_lead`).
Lead invisível no Kanban. Criado DEPOIS de `novo` virar inativa.

## Por que a Camada 1 não cobriu

`resolveActiveStageKey` (Camada 1) guardava só os 5 call-sites que escrevem em
`pipeline_entries` **diretamente** (lead-webhook, lead-service, webhook-orchestrator).
Existia um path inteiro não-coberto: writers que passam pelas **views compat
`pipe_*`** (cujas INSTEAD OF INSERT triggers gravavam `COALESCE(NEW.status,
'<default>')` sem validar etapa ativa).

## Path culpado (que criou a Flávia)

`webhook-new-lead/index.ts:359-383` → RPC `create_lead_with_pipe`
(`20261114000011_guard_definer_analytics_rpcs.sql:67-76`) com `p_pipe_status='novo'`
→ INSERT em view `pipe_whatsapp` → `pipe_whatsapp_insert_fn` gravava `'novo'`
literal em `pipeline_entries.stage_key`, sem checar `is_active`. Aceita lead com
`phone=null` (só `name` obrigatório); `origin` cai em `'outro'`. Casa 1:1 com a
Flávia. Mesma porta: `webhook-confirmacao` e TODO writer frontend das views.

## Fix (raiz, defense-in-depth)

`20261220000000_ghost_stage_guard_pipe_insert.sql`:
- Novo helper SQL `fn_resolve_active_stage_key(org, type, requested, fallback)` —
  espelha `resolveActiveStageKey`: (1) requested se ativo; (2) 1ª etapa ativa (min
  position); (3) `COALESCE(requested, fallback estático)` se org não tem etapa ativa.
- `pipe_whatsapp/confirmacao/propostas_insert_fn` agora resolvem `stage_key` via o
  helper. Como TODO writer de pipe canônico passa por essas views (RPC, frontend,
  edge), o guard cobre o caminho inteiro num só lugar. UPDATE/DELETE não mudam
  (mover pra etapa inativa é caso de uso legítimo).

Frontend (defense-in-depth, intenção correta — não mandam mais slug fantasma):
- `useWhatsAppLeadIntegration.ts` (`useLinkLeadToWhatsApp`): `status:'novo'` →
  `getFirstStageKey(org,'whatsapp')`.
- `CreateOpportunityModal.tsx`: `status:'novo'` → 1ª etapa ativa via
  `usePipelineStages('whatsapp')[0]`.

## Testes

- `tests/integration/ghost-stage-guard-pipe-insert.test.ts` (vitest + pg local) —
  5 cenários: Funil B + view INSERT `novo`→`novo_lead`; Funil B + RPC
  `create_lead_with_pipe('novo')`→`novo_lead`; Funil B + `abordado` (ativa) mantém;
  org default-seed `novo`→`novo`; org sem etapas → fallback estático `novo`.
  (Roda no job integration-tests do CI — Docker local indisponível na sessão.)

## Gotcha

- A org DNA já foi corrigida MANUALMENTE em prod nesta sessão (remap da Flávia).
  Este fix é só código — NÃO toca prod.
- Fallback estático preservado verbatim (`novo_lead`/`marcada`/`enviada`) — só dispara
  em org com ZERO etapa ativa (não-seedada); zero mudança de comportamento nesse caso.
