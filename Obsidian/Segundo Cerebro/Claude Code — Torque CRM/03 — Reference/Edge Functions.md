---
type: reference
title: Edge Functions
status: active
created: 2026-05-15
updated: 2026-06-30
tags: [reference, edge-functions, supabase, deno]
related: ["[[deploy-edge-function]]", "[[Cron Jobs]]", "[[Env Vars]]", "[[RPCs]]"]
owner: gabriel
---

# Edge Functions — Reference

> **118 edge functions Deno reais** em `supabase/functions/` (119 subpastas − `_shared/`).
> Layout flat — a Supabase CLI exige. Mapping BC → função é doc-only em `supabase/functions/CLAUDE.md` (slice 15).
> Para deploy, ver [[deploy-edge-function]]. Para padrão de código compartilhado, ver `supabase/functions/_shared/CLAUDE.md`.

## Padrão canônico

Toda edge function segue:

```typescript
import { withSentry } from "../_shared/sentry.ts";
import { withSecurityHeaders, getCorsHeaders } from "../_shared/cors.ts";

Deno.serve(withSentry('nome-da-funcao', async (req) => {
  // OPTIONS early return
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: withSecurityHeaders(getCorsHeaders(req)) });
  }

  // ... lógica

  return new Response(JSON.stringify({ ok: true }), {
    headers: withSecurityHeaders({ ...getCorsHeaders(req), 'Content-Type': 'application/json' }),
  });
}));
```

## Project refs

- Prod: `jsjsmuncfkbsbzqzqhfq`
- Dev: `bcfadphgsibjzivtbjvc`

Deploy: `supabase functions deploy <fn> --project-ref <ref>`

## Convenção `verify_jwt`

Legenda das tabelas abaixo:
- (sem marca) → `verify_jwt = false` declarado em `supabase/config.toml`. Auth via headers custom (`x-cron-secret`, JWT extraído manual, secret no path, HMAC, etc.). Permite preflight `OPTIONS` sem JWT; o token é validado **dentro** da função.
- 🔒 → função **não** listada em config.toml ⇒ usa o default `verify_jwt = true` (Supabase Gateway exige JWT válido antes de chegar no handler).

**88 funções** estão explicitamente `verify_jwt = false`; **30 funções** (marcadas 🔒) caem no default `true`.

> **⚠ Cuidado CLI**: `--no-verify-jwt=false` **HABILITA** JWT (double negative). Sempre configurar via `config.toml`, não via flag.

## Categorias

### WhatsApp / Uazapi (12)

| Função | Papel |
|---|---|
| `whatsapp-webhook` | Inbound Uazapi (secret no path); patch defensivo |
| `whatsapp-api-proxy` | Proxy autenticado (JWT + tenant + rate limit) |
| `whatsapp-rebind-webhook` | Re-bind scoped do webhook após mudança de config |
| `whatsapp-dlq-replay` | Replay da dead-letter queue (cron) |
| `whatsapp-session-watchdog` | Detecta sessões mortas (`session_dead_since`) — cron |
| `whatsapp-health-monitor` | Drift + health checks de instâncias — cron |
| `whatsapp-media-retry` | Retry de mídia que falhou no envio — cron |
| `history-sync-worker` | Backfill de histórico (`history_sync_jobs`) — cron |
| `recover-stuck-conversations` | Recupera conversas travadas |
| `mass-send-create` | Cria job `/sender/*` de envio em massa |
| `mass-send-status` | Polla status do job de envio em massa — cron |
| `mass-send-control` | Pause/resume/cancel do envio em massa |

### Meta (Cloud API + Ads) (14)

| Função | Papel |
|---|---|
| `meta-webhook` | Inbound Meta (mensagens + leadgen + status) |
| `meta-oauth-start` | Início do OAuth Embedded Signup |
| `meta-oauth-callback` | Callback OAuth (⚠ state base64 sem HMAC — ver memória) |
| `meta-embedded-signup-exchange` | Troca code → token (Embedded Signup) |
| `meta-asset-admin` | Admin de assets (WABA / phone numbers) |
| `meta-template-create` | Cria template de mensagem |
| `meta-template-list` | Lista templates |
| `meta-template-sync` | Sincroniza status de templates |
| `meta-conversation-profile` 🔒 | Perfil/contato da conversa |
| `meta-conversion-dispatch` | Envia conversões (CAPI) |
| `meta-leadgen-poll` | Poll de leadgen forms |
| `meta-ads-insights` 🔒 | Métricas de campanhas Meta Ads |
| `send-meta-message` | Envio outbound via Meta Cloud API |
| `refresh-meta-tokens` | Refresh de tokens longos — cron |

### Copilot v1 + IA compartilhada (18)

| Função | Papel |
|---|---|
| `agent-message` | 🔴 Turn principal do agente (fluxo mais frágil) |
| `analyze-copilot-prompt` | Análise estática de prompt |
| `evaluate-agent-conversation` 🔒 | Score de qualidade da conversation |
| `generate-agent-examples` 🔒 | Gera exemplos few-shot |
| `generate-business-context` 🔒 | Gera business context a partir de dados da org |
| `generate-custom-instructions` 🔒 | Gera prompt customizado |
| `generate-faqs` 🔒 | Extrai FAQs de conversations |
| `generate-faq-embeddings` 🔒 | Embeddings pgvector (1536d Gemini) |
| `reembed-all` 🔒 | Re-embedda toda a base vetorial |
| `outbound-trigger` 🔒 | Dispara msg outbound após decisão do agent |
| `summarize-conversation` | Resumo de conversa do lead |
| `oraculo-comercial` | Oráculo comercial (Q&A sobre dados) |
| `elevenlabs-proxy` | TTS (ElevenLabs) |
| `test-copilot-chat` 🔒 | Sandbox de teste de agente (Playground) |
| `copilot-batch-processor` | Drena batches maduros de mensagens — cron |
| `copilot-builder` | Wizard de criação de agente (flag `copilot_builder`) |
| `process-agent-document` 🔒 | Processa/embedda documentos do agente |
| `process-copilot-followups` | Follow-ups agendados do copilot — cron |

### Copilot v2 (clean-slate, slice 1) (2)

| Função | Papel |
|---|---|
| `agent-runtime-v2` | Runtime v2 entry (clean-slate, isolado) |
| `copilot-v2-worker` | Queue drainer do v2 — cron |

### Workflow executor + event bus (3)

| Função | Papel |
|---|---|
| `process-workflow-executions` | Executor do DAG (`workflow_executions`) — cron |
| `event-dispatcher` | Event-bus piloto (slice 19) |
| `test-workflow-system` 🔒 | Harness de teste do sistema de workflow |

### Process-family / dispatch (cron) (14)

| Função | Papel |
|---|---|
| `process-ai-actions` | Drena `ai_actions` — cron |
| `process-followup-automations` | Automações de follow-up — cron |
| `process-followup-situations` | Situações de follow-up — cron |
| `process-outbound-dispatches` | `outbound_dispatches` — cron |
| `process-pipe-distribution` | Distribui leads no pipe (round robin) — cron |
| `process-scheduled-user-messages` 🔒 | Mensagens agendadas pelo usuário — cron |
| `process-webhook-deliveries` | Entrega de `webhook_deliveries` — cron |
| `classify-followup-stages` | AI Stage Classifier (ADR-0006 amendment) — cron |
| `campaign-rule-dispatch` | Dispatch por regra de campanha — cron |
| `pipe-rule-dispatch` | Dispatch por regra de pipe stage — cron |
| `retry-dead-letter-jobs` | Retry de jobs na DLQ — cron |
| `cron-health-check` | Health do próprio cron — cron |
| `get-automation-jobs` 🔒 | API do Operations Center (Master Admin) |
| `reprocess-job` 🔒 | Reprocessa job específico (Onda 2 Fase E) |

### Disparos / blast (6)

| Função | Papel |
|---|---|
| `blast-plan-create` | Cria plano de disparo |
| `blast-plan-control` | Pause/resume/cancel do plano |
| `blast-plan-release` | Libera/agenda o disparo do plano |
| `quick-blast-create` | Disparo Rápido a partir do kanban/lista |
| `semi-automatic-dispatch` 🔒 | Disparo de templates em lote (semi-auto) |
| `carteira-bulk-message` | Mensagem em massa para clientes de carteira |

### TinyERP (9)

| Função | Papel |
|---|---|
| `tinyerp-connect` | OAuth/connect TinyERP |
| `tinyerp-disconnect` | Disconnect |
| `tinyerp-proxy` | Proxy autenticado pra API TinyERP |
| `tinyerp-sync-products` | Sincroniza catálogo de produtos |
| `tinyerp-push-order` | Empurra pedido pro ERP |
| `tinyerp-push-upsell-order` | Empurra pedido de upsell (carteira) |
| `tinyerp-fetch-nfe` | Busca NF-e |
| `tinyerp-webhook` | Inbound TinyERP |
| `erp-order-webhook` | Inbound de pedido (ERP genérico) |

### Calendar / Meeting (9)

| Função | Papel |
|---|---|
| `google-calendar-connect` | OAuth/connect Google Calendar |
| `google-calendar-callback` | OAuth callback |
| `google-calendar-disconnect` | Disconnect |
| `google-calendar-events` | CRUD de eventos |
| `google-calendar-sharing` | Compartilhamento de agenda |
| `google-calendar-webhook` | Push notifications do Google |
| `meeting-calendar-sync` | Sincroniza reuniões ↔ calendar |
| `meeting-webhook` | Inbound de reunião |
| `webhook-calcom` 🔒 | Inbound Cal.com |

### MCP (1)

| Função | Papel |
|---|---|
| `torque-mcp` | Servidor MCP interno (RLS-herdado; tools read/mutate/diag) — ver [[ADR-0011]] |

> `crm-mcp` (cenário B do ADR 0011, customer-facing BYO-AI) ainda **não** é função deployada — spine vive em `_shared/mcp/` (C1).

### Webhooks inbound / orquestração (10)

| Função | Papel |
|---|---|
| `lead-webhook` | Entrada de leads (n8n + integrações) |
| `partner-webhook` | Inbound de parceiro (ex: Zuvic / Dna de Almas) → `lead-webhook` |
| `webhook-new-lead` | Inbound de lead novo (legado/alternativo) |
| `webhook-confirmacao` | Inbound de confirmação de reunião |
| `webhook-orchestrator` | Orquestra webhooks (reusa helpers de `webhook-new-lead`) |
| `webhook-validate-url` | Valida URL de webhook |
| `webhook-send-test` | Envia evento de teste para webhook |
| `cadastro-externo-push` 🔒 | Push de cadastro externo → `lead-webhook` |
| `sz-chat-webhook` | Inbound SZ.Chat |
| `sz-chat-send` | Outbound SZ.Chat |

### Identity / Org / Permissões / admin (9)

| Função | Papel |
|---|---|
| `create-org-user` 🔒 | Cria usuário adicional na org |
| `assign-user-to-org` 🔒 | Vincula user existente a org |
| `attach-to-org-by-pending-invite` 🔒 | Fluxo de convite pendente |
| `remove-org-member` 🔒 | Remove membro da org |
| `admin-reset-user-password` 🔒 | Reset de senha (master only) |
| `get-member-permissions` 🔒 | Lista permissões do user |
| `save-member-permissions` 🔒 | Salva permissões do user |
| `list-organizations` | Lista orgs (master ops) |
| `list-unassigned-users` 🔒 | Lista users sem org |

### Leads / Onboarding (6)

| Função | Papel |
|---|---|
| `import-leads` | Import em massa de leads |
| `calculate-lead-score` | Score IA 0-100 |
| `get-lead-timeline` 🔒 | Agregação da timeline do lead |
| `get-daily-priorities` 🔒 | Prioridades do dia |
| `onboarding-advance` 🔒 | Avança step do onboarding |
| `list-lead-forms` | Lista lead forms (marketing) |

### Carteira / Portfolio (2)

| Função | Papel |
|---|---|
| `calculate-portfolio-health` | Health score por cliente de carteira |
| `suggest-retention-action` | Sugestão IA de ação de retenção |

> `carteira-bulk-message` (Disparos) e `tinyerp-push-upsell-order` (TinyERP) também servem o domínio Carteira.

### API pública / Health / Media (3)

| Função | Papel |
|---|---|
| `api` | REST API pública `/api/v1/*` (ADR-0008) |
| `check-api-health` 🔒 | Health check geral |
| `stream-media` | Proxy de áudio/imagem do Storage |

## Funções removidas (não existem mais no dir)

Confirmado ausente em `supabase/functions/` (2026-06-30):

- `checkout-create-payment`, `checkout-provision-org` — fluxo de checkout antigo
- `asaas-webhook` — webhook Asaas
- `reconfigure-uazapi-webhooks` — legado WhatsApp (substituído por `whatsapp-rebind-webhook`)
- `workflow-trigger` — substituído por `event-dispatcher` + `process-workflow-executions`

> **⚠ Drift config.toml**: `asaas-webhook`, `checkout-create-payment` e `checkout-provision-org` ainda têm bloco `[functions.*]` órfão em `config.toml` mesmo sem o diretório. Limpar numa migration de housekeeping.

## Listar atual

```bash
# contagem de funções reais (exclui _shared)
ls -d supabase/functions/*/ | grep -v '_shared' | wc -l   # → 118

# nomes
ls -d supabase/functions/*/ | sed 's#.*/functions/##; s#/$##' | grep -v '^_shared$' | sort

# quais usam o default verify_jwt=true (não estão em config.toml)
comm -23 \
  <(ls -d supabase/functions/*/ | sed 's#.*/functions/##;s#/##' | grep -v '^_shared$' | sort -u) \
  <(grep -oE '^\[functions\.[a-z0-9-]+\]' supabase/config.toml | sed 's/\[functions\.//;s/\]//' | sort -u)
```

Snapshot: **118 funções reais** · **88 `verify_jwt = false`** · **30 default `true`** (🔒).
