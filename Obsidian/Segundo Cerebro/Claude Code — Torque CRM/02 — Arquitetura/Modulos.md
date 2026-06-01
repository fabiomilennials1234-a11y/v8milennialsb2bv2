---
type: architecture
title: Módulos — Mapa do Código
status: active
created: 2026-05-15
updated: 2026-05-28
tags: [arquitetura, modulos, codigo, modularizacao]
related: ["[[Visao Geral]]", "[[Edge Functions]]"]
owner: gabriel
---

# Módulos — Mapa do Código

> Diátaxis: **Explanation** + **Reference parcial**.
> Lookup de edge functions específicas → [[Edge Functions]].
> Slices roadmap → `10 — Remodelagem/04-execucao/slices.md`.

## Estado pós-modularização (2026-05-28)

**Monolito modular consolidado.** Slices 1-16 completas. ESLint `boundaries/element-types` em **error mode** (slice 17). Cross-module SEMPRE via barrel `@/modules/<bc>`.

```
src/
├── modules/                  14 BCs auto-contidos
├── components/ui/            53 shadcn primitivos (cross-cutting)
├── shared/                   utils sem dependência de domínio
│   ├── components/           8 widgets neutros
│   ├── hooks/                11 hooks neutros
│   ├── format/               lead-field-labels
│   ├── realtime/             3 transport hooks (Channel/Status/Subscription)
│   └── permission-actions.ts
├── core/                     (vazio — popular com supabase client + sentry init)
├── contexts/                 (exports re-direcionados pra módulos)
├── integrations/supabase/    client + types auto-gerado
├── hooks/                    apenas use-toast (shadcn primitive)
└── pages/                    vazio — pages residem nos módulos

supabase/
├── functions/                78+ edge fns Deno (flat layout — Supabase CLI exige)
│                             BC mapping doc-only em supabase/functions/CLAUDE.md (slice 15)
├── functions/_shared/        35+ módulos compartilhados
└── migrations/               322+ migrations
```

## 14 Bounded Contexts

| # | Módulo | BC | Entidade primária | Slice | Status |
|---|--------|----|-------------------|-------|--------|
| 1 | [identity](../../../../src/modules/identity/CLAUDE.md) | identity | Org + Team Member + Role + Permission | 3 + 16 | 🟢 Active |
| 2 | [leads](../../../../src/modules/leads/CLAUDE.md) | leads | Lead | 4 + 16 | 🟢 Active |
| 3 | [pipelines](../../../../src/modules/pipelines/CLAUDE.md) | pipelines | Pipeline + Stage + Pipeline Entry | 5 + 16 | 🟢 Active |
| 4 | [communication](../../../../src/modules/communication/CLAUDE.md) | communication | Conversation + Message + Instance | 6 + 16 | 🟢 Active 🔴 |
| 5 | [copilot](../../../../src/modules/copilot/CLAUDE.md) | copilot | Copilot Agent + Human Pause + Oraculo | 7 + 16 | 🟢 Active 🔴 |
| 6 | [workflows](../../../../src/modules/workflows/CLAUDE.md) | workflows | Workflow DAG + Action Handler | 8 | 🟢 Active |
| 7 | [campaigns](../../../../src/modules/campaigns/CLAUDE.md) | campaigns | Campaign + Mass Send | 9 | 🟢 Active |
| 8 | [carteira](../../../../src/modules/carteira/CLAUDE.md) | carteira | Carteira Client + Order + Upsell | 10 | 🟢 Active |
| 9 | [engagement](../../../../src/modules/engagement/CLAUDE.md) | engagement | Checklist + Activity + Follow-up + Gamification | 11 + 16 | 🟢 Active |
| 10 | [analytics](../../../../src/modules/analytics/CLAUDE.md) | analytics | Dashboard + Metric + Cohort | 12 | 🟢 Active |
| 11 | [billing](../../../../src/modules/billing/CLAUDE.md) | billing | Subscription | 13 | 🟢 Active |
| 12 | [marketing](../../../../src/modules/marketing/CLAUDE.md) | marketing | Lead Form + Landing + UTM | 13 | 🟢 Active |
| 13 | [integrations](../../../../src/modules/integrations/CLAUDE.md) | integrations | Provider adapters | 13 + 16 | 🟢 Active |
| 14 | [platform](../../../../src/modules/platform/CLAUDE.md) | platform | Onboarding + Settings + Observability + Command palette | 14 + 16 | 🟢 Active |

🔴 = Área frágil declarada (ver [[Areas Frageis]]).

## Regras invariantes

1. **API pública via `index.ts`** — tudo cross-module passa pelo arquivo público do módulo.
2. **Cross-imports proibidos fora da API pública** — enforced por ESLint `boundaries/element-types` (error mode após slice 17).
3. **Sub-CLAUDE.md obrigatório** — cada módulo documenta escopo, áreas frágeis, owner.
4. **1 módulo = 1 BC** — não 2, não 0.5.
5. **Self-contained** — pode ser entregue/removido sem quebrar outros.
6. **Pages = deep-import** — `App.tsx` faz deep-import via `React.lazy()` pra preservar code-splitting. Hooks/components: SEMPRE via barrel.
7. **Edge functions = flat layout** — Supabase CLI exige `supabase/functions/<fn>/`. BC mapping é doc-only (ver `supabase/functions/CLAUDE.md`).

Detalhe completo em `10 — Remodelagem/03-to-be/principios-modulo.md`.

## Convenção interna do módulo

```
src/modules/<bc>/
├── components/        # React components do domínio
├── hooks/             # React hooks (use*)
├── pages/             # route components (deep-import only)
├── lib/               # utils internos do módulo
├── contexts/          # opcional — contexts do BC
├── types.ts           # types públicos
├── events.ts          # handlers de evento publicados (post slice 19)
├── index.ts           # API pública
└── CLAUDE.md          # ownership + escopo
```

Tests co-located onde possível (`Foo.tsx` + `Foo.test.tsx`).

## Cross-cutting (NÃO são módulos)

- `src/components/ui/` — primitivos shadcn (53 files)
- `src/shared/` — utils puros sem dependência de domínio
- `src/core/` — supabase client, env, types globais, sentry init (a popular)

## Slice 15 — edge functions doc-only

Reorg física de `supabase/functions/` foi **descartada**. Supabase CLI exige flat layout (`supabase/functions/<fn>/index.ts`), e CLI workflows (deploy, serve, logs) acoplam a esse contrato. Substituído por **mapping doc-only** (96 funções catalogadas por BC) em `supabase/functions/CLAUDE.md` (commit `c9b227ed`).

Ver `04 — Decisões/ADR-2026-05-26-modularizacao-monolito-modular.md` para racional.

## Hooks — convenções

- `use<Tabela>()` — list query da tabela
- `use<Tabela>(id)` — single record
- `useCreate<Entidade>()`, `useUpdate<Entidade>()`, `useDelete<Entidade>()` — mutations
- Pattern: `useQuery({ queryKey: [table, orgId], enabled: !!orgId })`
- Mutations invalidam queryKey no `onSuccess`
- Realtime: importar de `@/shared/realtime/useRealtimeSubscription`

## `_shared/` — módulos críticos

- `whatsapp-client.ts` + `whatsapp-providers/` — adapter WhatsApp
- `permission_engine.ts` — engine de permissões
- `copilot/` — submódulos do agent engine
- `workflow_engine.ts` — DAG executor
- `ai-action-executor.ts` — ações IA
- `sentry.ts` — wrapper Sentry
- `auth.ts` / `user-auth.ts` — extrair org/user do request (consolidar)
