# ADR — Modularização concluída (monolito modular) — 2026-05-28

## Status
Implementado.

## Decisores
CTO.

## Slices
0–19 (slice 16 cleanup longtail e slice 17 docs + ESLint flip incluídos; slice 15 real descartada — substituída por mapping doc-only).

## Decisão

Codebase reorganizado em **14 bounded contexts** sob `src/modules/<bc>/`, com `src/shared/` para utils cross-cutting e `src/components/ui/` mantida para primitivos shadcn. Boundary enforcement ativo via `eslint-plugin-boundaries` em error mode + CI gate.

A decisão original está documentada em [ADR-2026-05-26-modularizacao-monolito-modular](ADR-2026-05-26-modularizacao-monolito-modular.md). Este ADR registra o encerramento da execução em `develop`.

## Resultado

- 14 módulos populados sob `src/modules/`, cada um com API pública via `index.ts` + sub-CLAUDE.md.
- `eslint-plugin-boundaries` em error mode (`element-types` + `no-private`) + `dependency-cruiser` + CI gate ativo.
- 0 arquivos soltos no root de `src/components/` (apenas `ui/` shadcn), `src/hooks/` (apenas `use-toast.ts`), `src/pages/` (eliminada).
- Edge functions mantidas em flat layout por restrição do Supabase CLI; organização por BC via mapping em `supabase/functions/CLAUDE.md` (96 funções catalogadas) + link bidirecional pra `src/modules/<bc>/CLAUDE.md`.
- Event-bus piloto operacional para `lead.stage_changed` — tabela `domain_events` + `_shared/events/` + edge `event-dispatcher` + cron — padrão validado pra próximas migrações.

## Consequências

### Positivas
- Onboarding novo dev: começar lendo `src/modules/<bc>/CLAUDE.md` do BC relevante.
- AI subagentes operam com âncoras claras (sub-CLAUDE.md por módulo) — roteamento por BC explícito.
- Cross-imports inter-módulo proibidos fora de `index.ts` (CI gate) — blast radius limitado por construção.
- Caminho aberto pra extrair módulo em serviço se um dia precisar — interfaces já expostas.

### Negativas / a observar
- Slice 15 real descartada — edge functions permanecem em flat layout. Disciplina de naming + mapping doc-only é a única âncora física por BC nesse layer.
- Período transitório com call sites publicando `domain_events` antes do deploy da migration em prod resultaria em erro silencioso — sequência de deploy documentada em `smoke-pre-develop-to-main.md`.
- Disciplina contínua exigida pelo ESLint + revisão de PR pra manter as fronteiras.

## Métricas pre vs post

| Métrica | Pre | Post |
|---|---:|---:|
| `src/hooks/` root | 263 arquivos | 1 (`use-toast.ts`) |
| `src/components/` root | 13+ subpastas + arquivos soltos | 1 subpasta (`ui/`) |
| `src/pages/` root | 47 pages | 0 (pasta eliminada) |
| Módulos `src/modules/<bc>/` com sub-CLAUDE.md | 0 | 14 |
| ESLint `boundaries` | inexistente | `error` mode + CI gate |
| Edge functions catalogadas por BC | 0 | 96 (doc-only) |
| Domain events publicados via tabela | 0 | 1 (`lead.stage_changed`, piloto) |

## Próximos passos (fora desta slice)

- **PR `develop → main`** fica pra coordenação humana do CTO — não foi aberto nesta sessão.
- Sequência de deploy registrada em `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/10 — Remodelagem/04-execucao/smoke-pre-develop-to-main.md`:
  1. Aplicar migration `domain_events` em prod.
  2. Deploy edge `event-dispatcher` em prod.
  3. Ativar cron em prod.
  4. Deploy frontend.
- Migração das demais publicações de domain events (lead.created, conversation.message_received, workflow.executed, …) entra em backlog separado — fora do escopo da modularização.

## Refs

- ADR original: [ADR-2026-05-26-modularizacao-monolito-modular](ADR-2026-05-26-modularizacao-monolito-modular.md)
- SPEC: [`/.specs/features/modularizacao/SPEC.md`](../../../.specs/features/modularizacao/SPEC.md)
- Slices: [`10 — Remodelagem/04-execucao/slices.md`](../../10%20—%20Remodelagem/04-execucao/slices.md)
- Smoke checklist: [`10 — Remodelagem/04-execucao/smoke-pre-develop-to-main.md`](../../10%20—%20Remodelagem/04-execucao/smoke-pre-develop-to-main.md)
- Glossário de domínio: `/CONTEXT.md` (14 BCs)
