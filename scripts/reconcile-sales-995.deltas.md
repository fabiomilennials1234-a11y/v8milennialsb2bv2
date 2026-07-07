# Deltas justificados — reconciliação de vendas (#995)

`get_sales_metrics` (novo, caderno `sale_events`) × `get_dashboard_metrics`
(antigo, estado mutável). Portão de reconciliação do SP-3, ADR-0017 §8.

Este arquivo é o registro COMMITADO das divergências sancionadas. Toda célula
divergente que o motor emite (`scripts/reconcile-metrics.sh scripts/reconcile-sales-995.sql`)
precisa cair em uma das causas abaixo — cada uma ligada a um finding numerado
da auditoria (`RELATORIO-AUDITORIA-METRICAS-2026-07-02.md`) ou a uma decisão do
ADR-0017. Célula sem causa mapeada = `finding_ref` NULL = **portão FALHA**.

O mapa abaixo é espelhado 1:1 na tabela `recon_known_causes` dentro de
`scripts/reconcile-sales-995.sql`. Alterar a política de reconciliação =
editar OS DOIS juntos (mapa + este doc), nunca a lógica de comparação do motor.

## Mapa causa → finding

| suggested_cause (pattern)   | finding_ref   | Por que é esperado e correto |
|-----------------------------|---------------|------------------------------|
| `venda-pre-caderno%`        | ADR-0017 §7   | Venda cujo `won` foi alcançado antes do caderno `sale_events` existir (apply de `20270302000030`). O motor novo não tem evento; o antigo ainda conta pelo estado. Janela pré-caderno é best-effort declarada. `since` no gate deve ser >= data do apply para minimizar. |
| `estorno-so-no-caderno%`    | ADR-0017 §3   | Lead saiu de `won` (estorno registrado no caderno). O motor novo anula a venda (par sale+sale_reversed); o antigo não enxerga saída de won e segue contando. O comportamento NOVO é o correto. |
| `atribuicao-5-chaves%`      | R5            | Org-total do mês bate, mas o valor por-membro diverge: o motor antigo credita a MESMA venda a cada membro distinto entre 5 chaves (`sale_responsible_id`/`closer_id`/`responsible_id`/`pre_sale_responsible_id`/`sdr_id`), então Σ(membro) > total. O novo credita só `sale_responsible_id` (Σ = total). |
| `ancora-COALESCE%`          | R4            | Venda cai em mês diferente porque o antigo ancora em `COALESCE(metrics_period_at, closed_at, updated_at)` (qualquer touch move a venda) e o novo ancora em `sold_at` (momento do registro, imutável). |
| `valor-mutavel%`            | R6            | Valor difere porque o antigo lê `pipe_propostas.sale_value`/itens (estado mutável, editável após a venda) e o novo lê o snapshot gravado no evento. |
| `tz-utc-vs-org%`            | ADR-0017 §5   | Venda perto da meia-noite cai em mês diferente: antigo corta em UTC, novo corta no timezone da org. |

## Catch-all (fica NULL de propósito)

`verificar: ancora-COALESCE-vs-sold_at | valor-mutavel-pos-venda | tz-utc-vs-org | estorno`
— a heurística não conseguiu isolar a causa. `finding_ref` fica **NULL** e o
portão FALHA até um humano classificar a célula em uma das causas acima (e, se
for uma causa nova legítima, adicioná-la ao mapa + a esta tabela). É o
mecanismo que impede delta silencioso virar bug novo escondido (ADR-0017 §8).

## Como rodar

```bash
PROD_DATABASE_URL=... scripts/reconcile-metrics.sh scripts/reconcile-sales-995.sql \
  -v org_id="'6030520a-2ca7-477d-be89-55758e2cd808'" -v since="'2027-01-01'"
# exit 0 = portão passou; exit != 0 = delta inexplicado ou invariante violada.
```
