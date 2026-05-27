---
type: reference
title: Execução — Slices
status: active
created: 2026-05-26
tags: [remodelagem, execucao, slices]
related: ["[[estrutura-final]]", "[[criterios-sucesso]]"]
---

# Execução — Slices

19 slices vertical thin, mergeáveis em `develop` independente. Cada slice = 1 PR pequeno, app não quebra ao mergear, sem dependência de slice futura.

Detalhe completo + estimativas em `.specs/features/modularizacao/SPEC.md`.

## Ordem

| # | Branch | Escopo | Estimativa |
|---|--------|--------|-----------:|
| 0 | `feat/modularizacao/planejamento` ← atual | SPEC + ADR + auditoria + event-bus plano + vault 10-Remodelagem | 4h |
| 1 | `feat/modularizacao/00-tooling` | ESLint `boundaries` (warn-only) + `dependency-cruiser` + CI gate | 4h |
| 2 | `feat/modularizacao/01-skeleton` | `src/modules/<bc>/` vazias + sub-CLAUDE.md descrevendo escopo | 2h |
| 3 | `feat/modularizacao/02-identity` | auth + team + master + permissions | 5h |
| 4 | `feat/modularizacao/03-leads` | Consolidar lead/lead-detail/leads + hooks + pages. **Absorve dedup**: timeline×history×fieldChanges | 6h + 2h |
| 5 | `feat/modularizacao/04-pipelines` | kanban + pipelines + pipe-* + 16 hooks pipeline (namespace legacy explícito) | 6h + 1h |
| 6 ✅ | `feat/modularizacao/05-communication` | chat + chat-meta + whatsapp-* + hooks. **Absorve dedup**: realtime hooks (3→1) — *concluído 2026-05-27. Dedup realtime adiado para slice 14 (hooks cross-cutting, não pertencem ao BC)* | 7h + 1h |
| 7 ✅ | `feat/modularizacao/06-copilot` | copilot + hooks agent + `_shared/copilot/`. **Absorve dedup**: copilot toggle (3→1) — *concluído 2026-05-27. Frontend migrado (42 renames). Backend `_shared/copilot/` + 4 utils órfãos adiados para slice 16. Dedup toggle mantido como 3 hooks (mutation/audit/realtime — responsabilidades distintas, consolidação forçada quebraria callers)* | 5h + 1h |
| 8 ✅ | `feat/modularizacao/07-workflows` | automacoes + `_shared/workflow-*` + actions/action-handlers. **Absorve**: auditar nomenclatura — *concluído 2026-05-27. Frontend migrado (54 renames + 43 arquivos com imports reescritos, 65 substituições). Backend `_shared/workflow-*` + `actions/` + `action-handlers/` adiados pra slice 16. Edge functions (5) pra slice 15. `triggerStageChangedWorkflows` duplicate bug mantido (resolução em slice 19 event-bus). `useAutoAdminAssignment` e `useAutoMoveUpsellClients` NÃO migrados (orquestração identity/carteira pura, sem dependência de workflow APIs)* | 6h + 2h |
| 9 | `feat/modularizacao/08-campaigns` | campanhas + mass-send + templates | 4h |
| 10 | `feat/modularizacao/09-carteira` | carteira + upsell + proposals + deals + tinyerp + erp-* | 5h |
| 11 | `feat/modularizacao/10-engagement` | checklist + activities + agenda + gamification | 5h |
| 12 | `feat/modularizacao/11-analytics` | analytics + dashboard + tv + performance + revisao | 5h |
| 13 | `feat/modularizacao/12-billing-marketing` | subscription + landing + lead forms + UTM | 3h |
| 14 | `feat/modularizacao/13-platform` | onboarding + settings + observability | 4h |
| 15 | `feat/modularizacao/14-edge-functions` | Reorganizar `supabase/functions/` em subpastas BC + ajustar deploy + **auditar webhooks ambíguos** | 6h + 3h |
| 16 | `feat/modularizacao/15-shared-cleanup` | Limpar `_shared/` (specifics → `_shared/<bc>/`, manter só `core/`). **Absorve**: `auth.ts` vs `user-auth.ts` | 4h + 2h |
| 17 | `feat/modularizacao/16-docs` | CLAUDE.md raiz + AGENTS.md + llms.txt + vault Obsidian + ESLint flip warn→error | 4h |
| **19** | **`feat/modularizacao/18-event-bus-pilot`** | **Slice piloto event-bus**: `domain_events` + `_shared/events/` + dispatcher + migração `lead.stage_changed` | **8h** |
| 20 | `feat/modularizacao/17-finalize` | Deletar pastas legacy vazias + ADR conclusão + PR `develop → main` | 2h |

**Total estimado**: ~92h (~12 dias úteis 1 dev). Originais 80h + ~12h dedup absorvido.

## Order rationale

- **Tooling (slice 1) + skeleton (slice 2) primeiro**: cada slice de domínio (3-14) tem destino claro e violação detectável.
- **Slices de domínio (3-14) sequenciais**: paralelismo só entre slices sem dep (raro).
- **Edge functions (15) depois do frontend**: alguns deploys dependem de path.
- **Shared cleanup (16) depois de todos domínios**: já consumiram o que precisavam.
- **Docs (17) por último** com ESLint flip warn→error como gate de conclusão.
- **Event-bus piloto (19) depois de docs**: padrão consolidado + 1 bug recorrente fechado.
- **Finalize (20)**: deletar legacy + ADR conclusão.

## Convenção branches (já firmada)

Durante feature ativa, só 3 tipos de branch permitidos:
- `feat/modularizacao/<slice>` — saem de `develop`, PRs pra `develop`
- `hotfix/<...>` — sai de `main`, PR direto pra `main`, sync `main→develop` após merge, rebase slices em andamento
- `chore/<...>` (tests/docs-only) — sai de `develop`, PR pra `develop`

Sem outras branches paralelas. Detalhe: memória `feedback_branch_discipline_during_feature.md`.

## Não-paralelizável

- Slices 3-14 são sequenciais. Conflict storm seria garantido em paralelismo (todos tocam imports massivos).
- Codemod (jscodeshift) por slice. Cada slice = 1 codemod scriptado, reversível.

## Refs

- SPEC: `.specs/features/modularizacao/SPEC.md`
- [[decisoes-pendentes]] — bloqueios atuais
- [[riscos-mitigacoes]] — mitigações por risco
- [[criterios-sucesso]]
