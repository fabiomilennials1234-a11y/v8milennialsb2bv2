---
type: reference
title: Execução — Decisões Pendentes
status: concluido
created: 2026-05-26
updated: 2026-05-28
tags: [remodelagem, execucao, decisoes-pendentes]
related: ["[[slices]]", "[[ADR-2026-05-28-modularizacao-conclusao]]"]
---

# Execução — Decisões Pendentes (CTO)

> [!check] RESOLVIDAS — 2026-05-28
> Todas as decisões abaixo foram resolvidas ao longo da execução (slices 0–19 merged). #1 (ADR) aprovado; #2–#9 decididos slice a slice — ver [[slices]] e [[ADR-2026-05-28-modularizacao-conclusao]]. Notar: slice 14 (edge functions) foi **descartada como reorg física** e substituída por mapping doc-only em `supabase/functions/CLAUDE.md`, então os itens #4 (webhooks ambíguos) ficaram para auditoria doc-only fora do escopo da modularização. Doc mantido como registro histórico do raciocínio.

Bloqueios aguardando decisão. Cada item trava 1 slice específica.

## 1. Aprovar ADR-2026-05-26 (raiz de tudo)

Status: Proposta. Aguardando aprovação CTO.

**Trava:** slice 1 (tooling) e todo o resto.

ADR: [[ADR-2026-05-26-modularizacao-monolito-modular]].

## 2. `useAutoSaveField` vs `useExplicitSaveForm` — qual é o padrão?

3 hooks coexistem sem convenção declarada:
- `useAutoSaveField` — save imediato em blur/change
- `useExplicitSaveForm` — save explícito em submit
- `useOptimisticConflictHandler` — gerencia conflito de versão

**Hipótese arquiteto:** AutoSave pra inline edit (lead card), Explicit pra modais de criação, ConflictHandler como peça compartilhada.

**Trava:** slice 03 (leads) — qual fica em `modules/leads/hooks/`?

## 3. Deal é entidade viva ou legado?

`useDeals`, `useDealItems`, `useNewOrder`, `useQuickOrder`, `useOrderApproval` coexistem. CONTEXT.md lista "Order" mas não "Deal".

**Suspeita:** `useDeals*` é UI legacy pre-pipeline. Auditar:
- Páginas roteadas para Deals?
- Mutations escrevem em `deals` table?
- Algum cliente ainda usa?

**Trava:** slice 09 (carteira) — incluir `deals/` ou deletar?

## 4. Webhooks ambíguos

Decidir destino/sobrevivência de:
- `webhook-new-lead` — duplica `lead-webhook`?
- `meeting-webhook` — duplica `webhook-calcom`?
- `webhook-confirmacao` — vivo?
- `partner-webhook` — vivo? para qual parceiro?
- `erp-order-webhook` — duplica `tinyerp-webhook` ou é outro ERP?

**Trava:** slice 14 (edge functions) — decidir antes de mover.

**Sugestão arquiteto:** auditoria 1-a-1 em slice 14, com flag pra deletar se confirmado órfão.

## 5. Pages `MockupChat*` (4 variantes)

`MockupChat.tsx` + `MockupChatV2.tsx` + `MockupChatV3.tsx` + `MockupChatV3 2.tsx` (último com espaço no nome = filename corrupto de copy-paste).

Opções:
- Deletar todas (provavelmente certo)
- Manter 1 como dev tool em `tests/fixtures/`
- Mover toda variante histórica para `tests/mockups/` (paranoia)

**Trava:** slice 05 (communication).

**Sugestão arquiteto:** deletar `MockupChatV3 2.tsx` (corrupto) e `V1`/`V2`; auditar `V3` (atual?); mover canônica pra `modules/communication/mockups/` se ainda referenciada.

## 6. Event-bus piloto entra agora ou depois?

Slice 19 propõe piloto event-bus dentro do projeto de modularização.

Opções:
- **Adotar agora (slice 19 antes do finalize)**: consolida padrão antes de docs/CLAUDE.md raiz, evita 2 grandes refactors. +8h.
- **Adiar pra projeto separado**: modularização já é ~84h; adicionar +8h pode atrasar shipping; event-bus pode ter prioridade revisada.

**Sugestão arquiteto:** adotar piloto agora. Fecha 1 bug recorrente (`triggerStageChangedWorkflows-duplicate`), valida padrão, e o resto da expansão (5+ eventos) vira projeto separado pós-mod.

**Trava:** decisão de incluir ou não slice 19.

## 7. Granularidade do dispatcher (se event-bus aprovado)

1 cron `*/1 * * * *` dispara todos os tipos, ou 1 worker por tipo (paralelismo melhor, isolamento de falha)?

**Sugestão arquiteto:** começa com 1 worker único, mede latência, particiona se necessário.

## 8. `useFieldChangelog` exporta só `FIELD_LABELS`

Hook sem queryFn — apenas constantes de labels.

**Sugestão arquiteto:** mover `FIELD_LABELS` pra `src/shared/format/lead-field-labels.ts`, deletar hook. Confirmar nenhum lugar importa o hook como hook (só constantes).

**Trava:** slice 03 (leads).

## 9. Frontend escuta `domain_events`?

Opção v2 do event-bus: frontend subscreve realtime em `domain_events` filtrado por type → push notifications, toasts cross-module.

**Sugestão arquiteto:** out-of-scope da modularização. Frontend continua reagindo a tabelas de domínio direto via `useRealtimeSubscription`.

## Como decidir rapidamente

Cada item acima é uma pergunta sim/não ou A/B. Sessão de alinhamento de ~30min com CTO resolve todas exceto #4 (precisa auditoria edge-fn-por-edge-fn antes de decidir, ~1h).

## Refs

- [[slices]] — ordem de execução
- ADR: [[ADR-2026-05-26-modularizacao-monolito-modular]]
- Auditoria: [[auditoria-duplicatas]]
- Event-bus: [[event-bus-plano]]
