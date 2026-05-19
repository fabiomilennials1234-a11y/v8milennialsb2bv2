---
audit: 2026-05-19
related-prd: Issue #284 — Modal Lead v2
related-issue: Issue #287 — Audit + criar schema para message logs
status: complete (no migration needed)
---

# Message Logs — Schema Audit (Issue #287)

PRD #284 / Fase 5 prevê trigger no DB pra criar entry em `lead_history` toda
vez que uma mensagem é enviada/recebida (WhatsApp, email, SMS, ligação),
cobrindo tanto envios via UI quanto via edge functions, n8n, cron — fonte
única, audit completo. Issue #287 é o pré-step: confirmar que as tabelas
existem antes de F5.2 (criar triggers) e padronizar.

## Audit summary

| Surface esperado pelo PRD | Tabela real | Migration | Status |
| -- | -- | -- | -- |
| `whatsapp_messages` | `whatsapp_messages` | `20260127000000_add_whatsapp_messages.sql` | ✅ existe |
| `email_logs` | `emails` | `20260950000000_email_sync.sql` | ✅ existe (nome difere) |
| `sms_logs` | `sms_messages` | `20260953000000_sms_integration.sql` | ✅ existe (nome difere) |
| `call_logs` | `call_logs` | `20260952000000_call_logs.sql` | ✅ existe + trigger já implementada pra `lead_history` |

**Resultado:** nenhuma migration necessária. As 4 superfícies de mensagem
já vivem no schema com convenção multi-tenant, RLS, index por
`organization_id` e por `lead_id`.

## Esquema por tabela

### `whatsapp_messages`
- PK `id uuid`, FK `organization_id` (NOT NULL, ON DELETE CASCADE).
- `lead_id` nullable (ON DELETE SET NULL).
- `direction text CHECK ('incoming','outgoing')`.
- `message_id text` + `instance_id uuid` UNIQUE — dedupe inbound webhook.
- `status text CHECK ('pending','sent','delivered','read','received','failed')`.
- `raw_payload jsonb` — full Uazapi payload.
- Realtime habilitado (publication `supabase_realtime`).
- RLS: SELECT/INSERT/UPDATE por org; service_role bypass.

### `emails`
- PK `id uuid`, FK `organization_id` (NOT NULL, ON DELETE CASCADE), FK
  `email_account_id` (NOT NULL).
- `lead_id` nullable.
- Direction: `is_outbound boolean` (sentinel boolean, não enum).
- `message_id text` + UNIQUE(`email_account_id`, `message_id`) — dedupe.
- `thread_id text` + index — agrupamento de threads.
- Tracking: `open_count`, `first_opened_at`, `click_count`,
  `first_clicked_at`, `read_at`.
- RLS: SELECT por org; INSERT via account (user_id check).
- **Sem realtime** — pull-based via sync cursor.

### `sms_messages`
- PK `id uuid`, FK `organization_id` (NOT NULL, ON DELETE CASCADE).
- `lead_id` nullable.
- `direction text CHECK ('inbound','outbound')`.
- `provider_message_id text` (dedupe provider-side).
- `status text CHECK ('queued','sent','delivered','failed','received')`.
- `sent_by uuid` FK auth.users.
- RLS: SELECT/INSERT por org.

### `call_logs`
- PK `id uuid`, FK `organization_id` (NOT NULL, ON DELETE CASCADE), FK
  `user_id` (NOT NULL).
- `lead_id` nullable.
- `direction text CHECK ('inbound','outbound')`.
- `outcome text CHECK (...)`.
- `voip_call_id text` (futuro VoIP).
- RLS: SELECT por org; INSERT por org; UPDATE só do dono.
- **Trigger `fn_call_log_to_history` já existe** — escreve em `lead_history`
  com `action='call_logged'` no AFTER INSERT. Cobre F5.2 pra calls.

## Decisões

### D1 — Não criar `email_logs` nem `sms_logs`

Manter os nomes existentes (`emails`, `sms_messages`). Razões:

1. Renomear quebra ~7 hooks frontend + edge functions + types regenerados.
2. As tabelas atuais já satisfazem o contrato do PRD (multi-tenant +
   `lead_id` + identificação de mensagem + direção + RLS).
3. PRD #284 usa "email_logs / sms_logs" como nome descritivo; F5.2 vai
   referenciar nomes reais nas triggers e nos hooks de leitura.

### D2 — Direction: aceitar inconsistência atual

- `whatsapp_messages.direction` = `'incoming' | 'outgoing'`
- `sms_messages.direction` = `'inbound' | 'outbound'`
- `call_logs.direction` = `'inbound' | 'outbound'`
- `emails.is_outbound` = `boolean`

Não mexer no schema agora. A trigger F5.2 normaliza pra um vocabulário
único quando escreve em `lead_history.metadata` (ex.: sempre `'sent'` /
`'received'`). Migration de normalização fica como backlog.

### D3 — Trigger pra `lead_history` (F5.2, fora do escopo desta issue)

- `call_logs` já implementada (`fn_call_log_to_history` AFTER INSERT).
- `whatsapp_messages`, `emails`, `sms_messages` precisam de triggers
  análogas. Issue separada vai consolidar:
  - Naming: `fn_<channel>_to_history`.
  - Ação em `lead_history`: `<channel>_sent` / `<channel>_received` (via
    normalização do direction da D2).
  - Metadata jsonb: `{ channel, message_id, direction, sender_id }`.
  - `lead_id IS NULL` → skip (mensagem ainda não vinculada).

### D4 — `created_by` / actor

`call_logs.user_id`, `sms_messages.sent_by`, `emails.email_account_id` já
trazem o autor. `whatsapp_messages` **não** tem actor explícito (envios via
agente IA / cron / UI compartilham instance). F5.2 vai preencher
`metadata.sender_id` quando conhecido (UI passa via header custom da edge
function) e omitir quando não (cron / inbound webhook).

## Itens AC

- [x] Audit document (este arquivo).
- [N/A] Migration(s) criando tabelas faltantes — **nenhuma necessária**.
- [N/A] Regen types — sem mudança de schema.
- [x] Decisão direction enum vs free text — D2 acima.
- [ ] CTO sign-off — HITL flag.

## Links

- Issue #287 (este audit)
- Issue #284 (PRD master)
- Migration 20260127 — `whatsapp_messages`
- Migration 20260950 — `email_accounts`, `emails`, `email_templates`
- Migration 20260952 — `call_logs` + trigger pra `lead_history`
- Migration 20260953 — `sms_provider_config`, `sms_messages`, `sms_templates`
- [03 — Reference/Schema](Schema.md)
