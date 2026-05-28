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

**Estado (2026-05-28):** slices 0-16 ✅ merged. Slice 15 (edge functions reorg) descartada como reorg física — substituída por doc-only mapping. Slice 17 (docs + ESLint flip) em PR. Slice 18 (finalize) + slice 19 (event-bus piloto) pendentes.

Detalhe completo + estimativas em `.specs/features/modularizacao/SPEC.md`.

## Ordem

| # | Branch | Escopo | Estimativa | Status |
|---|--------|--------|-----------:|--------|
| 0 ✅ | `feat/modularizacao/planejamento` | SPEC + ADR + auditoria + event-bus plano + vault 10-Remodelagem | 4h | merged |
| 1 ✅ | `feat/modularizacao/00-tooling` | ESLint `boundaries` (warn-only) + `dependency-cruiser` + CI gate | 4h | merged |
| 2 ✅ | `feat/modularizacao/01-skeleton` | `src/modules/<bc>/` vazias + sub-CLAUDE.md descrevendo escopo | 2h | merged |
| 3 ✅ | `feat/modularizacao/02-identity` | auth + team + master + permissions | 5h | merged |
| 4 ✅ | `feat/modularizacao/03-leads` | Consolidar lead/lead-detail/leads + hooks + pages. **Absorveu dedup**: timeline×history×fieldChanges | 6h + 2h | merged |
| 5 ✅ | `feat/modularizacao/04-pipelines` | kanban + pipelines + pipe-* + 16 hooks pipeline (namespace legacy explícito) | 6h + 1h | merged |
| 6 ✅ | `feat/modularizacao/05-communication` | chat + chat-meta + whatsapp-* + hooks | 7h + 1h | merged |
| 7 ✅ | `feat/modularizacao/06-copilot` | copilot + hooks agent | 5h + 1h | merged |
| 8 ✅ | `feat/modularizacao/07-workflows` | automacoes + actions | 6h + 2h | merged |
| 9 ✅ | `feat/modularizacao/08-campaigns` | campanhas + mass-send + templates | 4h | merged |
| 10 ✅ | `feat/modularizacao/09-carteira` | carteira + upsell + proposals + deals | 5h | merged |
| 11 ✅ | `feat/modularizacao/10-engagement` | checklist + activities + agenda + gamification + commissions + goals | 5h | merged |
| 12 ✅ | `feat/modularizacao/11-analytics` | analytics + dashboard + tv + performance | 5h | merged |
| 13 ✅ | `feat/modularizacao/12-billing-marketing` | subscription + landing + lead forms + UTM | 3h | merged |
| 14 ✅ | `feat/modularizacao/13-platform` | onboarding + settings + observability + feature flags | 4h | merged |
| 15 ❌ | ~~`feat/modularizacao/14-edge-functions`~~ → docs-only | **Descartada como reorg física.** Supabase CLI exige flat layout em `supabase/functions/`. Substituído por **mapping doc-only** em `supabase/functions/CLAUDE.md` (96 funções por BC, commit `c9b227ed`). | 0h (doc-only) | ✅ doc |
| 16 ✅ | `feat/modularizacao/15-shared-cleanup` (renamed: cleanup longtail) | Limpar `src/components/`, `src/hooks/`, `src/pages/` root → módulos + `src/shared/`. 45 hooks/components + 1 page absorvidos pelos BCs corretos. | 4h | merged (PR #512) |
| 17 | `feat/modularizacao/17-docs-eslint-flip` ← **atual** | CLAUDE.md raiz + AGENTS.md + llms.txt + vault + sub-CLAUDE.md 8 módulos + ESLint flip warn→error + SPEC adendo slice 15 descartada | 4h | em PR |
| 18 | `feat/modularizacao/18-finalize` | Deletar pastas legacy vazias + ADR conclusão + PR `develop → main` | 2h | pending |
| 19 | `feat/modularizacao/19-event-bus-pilot` | **Slice piloto event-bus**: `domain_events` + `_shared/events/` + dispatcher + migração `lead.stage_changed` | 8h | paralela slice 17 |

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
