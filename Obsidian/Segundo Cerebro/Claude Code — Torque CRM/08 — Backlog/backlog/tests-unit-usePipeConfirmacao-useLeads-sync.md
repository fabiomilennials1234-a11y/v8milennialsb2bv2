---
type: backlog
title: Testes unit — useUpdatePipeConfirmacao + useUpdateLead sync paths
status: backlog
created: 2026-04-12
updated: 2026-04-12
tags: [uncategorized]
related: []
owner: gabriel
---

# Testes unit — useUpdatePipeConfirmacao + useUpdateLead sync paths

## Problema

O fix de 2026-04-30 introduziu lógica nova em dois hooks críticos:

- `useUpdatePipeConfirmacao` — SELECT-then-compare antes de checar `move_pipe_record`, fail-closed em loading, sync `meeting_date → leads.compromisso_date`, filtros `.eq("organization_id")` defensivos.
- `useUpdateLead` — sync inverso `compromisso_date → pipe_confirmacao.meeting_date` via UPDATE puro best-effort.

Testes unit ainda não cobrem esses paths. Regressão futura é fácil de introduzir sem cobertura.

## Cenários a cobrir

### `useUpdatePipeConfirmacao`

- [ ] `updates.status === current.status` → SELECT roda, `status` removido do payload, UPDATE não recebe `status`.
- [ ] `updates.status !== current.status` + `movePermission.allowed === false` → throw "Sem permissão".
- [ ] `updates.status !== current.status` + `movePermission === undefined` (loading) → throw "Sem permissão" (fail-closed).
- [ ] `updates.status !== current.status` + `movePermission.allowed === true` → UPDATE passa com `status`.
- [ ] SELECT falha (erro DB) → throw "Registro não encontrado".
- [ ] SELECT retorna 0 rows → throw "Registro não encontrado".
- [ ] `updates.meeting_date === undefined` → não dispara sync para `leads`.
- [ ] `updates.meeting_date === null` → sync escreve `compromisso_date = null`.
- [ ] `updates.meeting_date` setado + `leadId` ausente → não dispara sync.
- [ ] `organizationId === undefined` → throw "Cannot update pipe_confirmacao".
- [ ] `triggerFollowUpAutomation` só chamada quando `isStatusChange === true`.
- [ ] `onSuccess` invalida `["pipe_confirmacao"]` E `["leads"]`.

### `useUpdateLead`

- [ ] `safeUpdates.compromisso_date !== undefined` → UPDATE em `pipe_confirmacao` com filtros `.eq("lead_id").eq("organization_id")`.
- [ ] `safeUpdates.compromisso_date === undefined` → não dispara sync.
- [ ] UPDATE em `pipe_confirmacao` falha → `console.warn` chamado, mutation **não** falha.
- [ ] Payload do sync inverso é literal (sem spread) — assert que apenas `meeting_date` está no objeto.
- [ ] Operação é `update` (asserção AST/spy), nunca `upsert` ou `insert`.

## Estratégia

- Mock de `supabase` com helper `scripted()` (mesmo padrão de `tests/unit/lead-service-branches.test.ts`).
- Mock de `useCanPerformActionAsync` retornando `{ data: { allowed: bool } | undefined }`.
- Mock de `useOrganization` retornando `{ organizationId: "org-test" }`.
- Renderizar hooks com `renderHook` + `QueryClientProvider`.

## Critérios de aceite

- Cobertura de `usePipeConfirmacao.ts` ≥ 90% lines / 85% branches.
- Cobertura de `useLeads.ts` ≥ 85% lines (foco nos novos paths).
- Threshold ratchet em `vitest.config.ts` para travar regressão.
