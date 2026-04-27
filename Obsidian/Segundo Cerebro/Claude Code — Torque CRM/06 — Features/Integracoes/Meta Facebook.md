---
tags:
  - claude-code
  - feature
  - torque-crm
  - integracoes
created: 2026-04-12
last_updated: 2026-04-25
status: active
---

# Meta Facebook

## O que faz

Integracao bidirecional Meta Ads + Messenger + Instagram DM. Lead Ads capture automatico, Messenger replies via CRM, ad campaign attribution. OAuth para conexao de contas.

## Regras de negocio

- OAuth via meta-oauth-callback (exchange code por token)
- Webhook validado com HMAC signature
- Token refresh diario (tokens Meta expiram em 60 dias) via cron 2AM
- Lead Ads auto-assign para SDRs/closers via distribution logic
- Messenger messages roteadas para chat multi-canal

## Como o usuario usa

1. Configuracoes → Integracoes → Meta
2. Conecta conta Meta via OAuth
3. Configura Lead Ads mapping (campanha → assignment rules)
4. Leads entram automaticamente no CRM
5. Equipe responde via chat do CRM → mensagem vai pro Messenger

---

## Como funciona (tecnico)

### Componentes

- `src/components/settings/MetaSettings.tsx` — Conexao OAuth
- `src/components/settings/MetaLeadgenConfig.tsx` — Mapping de Lead Ads

### Edge Functions

- `meta-oauth-callback` — Troca code por token, subscribes webhooks
- `meta-webhook` — GET: verification; POST: recebe messenger msgs e leadgen submissions, valida HMAC
- `meta-ads-insights` — Fetch campaign insights (CTR, conversions, spend)
- `refresh-meta-tokens` — Cron diario 2AM, renova tokens
- `send-meta-message` — Envia para Messenger/Instagram via Meta Graph API

### Shared

- `_shared/meta-api.ts` — Client Meta API

### Tabelas

- `meta_ad_accounts` — account_id, access_token, app_secret_proof, token_expires_at, scopes
- `meta_leadgen_configs` — campaign_id, form_id, assignment_rule
- `meta_pages` — page_id, page_access_token, instagram_account_id, is_active

---

## Historico de mudancas

### 2026-04-25 — Fix race condition em Lead Ads (disparos duplicados)

Meta Lead Ads webhook tem retry agressivo (< 1s). Causava 2 chamadas concorrentes em `lead-webhook` → 2 leads idênticos criados em 18-60ms → workflow_executions duplicadas → mensagens WhatsApp em dobro.

**Fix**: `CREATE UNIQUE INDEX idx_leads_org_phone_unique ON leads (organization_id, normalized_phone) WHERE normalized_phone IS NOT NULL`. Catch `23505` em `lead-service.ts` retry-search resolve race naturalmente.

Migration: `20260919000000_merge_duplicate_leads_and_unique_index.sql`. Detalhes em [[2026-04-25]].

## Links relacionados

- [[Chat WhatsApp]]
- [[Analytics UTMs]]
- [[Dashboard]]
