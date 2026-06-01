# CLAUDE.md — Torque CRM

SaaS B2B multi-tenant. Leads, pipelines, campanhas, automações IA. ~30 orgs ativas. ICP: fábricas/distribuidoras B2B. Domínio: `torquecrm.com.br`. Time: CTO (Gabriel) + 1 dev junior + 3 subagentes Claude Code.

## Contexto JIT

Este doc é **mínimo**. Para detalhe, navegar via:
- **Vault**: `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/00 — INDEX.md`
- **Sub-CLAUDE.md** em módulos críticos:
  - `supabase/functions/agent-message/CLAUDE.md` — Copilot turn 🔴
  - `supabase/functions/whatsapp-webhook/CLAUDE.md` — Uazapi inbound 🔴
  - `supabase/functions/_shared/CLAUDE.md` — módulos compartilhados
  - `supabase/migrations/CLAUDE.md` — regras migration
  - `src/modules/CLAUDE.md` — bounded contexts overview 🟠
  - `src/modules/<bc>/CLAUDE.md` — 14 sub-CLAUDE.md (1 por BC)
- **AGENTS.md** raiz — spec agent-agnostic
- **llms.txt** raiz — index curado pra LLMs

## Subagentes (3)

Pipeline: `CTO → arquiteto → [design | engenheiro | ambos] → arquiteto (commit+push) → CTO`

| Subagente | Função | Skill |
|-----------|--------|-------|
| **arquiteto** | Entry/exit — sanity-check, arquitetura, roteamento, commit & push branch nova | `arquiteto` |
| **design** | UI/UX completo — visual, interação, microcopy, motion (invoca `hm-designer`) | `design` |
| **engenheiro** | Fullstack — TS/React/Deno + DB/RLS/RPC + tests + segurança + docs Obsidian/`.specs` + auto-QA | `engenheiro` |

**Roteamento**: Conversacional → arquiteto direto. Visual → design→engenheiro. Bug/refactor/schema/edge-fn → engenheiro. Feature UI completa → design+engenheiro paralelo. Decisão arquitetural → só arquiteto.

**Regras**: arquiteto nunca implementa. engenheiro cobre Impl+DB+Tests+Security+Docs (pula o que não aplica). design invoca `hm-designer`. Commit+push = responsabilidade do arquiteto. Tasks sensíveis (auth/PII/RLS/multi-tenant) = seção Segurança obrigatória. Default: dev. Prod: só com pedido explícito.

## Stack

Frontend: React 18 + TS 5.8 + Vite 5 (SWC) | UI: shadcn/ui (Radix) + Tailwind 3 + Lucide | State: TanStack Query v5 + Context (auth/features) | Forms: RHF + Zod | Backend: Supabase (Postgres + Auth + Edge Functions + Realtime + Storage) | AI: Gemini (embeddings 1536d) + pgvector | Integrações: Uazapi, Meta, Google Calendar, TinyERP, Asaas, n8n, SZ.Chat, ElevenLabs | Testes: Vitest + Playwright | Monitoring: Sentry

## Comandos

```bash
npm run dev              # localhost:8080
npm run build            # Produção
npm run test:unit        # Vitest
npm run test:integration # Vitest + Supabase local
npm run test:e2e         # Playwright
npm run lint             # ESLint
```

Deploy edge functions: `supabase functions deploy <fn> --project-ref <ref>`
- Prod: `jsjsmuncfkbsbzqzqhfq` | Dev: `bcfadphgsibjzivtbjvc`
- Frontend: push main → builds Docker image em ghcr.io (`:latest` + `:sha-<short>`). **Deploy é manual** via EasyPanel UI (VPS Hostinger, puxa `:latest`). Decoupled de propósito — evita push surpresa em prod a partir de merge rotineiro.

Org Milennials: `6030520a-2ca7-477d-be89-55758e2cd808`

## Estrutura

Monolito modular pós-modularização (slices 1–16, completo em 2026-05-28). 14 bounded contexts em `src/modules/<bc>/`.

```
src/
├── modules/                  # 14 BCs auto-contidos. API pública via index.ts. ESLint boundaries enforce (error mode após slice 17).
│   ├── identity/             # Auth + org + team + permissions + master ops
│   ├── leads/                # Lead CRUD + timeline + tags + import + bulk + enrichment
│   ├── pipelines/            # pipe_* views + custom pipelines + kanban + dispatch + loss reasons
│   ├── communication/        # WhatsApp + Meta + Email + SMS + AI email writer + history sync + mass send (UI)
│   ├── copilot/              # Copilot agents + Oraculo + prompt builder + reasoning + tool logs
│   ├── workflows/            # Workflow DAG + executor + triggers
│   ├── campaigns/            # Campaigns + mass send
│   ├── carteira/             # Carteira clients + orders + upsell
│   ├── engagement/           # Activities + agenda + checklists + followups + gamification + commissions + goals + coaching IA + log call
│   ├── analytics/            # Dashboards + metrics + cohorts + TV dashboard
│   ├── billing/              # Subscription + plans
│   ├── marketing/            # Lead forms + landing + UTM
│   ├── integrations/         # Google Calendar adapter (+ resto via edge fns doc-only)
│   └── platform/             # Onboarding + settings + observability + feature flags + command palette + saved views + layout + shortcuts
├── components/ui/            # shadcn primitivos (53) — cross-cutting, NÃO é módulo
├── shared/                   # Utils sem dependência de domínio
│   ├── components/           # 8 widgets neutros (CreateNewModal, UpgradeModal, EmptyState, ...)
│   ├── hooks/                # 11 hooks neutros (useDebounce, usePersistedState, useDataExport, ...)
│   ├── format/               # lead-field-labels (formatters puros)
│   ├── realtime/             # useRealtimeChannel + useRealtimeChannelStatus + useRealtimeSubscription (transport)
│   └── permission-actions.ts
├── core/                     # supabase client, env, sentry init (a popular)
├── contexts/                 # AuthContext via identity export; FeaturesContext em platform
├── integrations/supabase/    # Client + types (auto-gerado — não editar)
├── hooks/                    # Vazio exceto use-toast (shadcn primitive)
└── pages/                    # Vazio — pages residem nos módulos
supabase/
├── functions/                # 78+ edge functions Deno (flat layout — Supabase CLI exige). BC mapping doc-only em supabase/functions/CLAUDE.md (slice 15).
├── functions/_shared/        # 35+ módulos compartilhados
└── migrations/               # 322+ migrations
```

## Arquitetura

**Multi-tenancy**: Toda query filtra `organization_id`. RLS garante isolamento. Frontend nunca envia org_id — vem do auth context.

**Permissões (3 camadas)**: Master → Org Admin → Feature Permissions → Role Matrix. Hooks: `useUserRole()`, `useCanPerformAction(action)`, `useMasterAuth()`. Server-side enforcement map: `docs/PERMISSION-ENFORCEMENT.md`.

**Pipelines**: `pipe_whatsapp` (qualificação), `pipe_confirmacao` (reunião), `pipe_propostas` (fechamento), `custom_pipelines`. Stages dinâmicas em `pipeline_stages`. Lead pode estar em múltiplos pipes.

**Edge Function pattern**: `Deno.serve(withSentry('nome', handler))` + `withSecurityHeaders(getCorsHeaders(req))` + OPTIONS early return.

**Realtime**: `useRealtimeSubscription(table, queryKeys)` de `@/shared/realtime` — postgres_changes, filtro org_id, debounce 2s.

**Cron (pg_cron)**: 10+ jobs/1min via pg_net → edge functions. Auth: `x-cron-secret`. Principais: webhook-deliveries, workflow-executions, outbound-dispatches, ai-actions, campaign-rule-dispatch.

## Padrões de código

**Hooks**: useQuery com `queryKey: [table, orgId]`, `enabled: !!orgId`. Mutations invalidam queryKey no onSuccess.

**Tipos**: `Tables<"leads">`, `TablesInsert<"leads">`, `TablesUpdate<"leads">` de `@/integrations/supabase/types`.

**Imports**: Sempre `@/` alias. Cross-module SEMPRE via barrel: `@/modules/<bc>` (NÃO `@/modules/<bc>/hooks/...`). Deep-import só pra `pages/*` (preserva `React.lazy()` code-splitting). Enforce: ESLint `boundaries/element-types` (error). **Naming**: Componentes PascalCase, hooks `use*` camelCase, tabelas snake_case, env `VITE_SCREAMING_SNAKE`.

## Áreas frágeis

### Copilot (agentes IA)
Fluxo mais frágil. Testar: criar→configurar→ativar→conversar. Edge cases: agente sem business_context, lead sem telefone, conversation sem messages.
- UI: `src/modules/copilot/components/` | CRUD: `src/modules/copilot/hooks/useCopilotAgents.ts` | Backend: `supabase/functions/agent-message/`, `_shared/ai-action-executor.ts`, `outbound-trigger/`

### WhatsApp (Uazapi)
Provider-agnostic via adapter. Migração Evolution→Uazapi completa.
- Adapter: `_shared/whatsapp-client.ts` + `_shared/whatsapp-providers/` | Proxy: `whatsapp-api-proxy/` (JWT+tenant+rate limit) | Webhook: `whatsapp-webhook/` (secret path) | History: `history-sync-worker/` | Mass: `mass-send-{create,status,control}/`
- Frontend: `src/modules/communication/lib/whatsappApi.ts`, `components/chat/actions/`, `components/chat/history-sync/`, `components/whatsapp-migration/`; mass send UI: `src/modules/campaigns/`
- Tabelas: `whatsapp_instance_secrets` (RLS deny-all), `history_sync_jobs`, `uazapi_sender_jobs`
- RPCs: `get/set_uazapi_credentials` (service_role only)
- Features Uazapi-only: sendMenu, sendPixButton, react/edit/pin/deleteForAll/markRead, historySync, /sender/* mass send
- Kill-switch: `organizations.whatsapp_provider_override`
- Envs prod: `UAZAPI_BASE_URL`, `UAZAPI_ADMIN_TOKEN`, `UAZAPI_WEBHOOK_SECRET`, `CRON_SECRET`

### Permissões
3 camadas, issues recorrentes. Testar com admin/membro/master separadamente.
- `src/modules/identity/lib/permissions.ts` | `_shared/permission_engine.ts` | `src/modules/identity/hooks/useUserRole.ts` | `tests/integration/permission-engine.test.ts`

## Gotchas

- JWT: maioria edge functions `verify_jwt=false` no config.toml. Auth via headers custom.
- Types: `src/integrations/supabase/types.ts` (270KB) auto-gerado. Regen: `supabase gen types typescript --project-id <ref> > src/integrations/supabase/types.ts`
- Deploy: `--no-verify-jwt` obsoleto. Use config.toml. Cuidado: `--no-verify-jwt=false` HABILITA JWT (double negative).
- pg_net: só Supabase. Cron depende dele.
- Realtime onUpdate: só campos alterados, sem joins. Dados aninhados vêm do cache.
- RLS + Realtime: NUNCA usar `SELECT ... FROM team_members` inline em policies. Sempre usar `get_my_organization_ids()` / `get_my_admin_organization_ids()` / `get_my_team_member_ids()` (SECURITY DEFINER, bypassa RLS). Subquery inline causa recursão infinita quando Realtime avalia `apply_rls()`. Mesma regra pra qualquer tabela com RLS referenciada dentro de policies de outra tabela.
- n8n body params: sempre strings. Arrays → JSON body ou normalizar na edge function.
- Vite chunks: deps grandes → adicionar em `manualChunks` do vite.config.ts.

## Webhook lead-webhook

```json
{"source":"meta_ads","organization_id":"uuid","fields":{"name":"...","phone":"...","email":"...","company":"..."},"tags":["Ouro"],"place_in_pipe":{"pipe":"whatsapp","stage":"novo_lead"},"assigned_user_id":"uuid","update_existing_if_match":true}
```
Tags: array, JSON string `'["Ouro"]'`, ou string simples. Case-insensitive.

## Domínio

**Lead**: pessoa/empresa no sistema. Campos: nome, empresa, telefone, email, origem, rating(1-5 manual), qualification_score(0-100 auto), tags, responsáveis(SDR/Closer/Responsible).

**Lifecycle**: Entrada → pipe_whatsapp(novo→abordado→respondeu→agendado) → pipe_confirmacao(marcada→d5→d3→d1→compareceu) → pipe_propostas(enviada→vendido/perdido) → upsell. Lead em múltiplos pipes simultâneo.

**Roles código**: SEMPRE `admin`, `master`, `membro`. SDR/Closer = só UI/docs.

**Copilot**: Agentes IA via WhatsApp. Tipos: qualificador, sdr, followup, agendador, prospectador, custom. Personalidade + capabilities + kanban rules + business context. Dados: `conversations` + `conversation_messages`.

**Workflows**: DAG nodes. Triggers: lead_created, stage_changed, tag_added, cron. Nodes: trigger, action, condition, delay, wait_response, split_ab, copilot, webhook_call, wait_business_window. Track: `workflow_executions`.

**Campanhas**: Paralelo aos pipes. Objetivo + deadline + agente IA + metas + round robin + sequence msgs.

## Data model

`leads` (central) | `organizations` (tenant) | `team_members` (vendas+comissões) | `pipe_whatsapp/confirmacao/propostas` | `custom_pipelines`+`custom_pipe_entries` | `pipeline_stages` | `tags`+`lead_tags` | `campanhas`+`campanha_stages` | `workflows`+`workflow_executions` | `copilot_agents` | `conversations`+`conversation_messages` | `channel_messages` | `products` | `lead_history` | `follow_ups` | `webhook_deliveries` | `subscription_plans`

Relações: Lead→pipes(1:N), Lead→tags(N:N via lead_tags), Lead→responsible/sdr/closer(FKs team_members), Org→tudo(scoped), Workflow→executions→steps, Agent→conversations→messages.

## Fluxo n8n→V8

Trello→n8n→lead-webhook. Pattern: Meta Ads→Trello card→n8n trigger→extrai dados→classifica faturamento→tag→POST lead-webhook. 20+ workflows (1/cliente).

## Debugging

```bash
supabase functions logs <fn> --project-ref <ref>     # Logs realtime
supabase functions serve <fn> --env-file .env.local  # Local test
```

## Operações comuns

**Nova org**: `checkout-provision-org` → criar user (`create-org-user`) → vincular → plano → WhatsApp.
**Reset teste**: Delete ordem FK: lead_tags → pipe_* → leads → conversations. Filtrar por org_id.
**Nova edge function**: pasta `supabase/functions/<nome>/index.ts` → pattern padrão → config.toml se no-jwt → deploy → pg_cron se cron.

## CI/CD

Push main/develop → GitHub Actions: unit-tests → integration-tests (Supabase local) → e2e (Playwright) → docker-image (Node 20 + Nginx).

## Obsidian (Segundo Cerebro)

Vault: `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/`. Diátaxis-aligned. **Consultar ANTES de agir em features.**

| Pasta | Conteúdo |
|---|---|
| `00 — INDEX.md` | Map of content raiz |
| `01 — Identidade/` | Subagentes, Convenções |
| `02 — Arquitetura/` | Visao Geral, Multi-tenancy, Areas Frageis, Modulos, Integracoes |
| `03 — Reference/` | Schema, RLS Policies, Edge Functions, Cron Jobs, Env Vars, RPCs |
| `04 — Decisões/` | ADRs imutáveis |
| `05 — How-to/` | deploy-edge-function, aplicar-migration-prod, debug-whatsapp, ... |
| `06 — Features/` | Regras de negócio por domínio |
| `07 — Changelog/` | Append-only |
| `08 — Backlog/` | Work in progress |
| `09 — Tutorials/` | Onboarding dev, primeiro PR, tour vault, trabalhando com Claude |
| `99 — Templates/` | Esqueletos para notas novas |

**Vault tem 8 camadas de proteção** contra perda em merge — ver `CONTRIBUTING.md`.
Deletar arquivo do vault requer flag `[vault-delete-ok]` em commit message.

## Design

Dark-first. Refs: Linear, Stripe, Vercel. HSL CSS vars. Accent gold: `hsl(47 100% 50%)`. Font: Inter. shadcn/ui + `cn()`. Se parece template → reprovou.
