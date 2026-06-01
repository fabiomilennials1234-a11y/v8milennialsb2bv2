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

> [!info] Replan Fase 7 — 2026-05-29
> Fase 7 (ciclo leads↔pipelines) **replanejada**: abordagem barrel ABORTADA (baseline 86→120), event-bus não resolve forward-edges síncronos. Único caminho = inversão `PipeOpsPort`. Ver banner em [[fase-7-quebrar-ciclo-leads-pipelines]]. **Fase 8** provavelmente absorvida (re-deepen pipelines em sub-pastas faz parte da inversão) — confirmar com CTO antes de iniciar.
>
> **Update 2026-05-29 — Fase 7 CONCLUÍDA.** Inversão entregue em 7.3-bis (deep edges → 0) e os 3 barrel-edges residuais zerados em 7.4-bis. Ciclo `leads ↔ pipelines` = **0** em todas as formas (deep + barrel). Fase 8 absorvida. Próximo: Fase 9 (identity split).
>
> **Update 2026-05-29 — Slice 9.1b (precursora da Fase 9) CONCLUÍDA.** Quebrado o ciclo `shared → module` `realtime → identity` via contexto React owned por `shared/realtime` e alimentado por `identity` no root do app (`RealtimeOrgBridge` em `App.tsx`), mesmo espírito do `PipeOpsPort`. **Baseline dep-cruise 83 → 56** (`no-circular` 60 → 33; `no-orphans` 23 inalterado). 27 `no-circular` removidos — todos os ciclos que atravessavam `useRealtimeSubscription` (anchor `identity/index.ts` ↔ `useTeamMembers`/`useOrgRolePermissions` → `useRealtimeSubscription` → barrel). `useIdentity`/`ProtectedRoute`/`useUserRole` agora em **zero** ciclos. Destrava 9.2–9.5 (mover arquivos identity não re-chaveia mais edges cíclicos cross-boundary). Os alvos de baseline downstream da Fase 9 (premissados em 83) recalibram para a nova base 56. Ver [[fase-9-identity-split]] § Slice 9.1b.

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

> Coluna **Real (7.3-bis)** = medido em 2026-05-29 após inversão `PipeOpsPort` + re-deepen de `pipelines` (Fase 8 absorvida). Ver [[fase-7-quebrar-ciclo-leads-pipelines]] § "Slice 7.3-bis — executado".

| Métrica | Hoje (develop) | Após roadmap | Real (7.3-bis) | Como medir |
|---|---:|---:|---:|---|
| `pipelines` files-per-export | 0.85 | ≥ 3.0 | **3.58** ✅ | `find / wc + grep ^export` |
| `identity` files-per-export | 1.50 | ≥ 3.0 | **7.9** ✅ (Fase 9 CONCLUÍDA — 9.2/9.3/9.4a/9.4/9.4b/9.5; 71 files / **9 exports**; 4 sub-conceitos auth/permissions/master/org-team + barrel enxuto de 28 símbolos públicos; 9.5 purgou 44→9) | idem |
| Ciclo `leads ↔ pipelines` (deep + barrel) | 47 | 0 | **0** ✅ (deep zerado em 7.3-bis; 3 barrel-edges zerados em 7.4-bis) | grep cross-module |
| `dependency-cruiser` baseline | 86 | ≤ 70 | **55** ✅ (9.1b: 83 → 56; 9.2/9.3 neutro; 9.4a: 56 → 55) | `lint:deps:baseline` |
| Ciclos `no-circular` | 63 | ≤ 50 | **32** ✅ (9.1b: 60 → 33; 9.4a: 33 → 32, ciclo useOrganization↔useTeamMembers morto) | idem |
| Test coverage em `pipelines` e `identity` | preservar | preservar | preservado (zero regressão) | npm run test:coverage |

## Constraints invariantes (todas as fases)

1. Zero push em `main`. Zero merge em `main`.
2. Zero mutação em prod DB ou dev DB (refactor é puro TS).
3. Zero deploy edge function.
4. Branch sai de `develop` sincronizada. PR target = `develop`.
5. Sem `--no-verify`.
6. ESLint + dep-cruise sempre passam (ratchet bloqueia regressão).
7. Test suites não regridem vs baseline (27 files / 42 tests red toleráveis se pré-existentes).
8. Comportamento preservado — zero mudança de schema DB, zero pixel modificado, zero rota deletada/movida sem redirect.

## Ordem revisada — 2026-05-28 ~20:00 UTC (decisão CTO)

**Plano original (revertido):** Fase 5 → Fase 6 → estabilizar 7d → Fases 7/8/9.

**Plano atual:** Fases 7/8/9 em `develop` **antes** de Fase 5 (deploy prod) e Fase 6 (develop → main).

```
Hoje → Fase 7 → Fase 8 → Fase 9 → Fase 5 → Fase 6 → estabilização
```

### Razão da inversão

- Main vai receber tudo num único deploy: modularização + 4 fases pós-mod + event-bus + arch refactor
- Cliente vê produto mais limpo direto; menos débito visível pós-cutover
- Baseline ratchet menor antes do deploy = bug surface menor em prod
- Não precisa estabilizar prod sobre estrutura conhecidamente shallow (ratio 0.85, 1.50)

### Trade-offs aceitos

| Trade-off | Aceito porque |
|---|---|
| Deploy maior surface área | Fase 5 com monitoria 60min ativa (decisão pós skip da monitoria 24h dev) |
| Main fica mais defasada por ~2-4 semanas | Hotfix continua possível via branch de main (`feedback_hotfix_during_feature`) |
| Pattern arch não validado em prod antes | Pattern de modularização (slices 0-19) já foi validado em prod por orgs reais. Arch refactor preserva mesmo pattern |
| ~40h trabalho antes do deploy | CTO prioriza quality sobre time-to-prod |

### Hotfix durante esse período

Pattern de [[feedback_hotfix_during_feature]] se mantém:
- Hotfix sai de `main` (não develop)
- PR direto pra main
- Sync main → develop após merge
- Rebase de slices em andamento

## Refs

- [[mapa-as-is-to-be-real]] — contexto state atual
- [[reducao-deep-imports]] — processo redução ratchet
- [[roadmap-pos-modularizacao/_INDEX]] — roadmap deploy prod (fases 5-6 dependência)
- Relatório análise comparativa main vs develop (chat session, não persistido)

## Inventários por slice

- [[inventario-leads-pipelines]] — Slice 7.1 (Fase 7)
- [[inventario-identity]] — Slice 9.1 (Fase 9, decisão Alt B)
