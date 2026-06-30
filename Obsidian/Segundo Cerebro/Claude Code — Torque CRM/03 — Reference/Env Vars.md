---
type: reference
title: Variáveis de Ambiente
status: active
created: 2026-05-15
updated: 2026-06-30
tags: [reference, env-vars, config, secrets]
related: ["[[Edge Functions]]", "[[RPCs]]", "[[Integracoes]]"]
owner: gabriel
---

# Env Vars — Reference

> Nunca commitar `.env*` com valores reais. `.gitignore` cobre.
> **Source of truth**: dashboard Supabase (edge fn secrets) + `.env.local` (frontend dev).
> Esta lista é gerada a partir de `Deno.env.get(...)` em `supabase/functions/` (varredura 2026-06-30).

## Naming

- Frontend Vite: `VITE_SCREAMING_SNAKE` (só `VITE_*` é exposto ao browser)
- Backend (Deno + edge fn): `SCREAMING_SNAKE`

A coluna **Secret?** marca `✅` para credenciais que NUNCA podem vazar (chaves privadas, tokens, senhas, encryption keys, segredos de webhook). URLs, IDs públicos, model-ids e flags de ambiente são config, não segredo.

---

## Frontend (`.env.local`)

| Variável | Função |
|---|---|
| `VITE_SUPABASE_URL` | URL do projeto Supabase |
| `VITE_SUPABASE_ANON_KEY` | Anon key (público por design, OK em frontend) |
| `VITE_SENTRY_DSN` | Sentry DSN do frontend |
| `VITE_APP_URL` | URL do app (links absolutos) |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth (público) |

> Outras `VITE_*` conforme integrações ativadas. Anon key é segura no browser **porque RLS é a fronteira** — qualquer leak de service-role aqui seria crítico.

---

## Backend (edge fn secrets)

### Supabase core

| Variável | Secret? | Função |
|---|:---:|---|
| `SUPABASE_URL` | | URL do projeto (injetada pelo runtime) |
| `SUPABASE_ANON_KEY` | | Anon key (cliente RLS-scoped) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Service role — bypassa RLS. **NUNCA no frontend.** |
| `ANON_KEY` | | Alias de anon key usado por fns de provisionamento (`assign-user-to-org`, `create-org-user`, ...) |
| `ANON_KEY_2` | | Segunda anon key (fallback/rotação) tentada após `ANON_KEY` nas mesmas fns |
| `APP_URL` | | URL-base do app p/ links; fallback `http://localhost:5173` |
| `ALLOWED_ORIGINS` | | Allowlist CORS; default `https://torquecrm.com.br,http://localhost:8080` |
| `ENVIRONMENT` | | `production` / outros — gating de comportamento (ex.: test-mode) |

### Cron & segredos internos

| Variável | Secret? | Função |
|---|:---:|---|
| `CRON_SECRET` | ✅ | Header `x-cron-secret` — autentica jobs pg_cron → edge fn |
| `INTERNAL_API_KEY` | ✅ | Auth fn→fn interna (chamadas server-side privilegiadas) |
| `WEBHOOK_API_KEY` | ✅ | Auth de webhooks inbound (ex.: `lead-webhook`, `partner-webhook`) |
| `WEBHOOK_SECRET` | ✅ | Segredo genérico de assinatura/validação de webhook |
| `RECOVER_SECRET` | ✅ | Gateia `recover-stuck-conversations` |
| `TEST_MODE_SECRET` | ✅ | Habilita caminho de test-mode em prod sob segredo |

### WhatsApp — Uazapi 🔴

| Variável | Secret? | Função |
|---|:---:|---|
| `UAZAPI_BASE_URL` | | Ex.: `https://milennialstech.uazapi.com` |
| `UAZAPI_ADMIN_TOKEN` | ✅ | Token admin server-wide (provisionar/operar instâncias) |
| `UAZAPI_WEBHOOK_SECRET` | ✅ | Validação do webhook inbound (path secreto) |

> Token Uazapi **por instância** NÃO é env var — vive em `whatsapp_instance_secrets` (RLS deny-all), acesso via RPC `get/set_uazapi_credentials` (service_role). Ver [[Areas Frageis]].

### WhatsApp — Evolution (legado)

| Variável | Secret? | Função |
|---|:---:|---|
| `EVOLUTION_API_URL` | | Base URL Evolution (migração Evolution→Uazapi concluída) |
| `EVOLUTION_API_KEY` | ✅ | Token Evolution |
| `EVOLUTION_WEBHOOK_SECRET` | ✅ | Validação webhook Evolution |

> Mantidas só para compat/health-check (`check-api-health`, `_shared/auth.ts`). Não usar em features novas.

### Meta / Meta Ads

| Variável | Secret? | Função |
|---|:---:|---|
| `META_APP_ID` | | App ID Meta (público) |
| `META_APP_SECRET` | ✅ | App secret — OAuth + assinatura de webhook |
| `META_REDIRECT_URI` | | Redirect OAuth |
| `META_WEBHOOK_VERIFY_TOKEN` | ✅ | Verify token do webhook Meta |
| `META_CLOUD_REGISTER_PIN` | ✅ | PIN de registro WhatsApp Cloud API (provider novo) |
| `META_ADS_ACCESS_TOKEN` | ✅ | Token Graph API p/ `meta-ads-insights` |
| `META_ADS_ACCOUNT_ID` | | Ad account ID (não secreto) |

### TinyERP / ERP / Cadastro externo

| Variável | Secret? | Função |
|---|:---:|---|
| `TINYERP_ENCRYPTION_KEY` | ✅ | Encryption key de credenciais TinyERP per-tenant |
| `TINYERP_WEBHOOK_SECRET` | ✅ | Validação webhook TinyERP |
| `ERP_ORDER_WEBHOOK_SECRET` | ✅ | Validação `erp-order-webhook` (pedidos) |
| `CADASTRO_EXTERNO_API_KEY` | ✅ | Auth do push `cadastro-externo-push` |
| `CADASTRO_EXTERNO_URL` | | Endpoint do cadastro externo |

> Credenciais TinyERP **por org** ficam em tabela (cifradas com `TINYERP_ENCRYPTION_KEY`), não em env por-tenant.

### Google Calendar / Cal.com

| Variável | Secret? | Função |
|---|:---:|---|
| `GOOGLE_CLIENT_ID` | | OAuth client ID (público) |
| `GOOGLE_CLIENT_SECRET` | ✅ | OAuth client secret |
| `GOOGLE_REDIRECT_URI` | | Redirect OAuth |
| `GOOGLE_CALENDAR_ENCRYPTION_KEY` | ✅ | Encryption key de tokens Google armazenados |
| `CALCOM_WEBHOOK_SECRET` | ✅ | Validação de webhook Cal.com |

### AI models (LLM / embeddings / voz)

| Variável | Secret? | Função |
|---|:---:|---|
| `GEMINI_API_KEY` | ✅ | Google Gemini — embeddings (1536d) + geração |
| `OPENROUTER_API_KEY` | ✅ | OpenRouter — gateway principal dos copilots |
| `OPENAI_API_KEY` | ✅ | OpenAI (usos pontuais) |
| `ELEVENLABS_API_KEY` | ✅ | ElevenLabs TTS (`elevenlabs-proxy`) |
| `OPENROUTER_DEFAULT_MODEL` | | Model-id default; fallback no código `google/gemini-2.5-flash` |
| `COPILOT_BUILDER_MODEL` | | Modelo do copilot-builder; fallback `anthropic/claude-sonnet-4.6` |
| `OPENROUTER_REFERER_URL` | | Header `HTTP-Referer` enviado ao OpenRouter |

> `DEFAULT_MODEL` **não é env var** — é constante de fallback no código (`OPENROUTER_DEFAULT_MODEL || DEFAULT_MODEL`).

### SZ.Chat

| Variável | Secret? | Função |
|---|:---:|---|
| `SZ_CHAT_AGENT_EMAIL` | ✅ | Login do agente SZ.Chat (`sz-chat-send`) |
| `SZ_CHAT_AGENT_PASSWORD` | ✅ | Senha do agente SZ.Chat |

### Asaas (pagamentos)

| Variável | Secret? | Função |
|---|:---:|---|
| `ASAAS_API_KEY` | ✅ | API key Asaas |
| `ASAAS_API_URL` | | Base URL Asaas (sandbox vs prod) |

### Sentry (monitoring)

| Variável | Secret? | Função |
|---|:---:|---|
| `SENTRY_DSN` | | DSN das edge fns (`_shared/sentry.ts`) — semi-público, tratar como config |

### Outros

| Variável | Secret? | Função |
|---|:---:|---|
| `MILENNIALS_ORG_ID` | | UUID da org Milennials (`6030520a-...`) — gating de features internas |

---

## Per-tenant secrets (não-env)

Credenciais que variam **por org** vivem em tabelas (RLS deny-all), não em env vars:

- `whatsapp_instance_secrets` — token Uazapi por instância
- Credenciais TinyERP por org (cifradas com `TINYERP_ENCRYPTION_KEY`)
- Tokens Google Calendar por usuário (cifrados com `GOOGLE_CALENDAR_ENCRYPTION_KEY`)

Acesso sempre via RPC `SECURITY DEFINER` com role check. Ver [[RPCs]] e [[Areas Frageis]].

---

## Setup local (dev)

```bash
cp .env.example .env.local
# preencher anon key + URL dev
```

Edge fn local:

```bash
supabase functions serve <fn> --env-file .env.local
```

---

## Rotation

- Edge fn secrets se editam no **Supabase dashboard** (não em git).
- `CRON_SECRET` em prod: rotacionar requer atualizar o segredo nas chamadas pg_cron / `pg_net` correspondentes.
- Após rotação de qualquer chave AI/WhatsApp, validar com `check-api-health`.

---

## Gotchas

- **Vite só expõe `VITE_*`.** Outros ficam só no build server / runtime edge.
- **Edge fn secrets** se editam no dashboard Supabase — git nunca vê valores.
- **`.env.production`** ignorado por `.gitignore` — usar dashboard.
- **`SUPABASE_SERVICE_ROLE_KEY`** bypassa RLS: qualquer leak é crítico. Nunca devolver em resposta de fn nem logar.
- **`ANON_KEY` / `ANON_KEY_2`** são fallbacks de provisionamento — não confundir com `SUPABASE_ANON_KEY`.
- **`OPENROUTER_DEFAULT_MODEL` / `COPILOT_BUILDER_MODEL`** são config, não segredo — mudar o model-id é deploy-safe, mas afeta custo e qualidade dos copilots.
- **Evolution vars** são legado — presença não significa uso ativo.
