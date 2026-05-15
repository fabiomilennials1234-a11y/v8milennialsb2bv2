---
type: reference
title: Variáveis de Ambiente
status: draft
created: 2026-05-15
updated: 2026-05-15
tags: [reference, env-vars, config]
related: ["[[Edge Functions]]"]
owner: gabriel
---

# Env Vars — Reference

> Nunca commitar `.env*` com valores reais. `.gitignore` cobre.
> Source of truth: dashboard Supabase (edge fn secrets) + `.env.local` (frontend dev).

## Naming

- Frontend Vite: `VITE_SCREAMING_SNAKE`
- Backend (Deno + edge fn): `SCREAMING_SNAKE`

## Frontend (`.env.local`)

| Variável | Função |
|---|---|
| `VITE_SUPABASE_URL` | URL do projeto Supabase |
| `VITE_SUPABASE_ANON_KEY` | Anon key (público, OK em frontend) |
| `VITE_SENTRY_DSN` | Sentry DSN frontend |
| `VITE_APP_URL` | URL do app (pra links absolutos) |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth |
| (outras conforme integrações) |

## Backend (edge fn secrets)

### Auth / Supabase
| Variável | Função |
|---|---|
| `SUPABASE_URL` | URL do projeto |
| `SUPABASE_ANON_KEY` | Anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role (NUNCA frontend) |
| `CRON_SECRET` | Header `x-cron-secret` pra cron jobs |

### WhatsApp (Uazapi)
| Variável | Função |
|---|---|
| `UAZAPI_BASE_URL` | `https://milennialstech.uazapi.com` |
| `UAZAPI_ADMIN_TOKEN` | Token admin server-wide |
| `UAZAPI_WEBHOOK_SECRET` | Validação inbound webhook |

### IA
| Variável | Função |
|---|---|
| `GEMINI_API_KEY` | Google Gemini |
| `ELEVENLABS_API_KEY` | TTS |

### Integrações
| Variável | Função |
|---|---|
| `META_APP_ID`, `META_APP_SECRET` | Meta OAuth + webhook |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `ASAAS_API_KEY` | Asaas pagamentos |
| `TINY_API_KEY_*` | TinyERP (per-tenant em tabela, não env) |
| `SZCHAT_API_KEY` | SZ.Chat |
| `N8N_WEBHOOK_URL`, `N8N_API_KEY` | n8n (per-tenant em tabela) |

### Monitoring
| Variável | Função |
|---|---|
| `SENTRY_DSN_EDGE` | Sentry DSN edge fns |

## Per-tenant secrets

Credenciais que variam por org vivem em tabelas (RLS deny-all), não env vars:

- `whatsapp_instance_secrets` — token Uazapi por instância
- (outras integrações conforme onboarding)

Acesso via RPC `SECURITY DEFINER` com role check.

## Setup local (dev)

```bash
cp .env.example .env.local
# preencher anon key + URL dev
```

Edge fn local:
```bash
supabase functions serve <fn> --env-file .env.local
```

## Rotation

Procedimento documentado em [[rotacao-credentials]] (TODO criar).

## Gotchas

- **Vite só expõe `VITE_*`.** Outros ficam só no build server.
- **Edge fn secrets** se editam no Supabase dashboard (não em git).
- **`.env.production`** ignorado por gitignore — usar dashboard.
- **`CRON_SECRET` rotation** requer migration `ALTER DATABASE ... SET app.cron_secret`.
