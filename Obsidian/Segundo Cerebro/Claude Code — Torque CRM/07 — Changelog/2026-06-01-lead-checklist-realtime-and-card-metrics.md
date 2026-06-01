---
date: 2026-06-01
type: hotfix
branch: fix/lead-checklist-card-and-modal
target: main
modules: [leads, engagement, workflows]
---

# Hotfix — checklist no modal em tempo real + métricas do card

## Contexto

Dois bugs no card e no modal do lead:

1. **Card stale + anexo mentindo** — os 3 ícones do `LeadCard` (comentários, checklist, anexo)
   não refletiam dados reais em tempo real (`staleTime 30s`, sem realtime) e o ícone de anexo
   mostrava `0` fixo (tabela `lead_attachments` não existe).
2. **Checklist de automação invisível no modal** — node de workflow logava `"Checklist aplicado"`
   mas o checklist não aparecia no modal já aberto.

## Diagnóstico (Bug 2) — root cause READ-side, por dedução determinística

Não foi suposição. `applyChecklist` (`_shared/action-handlers/checklist-operations.ts`) só loga
`"aplicado"` em `success:true`, que exige o INSERT ter sucedido. `checklists.lead_id` tem FK
`REFERENCES leads(id)` — um `leadId` errado (ex: id de `pipeline_entry`) violaria a FK e abortaria
o insert antes do log. Logo, **a row existe com `lead.id` válido**. O bug é 100% no refresh:

- O modal usava um hook LOCAL `useLeadChecklists` (`LeadModalChecklist.tsx`), queryKey
  `["checklists","lead",leadId]`, **sem subscription realtime**. Só o `useChecklists()` do engagement
  assinava realtime — e o modal não o monta. INSERT vindo do backend nunca chegava ao modal aberto.
- `checklists` + `checklist_items` **estão** na publication `supabase_realtime`
  (migration `20260521120000`) — transporte OK; faltava o assinante.

Única falha WRITE-side que a FK não exclui: `leadId` nulo (coluna nullable → row órfã). Fechado.

## Mudanças

### READ-side (fix do bug)
- **`LeadModalChecklist.tsx`** — `useLeadChecklists` agora assina
  `useRealtimeSubscription("checklists", ["checklists"])` (prefix-matcha `["checklists","lead",leadId]`)
  e `useRealtimeSubscription("checklist_items", ["checklist_items","checklists"])` (fan-out staggered
  mantém as contagens do header frescas em mudança de item remota).
- **`useBatchedLeadMetrics.ts`** — realtime em `checklists`/`checklist_items` → `["lead-card-metrics"]`.
  Removido `attachmentsCount` (interface + EMPTY).
- **`useLeadComments.ts`** — create/delete invalidam `["lead-card-metrics"]` (`lead_comments` **não**
  está na publication realtime, então a contagem do card vem da invalidação cross-cache).
- **`LeadCardMetrics.tsx` / `LeadCard.tsx`** — ícone de anexo removido (honesto — sem feature),
  prop `attachmentsCount` eliminada.

### WRITE-side (hardening — previne regressão)
- **`checklist-operations.ts`** `applyChecklist`:
  - guarda `!leadId` → erro (não cria checklist órfão);
  - valida que o lead pertence à org (defense-in-depth; service-role bypassa RLS);
  - idempotência: seta `source_template_id` + pre-check `(org, lead, source_template_id)` + trata
    `23505` como sucesso idempotente. Espelha o trigger de stage (`uniq_checklists_lead_source`).

### Testes
- `tests/unit/action-handlers/checklist-operations.test.ts` — 11 testes (null-guard, lead cross-org,
  `source_template_id`, idempotência, race 23505).
- `tests/helpers/supabase-mock.ts` — novo `mockInsertError(table, error)` pra cobrir o branch 23505.

## QA (counts literais)
- `tsc --noEmit`: 0 errors
- `npm run build`: ✓ exit 0
- eslint (touched): 0 errors (warnings pré-existentes em test-helper)
- `checklist-operations.test.ts`: 11/11
- suites handler/executor (mock): 309/309
- Falhas pré-existentes (não causadas): `shared-action-handler-compat` (move-card, 2), `useLeadActionGates` (7) — confirmadas via `git stash`.

## Follow-up conhecido (aceito)
Checklists de workflow criados **antes** deste deploy têm `source_template_id = NULL` → na primeira
re-execução do node ganham 1 cópia duplicada (depois auto-dedupe). Blast radius limitado e
net-improvement sobre o comportamento antigo (que duplicava em **toda** execução). Opcional: migration
de backfill stampando `source_template_id` em checklists workflow-origin históricos. Não aplicado
(sem migration em prod sem pedido explícito).

## Revisão
Review adversarial multi-agente (4 dimensões → refutação de cada finding): 7 confirmados, 2 refutados.
Findings acionáveis (header counts, lead→org guard, teste 23505) aplicados; tradeoffs documentados
(comment count own-mutation, fan-out global de `checklist_items`).
