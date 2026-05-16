---
type: reference
title: Edge Functions
status: active
created: 2026-05-15
updated: 2026-05-15
tags: [reference, edge-functions, supabase]
related: ["[[deploy-edge-function]]", "[[Cron Jobs]]", "[[Env Vars]]"]
owner: gabriel
---

# Edge Functions — Reference

> 94 edge functions Deno em `supabase/functions/`.
> Para deploy, ver [[deploy-edge-function]].
> Para padrão de código, ver `supabase/functions/_shared/CLAUDE.md` (após F4).

## Padrão canônico

Toda edge function segue:

```typescript
import { Deno } from "deno-types";
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

## Categorias

### Auth + Org

- `checkout-create-payment` — cria pagamento Asaas pra plano
- `checkout-provision-org` — cria org + admin user + plano
- `create-org-user` — cria usuário adicional na org
- `assign-user-to-org` — vincula user existente a org
- `attach-to-org-by-pending-invite` — invite flow
- `admin-reset-user-password` — reset master only
- `get-member-permissions` — list permissions do user

### WhatsApp (Uazapi)

- `whatsapp-webhook` — webhook inbound (com patch defensivo V2)
- `whatsapp-api-proxy` — proxy autenticado pra Uazapi
- `whatsapp-rebind-webhook` — rebind scoped (após mudança de config)
- `whatsapp-dlq-replay` — replay DLQ (cron 5min)
- `whatsapp-session-watchdog` — detecta sessões mortas (cron 10min)
- `whatsapp-health-monitor` — drift + health checks (cron 5min)
- `history-sync-worker` — backfill história (cron)
- `mass-send-create` / `mass-send-status` / `mass-send-control` — envio em massa
- `reconfigure-uazapi-webhooks` — legado (a remover, BL-WA-12)

### Copilot (IA)

- `agent-message` — turn principal do agente
- `analyze-copilot-prompt` — análise estática de prompt
- `evaluate-agent-conversation` — score qualidade conversation
- `generate-agent-examples` — gera exemplos few-shot
- `generate-business-context` — gera context a partir de dados da org
- `generate-custom-instructions` — gera prompt customizado
- `generate-faqs` — extrai FAQs de conversations
- `generate-faq-embeddings` — embeddings pgvector (1536d Gemini)
- `outbound-trigger` — dispara msg outbound (após decisão do agent)
- `elevenlabs-proxy` — TTS

### Pipelines + Workflows

- `workflow-trigger` — dispara workflow por evento
- `campaign-rule-dispatch` — dispatch automático por stage (cron)
- `cadastro-externo-push` — push de leads pro lead-webhook

### Leads + Webhooks

- `lead-webhook` — entrada de leads (n8n + integrações)
- `get-lead-timeline` — agregação timeline
- `get-daily-priorities` — prioridades do dia
- `calculate-lead-score` — score IA 0-100

### Pagamentos + Asaas

- `asaas-webhook` — webhook inbound Asaas

### Calendar

- `google-calendar-callback` — OAuth callback
- (outras `google-calendar-*` pendente listar)

### Health + Cron

- `check-api-health` — health check geral
- `cron-health-check` — health do próprio cron

### Portfolio (Carteira)

- `calculate-portfolio-health` — health score por cliente

## Convenção `verify_jwt`

A maioria das funções tem `verify_jwt = false` em `supabase/config.toml`. Auth
via headers custom (`x-cron-secret`, JWT extraído manual, etc.). Decisão:
flexibilidade > strict default.

**⚠ Cuidado**: na CLI, `--no-verify-jwt=false` HABILITA JWT (double negative).
Sempre usar config.toml.

## Listar atual

```bash
ls supabase/functions | grep -v '^_' | wc -l
ls supabase/functions
```

Atual: **94 entries** (inclui `_shared/`, `deno.json`, `deno.lock`).
~91 functions reais.

## Regen automático

(planejado) Skill `vault-regen` pode atualizar esta lista a partir do
filesystem.
