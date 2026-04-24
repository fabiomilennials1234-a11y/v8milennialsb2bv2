---
date: 2026-04-24
status: accepted
deciders: [CTO, Architect]
supersedes: []
extends: [2026-04-17-receita-mes (changelog D032)]
tags: [metrics, analytics, dashboard, invariant]
---

# ADR 2026-04-24 — Receita do mês é invariante do projeto (não só da RPC)

## Contexto

Em 17/04 corrigimos `get_dashboard_metrics` removendo `sale_value × contract_duration` do cálculo de `vendaTotal`. Documentamos a regra canônica em `06 — Features/Analytics/Dashboard.md` e registramos a lição `L002` em STATE.md.

Em 24/04, o TV Dashboard foi reportado com o mesmo bug: `vendido R$ 75.3K` (inflado pelo LTV). Investigação mostrou que o bug tinha 3 superfícies de propagação fora da RPC, todas calculando "receita do mês" client-side e todas violando a regra:

| Superfície | Arquivo | Linhas | Impacto |
|------------|---------|--------|---------|
| TV Dashboard "vendido" (termômetro) | `src/hooks/useTVDashboardData.ts` | 137, 149 | Card principal da TV — visível para o time o dia todo |
| TV Dashboard — lista "vendas do mês" | `src/hooks/useTVDashboardData.ts` | 246 | Lista lateral do TV |
| TV Dashboard — metas individuais por closer | `src/hooks/useTVDashboardData.ts` | 270 | Percentuais de meta dos closers |
| Funil de propostas — header "sold" | `src/hooks/usePipeMetrics.ts` | 72, 84 | KPI no topo do Pipe Propostas |
| Funil de propostas — página | `src/pages/PipePropostas.tsx` | 443, 455 | Mesmo cálculo duplicado no componente |

Ou seja, a regra canônica estava **documentada mas não enforçada** — e o bug re-emergiu em 4 lugares diferentes, alguns pré-existentes ao fix de abril, outros adicionados depois.

Histórico da regressão (contexto de L002):
- `20260708000004` — adicionou `× duration` intencionalmente (confundiu LTV com receita do mês).
- `20260829400000` — removeu.
- `20260911000000` — regrediu ao reescrever a RPC para fix de `taxaConversao`.
- `20260417100000` — fix "definitivo" para a RPC (marcado como pendente de aplicar em dev).
- `2026-04-24` — descoberto que o fix NUNCA atingiu as 3 superfícies client-side.

## Decisão

**A regra deixa de ser "regra da RPC" e passa a ser invariante do projeto:**

> **Receita do mês / "vendido" / "sold" = Σ `sale_value` das vendas fechadas no período, sem multiplicação por `contract_duration`.**
>
> Isto vale para **toda** superfície de cálculo: RPCs, edge functions, hooks React, componentes, agregações ad-hoc. Não importa se o cálculo é server-side ou client-side, a métrica tem uma única definição.

**Campo separado obrigatório para LTV.** Se uma tela precisa exibir "valor total contratado" (LTV-like), esse valor tem nome próprio (`valorTotalContratado` ou `ltv`) e é calculado em separado. **Proibido** reutilizar `vendaTotal` / `vendasRealizadas` / `sold` / `vendido` com semântica de LTV.

**Decisões aplicadas agora** (ratificadas pelo CTO em 2026-04-24):
1. `PipePropostas` / `usePipeMetrics` → `sold` vira Σ `sale_value` puro. Não existe necessidade de LTV nessa tela hoje. Se aparecer, vira campo separado.
2. TV Dashboard → mantém o label `"vendido"` (semântica agora correta).

## Mecanismo de enforcement (prevenção de regressão)

Documentação sozinha já falhou 3 vezes. Enforcement vai por 2 camadas, na ordem da menor fricção:

### Camada 1 — Contract test AST-grep (barato, em CI)

Segue o padrão de `tests/unit/whatsapp-messages-idempotency-contract.test.ts` (D035). Arquivo novo:

**`tests/unit/receita-mes-invariant.test.ts`**
- Asserção: **nenhum** arquivo em `src/**/*.{ts,tsx}` e `supabase/functions/**/*.ts` contém o padrão `/sale_value\s*\*\s*[^;,)]*(duration|contract_duration)/i` **exceto** quando a expressão está sendo atribuída a uma variável cujo nome contém `valorTotalContratado` ou `ltv` (case-insensitive).
- Roda a cada `npm run test:unit`.
- Falha = PR barrado em CI.

### Camada 2 — Fixture canônica compartilhada (unit tests por hook)

Criar `tests/unit/fixtures/receita-mes-fixture.ts` exportando fixture imutável:
```ts
export const RECEITA_MES_FIXTURE = {
  deals: [
    { product_type: "mrr", sale_value: 1000, contract_duration: 12, closed_at: THIS_MONTH_DATE, status: "vendido" },
    { product_type: "projeto", sale_value: 5000, contract_duration: 1, closed_at: THIS_MONTH_DATE, status: "vendido" },
  ],
  expected: { vendaTotal: 6000, vendaMRR: 1000, vendaProjeto: 5000, vendido_count: 2 },
};
```

Cada hook que agrega "receita do mês" (hoje: `useTVDashboardData`, `usePipeMetrics`) ganha um teste que consome essa fixture e valida os 4 campos. Se alguém reintroduzir `× duration`, o teste explode com diff claro (17000 ≠ 6000).

**Não escolhido**: ESLint rule customizada. Overkill pra 1 dev junior + CTO e já temos o contract test que cobre 99% dos casos em <50 linhas.

**Bônus (não bloqueante)**: comentário header em `useTVDashboardData.ts`, `usePipeMetrics.ts`, `PipePropostas.tsx` linkando pra este ADR, explicando por quê `× duration` está PROIBIDO.

## Consequências

**Positivas**:
- Métrica "vendido" vira conceito único do projeto — todos os consumidores concordam.
- Regressão futura barrada por CI (não por vigilância humana).
- Custos explícitos de LTV ficam nomeados, não escondidos em reuso de campo.

**Negativas / riscos**:
- Se no futuro precisarmos de LTV numa tela que hoje usa `sold`, vamos pagar o custo de nomear o campo novo — aceito (era o padrão de qualidade que o CTO sempre vai preferir).
- Contract test AST-grep gera falso positivo se alguém escrever `valorTotalContratado = sale_value * duration` em linha separada. Mitigação: o regex checa a variável alvo; se alguém tentar driblar, o teste do fixture compartilhado pega (saúde em profundidade).

## Arquivos que mudam (spec enxuta para os próximos agentes)

### DBA
- [ ] Verificar em dev (`bcfadphgsibjzivtbjvc`) se a RPC `get_dashboard_metrics` reflete `20260417100000_fix_receita_mes_mrr_contract_duration.sql` ou ainda está com a versão de `20260911000000`. SQL: `SELECT prosrc FROM pg_proc WHERE proname = 'get_dashboard_metrics';`
- [ ] Se ainda tem `× v_duration` em `v_venda_total` / `v_venda_base_ativa` / `v_venda_primeiro_pedido`: criar migration nova com timestamp atual `20260424xxxxxx_enforce_receita_mes_canonica.sql` (não reaplicar migration antiga). Conteúdo = mesma recriação de `get_dashboard_metrics` sem as 3 ocorrências de `× v_duration`.
- [ ] Rodar `tests/sql/validate_receita_mes_mrr.sql` em dev para evidência objetiva.
- [ ] **Proibido tocar prod** (`jsjsmuncfkbsbzqzqhfq`).

### Frontend
- [ ] Branch: `fix/tv-dashboard-receita-mes` (a partir de `main`, não de `fix/workflow-audio-node`).
- [ ] `src/hooks/useTVDashboardData.ts`:
  - Linhas 137, 149 → remover `* duration` no bloco MRR de `vendasRealizadas`. Passa a ser `vendasRealizadas += val`.
  - Linha 246 → `const totalVal = baseVal` (sem ternário com `* duration`). Simplificar.
  - Linha 270 → `sum + (p.sale_value || 0)` (sem `* duration`) no accumulator de metas individuais.
  - Linhas 121-122 → substituir comentário enganoso por comentário novo citando ADR 2026-04-24.
  - Remover a variável local `duration` e a leitura de `contract_duration` dentro do hook (uso não existe mais).
- [ ] `src/hooks/usePipeMetrics.ts`:
  - Linhas 72, 84 → `sold += val` (sem `* duration`).
  - Atualizar comentário de cabeçalho da função: `sold` = Σ sale_value (ver ADR 2026-04-24).
- [ ] `src/pages/PipePropostas.tsx`:
  - Linhas 443, 455 → mesma correção em `sold`.
- [ ] Comentário header curto nos 3 arquivos acima citando ADR `04 — Decisões/2026-04-24-receita-mes-canonica-projeto.md` (3 linhas, nada mais).

### QA
- [ ] Criar `tests/unit/fixtures/receita-mes-fixture.ts` com a fixture canônica descrita na Camada 2.
- [ ] Criar `tests/unit/receita-mes-invariant.test.ts` implementando a Camada 1 (contract test AST-grep).
- [ ] Auditar `tests/unit/hooks-sprint2-tv-dashboard.test.ts` — se tiver asserção com `* duration`, estava validando o bug. Reescrever usando a fixture canônica.
- [ ] Adicionar/ajustar teste em `usePipeMetrics` consumindo a mesma fixture.
- [ ] Rodar `npm run test:unit` — resultado tem que vir verde com o novo invariante.
- [ ] Rodar `tests/sql/validate_receita_mes_mrr.sql` em dev após DBA aplicar migration (se aplicar).

### Infra
- [ ] Se DBA criar migration nova: `supabase db push --project-ref bcfadphgsibjzivtbjvc` (dev only).
- [ ] Abrir TV Dashboard de uma org real em dev, comparar números com query manual. Screenshot antes/depois para o changelog.
- [ ] **Não fazer deploy em prod.** PR fica aberto aguardando aprovação do CTO.

### Conductor (pós-execução)
- [ ] Atualizar `.specs/project/STATE.md` com D036 + L004 (já especificados abaixo).
- [ ] Atualizar `06 — Features/Analytics/Dashboard.md` acrescentando seção "TV Dashboard" e apontando pra este ADR.
- [ ] Criar `07 — Changelog/2026-04-24-fix-tv-dashboard-receita-mes.md` + entrada no daily `07 — Changelog/2026-04-24.md`.

## Links

- Precursor: `07 — Changelog/2026-04-17-receita-mes.md` (D032 / L002)
- Regra operacional: `06 — Features/Analytics/Dashboard.md` § "Semântica de receita"
- Script de validação SQL: `tests/sql/validate_receita_mes_mrr.sql`
- Contract tests padrão: `tests/unit/whatsapp-messages-idempotency-contract.test.ts` (D035 — template do AST-grep)
