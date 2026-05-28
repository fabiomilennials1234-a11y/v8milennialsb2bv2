---
status: ativo
owner: arquiteto
tipo: roadmap-execucao
criado: 2026-05-28
contexto: pós-Fase-5 (deploy prod) — refactor arquitetural informado por skill improve-codebase-architecture
relacionados:
  - "[[mapa-as-is-to-be-real]]"
  - "[[reducao-deep-imports]]"
  - "[[roadmap-pos-modularizacao/_INDEX]]"
---

# Roadmap Arch Deepening — pipelines + identity + ciclo leads-pipelines

3 fases sequenciais que endereçam os candidatos #1, #2 e #3 do relatório `improve-codebase-architecture` (main vs develop). Roda em `develop`, independente das fases 5-6 do roadmap pós-modularização (deploy prod).

## Contexto

Análise via skill identificou 3 candidatos com ROI mais alto pra deepening pós-modularização:

| # | Candidato | Problema medido | Fase |
|---|-----------|-----------------|-----:|
| 1 | `pipelines` re-deepen | 0.85 files-per-export (INVERTIDO — interface > implementação) | [[fase-8-pipelines-re-deepen]] |
| 2 | `identity` split em sub-BCs | 1.50 ratio + hotfix #530 (barrel dessincronizado de internals) | [[fase-9-identity-split]] |
| 3 | Quebrar ciclo `leads ↔ pipelines` | 47 imports bidirecionais (38+9) | [[fase-7-quebrar-ciclo-leads-pipelines]] |

## Por que esta ordem

**Fase 7 antes da 8** — quebrar ciclo `leads ↔ pipelines` reduz superfície compartilhada. Sem fazer isso, qualquer split de `pipelines` propaga deep imports pra `leads` (e vice-versa).

**Fase 8 antes da 9** — `pipelines` é o caso mais agudo (ratio invertido 0.85). Fase 7 + 8 combinadas atacam o pior offender medido. `identity` (1.50) é problema sério mas menos agudo, e impacta auth crítica — entra depois do dev exercitar pattern em fases menos sensíveis.

**Fase 9 por último** — `identity` é área frágil 🟠 (CLAUDE.md raiz) com permissões + auth. Split exige cuidado extra. Pattern já validado nas fases 7+8 reduz risco aqui.

## Estimativas

| Fase | Estimate (sessões) | PRs | Habilita |
|---|---:|---:|---|
| 7 — quebrar ciclo leads-pipelines | 6-10h | 2-3 | Fase 8 |
| 8 — pipelines re-deepen | 8-14h | 3-4 | Fase 9 + redução baseline |
| 9 — identity split | 10-16h | 3-5 | onboarding agentes mais limpo |
| **Total** | **24-40h** | **8-12** | baseline ratchet ↓ |

## Critérios de sucesso globais

| Métrica | Hoje (develop) | Após roadmap | Como medir |
|---|---:|---:|---|
| `pipelines` files-per-export | 0.85 | ≥ 3.0 | `find / wc + grep ^export` |
| `identity` files-per-export | 1.50 | ≥ 3.0 | idem |
| Ciclo `leads ↔ pipelines` (deep imports) | 47 | 0 | grep cross-module |
| `dependency-cruiser` baseline | 86 | ≤ 70 | `lint:deps:baseline` |
| Ciclos `no-circular` | 63 | ≤ 50 | idem |
| Test coverage em `pipelines` e `identity` | preservar | preservar | npm run test:coverage |

## Constraints invariantes (todas as fases)

1. Zero push em `main`. Zero merge em `main`.
2. Zero mutação em prod DB ou dev DB (refactor é puro TS).
3. Zero deploy edge function.
4. Branch sai de `develop` sincronizada. PR target = `develop`.
5. Sem `--no-verify`.
6. ESLint + dep-cruise sempre passam (ratchet bloqueia regressão).
7. Test suites não regridem vs baseline (27 files / 42 tests red toleráveis se pré-existentes).
8. Comportamento preservado — zero mudança de schema DB, zero pixel modificado, zero rota deletada/movida sem redirect.

## Roda em paralelo com fases 5-6 do roadmap pós-mod?

**Não.** Recomendado sequencial:
1. Concluir Fase 5 (deploy prod) — modularização entra em produção
2. Concluir Fase 6 (PR develop → main)
3. Estabilizar prod por ~1 semana
4. **Então** iniciar este roadmap arquitetural em `develop` novo

Razão: refactor arquitetural em paralelo com deploy prod aumenta surface area de risco. Esperar prod estabilizar dá baseline de comportamento pra comparar pós-refactor.

## Refs

- [[mapa-as-is-to-be-real]] — contexto state atual
- [[reducao-deep-imports]] — processo redução ratchet
- [[roadmap-pos-modularizacao/_INDEX]] — roadmap deploy prod (fases 5-6 dependência)
- Relatório análise comparativa main vs develop (chat session, não persistido)
