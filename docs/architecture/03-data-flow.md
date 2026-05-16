# Architecture — Level 3: Data Flows

Fluxos críticos end-to-end. Sequence diagrams para os 3 mais importantes.

## Flow 1: Lead ingestion (Meta Ads → Torque)

Meta Ads campaign captura lead → n8n processa + classifica → POST `lead-webhook`
→ Torque cria lead + coloca em pipe.

```mermaid
sequenceDiagram
    actor Lead
    participant Meta as Meta Ads
    participant n8n as n8n
    participant Trello as Trello card
    participant LeadWh as lead-webhook<br/>(edge fn)
    participant DB as Postgres
    participant RT as Realtime
    participant Front as Frontend

    Lead->>Meta: Submete form
    Meta->>n8n: Webhook (lead data)
    n8n->>Trello: Cria card (record)
    n8n->>n8n: Classifica faturamento<br/>+ atribui tag
    n8n->>LeadWh: POST /lead-webhook<br/>(payload normalizado)
    LeadWh->>LeadWh: Valida + resolve org<br/>(API key in body)
    LeadWh->>DB: INSERT leads<br/>(organization_id, fields, tags)
    LeadWh->>DB: INSERT pipe_whatsapp<br/>(stage: novo_lead)
    LeadWh->>DB: INSERT lead_tags
    DB-->>RT: postgres_changes
    RT-->>Front: Notifica subscribers da org
    Front->>Front: TanStack Query invalidate<br/>+ refetch
    Front->>Front: Lead aparece no kanban
```

Payload `lead-webhook`:
```json
{
  "source": "meta_ads",
  "organization_id": "uuid",
  "fields": {
    "name": "...",
    "phone": "...",
    "email": "...",
    "company": "..."
  },
  "tags": ["Ouro"],
  "place_in_pipe": {
    "pipe": "whatsapp",
    "stage": "novo_lead"
  },
  "assigned_user_id": "uuid",
  "update_existing_if_match": true
}
```

## Flow 2: WhatsApp inbound (Lead → DB → UI)

Lead manda msg WhatsApp → Uazapi → webhook → resolução defensiva → DB → realtime → UI.

```mermaid
sequenceDiagram
    actor Lead
    participant Wpp as WhatsApp
    participant Uaz as Uazapi
    participant Webhook as whatsapp-webhook<br/>(edge fn)
    participant DB as Postgres
    participant DLQ as whatsapp_webhook_dlq
    participant RT as Realtime
    participant Front as Frontend
    participant Copilot as agent-message<br/>(if agent active)

    Lead->>Wpp: Envia msg
    Wpp->>Uaz: Inbound
    Uaz->>Webhook: POST /whatsapp-webhook<br/>(x-webhook-secret)

    Webhook->>Webhook: Valida secret
    alt Resolução V1 (payload.instance)
        Webhook->>DB: Lookup whatsapp_instances
        DB-->>Webhook: instance found
    else Resolução V2 (token fallback)
        Webhook->>DB: Lookup by token
        DB-->>Webhook: instance found
    else Sem resolução
        Webhook->>DLQ: INSERT (reason, payload)
        Webhook-->>Uaz: 200 OK (sempre)
    end

    Webhook->>DB: INSERT channel_messages<br/>(idempotência por external_id)
    Webhook->>DB: INSERT whatsapp_messages_received_via
    DB-->>RT: postgres_changes
    RT-->>Front: Notifica
    Front->>Front: Mensagem aparece no chat

    alt Agente IA ativo
        Webhook->>Copilot: Trigger (assíncrono)
        Copilot->>Copilot: Carrega context<br/>(agente + FAQs + business + histórico)
        Copilot->>Copilot: Gemini turn
        Copilot->>DB: agent_decision_logs<br/>+ runtime_logs
        Copilot->>DB: INSERT outbound_queue
        Note over Copilot,DB: outbound-trigger cron envia<br/>via whatsapp-api-proxy
    end

    Webhook-->>Uaz: 200 OK
```

Patch defensivo: ver
[`Obsidian/.../supabase/functions/whatsapp-webhook/CLAUDE.md`](../../supabase/functions/whatsapp-webhook/CLAUDE.md).

## Flow 3: Cron tick → Edge function

`pg_cron` dispara → `pg_net.http_post` → edge fn → faz trabalho → atualiza estado.

```mermaid
sequenceDiagram
    participant Cron as pg_cron
    participant PgNet as pg_net
    participant Fn as edge function
    participant DB as Postgres

    Note over Cron: Schedule */5 * * * *<br/>(exemplo: whatsapp-dlq-replay)
    Cron->>PgNet: net.http_post<br/>(url + x-cron-secret)
    PgNet->>Fn: POST /functions/v1/<fn>
    Fn->>Fn: Valida x-cron-secret
    Fn->>DB: SELECT pending work<br/>(filtro por org se aplicável)
    DB-->>Fn: rows
    loop Cada row
        Fn->>Fn: Processa
        Fn->>DB: UPDATE status<br/>(success / failed / next_retry)
    end
    Fn-->>PgNet: 200 + body
    Note over Cron: result vai pra<br/>cron.job_run_details
```

Auth: header `x-cron-secret` validado contra env var na edge fn.

Cron jobs ativos: ver [`Obsidian/.../03 — Reference/Cron Jobs.md`](../../Obsidian/Segundo%20Cerebro/Claude%20Code%20—%20Torque%20CRM/03%20—%20Reference/Cron%20Jobs.md).

## Flow 4: Outbound msg (Torque → Lead via WhatsApp)

Edge fn enqueue → outbound-trigger cron → whatsapp-api-proxy → Uazapi → Lead.

```mermaid
sequenceDiagram
    participant Origem as Origem<br/>(copilot/campaign/workflow)
    participant DB as Postgres
    participant Cron as outbound-trigger<br/>(cron 1min)
    participant Proxy as whatsapp-api-proxy
    participant Uaz as Uazapi
    actor Lead

    Origem->>DB: INSERT outbound_dispatches<br/>(status: pending)
    Note over Cron: Tick a cada 1min
    Cron->>DB: SELECT outbound_dispatches<br/>WHERE status='pending'<br/>ORDER BY priority
    DB-->>Cron: jobs
    loop Cada job
        Cron->>DB: UPDATE status='sending'
        Cron->>Proxy: POST send-message<br/>(JWT + org + rate limit)
        Proxy->>Uaz: POST /sendText (Uazapi API)
        Uaz->>Lead: Envia
        Uaz-->>Proxy: 200 + message_id
        Proxy-->>Cron: success
        Cron->>DB: UPDATE status='sent'<br/>+ external_id
    end
```

## Gotchas comuns

- **Realtime onUpdate** retorna só campos alterados — dados aninhados vêm do cache do TanStack Query
- **postgres_changes respeita RLS** — frontend sem auth correto não recebe nada
- **pg_net é assíncrono** — `cron.job_run_details` mostra resultado depois
- **outbound rate limit** por org/instância — proxy enforça
- **Idempotência inbound** via `external_message_id` UNIQUE
