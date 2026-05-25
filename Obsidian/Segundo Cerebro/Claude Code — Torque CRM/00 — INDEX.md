---
type: identity
title: INDEX — Torque CRM Vault
status: active
created: 2026-04-12
updated: 2026-05-15
tags: [claude-code, index, torque-crm]
related: []
owner: gabriel
---

# Torque CRM — Segundo Cerebro

<!-- manual:start:overview -->

> SaaS B2B multi-tenant para gestão de leads, pipelines de vendas, campanhas e
> automações com IA. Produto da Milennials. Domínio: `torquecrm.com.br`.
> ~30 organizações ativas. ICP: fábricas e distribuidoras B2B.
> Time: CTO (Gabriel) + 1 dev junior + Claude Code subagentes (3).

<!-- manual:end:overview -->

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Frontend | React 18 + TypeScript 5.8 + Vite 5 (SWC) |
| UI | shadcn/ui (Radix) + Tailwind 3 + Lucide |
| State | TanStack Query v5 + React Context |
| Forms | React Hook Form + Zod |
| Backend | Supabase (Postgres + Auth + Edge Functions + Realtime + Storage) |
| AI | Google Gemini (embeddings 1536d) + pgvector |
| WhatsApp | Uazapi (migração de Evolution concluída) |
| Integrações | Meta, Google Calendar, TinyERP, Asaas, n8n, SZ.Chat, ElevenLabs |
| Testes | Vitest (unit/integration) + Playwright (E2E) |
| Monitoring | Sentry |
| Deploy | Docker + EasyPanel (Hostinger VPS) |

## Comandos chave

| Comando | O que faz |
|---------|-----------|
| `npm run dev` | localhost:8080 |
| `npm run build` | build prod (Vite) |
| `npm run test:unit` | Vitest unit |
| `npm run test:integration` | Vitest + Supabase local |
| `npm run test:e2e` | Playwright |
| `npm run lint` | ESLint |
| `supabase functions deploy <fn> --project-ref <ref>` | Deploy edge fn |
| `supabase gen types typescript --project-id <ref>` | Regen types |
| `supabase functions logs <fn> --project-ref <ref>` | Logs realtime |

Project refs: prod `jsjsmuncfkbsbzqzqhfq` | dev `bcfadphgsibjzivtbjvc`.
Org Milennials: `6030520a-2ca7-477d-be89-55758e2cd808`.

## Restrições críticas

> [!danger] NÃO FAZER
> - **Nunca editar** `src/integrations/supabase/types.ts` (270KB auto-gerado)
> - **Nunca usar** `--no-verify-jwt` CLI (use `verify_jwt = false` no `config.toml`)
> - **Nunca usar** SDR/Closer como role no código — roles: `admin`, `master`, `membro`
> - **Nunca enviar** service_role no frontend
> - **Nunca editar** migration que já rodou — criar nova
> - **Nunca commitar** `.env` com credenciais reais
> - **Default = dev.** Deploy em prod requer autorização explícita do CTO na sessão

## Mapa do vault

### 01 — Identidade
- [[Subagentes]] — Pipeline `CTO → arquiteto → [design|engenheiro] → arquiteto → CTO` + spec dos 3 subagentes

### 04 — Decisões (ADRs)
- [[ADR-2026-04-27-refactor-agent-engine-modular]] — Quebra de god module `AgentEngine` (2920→924 linhas)
- [[ADR-2026-04-30-meeting-date-sync]] — Sync `meeting_date ⇄ compromisso_date` + `move_pipe_record` fail-closed
- [[ADR-2026-05-15-consolidacao-subagentes]] — Consolidação 10→3 subagentes do harness Claude Code
- [ADR-2026-05-25 — Meta Chat canal separado](04%20—%20Decisões/ADR-2026-05-25-meta-chat-canal-separado.md)

### 06 — Features

#### Comunicação
- [[whatsapp-stability-plan]] — Estado consolidado pipeline WhatsApp (Uazapi → V8 → DB → UI)
- [[chat-bubble]] — Chat Bubble Kanban (FAB flutuante)
- [[chat-bubble-instance-filter]] — Filtro de instância WhatsApp no Chat Bubble
- [[01-schema|WhatsApp Write Instance — Schema]] — Vínculo 1:1 user→instância de escrita (Etapa A)
- [[02-ui-states|WhatsApp Write Instance — UI States]] — Spec visual (banner, card erro, modal admin)
- [[03-frontend|WhatsApp Write Instance — Frontend]] — Hook `useLeadWriteInstance` + ChatComposerShell + InstanceOwnerModal
- [[04-uat-roteiro|WhatsApp Write Instance — UAT]] — Roteiro F1-F8 testes presenciais

#### Vendas
- [[Pipe Confirmacao]] — Kanban de confirmação de reunião (D-5 → compareceu)
- [[Agenda Interna]] — Calendário unificado (meetings + follow-ups + msgs agendadas + confirmação)
- [[Upsell]] — Módulo de pós-venda e cross-sell

#### IA
- [[Copilot]] — Agentes IA conversacionais (qualificador, SDR, agendador, followup, prospectador, custom)

#### Admin
- [[Permissoes Sistema]] — RBAC 4 camadas (master → admin → feature → role)

#### Infraestrutura
- [[Runbook — Cron e Webhooks|Runbook Cron + Webhooks]] — pg_cron, webhook deliveries, dead letter

#### Automações
- [[rpc-consolidation]] — Consolidação de overloads RPC + health check + pg_net cleanup

### 07 — Changelog
- [[2026-04-27]] — Daily: refactor copilot + products RLS + PDF chunking
- [[2026-04-27-refactor-copilot-modules]] — Quebra god module copilot
- [[2026-04-27-pdf-chunking-rag]] — Fix PDF agente BRUNA em loading infinito
- [[2026-04-27-products-rls-strict]] — RLS estrita em `products`
- [[2026-04-28-chat-deep-link-funil]] — Deep link funil → chat
- [[2026-04-29]] — Daily
- [[2026-04-29-chat-layout-min-w-0]] — Fix chat layout min-w-0
- [[2026-04-30]] — Daily: sync `meeting_date ⇄ compromisso_date`
- [[2026-04-30-meeting-date-sync]] — Detalhe técnico do fix
- [[2026-05-04]] — Daily: Agenda interna, RPC, webhook
- [[2026-05-06]] — Daily: Fix delete leads upsell FK + import error tracking
- [[2026-05-08]] — Daily: WhatsApp write instance frontend
- [[2026-05-08-whatsapp-write-instance-frontend]] — Etapa C frontend
- [[2026-05-12]] — Daily: RPC consolidation + chat bubble instance filter
- [[2026-05-15-bl-wa-01-fallback-polling]] — Fallback polling realtime WhatsApp
- [[2026-05-15-bl-wa-03-session-dead-banner]] — UI banner sessão morta
- [[2026-05-15-bl-wa-04-media-dlq-retry]] — Mídia DLQ + retry
- [[2026-05-15-bl-wa-05-group-capture]] — Captura mensagens de grupo
- [[2026-05-15-whatsapp-stability-rollout]] — Incidente Uazapi V2 + rollout estabilização

### 08 — Backlog

#### Em progresso
- [[whatsapp-stability-100pct]] — Fechar 100% pipeline WhatsApp (BL-WA-01..14, 5/14 done)
- [[promote-refactor-copilot-to-main]] — Promote refactor copilot develop→main (aguardando validação)

#### Backlog (pendente)
- [[move-pipe-record-server-side]] — HIGH: trigger DB ou RPC `SECURITY DEFINER` para gate server-side
- [[permissions-fallback-fail-closed]] — MEDIUM: auditar fallback `allowed: true` em `src/lib/permissions.ts`
- [[tests-unit-usePipeConfirmacao-useLeads-sync]] — MEDIUM: testes unit dos paths SELECT-then-compare
- [[microcopy-reschedule-modal]] — LOW: microcopy do `RescheduleModal`
- [[toast-sync-inverso-falha]] — LOW: toast/Sentry no sync inverso
- [[triggerStageChangedWorkflows-duplicate]] — LOW: dedupe trigger workflows client vs server

## Convenções

- **Naming**: ADR `ADR-YYYY-MM-DD-slug.md`. Feature `<dominio>/<slug>.md`. Changelog `YYYY-MM-DD.md` (daily) + `YYYY-MM-DD-slug.md` (per-feature).
- **Frontmatter universal**: `type`, `title`, `status`, `created`, `updated`, `tags`, `related`, `owner`. Ver [[99 — Templates/_README|Templates]].
- **Wikilinks**: usar `[[arquivo]]` ou `[[arquivo|texto custom]]`. Pasta `[[Pasta/arquivo]]` aceita.
- **Commit scope**: `docs(vault):` para mudanças só no vault.

## Roadmap do vault

Reestruturação em andamento (2026-05-15+). Ver [[ADR-2026-05-15-vault-restructure]]
para plano completo, ou `08 — Backlog/em-progresso/vault-restructure.md`.

Estado vs target:
- ✅ F0 Proteção 8 camadas (`chore/vault-protection`)
- 🟡 F1 Limpeza (em andamento)
- 🔜 F2 Templates + convenções
- 🔜 F3 Diátaxis full (02-Arquitetura, 03-Reference, 05-How-to, 09-Tutorials)
- 🔜 F4 Root docs (AGENTS.md, llms.txt, sub-CLAUDE.md)
- 🔜 F5 C4 diagrams
- 🔜 F6 Automação (vault-regen, vault-lint)
- 🔜 F7 Migração legacy
- 🔜 F8 Onboarding + health monitoring

## Não confundir

- **Subagente do harness** (arquiteto/design/engenheiro) — ferramenta dev → ver [[Subagentes]]
- **Agente IA do produto (Copilot)** — IA conversacional pra leads → ver [[Copilot]]

### 02 — Arquitetura/Modulos
- [Atendimento Meta](02%20—%20Arquitetura/Modulos/atendimento-meta.md)

### 05 — How-to
- [Debug Meta Chat](05%20—%20How-to/debug-meta-chat.md)
