# `src/modules/` — Bounded Contexts

Pasta-raiz do **monolito modular** do Torque CRM. Cada subpasta é um **bounded context** (BC) auto-contido, derivado do CONTEXT.md raiz.

## Status

🟡 **Skeleton** — pastas criadas no slice 2 da modularização. Código migra progressivamente nos slices 3-14.

Refs: [SPEC](../../.specs/features/modularizacao/SPEC.md) · [ADR](../../Obsidian/Segundo%20Cerebro/Claude%20Code%20—%20Torque%20CRM/04%20—%20Decisões/ADR-2026-05-26-modularizacao-monolito-modular.md) · [Princípios do módulo](../../Obsidian/Segundo%20Cerebro/Claude%20Code%20—%20Torque%20CRM/10%20—%20Remodelagem/03-to-be/principios-modulo.md)

## Regras invariantes

1. **API pública via `index.ts`** — tudo cross-module passa pelo arquivo público do módulo
2. **Cross-imports proibidos fora da API pública** — enforced por ESLint `boundaries` (warn agora, error em slice 17)
3. **Sub-CLAUDE.md obrigatório** — cada módulo documenta escopo, áreas frágeis, owner
4. **1 módulo = 1 BC** — não 2, não 0.5
5. **Self-contained** — pode ser entregue/removido sem quebrar outros
6. **Comunicação cross-module via evento** (post-slice 19 event-bus): side-effects via `publishEvent`, não chamada direta

Detalhe completo em `10 — Remodelagem/03-to-be/principios-modulo.md`.

## Mapa dos 14 módulos

| # | Módulo | BC | Entidade primária | Slice | Status |
|---|--------|----|-------------------|-------|--------|
| 1 | [identity](./identity/CLAUDE.md) | identity | Org + Team Member + Role + Permission | 3 | Skeleton |
| 2 | [leads](./leads/CLAUDE.md) | leads | Lead | 4 | Skeleton |
| 3 | [pipelines](./pipelines/CLAUDE.md) | pipelines | Pipeline + Stage + Pipeline Entry | 5 | Skeleton |
| 4 | [communication](./communication/CLAUDE.md) | communication | Conversation + Message + Instance | 6 | Skeleton |
| 5 | [copilot](./copilot/CLAUDE.md) | copilot | Copilot Agent + Human Pause | 7 | Active |
| 6 | [workflows](./workflows/CLAUDE.md) | workflows | Workflow DAG + Action Handler | 8 | Active |
| 7 | [campaigns](./campaigns/CLAUDE.md) | campaigns | Campaign + Mass Send | 9 | Active |
| 8 | [carteira](./carteira/CLAUDE.md) | carteira | Carteira Client + Order + Upsell | 10 | Active |
| 9 | [engagement](./engagement/CLAUDE.md) | engagement | Checklist + Activity + Follow-up + Gamification | 11 | Active |
| 10 | [analytics](./analytics/CLAUDE.md) | analytics | Dashboard + Metric + Cohort | 12 | Active |
| 11 | [billing](./billing/CLAUDE.md) | billing | Subscription | 13 | Active |
| 12 | [marketing](./marketing/CLAUDE.md) | marketing | Lead Form + Landing + UTM | 13 | Active |
| 13 | [integrations](./integrations/CLAUDE.md) | integrations | Provider adapters | 13 | Skeleton |
| 14 | [platform](./platform/CLAUDE.md) | platform | Onboarding + Settings + Observability | 14 | Active |

## Cross-cutting (NÃO são módulos)

- `src/ui/` ou `src/components/ui/` — primitivos shadcn
- `src/shared/` — utils puros sem dependência de domínio
  - `src/shared/disparo/` — a decisão de Disparo que DOIS bounded contexts compartilham
    (#1846): quais números existem e em que regime (`disparo-numbers`), o teto por número
    (`speed-safety`), e o contrato do Template oficial (`template-escolhido`). O wizard
    vive em `campaigns` e o Disparo Rápido em `leads`; publicar isto pelo barrel de um dos
    dois fechava ciclo. **Os três são folha do grafo — zero import de módulo. Um único
    `@/modules/...` aqui recria o ciclo.**
    ⚠️ Carregam domínio (allowlist de provedor, regime do ADR-0028), o que tensiona a linha
    acima. A decisão de mover foi do CTO na #1846; a frase "sem dependência de domínio" já
    não descreve a árvore (`shared/components/CreateNewModal.tsx`,
    `shared/hooks/useDataExport.ts` importam módulo — estes três não). Ver
    `.specs/blast/HANDOFF-1846.md` §5.
- `src/core/` — supabase client, env, types globais, observability boot

## Convenção interna do módulo

```
src/modules/<bc>/
├── components/        # React components do domínio
├── hooks/             # React hooks (use*)
├── pages/             # route components
├── lib/               # utils internos do módulo
├── types.ts           # types públicos
├── events.ts          # handlers de evento publicados (post slice 19)
├── index.ts           # API pública
└── CLAUDE.md          # ownership + escopo
```

Tests co-located (`Foo.tsx` + `Foo.test.tsx`).

## Migração

Slice por slice, sequencial. Cada slice = 1 PR pequeno. Slices 3-14 sequenciais. Ordem detalhada em `.specs/features/modularizacao/SPEC.md`.
