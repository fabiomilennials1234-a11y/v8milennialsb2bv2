# CLAUDE.md — Torque CRM

SaaS B2B multi-tenant. Leads, pipelines, campanhas, automações IA. ~30 orgs ativas. ICP: fábricas/distribuidoras B2B. Domínio: `torquecrm.com.br`. Time: CTO (Gabriel) + 1 dev junior + 7 subagentes Claude Code.

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

## Subagentes (7)

Entry point = **orchestrador** (coordenador). Ele classifica, roteia pelo ramo, custodia o Context Packet e segura o estado com loops de reprovação. Pipeline por ramo (`‖` = paralelo, mesma mensagem):

```
BUG      → diagnosticador → engenheiro → [revisor ‖ qa] → arquiteto(versiona) → humano deploya
FEATURE  → arquiteto(macro) → engenheiro (+design ‖) → [revisor ‖ qa] → arquiteto(versiona) → humano
REFACTOR → arquiteto(plano) → engenheiro → [revisor ‖ qa] → arquiteto(versiona) → humano
VISUAL   → design(spec) → engenheiro → [revisor ‖ qa] → arquiteto(versiona) → humano
TRIVIAL  → engenheiro → revisor → arquiteto(versiona)
```

**Fan-out revisor ‖ qa**: leituras independentes do mesmo diff, despachadas juntas. Pré-condição = `lint`+`test:unit`+`build` verdes no output do engenheiro. Serializa (revisor primeiro) só se build vermelho, RLS/multi-tenant/permissões não revisado, payment/efeito externo irreversível, ou migration destrutiva. Junção: `APROVA+PASSA` → arquiteto; qualquer `REPROVA`/`FALHA` → engenheiro em **uma** volta com os dois feedbacks fundidos. REPROVA de segurança bloqueia mesmo com QA PASSA.

**Context Packet** (`.claude/skills/_shared/context-packet.md`): subagentes não compartilham contexto, então o CP é o estado que viaja com a task — `Mapa verificado`, `Achados`, `Descartado`, `Comandos que valem`, `Aberto`. Todo brief carrega o CP **verbatim**; cada papel devolve `CP-v(N+1)`; o orchestrador propaga e funde. Sem CP, cada hop re-explora o repo do zero (medido: 197 leituras para 19 edições numa sessão).

Loops: revisor **REPROVA** ou qa **FALHA** → orchestrador re-despacha o engenheiro com feedback. Uma rodada de fan-out = **uma** volta. Cap = **2 voltas** no mesmo ponto → escala CTO.

| Subagente | Função | Skill |
|-----------|--------|-------|
| **orchestrador** | Entry + coordenador. grill-with-docs + grill-me, classifica, roteia, segura estado, aplica loops+cap | `orchestrador` |
| **diagnosticador** | Causa-raiz de bug/regressão (reproduz→minimiza→localiza). Não implementa | `diagnosticador` |
| **arquiteto** | Arquitetura macro (entrada) + versionamento/prep-PR (saída). Não roteia, não sobe prod | `arquiteto` |
| **engenheiro** | Fullstack — TS/React/Deno + DB/RLS/RPC + tests + segurança + docs Obsidian/`.specs` + auto-QA | `engenheiro` |
| **design** | UI/UX completo — visual, interação, microcopy, motion (invoca `hm-design`) | `design` |
| **revisor** | Gate qualidade+segurança. Lógica + rubric segurança obrigatório em área frágil. APROVA/REPROVA | `revisor` |
| **qa** | Teste end-to-end real (dirige o fluxo, observa). PASSA/FALHA (invoca `hm-qa`) | `qa` |

**Regras**: orchestrador coordena, nunca implementa/versiona. arquiteto desenha macro + versiona, nunca roteia. diagnosticador/revisor/qa nunca implementam — apontam; correção é do engenheiro. engenheiro cobre Impl+DB+Tests+Security+Docs. Áreas frágeis (Copilot/WhatsApp/Uazapi/Permissões/RLS/multi-tenant/PII/payment) = rubric de segurança obrigatório e bloqueante no revisor. Commit+push = arquiteto; **prod = humano** (arquiteto só prepara PR). Default deploy: dev. Prod: só com pedido explícito.

## Agent skills

### Issue tracker

Issues e PRDs vivem no GitHub (`fabiomilennials1234-a11y/v8milennialsb2bv2`), via `gh` CLI; PRD/épico leva label `prd` e as fatias referenciam ele. See `docs/agents/issue-tracker.md`.

### Triage labels

Vocabulário canônico sem overrides — `needs-triage`, `needs-info`, `ready-for-agent` (já existe no repo), `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` (21 ADRs) na raiz, mais os sub-`CLAUDE.md` por BC e o vault Obsidian. See `docs/agents/domain.md`.

## Stack

Frontend: React 18 + TS 5.8 + Vite 5 (SWC) | UI: shadcn/ui (Radix) + Tailwind 3 + Lucide | State: TanStack Query v5 + Context (auth/features) | Forms: RHF + Zod | Backend: Supabase (Postgres + Auth + Edge Functions + Realtime + Storage) | AI: Gemini (embeddings 1536d) + pgvector | Integrações: Uazapi, Meta, Google Calendar, TinyERP, Asaas, n8n, SZ.Chat, ElevenLabs | Testes: Vitest + Playwright | Observabilidade: `runtime_logs` (in-house, ADR-0017)

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
- Prod: `jsjsmuncfkbsbzqzqhfq`
- Frontend: **merge em main DEPLOYA sozinho.** Há um webhook `push` ativo do GitHub para `http://46.202.148.241:3000/api/deploy/…` (o EasyPanel), e ele builda e sobe a imagem. **Não existe passo manual.** Edge functions e migrations continuam manuais.
  > **Medido em 2026-08-02, e é a segunda vez que esta linha muda de lado.** PR #1352 mergeado às 23:05:53 UTC → imagem `easypanel/v8_mvp/teste:latest` construída às **23:07:55 UTC**, dois minutos depois, sem ninguém tocar na UI. O webhook está em `gh api repos/…/hooks` (`active=true`, evento `push`); não há watchtower na VPS — quem age é o próprio EasyPanel.
  >
  > A versão anterior afirmava o oposto ("NÃO é automático", "Redeploy MANUAL", "desacoplamento INTENCIONAL", "não conserte") e citava um comentário do `docker-image.yml` como fonte. Aquele comentário descreve o workflow do GitHub — que de fato só publica no ghcr.io — e **não sabe do webhook do EasyPanel**, que é outro caminho. Fonte parcial lida como fonte completa.
  >
  > O custo dessa inversão foi assimétrico e vale registrar: enquanto o doc dizia "automático", ninguém redeployava e a pendência voltava; depois que passou a dizer "manual", passou-se a anunciar redeploy pendente para coisa **já em produção**. As duas versões produziram trabalho errado. **Antes de reescrever isto uma terceira vez, meça:** compare o `mergedAt` do PR com o `CreatedAt` da imagem na VPS, e confira `gh api repos/…/hooks`.

## Ambientes — servidor dev APOSENTADO (decisão CTO 2026-07-22)

O projeto dev `bcfadphgsibjzivtbjvc` está **aposentado**. Não use, não deploye, não referencie. Estava 404 migrations atrás de prod e o token de acesso nem o enxerga.

**Ambiente de validação CANÔNICO (decisão CTO 2026-07-27): branch efêmera de prod. Docker FORA.** Runbook completo: `.specs/project/runbook-validacao-local.md`.

Regras, sem exceção:
1. **Branch é descartável.** Criou pra testar, terminou o teste, **encerra na hora** (`delete_branch`). Custo **$0.01344/hora**. Branch órfã = cobrança à toa.
2. **Nunca deixe branch viva entre sessões.** Cria de novo amanhã — barato criar, caro esquecer.
3. **`list_branches` antes de criar** — nunca duas.
4. Prod é **botão do humano**. Branch valida antes; não vira ambiente permanente.

✅ **BASELINE FEITO (#1233, 2026-07-23) — o "bloqueio 840" morreu.** Ledger de prod reconciliado = **18 linhas** (baseline + ativas, bate 1:1 com o repo); as 840 antigas em `supabase/migrations/archive/` (não reaplicar). O texto anterior ("BLOQUEIO ATIVO, MIGRATIONS_FAILED, baseline não feito") era **stale e falso** — mesmo veneno do #1212/#1223.

⚠️ **A branch precisa de `db push` do repo, não só `create_branch`:** a linha do baseline no ledger é **marcador de 189 chars** (não o dump), então `create_branch` replaya sobre schema vazio; o `db push` do repo aplica o baseline real (1.8 MB). Passo-a-passo no runbook.

### 🔒 GUARDA MECÂNICA de escrita — `db push` NÃO é seguro na mão
Um `db push` com URL/ref errado escreve em PROD (já aconteceu). Defesa por desenho, não disciplina:
- **Checkout NÃO-LINKADO por padrão.** Provado: `supabase db push` bare → `Cannot find project ref`. Linkar = ato deliberado e temporário, desfeito ao fim. **1ª linha.**
- **Toda escrita via `scripts/db-push-branch.sh`** — recusa a URL se contiver o ref de prod (`jsjsmuncfkbsbzqzqhfq`), roda `--dry-run`, exige confirmação, aborta se o push tocar dado real ("1 org promovida").
- **MCP Supabase em `read_only`** — só leitura + `create/list/delete_branch`; escrita (`execute_sql`/`apply_migration`) negada. Escrita de QA = `psql` na branch (`supabase/qa-seed/`), nunca MCP.
- **Migration = só schema** (guarda F4): `DO`/backfill de dado de cliente não entra no apply; assim URL errada vira erro de schema recuperável, não mudança de dado.

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

**Edge Function pattern**: `Deno.serve(withErrorBoundary('nome', handler))` + `withSecurityHeaders(getCorsHeaders(req))` + OPTIONS early return. O boundary devolve 500 **com CORS** — nunca remova o wrapper.

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
3 camadas, issues recorrentes. Testar separadamente com **admin**, **member** (o role do enum, não `membro`) e **master** — lembrando que master não é um valor de role, é a camada de cima.
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

**Roles código**: `team_members.role` é o enum `app_role` = `admin | sdr | closer | agency | bdr | cliente | member`. Em uso hoje (prod): `admin` e `member`. **É `member`, nunca `membro`** — escrever `'membro'` estoura `22P02` no INSERT. **`master` NÃO é role**: é camada à parte (`is_master_user()`, `useMasterAuth()`), fora do enum. SDR/Closer existem no enum mas o produto os trata como rótulo de UI. Guarda mecânica: `tests/unit/role-vocabulary.test.ts`.

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
