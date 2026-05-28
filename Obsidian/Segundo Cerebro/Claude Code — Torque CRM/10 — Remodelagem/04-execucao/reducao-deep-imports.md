---
status: ativo
owner: arquiteto
fase: 2
criado: 2026-05-28
---

# Redução incremental de deep-imports

Doc operacional do **ratchet** introduzido em [`fase-2-enforcement-real`](roadmap-pos-modularizacao/fase-2-enforcement-real.md). Cobre como reduzir o baseline sem big-bang refactor.

## Estado inicial (Fase 2 — 2026-05-28)

Baseline em `.dependency-cruiser-baseline.json` contém **86 violations**:

- `no-circular`: **63** — ciclos cross-arquivo, mesmo dentro do mesmo módulo.
- `no-orphans`: **23** — arquivos sem importador.

### Top edges (ciclos `no-circular`)

Agrupado por `<from-module> -> <to-module>` (primeiros 3 segmentos do path):

| # | Edge | Ciclos |
|---|------|-------:|
| 1 | `src/modules/identity → src/modules/identity` | 26 |
| 2 | `src/modules/communication → src/modules/communication` | 17 |
| 3 | `src/modules/leads → src/modules/leads` | 8 |
| 4 | `src/modules/leads → src/modules/communication` | 6 |
| 5 | `src/modules/identity → src/shared/realtime` | 2 |
| 6 | `src/modules/leads → src/modules/engagement` | 2 |
| 7 | `src/modules/engagement → src/modules/engagement` | 1 |
| 8 | `src/modules/leads → src/modules/pipelines` | 1 |

Maioria absoluta é **ciclo intra-módulo** (identity, communication, leads). Indica oportunidade de extrair tipos compartilhados pra `lib/` ou `types.ts` dentro do próprio BC. Os 9 ciclos cross-module (leads↔communication, leads→engagement, leads→pipelines, identity→shared/realtime) são os mais perigosos — quebram boundaries.

Observação: o roadmap menciona **973 deep-imports cross-module** detectados pela análise pós-modularização (PR #517). Esses **não aparecem aqui** porque a regra atual de dep-cruise (`module-internals-private`) usa backref `\1` no `to.path` que não é avaliado como cross-pattern pela engine — ela só pega ciclos. Tornar deep-imports detectáveis pelo dep-cruise é trabalho de fase futura (Fase 4 ou sprint dedicada): reescrever a regra com `from`+`to` pair específico por módulo, ou substituir por regra ESLint `no-restricted-imports` por BC.

## Como reduzir

Em qualquer PR feature, se você tocar um ciclo:

1. Identifique o ponto de quebra mais barato. Ciclos normalmente quebram extraindo um tipo/interface compartilhado pra `<bc>/lib/types.ts` ou movendo função pura pra `<bc>/lib/`.
2. Para deep-imports cross-module: promova o símbolo importado para a API pública (`@/modules/<bc>/index.ts`). Ajuste o import no consumer: `from "@/modules/<bc>"`.
3. Rode `npm run lint:deps:baseline` — confirme que a violation sumiu (total cai de N para N-1).
4. Documente no body do PR: `dep-cruise ratchet: 86 → 85 (removido <descrição>)`.

## Como o gate funciona

`npm run lint:deps:check` (rodado no CI step `Dep-cruise ratchet`):

- Roda `depcruise src` no estado atual.
- Carrega `.dependency-cruiser-baseline.json`.
- Calcula chave `<rule>|<from>|<to>` pra cada violation.
- **Falha** apenas se aparecer violation cuja chave **não está no baseline**.
- Violations no baseline são toleradas indefinidamente (até alguém regenerar).

Isso significa:
- **PR novo NÃO pode introduzir ciclo / orphan novo.** Build quebra.
- **PR novo PODE reduzir baseline.** Regenerar arquivo + body do PR explica.
- **NUNCA regenerar baseline pra "esconder" violation nova.** Code review pega — mudança no baseline.json sem explicação justa = block.

## Sprints de redução dirigida (futuro)

Priorizar por blast radius:

- **Sprint A — ciclos cross-module (9 ciclos)**: leads↔communication (6), leads→engagement (2), leads→pipelines (1), identity→shared/realtime (2). São os que quebram boundary entre BCs.
- **Sprint B — ciclos identity (26)**: intra-BC mas volumoso, sinal de coesão problemática.
- **Sprint C — ciclos communication (17)**: intra-BC chat module.
- **Sprint D — ciclos leads (8) + engagement (1)**: cleanup final intra-BC.
- **Sprint E — orphans (23)**: caso-a-caso, mover/deletar.

**Meta:** baseline = 0 em 5 sprints. Após zerar, deletar `.dependency-cruiser-baseline.json` + `lint:deps:check` e voltar `lint:deps` direto no CI como gate.

## Comandos

```bash
npm run lint:deps           # Lista violations atuais (legível)
npm run lint:deps:check     # Ratchet: falha se houve violation nova
npm run lint:deps:baseline  # Regenera snapshot (só quando reduzir)
```

## Riscos

- **Time regenera baseline sem corrigir imports.** Mitigação: PR review obriga justificativa.
- **Baseline esconde dívida indefinidamente.** Mitigação: sprint plan acima + visibility no doc.
- **Schema do dep-cruiser muda.** Script lê `summary.violations` + `rule.name`, `from`, `to` — campos estáveis há várias majors. Aceitar débito.
