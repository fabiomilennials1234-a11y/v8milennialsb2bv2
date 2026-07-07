# Deltas justificados — reconciliação de ranking (#997)

`get_ranking` (novo, caderno `sale_events`) × `get_ranking_data` (antigo,
`salesRanking` de estado mutável). Portão de reconciliação do SP-3, ADR-0017 §8.

Este arquivo é o registro COMMITADO das divergências sancionadas. Toda célula
divergente que o motor emite (`scripts/reconcile-metrics.sh scripts/reconcile-ranking-997.sql`)
precisa cair em uma das causas abaixo — cada uma ligada a um finding numerado
da auditoria (`RELATORIO-AUDITORIA-METRICAS-2026-07-02.md`) ou a uma decisão do
ADR-0017. Célula sem causa mapeada = `finding_ref` NULL = **portão FALHA**.

O mapa abaixo é espelhado 1:1 na tabela `recon_known_causes` dentro de
`scripts/reconcile-ranking-997.sql`. Alterar a política = editar OS DOIS juntos.

## Mapa causa → finding

| suggested_cause (pattern)   | finding_ref   | Por que é esperado e correto |
|-----------------------------|---------------|------------------------------|
| `venda-pre-caderno%`        | ADR-0017 §7   | Venda cujo `won` foi alcançado antes do caderno `sale_events` existir. Motor novo sem evento; antigo ainda conta pelo estado. Janela pré-caderno é best-effort declarada. `since` >= data do apply de `20270302000030`. |
| `estorno-so-no-caderno%`    | ADR-0017 §3   | Lead saiu de `won` (estorno no caderno). O novo anula a venda (par sale+sale_reversed); o antigo não vê a saída de won e segue contando no pódio. Comportamento novo é o correto. |
| `atribuicao-COALESCE%`      | R5 / linha #3 | Org-total bate mas o valor por-membro diverge: o pódio antigo credita `COALESCE(sale_responsible_id, responsible_id, closer_id)` — a venda vai pro 1º não-nulo, não pro Closer canônico. O novo credita só `sale_responsible_id` ⇒ Σ(membro)=total e "venda no pódio ⟺ comissão". É o coração do finding #3. |
| `metric_type-bucket%`       | linha #8      | Vendedor com `metric_type ≠ 'sales'` (ou mal-configurado) SOME do pódio antigo (o motor filtra `metric_type IN ('sales', NULL)`); o novo não bucketiza por metric_type — rankeia todo mundo com venda no caderno. |
| `ancora-COALESCE%`          | R4            | Venda cai em mês diferente: antigo ancora em `COALESCE(metrics_period_at, closed_at, updated_at)` (qualquer touch move a venda); novo ancora em `sold_at` (registro imutável). |
| `valor-mutavel%`            | R6            | Valor difere: antigo lê `pipe_propostas.sale_value` (estado mutável, editável após a venda); novo lê o snapshot gravado no evento. |
| `tz-utc-vs-org%`            | ADR-0017 §5   | Venda perto da meia-noite cai em mês diferente: antigo corta em UTC, novo no timezone da org. |

## Invariantes internas (recon_invariants)

- **`novo: Σ(membro,mês) = total(mês) por org`** — pódio == dashboard: os grãos
  org×membro e org×mês saem do MESMO conjunto líquido do caderno. Falha =
  regressão de construção. É o guardião que #1002 sobe pro CI.
- **`cross-RPC: get_ranking.revenue_total == get_sales_metrics.revenue_total`** —
  as duas RPCs canônicas do SP-3 concordam no total do período (o que R5
  quebrava: somar o ranking ≠ card de topo). Amostrado no mês corrente por org.

## Catch-all (fica NULL de propósito)

`verificar: ancora-COALESCE-vs-sold_at | valor-mutavel-pos-venda | tz-utc-vs-org | estorno`
— a heurística não isolou a causa. `finding_ref` fica **NULL** e o portão FALHA
até um humano classificar a célula (e, se for causa nova legítima, adicioná-la
ao mapa + a esta tabela). Impede delta silencioso virar bug novo (ADR-0017 §8).

## Como rodar

```bash
PROD_DATABASE_URL=... scripts/reconcile-metrics.sh scripts/reconcile-ranking-997.sql \
  -v org_id="'6030520a-2ca7-477d-be89-55758e2cd808'" -v since="'2027-01-01'"
# exit 0 = portão passou; exit != 0 = delta inexplicado ou invariante violada.
```
