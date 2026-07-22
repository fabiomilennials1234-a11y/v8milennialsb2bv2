---
type: identity
title: INDEX — Torque CRM Vault
status: active
created: 2026-04-12
updated: 2026-06-30
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

Project ref: prod `jsjsmuncfkbsbzqzqhfq`. Dev **aposentado** em 2026-07-22 — validação em branch efêmera a partir de prod (bloqueada até o baseline das migrations). Ver `CLAUDE.md` raiz § Ambientes.
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

> Cada pasta tem um `_MOC.md` auto-gerado por `scripts/vault-regen-indexes.mjs` que
> lista suas notas. Este mapa aponta pros índices — **não duplica** a lista de arquivos
> (era a fonte do drift; rodar o regen mantém os MOCs em dia).

| Pasta | Conteúdo | Índice |
|---|---|---|
| **01 — Identidade** | Subagentes, convenções, certificação de permanência | [[01 — Identidade/_MOC\|_MOC]] |
| **02 — Arquitetura** | Visão geral, multi-tenancy, áreas frágeis, módulos, integrações, roadmap, As-Is/To-Be | [[02 — Arquitetura/_MOC\|_MOC]] |
| **03 — Reference** | Schema, RLS, Edge Functions, Cron, Env Vars, RPCs, Webhooks (rev. 2026-06-30) | [[03 — Reference/_MOC\|_MOC]] |
| **04 — Decisões** | ADRs imutáveis | [[04 — Decisões/_MOC\|_MOC]] |
| **05 — How-to** | deploy-edge-function, aplicar-migration-prod, debug-whatsapp, criar-nova-org, ... | [[05 — How-to/_MOC\|_MOC]] |
| **06 — Features** | Regras de negócio por domínio (Comunicação, Vendas, IA, Admin, Infra) | [[06 — Features/_MOC\|_MOC]] |
| **07 — Changelog** | Append-only — diário (`YYYY-MM-DD.md`) + per-feature (`YYYY-MM-DD-slug.md`) | [[07 — Changelog/_MOC\|_MOC]] |
| **08 — Backlog** | Work in progress + pendências | [[08 — Backlog/_MOC\|_MOC]] |
| **09 — Tutorials** | Onboarding dev, primeiro PR, tour vault, trabalhando com Claude | [[09 — Tutorials/_MOC\|_MOC]] |
| **10 — Remodelagem** | Projeto Modularização — **CONCLUÍDO 2026-05-28** (As-Is → Solução → To-Be) | [[10 — Remodelagem/_MOC\|_MOC]] |
| **99 — Templates** | Esqueletos pra notas novas (adr, backlog-item, ...) | [[99 — Templates/_MOC\|_MOC]] |

### Decisões recentes (ADRs)

- [[ADR-2026-06-29-dna-almas-tag-driven-routing]] — roteamento tag-driven canônico (partner webhooks)
- [[ADR-2026-06-29-send-to-number-workflow-node]] — workflow node `send_to_number`
- [[ADR-2026-06-26-master-insights-unit-economics]] — unit economics master-only por org
- [[ADR-2026-06-26-copilot-set-sections-faithful-recompile]] — `copilot.set_sections` recompile fiel
- [[ADR-2026-06-24-torque-mcp-s5-s6-audit-triggers-migration-diff]] — tools de diagnóstico do torque-mcp
- [[ADR-2026-06-23-definer-search-path-hardening]] — pin `search_path` em SECURITY DEFINER (42883)
- [[ADR-2026-06-22-torque-mcp-interno]] — torque-mcp servidor interno (Edge Function)
- [[ADR-2026-05-28-modularizacao-conclusao]] · [[ADR-2026-05-26-modularizacao-monolito-modular]] — modularização

> ADRs também vivem no repo em `docs/adr/00NN-slug.md` (mais perto do código). ⚠️ Há
> colisões de numeração no repo a resolver (dois `0002`, dois `0012`) — ver `08 — Backlog`.

## Convenções

- **Naming**: ADR `ADR-YYYY-MM-DD-slug.md`. Feature `<dominio>/<slug>.md`. Changelog `YYYY-MM-DD.md` (daily) + `YYYY-MM-DD-slug.md` (per-feature).
- **Frontmatter universal**: `type`, `title`, `status`, `created`, `updated`, `tags`, `related`, `owner`. Ver [[99 — Templates/_README|Templates]].
- **Wikilinks**: usar `[[arquivo]]` ou `[[arquivo|texto custom]]`. Pasta `[[Pasta/arquivo]]` aceita.
- **Commit scope**: `docs(vault):` para mudanças só no vault.
- **Manutenção**: rodar `node scripts/vault-regen-indexes.mjs` após adicionar/remover notas (regenera os `_MOC.md`). `--check` falha no CI se algum MOC estiver desatualizado.

## Não confundir

- **Subagente do harness** (arquiteto/design/engenheiro) — ferramenta dev → ver [[Subagentes]]
- **Agente IA do produto (Copilot)** — IA conversacional pra leads → ver [[Copilot]]
