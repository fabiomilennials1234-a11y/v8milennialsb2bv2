---
type: architecture
title: Visão Geral — Arquitetura Torque CRM
status: active
created: 2026-05-15
updated: 2026-05-15
tags: [arquitetura, overview]
related: ["[[Multi-tenancy]]", "[[Modulos]]", "[[Integracoes]]", "[[Areas Frageis]]"]
owner: gabriel
---

# Visão Geral — Arquitetura Torque CRM

> Diátaxis: **Explanation**. Por quê + modelo mental.
> Reference técnico em `docs/architecture/` (C4 diagrams) e `03 — Reference/`.

## Identidade do sistema

SaaS B2B multi-tenant. CRM com pipelines de vendas, campanhas, automações IA.
~30 orgs ativas. ICP fábricas/distribuidoras B2B. Domínio `torquecrm.com.br`.

Time: CTO (Gabriel) + 1 dev junior + Claude Code subagentes (ver [[Subagentes]]).

## Stack — escolhas e por quê

| Camada | Tecnologia | Por quê |
|---|---|---|
| Frontend | React 18 + TS 5.8 + Vite 5 (SWC) | Ecosystem maduro, fast dev loop, type safety |
| UI | shadcn/ui (Radix) + Tailwind 3 | Componentes acessíveis sem lock-in; dark-first natural |
| State | TanStack Query v5 + React Context | Cache server-state + auth/feature flags contextuais |
| Forms | RHF + Zod | Schema-first, validação compartilhada front/back |
| Backend | Supabase (Postgres + Auth + Edge Fn + Realtime + Storage) | BaaS robusto, Postgres direto, RLS para multi-tenant |
| AI | Google Gemini (embeddings 1536d) + pgvector | RAG inline no Postgres, sem vector DB separado |
| WhatsApp | Uazapi (multi-device) | Migração concluída de Evolution; ver [[whatsapp-stability-plan]] |
| Integrações | Meta, Google Calendar, TinyERP, Asaas, n8n, SZ.Chat, ElevenLabs | Ingestão de leads + faturamento + comunicação |
| Testes | Vitest + Playwright | Speed + DOM matching |
| Monitoring | Sentry | Erros front + back |
| Deploy | Docker + EasyPanel (Hostinger VPS) | Custo controlado, deploy simples |

Decisões arquiteturais detalhadas em `04 — Decisões/`.

## Princípios arquiteturais

1. **Multi-tenant by default.** Toda query filtra `organization_id`. RLS garante
   isolamento. Frontend nunca envia `org_id` — vem do auth context.
2. **Edge Function pattern.** Cada função usa `Deno.serve(withSentry('nome',
   handler))` + `withSecurityHeaders(getCorsHeaders(req))` + OPTIONS early return.
3. **Permissões em 3 camadas.** Master → Org Admin → Feature Permissions →
   Role Matrix. Roles no código: `admin`, `master`, `membro`.
4. **Realtime debounced.** `useRealtimeSubscription(table, queryKeys)` com
   `postgres_changes`, filtro `org_id`, debounce 2s.
5. **Cron via pg_cron + pg_net.** 10+ jobs/1min disparam edge functions.
   Auth via `x-cron-secret`. Detalhe em [[Cron Jobs]].
6. **Provider-agnostic onde possível.** WhatsApp via adapter pattern
   (`_shared/whatsapp-client.ts`). Permite swap de provider sem mexer no
   resto do código.
7. **Tipos Supabase auto-gerados.** Nunca editar `src/integrations/supabase/
   types.ts` manualmente — regen via CLI.

## Mapa mental

```
                                ┌─────────────────────────┐
                                │   Cliente final (lead)  │
                                └────────────┬────────────┘
                                             │ WhatsApp / SMS / form
                                             ▼
┌──────────────┐   ingestão    ┌──────────────────────────────┐
│  Meta Ads /  │──────────────▶│   n8n (orquestração)         │
│  formulários │               └──────────┬───────────────────┘
└──────────────┘                          │ POST lead-webhook
                                          ▼
                              ┌─────────────────────────┐
                              │  Edge Functions (Deno)  │
                              │  + Sentry + Auth gate   │
                              └────────┬────────────────┘
                                       │
┌──────────────┐    realtime    ┌──────▼─────────────────┐  pg_cron
│  Frontend    │◀──────────────▶│   Postgres + RLS       │◀─────── jobs
│  React+Vite  │                │   + pgvector + Auth    │
│              │                │   + Storage            │
└──────┬───────┘                └────────────────────────┘
       │ TanStack Query
       │
       ▼
  Browser
```

C4 detalhado em `docs/architecture/01-context.md`.

## Domínio — modelo conceitual

Ver [[Modulos]] para detalhe por módulo. Entidades centrais:

- **Lead** — pessoa/empresa no sistema. Tem rating manual (1-5),
  qualification_score IA (0-100), tags, responsáveis (SDR/Closer/Responsible).
- **Pipeline** — funil de vendas. 3 padrão + customizados:
  - `pipe_whatsapp` — qualificação (novo → agendado)
  - `pipe_confirmacao` — confirmação reunião (D-5 → compareceu)
  - `pipe_propostas` — proposta comercial (enviada → vendido/perdido)
  - `custom_pipelines` — funis customizados por org
- **Stage** — etapa dentro do pipe (`pipeline_stages`). Lead em múltiplos pipes simultâneo.
- **Campanha** — paralelo aos pipes. Objetivo + deadline + agente IA + metas
  + round robin + sequence msgs.
- **Workflow** — automação DAG. Triggers: lead_created, stage_changed, etc.
  Track em `workflow_executions`.
- **Copilot Agent** — IA conversacional. Tipos: qualificador, sdr, followup,
  agendador, prospectador, custom. Ver [[Copilot]].
- **Organization** — tenant. Toda query escopo.

## Por que essas decisões

### Por que Supabase
- Postgres direto + RLS resolve multi-tenant sem ORM custom
- Auth integrado (sem Firebase Auth duplicado)
- Edge Functions próximo do DB (latência baixa)
- pgvector inline (sem Pinecone/Weaviate separado)

### Por que Uazapi (não Twilio/Cloud API)
- Custo Cloud API alto e config complexa
- Multi-device necessário pra small business
- Uazapi: API simples, webhook fácil, multi-device nativo
- Migração de Evolution feita por incidente de estabilidade — ver [[ADR-2026-04-15-...]] (futuro)

### Por que TanStack Query (não Redux/Zustand)
- Server-state ≠ client-state
- Cache + invalidação + refetch + optimistic update built-in
- Reduz boilerplate enorme

### Por que React Context (não Zustand)
- Auth + feature flags são contexto natural
- Não precisa store global pra isso
- Performance OK com memo correto

## Áreas frágeis (alta gravidade)

Ver detalhe em [[Areas Frageis]]:
1. **Copilot** — fluxo mais frágil, testar fim-a-fim
2. **WhatsApp** — provider externo, ver [[whatsapp-stability-plan]]
3. **Permissões** — 3 camadas, issues recorrentes

## CI/CD

Push `main`/`develop` → GitHub Actions: unit-tests → integration → e2e →
docker-image (Node 20 + Nginx). Deploy automático sob review.

## Próximos passos arquiteturais (roadmap)

Backlog em `08 — Backlog/`. ADRs em consideração:
- [[move-pipe-record-server-side]] — move permission gate cliente → servidor
- Outros conforme amadurece.
