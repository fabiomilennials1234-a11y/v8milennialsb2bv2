---
type: reference
title: Webhooks Outbound
status: draft
created: 2026-05-15
updated: 2026-09-02
tags: [reference, webhooks, outbound]
related: ["[[Cron Jobs]]", "[[Runbook — Cron e Webhooks]]", "[[Edge Functions]]", "[[Schema]]"]
owner: gabriel
---

# Webhooks Outbound — Reference

> Webhooks que o Torque CHAMA (out). Para webhooks que o Torque RECEBE,
> ver edge functions `*-webhook` em [[Edge Functions]].

## Tabelas

Schema vivo (grounded em `20260211000000_webhooks_outbound.sql` +
`20260909000002_webhook_dead_letters.sql`).

### `webhooks` — config por org

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | uuid PK | |
| `organization_id` | uuid FK→organizations | scope tenant (ON DELETE CASCADE) |
| `name` | text | nome amigável |
| `url` | text | destino (HTTPS only — ver Segurança) |
| `secret` | text? | chave HMAC opcional |
| `events` | text[] | event types assinados (default `{}`) |
| `http_method` | text | `POST` \| `PUT` \| `PATCH` (CHECK) |
| `custom_headers` | jsonb | headers extra (default `{}`) |
| `is_active` | bool | false desativa entrega |
| `consecutive_failures` | int | contador do circuit breaker (default 0) |
| `disabled_reason` | text? | preenchido quando o breaker desativa |
| `created_at` / `updated_at` | timestamptz | |

RLS: membros da org leem (`webhooks_select_own_org`); só admin
(`team_members` ⋈ `user_roles.role='admin'`) faz INSERT/UPDATE/DELETE.

### `webhook_deliveries` — fila

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | uuid PK | |
| `webhook_id` | uuid FK→webhooks | (ON DELETE CASCADE) |
| `event` | text | event type |
| `payload` | jsonb | envelope completo (ver abaixo) |
| `attempt` | smallint | tentativa atual (default 1) |
| `max_attempts` | smallint | default 5 |
| `next_retry_at` | timestamptz | worker drena `<= now()` |
| `created_at` | timestamptz | |

RLS: **sem policy para usuários** — só service_role (worker) acessa, via bypass.

### `webhook_delivery_logs` — log por tentativa

`webhook_id`, `event`, `attempt`, `status_code`, `response_body`,
`error_message`, `delivered_at`. RLS: membros da org do webhook leem.

### `webhook_dead_letters` — DLQ

Entregas que esgotaram `max_attempts` são preservadas aqui:
`webhook_id`, `event`, `payload`, `attempts`, `last_status_code`,
`last_error`, `last_response_body`, `created_at`, `failed_at`. RLS: membros da
org leem; service_role gerencia.

## Tipos de webhook

Eventos são enfileirados por **triggers de banco** (`AFTER INSERT/UPDATE`) que
chamam `public.enqueue_webhook_deliveries_for_org(org_id, event, payload)` (ou,
no caso de `leads`, a fn dedicada `public.enqueue_lead_webhooks()`). A função só
enfileira para webhooks da org com `is_active = true` **e** `events @> ARRAY[ev]`.
Edge functions também podem enfileirar via helper
`enqueueWebhookDeliveries()` em `_shared/webhook-utils.ts`.

Grounded em `20260211000001_webhooks_leads_trigger.sql` +
`20260212000000_webhooks_triggers_pipes_followups_campaigns_etc.sql`:

> **Aposentados (SCRUM-630, `20270908005000`)**: os 6 eventos
> `pipe_{whatsapp,confirmacao,propostas}.{created,updated}` morreram quando as
> tabelas `pipe_*` viraram views (Wave 1) — os enqueuers ficaram órfãos (0
> triggers) e foram dropados. Substituto: `negocio.stage_changed`.

| Event type | Origem (tabela / trigger) | Quando |
|---|---|---|
| `lead.created` | `leads` | AFTER INSERT |
| `lead.updated` | `leads` | AFTER UPDATE |
| `negocio.stage_changed` | `pipeline_entries` / `trg_pe_webhook_stage_changed` | AFTER UPDATE OF `stage_key, stage_id` quando a etapa muda — qualquer funil (sistema ou custom) |
| `follow_up.created` | `follow_ups` | INSERT |
| `follow_up.completed` | `follow_ups` | UPDATE quando `completed_at` passa a não-nulo |
| `follow_up.updated` | `follow_ups` | outros UPDATE |
| `campaign_dispatch.scheduled` | `campaign_dispatch_batches` | INSERT |
| `campaign_dispatch.completed` | `campaign_dispatch_batches` | UPDATE p/ status `completed`/`failed`/`cancelled` |
| `acao_dia.created` | `acoes_do_dia` | INSERT |
| `acao_dia.completed` | `acoes_do_dia` | UPDATE p/ `is_completed = true` |
| `whatsapp_message.received` | `whatsapp_messages` | INSERT `direction = 'incoming'` |
| `whatsapp_message.sent` | `whatsapp_messages` | INSERT outras direções |

> `acoes_do_dia`: updates que não sejam conclusão **não** disparam evento.
> `whatsapp_message.*`: `content` é truncado em 500 chars no payload.

### Schema do payload

Todo evento usa o mesmo envelope:

```json
{
  "event": "lead.created",
  "timestamp": "2026-06-30T12:34:56.789Z",
  "data": { /* específico do recurso */ }
}
```

`timestamp` é UTC, formato `YYYY-MM-DD"T"HH24:MI:SS.MS"Z"`.

> **Exceção — `negocio.stage_changed`** (SCRUM-630, F3/D10): payload FLAT, sem o
> envelope acima (contrato novo nasceu limpo — em 2026-09-02 `webhooks` tinha
> 0 linhas em prod, então não havia consumidor do envelope legado):
>
> ```json
> {
>   "event": "negocio.stage_changed",
>   "organization_id": "uuid", "pipeline_id": "uuid",
>   "pipeline_slug": "...", "pipeline_name": "...",
>   "stage_id": "uuid|null", "stage_key": "...",
>   "stage_name": "...|null", "stage_role": "...|null",
>   "previous_stage_id": "uuid|null", "previous_stage_key": "...",
>   "deal_id": "uuid|null", "lead_id": "uuid|null", "entry_id": "uuid",
>   "moved_at": "2026-09-02T12:34:56.789Z"
> }
> ```
>
> `stage_name`/`stage_role` vêm NULL quando a etapa é fantasma (`stage_id`
> NULL). Enfileirado por `enqueue_negocio_stage_changed_webhooks()`
> (`20270908005000`), com fast-path EXISTS por org antes de montar o payload.

`data` por família (campos confirmados nas triggers):

- **lead.\***: `id, name, email, phone, company, organization_id, origin`
- **follow_up.\***: `id, lead_id, organization_id, title, due_date, completed_at, assigned_to, priority, source_pipe`
- **campaign_dispatch.scheduled**: `id, organization_id, campanha_id, template_id, scheduled_at, status`
- **campaign_dispatch.completed**: `id, organization_id, campanha_id, status, total_leads, sent_count, failed_count`
- **acao_dia.\***: `id, user_id, lead_id, title, description, is_completed, completed_at, confirmacao_id, follow_up_id, proposta_id`
- **whatsapp_message.\***: `id, organization_id, lead_id, direction, message_type, content (≤500ch), phone_number, status, message_id`

## Worker `process-webhook-deliveries`

Edge function (BC platform). Auth: `x-cron-secret` (`timingSafeCompare`).
Disparada por pg_cron `* * * * *` via `invoke_process_webhook_deliveries()`
(lê `webhook_worker_url` + `cron_secret` da tabela `cron_config`, dispara por
`net.http_post`) — `20260211000002_webhooks_cron.sql`.

Loop (batch `BATCH_SIZE = 100`, ordenado por `next_retry_at` asc):

1. Resolve o `webhooks` row; se sumiu → log + delete da fila.
2. `validateUrl()` (anti-SSRF, ver Segurança); inválida → log + retry/descarte.
3. `sendWebhook()` → grava `webhook_delivery_logs`.
4. **2xx** → delete da fila + `consecutive_failures = 0`.
5. **Falha com `attempt >= max_attempts`** → move p/ `webhook_dead_letters` +
   delete da fila + incrementa breaker.
6. **Falha com tentativas restantes** → `attempt + 1`, `next_retry_at` via
   backoff, incrementa breaker.

### Backoff

`nextRetryDelayMinutes(attempt)` — minutos `[1, 5, 15, 60]` (clamp no último) com
**±20% jitter** (anti-thundering-herd). `max_attempts` default 5.

> Substitui a tabela antiga deste doc (`1m → 5m → 30m → 2h → 12h`), que não bate
> com o código vivo.

### Circuit breaker

`consecutive_failures` por webhook; ao atingir `CIRCUIT_BREAKER_THRESHOLD = 10`,
o worker seta `is_active = false` + `disabled_reason = "Circuit breaker: 10+
consecutive failures"` e, **só na 1ª desativação**, insere `system_alerts`
(`severity = critical`, `category = webhook_circuit_breaker`). Sucesso zera o
contador.

## Como configurar

Frontend `/configuracoes/webhooks` (admin only — ver RLS). Por evento(s) + URL +
`http_method` + `custom_headers` + `secret` opcional.

## Segurança

Implementado em `_shared/webhook-utils.ts`:

- **Apenas HTTPS.** `validateUrl()` resolve DNS e **bloqueia** localhost e ranges
  privados (10/8, 172.16–31, 192.168/16, ::1, fe80::/10) — anti-SSRF.
- **`redirect: "manual"`** — não segue redirect para outro host.
- **Timeout 10s** (`AbortController`); response body truncado em 2048 chars.
- **Assinatura HMAC opcional**: se o webhook tem `secret`, o worker envia header
  **`X-Webhook-Signature-256`** = HMAC-SHA256 do body cru, em **hex**
  (`signPayload(secret, body)`). O receptor recomputa com o mesmo secret e
  compara (timing-safe). ⚠️ Não é `X-Torque-Signature` — esse nome não existe no
  código.
- Headers sempre presentes: `Content-Type: application/json`,
  `X-Webhook-Event: <event>`, `X-Webhook-Delivery-Id: <delivery_id>`, + os
  `custom_headers`.
- **DLQ** após `max_attempts` + **circuit breaker** após 10 falhas consecutivas
  (ver Worker).
