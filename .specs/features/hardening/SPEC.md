# Hardening — Stop-the-bleeding + Harden top-3 módulos

**Created:** 2026-05-26
**Scope:** Large (codebase-wide bug mitigation + structural hardening)
**Owner:** CTO + arquiteto + engenheiro
**Estimate:** ~120h (~15 dias úteis 1 dev)
**Source:** Grilling session 2026-05-26 (skill `grill-with-docs`). Modelo validado pelo `automations-onda-1` (precedent ~30h pra stop-the-bleeding com gain massivo).
**Gated by:** Phase 1 (Modularização) merged em main.
**Roadmap:** [`.specs/project/ROADMAP.md`](../../project/ROADMAP.md) — Phase 2.

---

## Contexto

Após Modularização (Phase 1), o codebase terá fronteiras físicas por bounded context. Aproveitar essa janela pra:

1. **Eliminar dor real** (top 5 root causes observadas em telemetria de produção)
2. **Hardenizar os 3 módulos com mais incidente** (Pareto — 80% da dor)
3. **Estabelecer padrões estruturais** (testes, fail-closed, Zod, idempotency, observability, RLS audit) que viram template pros outros 11 módulos

Hardening sem fronteira física = jogar testes em código espaguete + observability sem dimensão de domínio. Por isso só faz sentido **pós-Modularização**.

## Goals

- **Reativo**: top 5 root causes de erro (Sentry + DB + GitHub) com **0 ocorrências por 7 dias** após fix
- **Preventivo**: top-3 módulos com **70% test coverage** + 6 pillars aplicados
- **Padrão**: documentar pattern de hardening por pillar (`docs/patterns/<pillar>.md`) reutilizável nos 11 módulos restantes via backlog continuado

## Non-goals

- Hardening universal de 14 módulos (Pareto: 11 restantes via backlog continuado, sob demanda quando incidente aparecer)
- Mudança de stack/framework
- Refactor visual
- Mudança de schema DB que não derive de bug observado
- Reescrita de Copilot internals (sub-projeto separado)

---

## Triagem (slice 0)

**Fontes obrigatórias** (consultar SEMPRE antes de propor fix):

| Fonte | O que captura | Query padrão |
|---|---|---|
| `runtime_logs` | erros estruturados edge fn | `SELECT level, source, message, COUNT(*) FROM runtime_logs WHERE created_at > now() - interval '30 days' AND level IN ('error','fatal') GROUP BY 1,2,3 ORDER BY 4 DESC LIMIT 50` |
| `dead_letter_events` | events sem handler ou timeout | `SELECT event_type, error_message, COUNT(*) FROM dead_letter_events WHERE created_at > now() - interval '30 days' GROUP BY 1,2 ORDER BY 3 DESC LIMIT 30` |
| `workflow_executions` | DAG runs failed | `SELECT workflow_id, error_message, COUNT(*) FROM workflow_executions WHERE status='failed' AND created_at > now() - interval '30 days' GROUP BY 1,2 ORDER BY 3 DESC` |
| `pending_ai_actions` | ações IA failed | `SELECT action_type, error_message, COUNT(*) FROM pending_ai_actions WHERE status='failed' AND created_at > now() - interval '30 days' GROUP BY 1,2 ORDER BY 3 DESC` |
| `conversations` | drift `leads.ai_disabled` vs `conversations.state` | join entre `leads`, `conversations`, comparar `WAITING_HUMAN` vs `ai_disabled` |
| Sentry (frontend + edge) | erros uncaught | dashboard Sentry, filtrar últimos 30d, agrupar por issue |
| GitHub issues abertos | dor humana reportada | `gh issue list --state open --json number,title,labels,createdAt --limit 100` |

**Output da triagem**: tabela ranqueada por **(frequência × impacto × orgs afetadas)**. Top 5 viram REQ-P0.x; top-3 módulos (por incident count) viram alvo de hardening estrutural.

**Hipótese pré-triagem** (a confirmar):
- Top-3 módulos prováveis: `copilot`, `communication`, `workflows` (precedent: áreas frágeis no CLAUDE.md)
- Top causes prováveis: continuação de padrões da onda-1 (enums missing, tabelas drift, race conditions em mutations sem idempotency)

---

## Slices propostas

Cada slice = 1 PR pequeno, mergeável em `develop` (após Phase 1, develop volta a estar disponível pra Phase 2).

| # | Branch | Escopo | Estimativa |
|---|--------|--------|------------|
| 0 | `feat/hardening/00-triagem` | Query DB + Sentry export + gh issue export. Output: ranking + REQ-P0.x + lista top-3 módulos. Doc em `.specs/features/hardening/TRIAGEM.md`. | 8h |
| 1 | `feat/hardening/01-stop-bleeding-p0` | Fix top 5 root causes. PR por cause se independente; agrupado se mesmo módulo. | 16h |
| 2 | `feat/hardening/02-patterns` | Documentar 6 pillars como pattern reutilizável em `docs/patterns/`. Necessário antes de aplicar em módulo. | 8h |
| 3 | `feat/hardening/03-mod1-tests` | Pillar 1 (test coverage 70%) no módulo 1 | 12h |
| 4 | `feat/hardening/04-mod1-pillars` | Pillars 2-6 no módulo 1 (fail-closed, Zod, idempotency, observability, RLS audit) | 12h |
| 5 | `feat/hardening/05-mod2-tests` | Pillar 1 no módulo 2 | 12h |
| 6 | `feat/hardening/06-mod2-pillars` | Pillars 2-6 no módulo 2 | 12h |
| 7 | `feat/hardening/07-mod3-tests` | Pillar 1 no módulo 3 | 12h |
| 8 | `feat/hardening/08-mod3-pillars` | Pillars 2-6 no módulo 3 | 12h |
| 9 | `feat/hardening/09-finalize` | Audit final + métricas + descongelamento backlog + PR `develop → main` | 6h |

**Order rationale**: triagem antes de qualquer fix (não chutar onde dói). Stop-bleeding antes de hardening (resolve dor imediata antes de investir em prevenção). Patterns documentadas antes de aplicar (evita variação ad-hoc por módulo). Tests antes dos outros pillars no módulo (testes capturam comportamento pre-hardening, viram safety net).

---

## 6 Pillars (detalhados)

### Pillar 1 — Test coverage 70% por módulo

**Output**: integration tests Vitest cobrindo happy + edge cases. E2E Playwright pros fluxos críticos do módulo.

**Pattern doc**: `docs/patterns/01-test-coverage.md`

**Rule**:
- Unit tests obrigatórios em funções puras
- Integration tests obrigatórios em mutations + edge fn entry points
- E2E obrigatórios em fluxos que envolvem mais de 1 módulo
- `vitest --coverage` reportado em CI; gate em 70% do módulo modificado (não global)

### Pillar 2 — Fail-closed enforcement

**Output**: audit de toda permission check + mutation; loading/erro nunca retorna `allowed: true` ou `data: []` silencioso.

**Pattern doc**: `docs/patterns/02-fail-closed.md`

**Rule**:
- Hooks de permission: `{ allowed: false, reason: 'loading', isLoading: true }` em loading (padrão já em `useLeadActionGates`)
- Mutations: throw em erro de permission ao invés de retornar null
- Edge fn: 4xx explícito ao invés de 200 com `success: false`

### Pillar 3 — Input validation Zod nos boundaries

**Output**: toda boundary (edge fn entry, form submit, webhook handler) valida input via Zod schema antes de qualquer lógica.

**Pattern doc**: `docs/patterns/03-zod-boundaries.md`

**Rule**:
- Schema vive ao lado do handler (`<handler>.schema.ts`)
- Erro de validação = 400 com detalhe; nunca propaga pra próxima camada
- Schema compartilhado entre front e back via `src/shared/schemas/` quando aplicável

### Pillar 4 — Idempotency keys em mutations críticas

**Output**: mutations que NÃO podem rodar 2x (cobrança, envio de msg, criação de lead) ganham `idempotency_key` obrigatório.

**Pattern doc**: `docs/patterns/04-idempotency.md`

**Rule**:
- `idempotency_key` no payload de entrada
- Tabela `idempotency_records` (ou índice unique na tabela alvo)
- Repetição retorna 200 com mesmo resultado, sem re-execução

### Pillar 5 — Observability por módulo

**Output**: Sentry tag `module:<bc>` em todo capture + structured log com `module` field + correlação ID propagado entre edge fn + frontend.

**Pattern doc**: `docs/patterns/05-observability.md`

**Rule**:
- `Sentry.setTag('module', '<bc>')` no init do módulo
- `logger.info({ module, action, lead_id, ... })` ao invés de `console.log`
- `x-correlation-id` header propagado em edge fn → DB → frontend

### Pillar 6 — RLS audit + helpers SECURITY DEFINER

**Output**: 0 subquery inline em RLS policies; toda referência cross-table usa helper `SECURITY DEFINER` (precedent: `get_my_organization_ids()`, `lead_history.SELECT` via helper).

**Pattern doc**: `docs/patterns/06-rls-helpers.md`

**Rule**:
- Audit todas RLS policies; identificar subqueries inline
- Criar helper SECURITY DEFINER por padrão de acesso
- Migration substituindo policy
- Test integration: query realtime que dispararia recursão antes

---

## Critérios de aceite (overall)

- [ ] Triagem completa em `.specs/features/hardening/TRIAGEM.md` com ranking
- [ ] Top 5 root causes corrigidos, **0 ocorrências por 7 dias** em prod
- [ ] Top-3 módulos com **70% test coverage** (medido por Vitest)
- [ ] 6 pillars documentados em `docs/patterns/`
- [ ] 6 pillars aplicados nos top-3 módulos
- [ ] Sentry mostrando tag `module:<bc>` em todos os erros
- [ ] CI gate: Zod nos boundaries de edge fn dos top-3
- [ ] 0 RLS policy com subquery inline nos top-3
- [ ] Descongelamento backlog: `org-quota-enforcement` primeiro item pós-hardening
- [ ] Padrões documentados ficam disponíveis pros 11 módulos restantes (backlog continuado)

## Riscos

| Risco | Mitigação |
|-------|-----------|
| **Triagem revela top causes em módulos não-priorizados** | Re-ranking: top-3 vira top-3 *por incidente*, não palpite. Pode mudar (copilot/communication/workflows → outro trio). |
| **70% coverage virar meta cosmética** | Test quality > quantity. Code review obrigatório nos PRs de Pillar 1. Cobertura de happy path + 2 edge cases por mutation crítica, não cobertura de getter trivial. |
| **Patterns docs ficarem desatualizadas** | Cada pattern doc cita o PR exemplar que aplicou aquele pillar. Doc + código ficam pareados. |
| **RLS audit dispara recursão em test integration** | Já temos precedent (`lead_history.SELECT use helper`); seguir mesmo playbook. Memory `reference_pipe_views_compat.md` cobre padrão. |
| **Sentry tag sem categorização** | Tag = nome do BC do CONTEXT.md. 14 valores possíveis, finito. Dashboard de erro por módulo no slice 9. |
| **Backlog descongelado vira pressão de feature antes do hardening assentar** | Slice 9 inclui soak de 7 dias pra confirmar 0 ocorrências antes de descongelar. |

---

## Decisões registradas (desta sessão grilling)

| # | Decisão | Por quê |
|---|---|---|
| 1 | Sequencial (Modularização → Hardening) | Hardening sem fronteira = retrabalho |
| 2 | Híbrido (reativo + preventivo) | Onda-1 validou modelo |
| 3 | Pointer (não duplicar) | Roadmap = estratégia; SPEC = execução |
| 4 | 5 tabelas DB + Sentry + GitHub issues | Cobertura completa de sinais |
| 5 | 6 pillars priorizados pelo ranking | Pareto: foca onde dói |
| 6 | Absorver Coverage 70% | Evita reescrita de testes pós-move |
| 7 | Freezar backlog (exceto crítico = hotfix) | Disciplina firmada |
| 8 | Stop-bleeding + harden top-3 | Pareto: 3 módulos = ~80% da dor |

---

## Próximos passos imediatos (post-Phase 1 merge)

1. CTO aprova SPEC
2. Cortar `feat/hardening/00-triagem` de `develop`
3. Executar queries de triagem, gerar `TRIAGEM.md` com ranking
4. Decidir top-3 módulos com base em dado, não palpite
5. Cortar slices 1-9 sequencialmente
