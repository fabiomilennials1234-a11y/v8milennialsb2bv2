---
type: reference
title: Solução — Event-Bus
status: active
created: 2026-05-26
tags: [remodelagem, solucao, event-bus]
related:
  - "[[event-bus-plano]]"
  - "[[monolito-modular]]"
---

# Solução — Event-Bus

Modularização física resolve **onde mora o código**. Event-bus resolve **como módulos conversam**.

Detalhe completo em [[event-bus-plano]] (`06 — Features/modularizacao/event-bus-plano.md`).

## Tese

Módulo conversa com módulo via **eventos de domínio**, não via chamada direta de função. API pública de um módulo são (1) types + (2) handlers de evento publicados — não export de funções side-effecting.

## Sintoma que justifica

Backlog `triggerStageChangedWorkflows-duplicate.md`: quando lead muda de stage, `triggerStageChangedWorkflows()` é chamado em **3 lugares diferentes**, às vezes 2x. Bugs:
- Workflow disparado em duplicidade
- Workflow não disparado se chamador esqueceu
- Acoplamento: Pipeline conhece Workflow

Generalizado: cada feature nova que toca `leads` ou `pipeline_entries` força auditar todos os call sites.

## Eventos canônicos identificados

13 eventos cobrem ~70% do acoplamento cross-module atual:

| Evento | Disparado em | Reagentes |
|--------|--------------|-----------|
| `lead.created` | `lead-webhook`, `import-leads`, frontend create | pipe placement, tags, scoring, history, workflow_rules, n8n outbound |
| `lead.updated` | `useUpdateLead`, edge updates | field_changes log, embedding refresh, re-score |
| `lead.stage_changed` | `pipeline-adapter`, frontend drag, `process-pipe-distribution` | workflows (3 call sites), campaign rules, notifications, history |
| `lead.assigned` | distribution, manual assign | notifications, history |
| `lead.tag_added/removed` | `useTags`, automation | workflow_rules match |
| `message.received` | webhooks (whatsapp, meta, sz_chat) | conversation upsert, copilot, classifier, lead linking, dead-session-recovery |
| `message.sent` | gateway, outbound-sender, followup-sender | dispatch log, conversation summary, pipe sync, whatsapp_messages upsert |
| `workflow.step_executed` | workflow-executor | execution log, downstream step, dead-letter |
| `campaign.dispatched` | campaign-distribution, mass-send | outbound queue, dispatch log |
| `conversation.read` | mark_read RPCs | unread counter |
| `instance.session_died` | whatsapp-session-watchdog | banner UI, fallback polling, alert |
| `order.created/approved` | quick-order, order approval | tinyerp push, commission, upsell, history |
| `human_pause.requested/released` | copilot pause | agent stop, banner, audit |

## Padrão proposto

### Tabela bus

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

### Type-safe events

```typescript
export type DomainEvent =
  | { type: "lead.stage_changed"; orgId: string; leadId: string; fromStage: string; toStage: string; pipeKey: string }
  | { type: "message.received"; orgId: string; conversationId: string; messageId: string; channel: "whatsapp" | "meta" | "sz_chat" }
  // ... outros 11
```

### Publisher único

```typescript
export async function publishEvent(supabase: SupabaseClient, event: DomainEvent) {
  await supabase.from("domain_events").insert({
    type: event.type,
    org_id: event.orgId,
    payload: event,
    occurred_at: new Date().toISOString(),
  });
}
```

### Dispatcher (cron 1/min)

`supabase/functions/event-dispatcher/` puxa `processed_at is null`, faz fanout pra handlers registrados, marca processado/falho. Retry com `attempt_count`.

### Handlers registrados por módulo

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

Cross-module via evento. Módulo Pipeline não importa módulo Workflow.

## Tradeoffs

**Pros:**
- Acopla módulo a contrato de evento, não a função
- Adicionar listener novo = handler novo, sem tocar emissor
- Audit log natural via `domain_events`
- Reprocessamento simples (reset `processed_at`)
- Caminho de extração pra microserviço trivial (handler → HTTP endpoint)

**Cons:**
- Async: stage change → workflow não é mais síncrono (UI usa optimistic update — já faz)
- Latência: até 1s pra workflow disparar (poll do dispatcher) — aceitável pra workflows; inaceitável pra UX inline
- Dispatcher como SPOF (mitigação: alarme `processed_at < now() - 30s`)
- Ordem não-garantida — handlers devem ser idempotentes
- Custo migração: ~30-50 call sites viram `publishEvent`

**Por que async (e não in-process síncrono):** edge functions são stateless. Sem registro em memória entre invocações. Síncrono = chamar handlers de dentro de wrapper, recria acoplamento.

DB-backed queue é simples e suficiente até 1000+ orgs.

## Slice piloto (slice 19 do SPEC)

`feat/modularizacao/18-event-bus-pilot` (8h):
1. Migration `domain_events`
2. `_shared/events/{types,publish,dispatch,registry}.ts`
3. Edge `event-dispatcher` + cron `*/1 * * * *`
4. Migrar `lead.stage_changed` (3 call sites → 1 publish + 1 handler workflow)
5. Smoke + Sentry breadcrumb com `event.type`

Expansão pra outros eventos (`message.*`, `lead.created`, `campaign.dispatched`, `workflow.step_executed`) = projeto separado pós-modularização.

## Refs

- [[event-bus-plano]] — detalhe completo
- [[monolito-modular]] — decisão arquitetural raiz
- Backlog: `triggerStageChangedWorkflows-duplicate.md`
