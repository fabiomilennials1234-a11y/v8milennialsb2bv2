---
type: reference
title: Modularização — Plano de Event-Bus
status: archived
created: 2026-05-26
updated: 2026-05-28
tags: [modularizacao, event-bus, arquitetura]
related:
  - "[[ADR-2026-05-26-modularizacao-monolito-modular]]"
  - "[[ADR-2026-05-28-modularizacao-conclusao]]"
  - "[[auditoria-duplicatas]]"
owner: gabriel
---

# Modularização — Plano de Event-Bus

> [!success] COMPLETED — 2026-05-28
> Plano **executado como piloto** no slice 19: `domain_events` + `_shared/events/` + edge `event-dispatcher` + cron, com `lead.stage_changed` migrado para o padrão de evento. A expansão pros demais eventos (lead.created, conversation.message_received, workflow.executed, …) ficou em backlog separado fora do escopo da modularização. Ver [[ADR-2026-05-28-modularizacao-conclusao]].

**Created:** 2026-05-26
**Owner:** arquiteto
**Status:** ✅ Concluído 2026-05-28 (piloto `lead.stage_changed` no slice 19)
**SPEC:** [`.specs/features/modularizacao/SPEC.md`](../../../../../.specs/features/modularizacao/SPEC.md)

Modularização física resolve **onde mora o código**. Event-bus resolve **como módulos conversam**.

Tese: módulo conversa com módulo via **eventos de domínio**, não via chamada direta de função. API pública de um módulo são (1) types + (2) handlers de evento publicados — não export de funções side-effecting.

---

## 1. Por que agora

Backlog confirma sintoma: `08 — Backlog/backlog/triggerStageChangedWorkflows-duplicate.md` — quando lead muda de stage, `triggerStageChangedWorkflows()` é chamado **em 3 lugares diferentes**, às vezes 2x para o mesmo evento. Bugs:
- Workflow disparado em duplicidade
- Workflow não disparado se chamador esqueceu de invocar
- Acoplamento lateral: módulo Pipeline conhece módulo Workflow

Sintoma genérico: cada feature nova que toca `leads` ou `pipeline_entries` força auditar TODOS os call sites que reagem a esse domínio. Não escala.

---

## 2. Eventos de domínio identificados

| Evento | Disparado em | Reagentes atuais (call sites diretos) |
|--------|--------------|----------------------------------------|
| `lead.created` | `lead-webhook`, `import-leads`, frontend create | pipe placement, tags assignment, scoring, history insert, workflow_rules match, n8n outbound |
| `lead.updated` | `useUpdateLead`, edge updates | field_changes log, embedding refresh, qualification re-score |
| `lead.stage_changed` | `pipeline-adapter.upsertPipeEntry`, frontend drag, `process-pipe-distribution` | `triggerStageChangedWorkflows` (3 call sites), campaign rules, notifications, lead_history insert |
| `lead.assigned` | round-robin distribution, manual assign | notifications, history |
| `lead.tag_added` / `tag_removed` | `useTags`, automation actions | workflow_rules match |
| `message.received` | `whatsapp-webhook`, `meta-webhook`, `sz-chat-webhook` | conversation upsert, copilot agent-engine, message-classifier, lead linking, dead-session-recovery |
| `message.sent` | `message-gateway`, `outbound-sender`, `followup-sender` | outbound_dispatch_log, conversation_context_summary, lead pipe sync (`pipe_whatsapp=abordado`), whatsapp_messages upsert |
| `workflow.step_executed` | `workflow-executor` | execution log, downstream step trigger, dead-letter on fail |
| `campaign.dispatched` | `campaign-distribution`, `mass-send-create` | outbound queue insert, dispatch log |
| `conversation.read` | mark_read RPCs | unread counter refresh |
| `instance.session_died` | `whatsapp-session-watchdog` | banner UI, fallback polling, alert |
| `order.created` / `order.approved` | quick-order, order approval | tinyerp push, commission calc, upsell trigger, lead_history |
| `human_pause.requested` / `released` | copilot pause hooks | agent stop, banner, audit |

13 eventos canônicos. Cobrem ~70% do acoplamento cross-module hoje resolvido por chamada direta.

---

## 3. Padrão proposto

### 3.1 Type-safe domain events

```typescript
// _shared/events/types.ts
export type DomainEvent =
  | { type: "lead.stage_changed"; orgId: string; leadId: string; fromStage: string; toStage: string; pipeKey: string }
  | { type: "message.received"; orgId: string; conversationId: string; messageId: string; channel: "whatsapp" | "meta" | "sz_chat" }
  | { type: "message.sent"; orgId: string; messageId: string; leadId: string | null; instanceId: string }
  // ... outros 10
```

### 3.2 Publisher (uma forma de emitir)

```typescript
// _shared/events/publish.ts
export async function publishEvent(supabase: SupabaseClient, event: DomainEvent) {
  await supabase.from("domain_events").insert({
    type: event.type,
    org_id: event.orgId,
    payload: event,
    occurred_at: new Date().toISOString(),
  });
}
```

Tabela `domain_events`:
```sql
create table domain_events (
  id uuid default gen_random_uuid() primary key,
  type text not null,
  org_id uuid not null references organizations(id),
  payload jsonb not null,
  occurred_at timestamptz not null default now(),
  processed_at timestamptz,
  failed_at timestamptz,
  error text,
  attempt_count int default 0
);
create index on domain_events(processed_at) where processed_at is null;
create index on domain_events(type, occurred_at);
```

### 3.3 Dispatcher (worker pg_cron 1/sec)

`supabase/functions/event-dispatcher/index.ts` puxa `processed_at is null`, faz fanout pra handlers registrados, marca processado/falho. Padrão de retry com `attempt_count`.

### 3.4 Handlers registrados por módulo

```typescript
// modules/workflows/handlers.ts
export const workflowHandlers: EventHandler[] = [
  {
    on: "lead.stage_changed",
    handler: async (event, ctx) => {
      await triggerStageChangedWorkflows(ctx.supabase, event);
    },
  },
];
```

Handlers registrados num índice central (`_shared/events/registry.ts`):
```typescript
export const allHandlers = [
  ...workflowHandlers,
  ...campaignHandlers,
  ...notificationHandlers,
  ...analyticsHandlers,
];
```

Cross-module via evento. Módulo Pipeline não importa módulo Workflow.

### 3.5 Realtime no frontend

Frontend continua usando `useRealtimeSubscription(table, queryKeys)` direto nas tabelas afetadas. Event-bus é backend-only. Eventualmente: subscription em `domain_events` filtrada por type → push notifications, UI toasts cross-module.

---

## 4. Tradeoffs

### Pros
- Acopla módulo a **contrato de evento**, não a função.
- Adicionar listener novo = adicionar handler, sem tocar emissor.
- Audit log natural via `domain_events`.
- Reprocessamento simples (reset `processed_at`).
- Caminho de extração pra microserviço fica trivial (handler vira HTTP endpoint).

### Cons
- **Async**: stage change → workflow não é mais síncrono. UI precisa optimistic update (já faz hoje).
- **Latência**: até 1s pra workflow disparar (poll do dispatcher). Aceitável pra workflows; inaceitável pra UX inline.
- **Dispatcher como SPOF**: se cron parar, eventos acumulam. Mitigação: alarme em `processed_at < now() - 30s` count.
- **Ordem**: 2 eventos do mesmo lead em sequência podem processar em paralelo. Handler tem que ser idempotente.
- **Custo de migração**: cada `await X()` direto vira `await publishEvent(...)` + handler em outro módulo. ~30-50 call sites.

### Por quê async (e não in-process publisher síncrono)

Edge functions são stateless e isoladas. Não dá pra registrar handler em memória entre invocações. Alternativa síncrona = chamar todas as edge functions handlers de dentro de um wrapper — recria o acoplamento que queremos remover.

DB-backed queue é o padrão simples e suficiente até 1000+ orgs.

---

## 5. Slice de execução proposta

**Slice 19 (novo) — `feat/modularizacao/18-event-bus`** (8h):

1. Migration: `domain_events` table + indexes.
2. `_shared/events/{types,publish,dispatch,registry}.ts`.
3. Edge function `event-dispatcher` + cron `*/1 * * * *`.
4. **Piloto**: migrar `lead.stage_changed` (3 call sites → 1 publish + 1 handler workflow).
5. Smoke + observability (Sentry breadcrumb com event.type).

Slices 20-24 (sequenciais, 1 evento por slice, 3-5h cada): `message.received`, `message.sent`, `lead.created`, `campaign.dispatched`, `workflow.step_executed`.

**Ordem em relação aos 18 slices SPEC**: depois de slice 17 (docs+ESLint error mode). Modularização física precisa estar consolidada antes de mover comunicação inter-módulo pra eventos. Tentar antes = mover acoplamento duas vezes.

---

## 6. Critérios de aceite (do piloto, slice 19)

- [ ] Migration aplicada em dev
- [ ] `triggerStageChangedWorkflows` chamado em **1 só lugar** (handler do evento)
- [ ] Drag lead no kanban → evento publicado → workflow dispara em <2s
- [ ] Idempotência: re-processar evento mesmo `lead.stage_changed` não duplica execução
- [ ] Dispatcher cron rodando + Sentry breadcrumb com `event.type`
- [ ] Backlog `triggerStageChangedWorkflows-duplicate.md` fechado

---

## 7. Decisões pendentes (CTO)

1. **Adotar no plano de modularização atual** (slice 19 antes da finalização), ou projeto separado pós-mod?
   - Pró agora: consolida o padrão antes de docs/CLAUDE.md raiz, evita 2 grandes refactors.
   - Pró depois: modularização já é 80h; adicionar +30h pode atrasar shippping.
   - **Recomendação arquiteto:** adotar piloto (slice 19) agora; expansão pra 5+ eventos como projeto separado.

2. **Granularidade do dispatcher**: 1 cron 1/sec dispara todos os tipos, ou 1 worker por tipo (paralelismo melhor, isolamento de falha)?
   - **Recomendação:** começa com 1 worker único, mede latência, particiona se necessário.

3. **Frontend escuta `domain_events`?**: Opção pra v2. Por enquanto frontend reage a tabelas de domínio direto.

---

## Refs

- SPEC modularização: [`.specs/features/modularizacao/SPEC.md`](../../../../../.specs/features/modularizacao/SPEC.md)
- ADR: [ADR-2026-05-26-modularizacao-monolito-modular](../../04%20—%20Decisões/ADR-2026-05-26-modularizacao-monolito-modular.md)
- Auditoria duplicatas: [auditoria-duplicatas.md](auditoria-duplicatas.md)
- Backlog correlato: `08 — Backlog/backlog/triggerStageChangedWorkflows-duplicate.md`
- Fundamentação: [Augusto Galego — monolito modular](../../../Clippings/(1197)%20Acabou%20o%20hype%20de%20microsserviços.%20Voltamos%20pra%202010.md) — interfaces como contrato, ports and adapters.
