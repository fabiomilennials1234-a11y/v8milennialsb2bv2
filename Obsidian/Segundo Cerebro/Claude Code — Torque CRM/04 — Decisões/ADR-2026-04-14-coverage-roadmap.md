---
tags:
  - adr
  - coverage
  - testing
  - torque-crm
date: 2026-04-14
status: em-progresso
---

# ADR — Coverage Roadmap

## Status

**Em progresso** — Fase 0 completa, Fase 1 parcial (22 de ~40 módulos-alvo)

## Contexto

Solicitação do CTO: chegar a 100% de cobertura para "conseguir acompanhar tudo e testar tudo quando necessário, sem surpresa."

Estado inicial (2026-04-14): **64.59% stmts / 56.15% branches / 69.48% lines**, zero thresholds, CI com `continue-on-error: true` no coverage, bugs recentes em produção (ex.: opt-out `'para'`, conversion rate, tag normalization).

## Decisão

**Não miramos em 100% numérico.** 100% coverage é uma métrica de alcance, não de corretude — pode existir com testes frágeis que não pegam bugs reais (ex.: bug do `'para'` passaria em 100% coverage se o teste não assertasse caso por caso).

### Objetivo real

> **85% lines global, 90%+ branches nas áreas frágeis (permissões, copilot, webhooks), mutation testing nos módulos críticos, contract tests nos webhooks públicos, RLS tests pra isolamento multi-tenant, gate de regressão no CI.**

### Camadas de confiança

Pirâmide em ordem de garantia:

1. **Unit tests** — "A função retorna o valor certo?" (Vitest + asserts fortes)
2. **Integration tests** — "Componente + hook + banco + RLS conversam certo?" (Vitest + Supabase local)
3. **Contract tests** — "Webhook recebe payload do n8n sem breaking change?" (Zod schemas)
4. **E2E tests** — "Humano consegue fazer o fluxo real clicando?" (Playwright)
5. **Mutation testing** — "Os testes pegam bugs se eu introduzir um?" (Stryker — pendente)
6. **RLS tests** — "Usuário de org A vê dado de org B?" (SQL com JWTs)
7. **Observabilidade em prod** — Sentry + logs + alerts (já em uso)

Coverage numérico só mede a primeira camada.

### Alvos por camada

| Camada | Target | Razão |
|---|---|---|
| `src/lib/permissions.ts`, `permission_engine` | **95%+ branches** | Crítico, 3 camadas, bug recorrente |
| `src/hooks/` (React Query) | **85%+ lines** | Contrato com backend, quebra silenciosa |
| `supabase/functions/_shared/` | **90%+ lines** | Usado por 78 edge functions |
| Copilot (`agent-message`, `ai-action-executor`) | **90%+ branches** | Área frágil declarada |
| `supabase/functions/<webhooks públicos>` | **85%+** | Entrada do sistema, sem type safety |
| `src/components/ui/` (shadcn) | **ignorar** | Lib externa customizada |
| `src/pages/` | **60%+ smoke** | Render + navegação |
| Integration tests (DB real) | **cobrir 100% dos RPCs + policies críticos** | % importa menos que *existir* |
| E2E (Playwright) | **5 fluxos golden** | Lead → pipe → proposta → venda |

## 4 Fases

### Fase 0 — Estabilizar base ✅ COMPLETA

1. ✅ Consertar teste falhando (`useCalendarSharing`).
2. ✅ Thresholds por diretório em `vitest.config.ts` (ratcheting baseline).
3. ✅ Coverage Deno pra edge functions (`supabase/functions/deno.json` + npm scripts).
4. ✅ CI coverage gate bloqueante (removido `continue-on-error`, Node 20, job Deno).

### Fase 1 — Áreas frágeis 🔄 EM PROGRESSO (22 de ~40)

Foco: CLAUDE.md áreas frágeis + ingress público + integrações críticas.

**Cobertos** (com threshold travado):
- Permissões: `permission_engine` (95%), `user-auth` (98%), `src/lib/permissions` (100%)
- Workflow engine: `workflow-executor` (92%), `workflow-trigger` (100%), `workflow-action-handler` (93%), `workflow-condition-evaluator` (100%)
- Copilot: `followup-sender` (100%), `ai-action-executor` (94%), `ai-queue` (100%)
- Ingestão: `lead-webhook` (84%), `lead-service` (100%)
- Mensageria: `outbound-sender` (97%), `audio-sender` (100%), `tts-elevenlabs` (100%), `natural-messaging` (94%)
- Integrações: `google-calendar-utils` (100%), `tinyerp-utils` (100%), `meta-api` (100%), `asaas` (100%)
- RAG: `embeddings` (100%)
- Auth/webhook: `auth` (99%)

**Restantes** (~18 módulos):
- `_shared/`: logger, sentry, validation, track, message-humanizer, job-tracker (todos ≥86%)
- `src/lib/`: audioToMp3 (0%), whatsapp (45%), subscription (55%), evolutionApi (64%)
- `src/hooks/`: ~30 hooks com <50% (useAcoesDoDia, useBadges, useCompetitions, useImportLeads, etc.)

### Fase 2 — Hooks e shared (4 semanas) — NÃO INICIADA

- Cobrir 122 hooks React Query com template único (mock `supabase.from(...)`, assert query key, org filter, invalidations).
- Cobrir todos os 35 módulos `_shared/`.

**Target**: 80% lines global no `src/`, 85%+ em `_shared/`.

### Fase 3 — E2E e contratos (contínuo) — NÃO INICIADA

- Playwright nos 5 fluxos golden rodando em CI contra Supabase local + seed fixo.
- Contract tests p/ webhooks (Zod schema compartilhado entre edge function e teste).
- RLS tests (queries com JWTs de cada role confirmando não-vazamento cross-org).

**Target**: 85% lines global, 75% branches global, E2E verde, contratos blindados.

### Fase 4 — Manutenção — NÃO INICIADA

- Todo bug em produção vira teste **antes** do fix (TDD-regression).
- Revisão mensal — caçar dead code (funções 0%).
- Mutation testing (Stryker) em módulos críticos de permissões + copilot, 1×/trimestre.

## Consequências

### Positivas

- **Regressão bloqueada**: 22 módulos + 3 gates globais no CI. PR que derrubar coverage falha automaticamente.
- **Áreas frágeis blindadas**: bugs históricos (tag normalization, race condition 23505, opt-out) têm testes que impedem retorno.
- **Padrões documentados**: `vi.resetModules()`, `scripted()` mock helper, mock de `serve`/`withSentry`, hoisted `mockState` — reutilizáveis por outros devs.
- **Pipeline Deno funcional**: base pra testar todas as 78 edge functions sem rodar Supabase local.
- **Trilha CI clara**: lintados pelo coverage gate, não apenas testes unitários.

### Negativas / Custos

- **Manutenção de thresholds**: quando um módulo passa por refactor, o threshold precisa ser reajustado. Mitigação: comentário no `vitest.config.ts` explica o baseline e quando ratchetar.
- **Tempo investido**: ~15 módulos/sessão, restam ~3-4 sessões pra Fase 1.
- **`ai-action-executor.ts` tem dead code**: `descriptionFn` em `ACTION_HISTORY_MAP` nunca é chamado para `STAGE_AI_ACTIONS` (PG triggers fazem o log). Threshold fixo em 94% pra não chase code unreachable.

### Alternativas rejeitadas

- **"100% global em tudo"** — rejeitado. Coverage alto com testes fracos é pior que 70% com testes fortes (falsa segurança). Os últimos 10% custam 3-5× mais e forçam testes que testam implementação em vez de comportamento.
- **Não usar threshold travado, só medir** — rejeitado. Sem gate no CI, coverage degrada silenciosamente.

## Referências

- Estado persistente: `.specs/project/STATE.md` (D007, D009–D031)
- Thresholds: `vitest.config.ts`
- CI: `.github/workflows/test.yml`
- Changelog: [[07 — Changelog/2026-04-14]]
- Roadmap operacional: [[03 — Operacional/Coverage Roadmap]]
