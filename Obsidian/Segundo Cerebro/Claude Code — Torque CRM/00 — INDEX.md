---
tags:
  - claude-code
  - index
  - torque-crm
created: 2026-04-12
last_updated: 2026-04-25
status: active
---

# Torque CRM — Segundo Cerebro

## O que e

SaaS B2B multi-tenant para gestao de leads, pipelines de vendas, campanhas e automacoes com IA. Produto da Milennials. Dominio: `torquecrm.com.br`. Aproximadamente 30 organizacoes ativas, ICP: fabricas e distribuidoras B2B. Time: CTO (Gabriel) + 1 dev junior.

## Stack tecnologica

| Camada | Tecnologia |
|--------|-----------|
| Frontend | React 18 + TypeScript 5.8 + Vite 5 (SWC) |
| UI | shadcn/ui (Radix) + Tailwind 3 + Lucide icons |
| State | TanStack Query v5 + React Context (auth/features) |
| Forms | React Hook Form + Zod |
| Backend | Supabase (Postgres + Auth + Edge Functions + Realtime + Storage) |
| AI | Google Gemini (embeddings 1536d) + pgvector (RAG) |
| Integracoes | Evolution API, Meta, Google Calendar, TinyERP, Asaas, n8n, SZ.Chat, ElevenLabs |
| Testes | Vitest (unit/integration) + Playwright (E2E) |
| Monitoring | Sentry |
| Deploy | Docker + EasyPanel (Hostinger VPS) |

## Capacidades do agente neste projeto

- Ler/escrever todos os arquivos do projeto (src/, supabase/, docs/, tests/)
- Executar comandos npm (dev, build, lint, test)
- Executar comandos supabase (deploy, db, gen types, logs)
- Executar comandos git (add, checkout, merge, push)
- Deploy de edge functions para producao e dev
- Rodar testes unitarios, integracao e E2E

## Restricoes criticas

> [!danger] NAO FAZER
> - **Nunca editar** `src/integrations/supabase/types.ts` manualmente (270KB auto-gerado)
> - **Nunca usar** `--no-verify-jwt` na CLI (use `verify_jwt = false` no config.toml)
> - **Nunca usar** SDR/Closer como role no codigo — roles sao `admin`, `master`, `membro`
> - **Nunca enviar** service_role key no frontend
> - **Nunca editar** migration que ja rodou — sempre criar nova
> - **Nunca commitar** arquivos `.env` com credenciais reais

## Comandos mais usados

| Comando | O que faz |
|---------|-----------|
| `npm run dev` | Dev server em localhost:8080 |
| `npm run build` | Build de producao (Vite) |
| `npm run test:unit` | Testes unitarios (Vitest) |
| `npm run test:integration` | Testes de integracao (precisa Supabase local) |
| `npm run test:e2e` | E2E (Playwright + Chromium) |
| `npm run lint` | ESLint |
| `supabase functions deploy <nome> --project-ref <ref>` | Deploy edge function |
| `supabase gen types typescript --project-id <ref>` | Regenerar tipos TS |
| `supabase functions logs <nome> --project-ref <ref>` | Ver logs em tempo real |

## Mapa de notas

### 01 — Identidade
- [[Permissoes]] — Permissoes do agente, MCPs, allow/deny
- [[Comportamentos]] — Regras de conduta, padroes de qualidade

### 02 — Arquitetura
- [[Visao Geral]] — Tipo de projeto, stack, estrutura de pastas
- [[Modulos]] — Componentes, hooks, pages, edge functions
- [[Integracoes]] — APIs, servicos externos, fluxos de dados

### 03 — Operacional
- [[Scripts e Comandos]] — Todos os comandos uteis com exemplos
- [[Fluxos de Trabalho]] — Como executar tarefas comuns
- [[Limitacoes]] — Gotchas, bugs conhecidos, areas frageis
- [[Coverage Roadmap]] — Onde paramos no projeto de coverage + como retomar

### 04 — Decisoes
- [[ADR-2026-04-12-arquitetura-inicial]] — Snapshot das decisoes arquiteturais encontradas
- [[ADR-2026-04-14-coverage-roadmap]] — Roadmap de cobertura de testes (4 fases)
- [[ADR-2026-04-15-agente-security]] — Adicao do agente Security ao time (9 → 10)
- [[ADR-2026-04-27-refactor-agent-engine-modular]] — Quebra de god modules em capabilities/fases

### 05 — Log de Contexto
- [[2026-04-12—sessao-inicial]] — Varredura completa do projeto

### 06 — Features

#### Comunicacao
- [[Chat WhatsApp]] — Chat multi-canal unificado (WhatsApp, Messenger, Instagram, SZ.Chat)
- [[Mensagens Agendadas]] — Agendar envio de mensagens WhatsApp
- [[Templates de Mensagem]] — Templates com variaveis dinamicas e slash commands

#### Vendas
- [[Pipe WhatsApp]] — Kanban de qualificacao de leads (novo → agendado)
- [[Pipe Confirmacao]] — Kanban de confirmacao de reuniao (D-5 → compareceu)
- [[Pipe Propostas]] — Kanban de propostas comerciais (proposta → vendido/perdido)
- [[Pipelines Customizados]] — Funis customizados por org (permanentes e temporarios)
- [[Funis Hub]] — Dashboard central de todos os pipes
- [[Follow-ups]] — Tarefas de follow-up automaticas e manuais
- [[Produtos]] — Catalogo B2B (MRR, projeto, unitario) com variantes
- [[Upsell]] — Modulo de pos-venda e cross-sell

#### Automacao
- [[Workflow Builder]] — Editor visual de automacoes (DAG com React Flow)
- [[Campanhas]] — Campanhas temporarias com metas e gamificacao
- [[Regras de Pipe]] — Dispatch automatico de mensagens por stage

#### IA
- [[Copilot]] — Agentes IA conversacionais (qualificador, SDR, agendador)
- [[Oraculo Comercial]] — Coaching IA e forecasting de vendas
- [[Lead Score]] — Score automatico 0-100 via IA

#### Analytics
- [[Dashboard]] — Dashboard principal (4 tabs: Visao Geral, Performance, Inteligencia, Analytics)
- [[Dashboard Outbound]] — Dashboard simplificado para orgs outbound
- [[Analytics Comercial]] — Analytics avancado (master only)
- [[Analytics UTMs]] — Explorer hierarquico de UTMs com CPL/CAC/ROAS
- [[Performance]] — Ranking + Metas + Premiacoes + Gestao
- [[Ranking]] — Leaderboard realtime
- [[TV Dashboard]] — Dashboard fullscreen para TV de escritorio

#### Equipe
- [[Gestao de Time]] — CRUD de membros, roles, seats, invite
- [[Comissoes]] — Comissoes por venda (MRR/Projeto)
- [[Metas]] — Goals mensais time e individual
- [[Premiacoes]] — Awards e badges com gamificacao

#### Integracoes
- [[WhatsApp Evolution]] — Evolution API (multi-device WhatsApp)
- [[Meta Facebook]] — Meta Ads + Messenger + Instagram
- [[Google Calendar]] — Sync de calendario e eventos
- [[TinyERP]] — Sync produtos, push pedidos, fetch NFe
- [[Asaas Pagamentos]] — PIX, card, subscriptions
- [[SZ Chat]] — SZ.Chat Alamaster multi-canal
- [[n8n Orquestracao]] — 20+ workflows de ingestao de leads

#### Admin
- [[Onboarding]] — Wizard 6 steps para novas orgs
- [[Configuracoes]] — Hub de configuracoes (8+ tabs)
- [[Permissoes Sistema]] — RBAC 4 camadas (master → admin → feature → member)
- [[Checkout e Planos]] — Wizard de checkout com PIX/card
- [[API Docs]] — Documentacao interativa da API
- [[Webhooks]] — Webhooks outgoing com retry e dead letter
- [[Master Admin]] — Super-panel administrativo (master only)

#### Seguranca
- [[Overview]] — Dominio de seguranca — threat model, superficie critica, owner (agent-security)

### 07 — Changelog
- [[2026-04-12]] — Daily note (primeiro dia)
- [[2026-04-14]] — Coverage project fase 0 + 1
- [[2026-04-15]] — Adicao do agente Security ao time
- `individuais/` — Notas detalhadas por mudanca significativa

### 08 — Backlog
- `backlog/` — Items pendentes
- `em-progresso/` — Items sendo trabalhados
- `concluido/` — Items finalizados (ex: [[second-brain-v2]])
