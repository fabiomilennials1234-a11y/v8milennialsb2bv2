---
tags:
  - claude-code
  - decisao
  - torque-crm
created: 2026-04-12
last_updated: 2026-04-12
status: active
---

# ADR: Snapshot Arquitetural — 2026-04-12

## Resumo

Registro das decisoes arquiteturais significativas encontradas durante a varredura inicial do projeto. Cada decisao com o contexto e tradeoffs identificados.

## D1 — Multi-tenancy via RLS (Row Level Security)

**Decisao**: Isolamento de tenants via RLS no Postgres, nao via schema separado ou banco separado.

**Contexto**: ~30 orgs ativas, crescendo. RLS garante que queries automaticamente filtram por `organization_id` baseado no JWT.

**Tradeoffs**:
- (+) Simplicidade operacional — um banco, um schema
- (+) Custo baixo — nao precisa de infra separada por tenant
- (-) Performance pode degradar com muitas orgs na mesma tabela
- (-) Uma policy mal configurada pode vazar dados cross-org

**Status**: Funcionando. Testes de integracao validam isolamento (`rls-org-isolation.test.ts`).

## D2 — verify_jwt = false em TODAS as edge functions

**Decisao**: Desabilitar verificacao JWT nativa do Supabase em todas as 52 edge functions. Autenticacao feita internamente.

**Contexto**: Diferentes edge functions autenticam de formas diferentes (Bearer token, x-webhook-key, x-cron-secret, API keys). O JWT nativo do Supabase nao suporta todos esses cenarios.

**Tradeoffs**:
- (+) Flexibilidade total de autenticacao
- (+) Permite webhooks externos sem JWT
- (-) Toda edge function DEVE implementar autenticacao manualmente
- (-) Se esquecer de autenticar, funcao fica aberta

**Mitigacao**: Modulos `_shared/auth.ts` e `_shared/user-auth.ts` centralizam a logica.

## D3 — pg_cron + pg_net para background jobs

**Decisao**: Usar pg_cron (Postgres) + pg_net (HTTP) para disparar edge functions como cron jobs, em vez de um worker externo (Bull, Celery, etc.).

**Contexto**: 17 cron jobs rodando a cada 1-5 minutos. pg_cron agenda, pg_net faz HTTP POST para a edge function com header `x-cron-secret`.

**Tradeoffs**:
- (+) Zero infra adicional — tudo no Supabase
- (+) Persistencia e retry nativos do Postgres
- (-) Vendor lock-in — pg_net so existe no Supabase
- (-) Se pg_net falhar, todos os jobs param silenciosamente
- (-) Sem dashboard de monitoramento de jobs (workaround: `runtime_logs` + `job-tracker.ts`)

## D4 — React Query como camada de estado

**Decisao**: TanStack Query v5 como unica camada de server state. React Context apenas para auth e feature flags.

**Contexto**: 122+ hooks, todos usando `useQuery`/`useMutation`. Sem Redux, Zustand ou MobX.

**Tradeoffs**:
- (+) Cache automatico, refetch, invalidation
- (+) Realtime via `useRealtimeSubscription` + invalidate
- (-) Query keys podem ficar inconsistentes (precisa disciplina)
- (-) Realtime handler recebe apenas deltas, nao rows completos — dados aninhados dependem do cache

## D5 — Supabase como backend completo (BaaS)

**Decisao**: Supabase como unico backend — Auth, Database, Storage, Edge Functions, Realtime. Sem server Node/Express/NestJS.

**Tradeoffs**:
- (+) Velocidade de desenvolvimento (CTO + 1 dev junior)
- (+) Infra gerenciada
- (+) Realtime nativo
- (-) Vendor lock-in significativo
- (-) Edge functions sao Deno, nao Node — ecossistema menor
- (-) Limites de escala dependem do plano Supabase

## D6 — Code splitting manual no Vite

**Decisao**: manualChunks explicito no `vite.config.ts` para controlar bundles.

**Chunks**: vendor (react), supabase, charts (recharts), motion (framer-motion), query (tanstack), dnd (dnd-kit).

**Contexto**: Sem isso, Vite agrupa tudo em poucos chunks grandes. Chunks manuais melhoram TTI e cache de longo prazo.

## D7 — Dark-first design system

**Decisao**: Tema dark como padrao. HSL CSS variables. Accent gold `hsl(47 100% 50%)`. Class-based dark mode.

**Contexto**: Decisao do CTO — referencias: Linear, Stripe, Vercel. Nao e um "toggle" — dark e o design principal.

## D8 — Google Calendar como microservico separado

**Decisao**: `services/google-calendar-service/` e um servico Python + Docker separado do monolito React/Supabase.

**Contexto**: OAuth 2.0 do Google requer server-side callbacks e refresh token management que nao cabem bem em edge functions stateless.

**Tradeoffs**:
- (+) Isolamento de responsabilidade
- (+) Python tem SDK Google Calendar mais maduro
- (-) Mais um servico para deployar e monitorar
- (-) Comunicacao via proxy (vite.config.ts: /api/calendar-service → localhost:8000)

## D9 — Quotas por org (modelo delta)

**Decisao**: Tabela `org_quotas` com modelo delta para enforcement de limites (leads, agentes, whatsapp instances, etc.).

**Contexto**: Implementacao recente (migrations 20260910000000-20260910000008). Permite enforcement sem contar rows a cada request.

## Links relacionados

- [[Visao Geral]]
- [[Limitacoes]]
- [[Integracoes]]
- [[00 — INDEX]]

## Notas do agente

> Fonte: analise combinada de `CLAUDE.md`, `vite.config.ts`, migrations, `supabase/config.toml`, e estrutura do projeto.
> Decisoes inferidas da estrutura do codigo. D1-D5 sao explicitas no CLAUDE.md. D6-D9 foram deduzidas.
