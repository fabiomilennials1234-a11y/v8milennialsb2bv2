# Modularização — Reorganização por Bounded Context

**Created:** 2026-05-26
**Scope:** Extra-large (codebase-wide structural refactor)
**Owner:** CTO + arquiteto + engenheiro
**Estimate:** 18 slices, ~80h total (~10 dias úteis 1 dev)
**Source:** Sanity-check arquitetural do arquiteto, fundado em CONTEXT.md (glossário canônico) + inspeção real da estrutura (`src/components/` 30+ pastas, `src/hooks/` 263 arquivos com 250+ soltos no root, `supabase/functions/` 97 funções no root, `_shared/` 35+ módulos no root). Fundamentação conceitual: [Augusto Galego — "Acabou o hype de microsserviços. Voltamos pra 2010"](../../../Obsidian/Segundo%20Cerebro/Clippings/(1197)%20Acabou%20o%20hype%20de%20microsserviços.%20Voltamos%20pra%202010.md) (monolito modular como janela entre MVP e microsserviços).
**ADR:** [ADR-2026-05-26-modularizacao-monolito-modular](../../../Obsidian/Segundo%20Cerebro/Claude%20Code%20—%20Torque%20CRM/04%20—%20Decisões/ADR-2026-05-26-modularizacao-monolito-modular.md)

---

## Contexto

O Torque CRM cresceu organizado por **camada técnica** (hooks/components/pages/functions), não por **domínio**. Pain points medidos:

- **263 hooks** em `src/hooks/` — só 4 subpastas (`chat`, `chat-meta`, `lead`, `onboarding`); 250+ no root.
- **97 edge functions** sem agrupamento — todas em `supabase/functions/<nome>/`.
- **35+ módulos** no root de `supabase/functions/_shared/` misturando domínios (workflow, message gateway, copilot batch, retention gate, permission engine).
- **Pastas duplicadas** por domínio: `lead/`, `lead-detail/`, `leads/`; `chat/`, `chat-meta/`; `pipelines/`, `pipe-propostas/`; `campanhas/`, `campaigns/`.
- **47 pages** soltas no root com naming inconsistente (`PipePropostas.tsx` vs `Negocios.tsx`, `MockupChatV3 2.tsx` órfão).
- **Sub-CLAUDE.md** existem só em 5 áreas frágeis; resto do codebase sem ownership documentado.

CONTEXT.md já documenta **14 bounded contexts** explícitos. A arquitetura física não reflete a arquitetura lógica → onboarding lento (CTO sozinho + 1 dev junior + 3 subagentes), blast radius alto a cada mudança, AI agents perdidos sem âncoras de domínio.

## Vision

**Monolito modular** (não microsserviços, não monolito espaguete). 1 frontend + 1 Supabase, mas dentro: módulos por bounded context com **API pública via `index.ts`** e cross-imports proibidos fora dela.

Por que monolito modular e não microsserviços: Torque tem CTO + 1 dev junior + 3 AI subagentes — fragmentar em microsserviços = overhead de devops, latência de rede, observabilidade distribuída, bancos separados. Custo > benefício até centenas de devs. Monolito modular pega o **isolamento** (anti-espaguete) sem o **overhead de rede**. Se um dia precisar virar microsserviço, as interfaces já estão expostas — troca call de função por GRPC e pronto. Detalhe completo no ADR-2026-05-26.

Codebase organizado por **bounded context** (DDD). Cada módulo:
- Unidade isolada com API pública clara (`index.ts` ou pasta `public/`)
- Ownership e responsabilidade documentados (sub-CLAUDE.md)
- Blast radius limitado pelas próprias fronteiras
- Pode ser entregue/removido sem quebrar outros módulos
- Cross-imports impedidos por ESLint (`boundaries`) + CI gate

**Hipótese**: ship-velocity sobe quando estrutura física = mental model. Hoje o CTO segura tudo na cabeça; um time não escalaria.

## Goals

- Reorganizar todo `src/` e `supabase/functions/` por bounded context derivado de CONTEXT.md
- Estabelecer API pública por módulo (boundary enforcement via tooling)
- Zerar pastas duplicadas por domínio (lead/leads/lead-detail → 1 módulo)
- Agrupar 263 hooks em módulos (root de `src/hooks/` vazio ou apenas cross-cutting)
- Agrupar 97 edge functions em subpastas de domínio
- Atualizar CLAUDE.md raiz + sub-CLAUDE.md por módulo + vault Obsidian + llms.txt + AGENTS.md

## Non-goals

- Reescrita de regras de negócio (comportamento idêntico antes/depois)
- Mudança de schema DB
- Migração de provider (Evolution→Uazapi já feita)
- Mudança de stack de hooks (manter `useQuery`/`useMutation`)
- Mudança visual (zero pixel modificado)
- Refactor de Copilot internals (sub-projeto separado)

## Bounded Contexts (derivados de CONTEXT.md + estrutura observada)

| BC | Entidade primária | Source CONTEXT.md | Pastas atuais |
|----|-------------------|-------------------|---------------|
| **identity** | Org + Team Member + Role + Permission | "Team & Organization" | `components/master`, `components/settings/equipe`, `hooks/auth`, `lib/permissions.ts`, `contexts/AuthContext` |
| **leads** | Lead | "Lead", "Lead Form", "UTM" | `components/lead`, `lead-detail`, `leads`, `pages/Leads.tsx`, `Duplicates.tsx`, `Trash.tsx` |
| **pipelines** | Pipeline + Stage + Pipeline Entry | "Pipeline", "Stage" | `components/pipelines`, `pipe-propostas`, `confirmacao`, `kanban`, pages `PipeX.tsx`, `CustomPipeline.tsx`, `FunisHub.tsx` |
| **communication** | Conversation + Message + Instance + Message Gateway | "Conversation", "Message", "Instance", "Message Gateway" | `components/chat`, `chat-meta`, `hooks/chat`, `hooks/chat-meta`, pages `ChatWhatsApp.tsx`, `AtendimentoMeta.tsx`, `Mockup*` |
| **copilot** | Copilot Agent + Human Pause + Oraculo | "Copilot Agent", "Human Pause", "Oraculo Comercial" | `components/copilot`, page `Copilot.tsx`, `CopilotMetrics.tsx`, `_shared/copilot/` (✅ já agrupado parcialmente) |
| **workflows** | Workflow DAG + Triggers + Conditions + Action Handlers | "Workflow", "Action Handler" | `components/automacoes`, pages `Automacoes*.tsx`, `_shared/workflow-*`, `_shared/action-handlers/`, `_shared/actions/` |
| **campaigns** | Campaign + Mass Send | "Campaign" | `components/campanhas`, `pages/campaigns/`, `pages/CampanhaDetail.tsx`, `Campanhas.tsx` |
| **carteira** | Carteira Client + Order + Upsell + ERP sync | "Carteira", "Order" | `components/carteira`, `components/upsell`, page `Upsell.tsx`, edge `tinyerp-*`, `erp-*`, `carteira-*`, `suggest-retention-action` |
| **engagement** | Checklist + Activity + Follow-up + Agenda + Gamification | "Checklist", "Activity", "Follow-up", "Gamification" | `components/agenda`, `pages/Agenda.tsx`, `ChecklistPage.tsx`, `Premiacoes.tsx`, `Ranking.tsx`, `useActivities`, `useChecklists`, `useAwards`, `useBadges`, `useCompetitions` |
| **analytics** | Dashboard + Metric + Cohort + TV | "Engagement" (parcial) | `components/analytics`, `dashboard`, `tv`, `performance`, pages `Dashboard.tsx`, `DashboardOutbound.tsx`, `TVDashboard.tsx`, `Performance.tsx`, `Metas.tsx`, `GestaoMetas.tsx`, `Revisao.tsx` |
| **billing** | Subscription + Asaas | "Subscription Plan" | edge functions Asaas, `lib/subscription.ts`, page `Configuracoes.tsx` (parcial) |
| **marketing** | Lead Form + Landing + UTM | "Lead Form", "UTM" | `components/landing`, page `Landing.tsx`, `lead-webhook`, `meta-webhook`, `list-lead-forms` |
| **integrations** | Provider adapters (Google Calendar, Meta, TinyERP, Asaas, SZ.Chat, Cal.com) | (cross-cutting) | edge `google-calendar-*`, `meta-oauth-*`, `meta-api`, `tinyerp-*`, `sz-chat-*`, `webhook-calcom` |
| **platform** | Onboarding + Settings + Observability + Health + Dead Letter | "Dead Letter Event" | `components/onboarding`, `command`, `settings`, pages `Onboarding.tsx`, `Configuracoes.tsx`, `Privacidade.tsx`, `MessageTemplates.tsx`, `cron-health-check`, `_shared/sentry.ts`, `logger.ts`, `rate-limit.ts`, `security-headers.ts` |

**Cross-cutting (não-módulo)**:
- `ui/` — primitivos shadcn (mantém intacto)
- `shared/` — utils puros sem dependência de domínio (`cn`, `format`, `normalizePhone`, `optimistic-lock`)
- `core/` — supabase client, types globais, env, sentry init

## Estrutura final proposta

```
src/
  modules/
    identity/
      components/ hooks/ pages/ lib/
      index.ts                    # API pública
      CLAUDE.md                   # ownership + áreas frágeis
    leads/
    pipelines/
    communication/
    copilot/
    workflows/
    campaigns/
    carteira/
    engagement/
    analytics/
    billing/
    marketing/
    integrations/
    platform/
  ui/                             # shadcn primitivos (mantém)
  shared/                         # utils puros
  core/                           # supabase client, env, types
  integrations/supabase/          # types.ts gerado (mantém)

supabase/
  functions/
    _shared/
      core/                       # cors, response, sentry, supabase-admin, security-headers, logger
      <bc>/                       # módulos por BC quando compartilhado entre 2+ functions
    <bc>/
      <function-name>/index.ts    # ex: leads/import-leads/, communication/whatsapp-webhook/
```

**Deploy compatibility**: edge functions agrupadas em subpastas exigem ajuste de path em CI/deploy scripts. Tratado em slice 14 isoladamente.

## Slices (vertical thin, mergeáveis em develop independente)

Cada slice = 1 PR pequeno, app não quebra ao mergear, sem dependência de slice futura.

| # | Branch | Escopo | Estimativa |
|---|--------|--------|------------|
| 0 | `feat/modularizacao/planejamento` ← atual | Este SPEC + ADR | 2h |
| 1 | `feat/modularizacao/00-tooling` | ESLint rule `boundaries` (warn-only inicial) + `dependency-cruiser` + CI gate | 4h |
| 2 | `feat/modularizacao/01-skeleton` | Criar `src/modules/<bc>/` vazias com sub-CLAUDE.md descrevendo escopo | 2h |
| 3 | `feat/modularizacao/02-identity` | Mover auth + team + master + permissions | 5h |
| 4 | `feat/modularizacao/03-leads` | Consolidar lead/lead-detail/leads + hooks + pages | 6h |
| 5 | `feat/modularizacao/04-pipelines` | kanban + pipelines + pipe-* + hooks pipeline | 6h |
| 6 ✅ | `feat/modularizacao/05-communication` | chat + chat-meta + whatsapp-* + hooks chat + pages — *concluído 2026-05-27* | 7h |
| 7 ✅ | `feat/modularizacao/06-copilot` | copilot + hooks agent (`_shared/copilot/` já agrupado) — *concluído 2026-05-27* | 5h |
| 8 | `feat/modularizacao/07-workflows` | automacoes (frontend) + executor (`_shared/workflow-*`, `actions/`, `action-handlers/`) | 6h |
| 9 | `feat/modularizacao/08-campaigns` | campanhas + mass-send + templates | 4h |
| 10 | `feat/modularizacao/09-carteira` | carteira + upsell + tinyerp + erp-* | 5h |
| 11 | `feat/modularizacao/10-engagement` | checklist + activities + agenda + gamification | 5h |
| 12 | `feat/modularizacao/11-analytics` | analytics + dashboard + tv + performance | 5h |
| 13 | `feat/modularizacao/12-billing-marketing` | subscription + landing + lead forms + UTM | 3h |
| 14 | `feat/modularizacao/13-platform` | onboarding + settings + observability | 4h |
| 15 | `feat/modularizacao/14-edge-functions` | Reorganizar `supabase/functions/` em subpastas BC + ajustar deploy | 6h |
| 16 | `feat/modularizacao/15-shared-cleanup` | Limpar `_shared/` (mover specifics pra `_shared/<bc>/`, manter só `core/`) | 4h |
| 17 | `feat/modularizacao/16-docs` | CLAUDE.md raiz + AGENTS.md + llms.txt + vault Obsidian + ESLint flip warn→error | 4h |
| 18 | `feat/modularizacao/17-finalize` | Deletar pastas legacy vazias + ADR de conclusão + PR `develop → main` | 2h |

**Order rationale**: tooling (slice 1) + skeleton (2) primeiro garantem que cada slice de domínio (3-14) tenha destino claro e violação detectável. Edge functions (15) depois do frontend porque alguns deploys dependem de path. Shared cleanup (16) depois que todos domínios já consumiram o que precisavam. Docs (17) por último com ESLint flip warn→error como gate.

### Adendo 2026-05-26 — Dedup absorvido + Event-Bus piloto (slice 19)

Auditoria pós-SPEC achou duplicatas que se não tratadas perpetuam dentro dos módulos novos. Detalhe: [`Obsidian/.../06 — Features/modularizacao/auditoria-duplicatas.md`](../../../Obsidian/Segundo%20Cerebro/Claude%20Code%20—%20Torque%20CRM/06%20—%20Features/modularizacao/auditoria-duplicatas.md).

**Tratamento**: cada slice de domínio (3-14) absorve sua própria dedup local (lead history×timeline×field-changes em slice 03; copilot toggle compose em slice 06; auditar `_shared/auth.ts` vs `user-auth.ts` em slice 16; etc.). +12h sobre estimativa original = ~92h total.

**Slice piloto event-bus** após slice 17, **antes** de finalizar (18):

| # | Branch | Escopo | Estimativa |
|---|--------|--------|------------|
| 19 | `feat/modularizacao/18-event-bus-pilot` | `domain_events` table + `_shared/events/{types,publish,dispatch,registry}` + edge `event-dispatcher` (cron 1/min) + migração piloto de `lead.stage_changed` (3 call sites → 1 publish + 1 handler workflow). Fecha backlog `triggerStageChangedWorkflows-duplicate.md`. | 8h |

Detalhe: [`Obsidian/.../06 — Features/modularizacao/event-bus-plano.md`](../../../Obsidian/Segundo%20Cerebro/Claude%20Code%20—%20Torque%20CRM/06%20—%20Features/modularizacao/event-bus-plano.md).

Expansão pra outros 5+ eventos (`message.received/sent`, `lead.created`, `campaign.dispatched`, `workflow.step_executed`) = projeto separado pós-modularização. Slice 19 valida padrão + fecha 1 bug recorrente.

**Renumeração**: slice de finalização passa de 18 → 20 (deletar legacy + ADR conclusão + PR develop→main).

## Critérios de decomposição (regra de classificação)

**É módulo se** todos os 4 verdadeiros:
1. É bounded context do CONTEXT.md
2. Tem entidade primária com lifecycle
3. Pode ser entregue/removido sem quebrar outros módulos
4. Tem owner mental claro (vendas, comunicação, ops, finance)

**NÃO é módulo se**:
- Utilitário puro sem dependência de domínio → `shared/`
- Primitivo de UI sem semântica de produto → `ui/`
- Init/config global → `core/`
- Helper compartilhado entre 2+ módulos sem identidade própria → `shared/` ou `_shared/core/`

## Boundary enforcement

**Tooling (slice 1)**:
- `eslint-plugin-boundaries`: cada módulo declarado, imports cross-module só via `index.ts` público.
- `dependency-cruiser`: gera grafo de deps, falha CI se ciclo entre módulos.
- Convenção: imports inter-módulo SEMPRE via `@/modules/<bc>` (não `@/modules/<bc>/internal/...`).

**Rollout**: warn-only por 2 slices (debugging), depois flip pra error em slice 17.

## Critérios de aceite (overall)

- [ ] 0 arquivos em `src/components/` (esvaziado, exceto se for movido pra `src/modules/`)
- [ ] 0 hooks soltos em root de `src/hooks/` (esvaziado, movido pra `src/modules/<bc>/hooks/`)
- [ ] 0 pages soltas em root de `src/pages/` (esvaziado, movido)
- [ ] 0 edge functions soltas no root de `supabase/functions/` (exceto `_shared/`)
- [ ] Cada módulo tem `index.ts` exportando API pública
- [ ] Cada módulo tem sub-CLAUDE.md
- [ ] ESLint `boundaries` em error mode + CI gate ativo
- [ ] CLAUDE.md raiz + AGENTS.md + llms.txt atualizados
- [ ] Vault Obsidian (`02 — Arquitetura/Modulos.md`) atualizado
- [ ] CI verde (lint + typecheck + unit + integration + e2e)
- [ ] Bundle size não regrediu (delta ±5%)
- [ ] Smoke manual: login → kanban → chat → copilot → workflow → campaign → carteira

## Riscos

| Risco | Mitigação |
|-------|-----------|
| **Imports massivos a reescrever** | Codemod (jscodeshift) por slice. Cada slice = 1 codemod scriptado, reversível. |
| **Conflict storm em PRs paralelos** | Slices sequenciais por padrão. Paralelismo só entre slices que tocam módulos sem deps (raro). |
| **Hotfix durante feature longa** | Protocolo já firmado (`feedback_hotfix_during_feature.md`): sai de main, merge main→develop, rebase slices em andamento. |
| **Deploy edge functions quebra** | Slice 14 isolado: muda paths + deploy scripts no mesmo PR, testa em dev antes de prod. |
| **Realtime subscriptions invalidam cache errado** | Validar `queryKey` por hook movido. Hooks de realtime listados em `_shared/realtime/` ou no módulo dono. |
| **AI subagentes perdidos durante transição** | Sub-CLAUDE.md por módulo criado no skeleton (slice 2). Vault atualizado em slice 17. |
| **Pasta `MockupChat*` órfã** | Slice 5 (communication): deletar se confirmado órfão, ou mover pra `modules/communication/internal/mockups/` se ainda referenciada. |
| **Disciplina de PRs** | Regra já firmada (`feedback_branch_discipline_during_feature.md`): só `feat/modularizacao/*` ou `hotfix/*` durante feature. |

## Decisão arquitetural (ADR)

Detalhe completo no vault: [ADR-2026-05-26-modularizacao-monolito-modular](../../../Obsidian/Segundo%20Cerebro/Claude%20Code%20—%20Torque%20CRM/04%20—%20Decisões/ADR-2026-05-26-modularizacao-monolito-modular.md).

**Resumo**: adotar monolito modular como padrão físico. `src/modules/<bc>/` + `supabase/functions/<bc>/<fn>/`. API pública via `index.ts`. Boundary enforced por ESLint + CI. Status: proposto, pendente aprovação CTO.

Fundamentação conceitual: [clipping Augusto Galego — monolito modular](../../../Obsidian/Segundo%20Cerebro/Clippings/(1197)%20Acabou%20o%20hype%20de%20microsserviços.%20Voltamos%20pra%202010.md).

## O que NÃO entra neste projeto

- Reescrita de regras de negócio
- Mudança de schema DB
- Mudança visual (zero pixel)
- Migração de stack/framework
- Refactor de internals de módulo (só mover + estabelecer fronteira)
- Otimização de bundle (acompanhar via CI, não objetivo)

## Próximos passos imediatos (após merge desta slice em develop)

1. CTO aprova ADR-MOD-001
2. Abrir issue de cada slice 1-18 (skill `to-issues`)
3. Slice 1 (`feat/modularizacao/00-tooling`) cortada de `develop`

---

## Adendo 2026-05-28 — Slice 15 (edge functions reorg) descartada

**Decisão:** Slice 15 reorg física de `supabase/functions/<bc>/<fn>/` foi **descartada**. Substituída por **mapping doc-only** em `supabase/functions/CLAUDE.md` (96 funções catalogadas por BC, commit `c9b227ed`).

**Motivo:** Supabase CLI hardcoda o contrato `supabase/functions/<fn>/index.ts` (flat layout). Toda a tooling (deploy, serve, logs, config.toml) acopla a esse path. Quebrar isso significaria forkar a CLI ou manter wrapper duplo — custo > benefício pra equipe pequena.

**Trade-off aceito:** Edge functions ficam fora do enforcement físico de boundaries. Mitigação: BC mapping doc-only + sub-CLAUDE.md por edge function crítica (já existe pra `agent-message`, `whatsapp-webhook`, `_shared`).

**Impacto:** Critério de aceite "0 edge functions soltas no root de `supabase/functions/`" **revogado**. Substituído por: "edge functions catalogadas por BC em `supabase/functions/CLAUDE.md` com link bidirecional para `src/modules/<bc>/CLAUDE.md`".

## Adendo 2026-05-28 — Slice 16 adicionada (cleanup longtail)

**Decisão:** Slice 16 não estava no plano original. Adicionada após inspeção pós-slice 14: ainda restavam 45 hooks/components + 1 page em `src/components/{ai,branding,calls,command,email,layout,oraculo,saved-views,shared,sms,team}/` e `src/hooks/` root.

**Escopo executado (PR #512):**
- `useTags`, `useImportBatches`, `useEnrichment`, `useBulkActions`, `useBulkSelection`, `useBatchedLeadMetrics` → `leads`
- `useEmailAccounts`, `useEmails`, `useSms`, `useAiEmailDrafts`, `components/{email,sms,ai/AiEmailWriter}`, `pages/MessageTemplates` → `communication`
- `useGoogleCalendar`, `useGoogleCalendarSharing` → `integrations`
- `useLossReasons` → `pipelines`
- `useSavedViews`, `useApplyViewFromUrl`, `useGlobalShortcuts`, `useKeyboardShortcuts`, `useSandbox`, `components/{command,saved-views,layout}` → `platform`
- `useAvatarMap`, `useAutoAdminAssignment`, `components/team/*` → `identity`
- `components/oraculo/OraculoComercial` → `copilot`
- `components/calls/LogCallModal`, `components/ai/{CoachingSidebar,NextBestActionsPanel}` → `engagement`
- `useRealtimeChannel`, `useRealtimeChannelStatus`, `useRealtimeSubscription` → `src/shared/realtime/`
- `usePersistedState`, `useDebounce`, `useOptimisticConflictHandler`, `useCountUp`, `use-viewport`, `useAutoSaveField`, `useExplicitSaveForm` → `src/shared/hooks/`

**Estado pós-slice 16:** `src/components/` contém apenas `ui/` (shadcn). `src/hooks/` contém apenas `use-toast.ts`. `src/pages/` vazia.

## Adendo 2026-05-28 — Slice 17 (docs + flip warn→error)

**PR atual.** Atualiza:
- 8 sub-CLAUDE.md afetados por slice 16 (identity, leads, pipelines, communication, copilot, engagement, integrations, platform)
- CLAUDE.md raiz + AGENTS.md + llms.txt
- Vault `02 — Arquitetura/Modulos.md` + `10 — Remodelagem/04-execucao/slices.md`
- ESLint `boundaries/element-types` + `boundaries/no-private` flip `warn` → `error` (0 violations detectadas pre-flip — fix risk-free)
- Este SPEC com adendos slice 15/16/17

**Próximo:** Slice 18 (finalize — deletar legacy + ADR conclusão). Slice 19 (event-bus piloto) em paralelo.
