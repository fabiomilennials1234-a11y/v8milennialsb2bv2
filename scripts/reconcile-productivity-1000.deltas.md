# Deltas justificados — reconciliação de produtividade (#1000)

Dimensão `vendido` do placar por vendedor: NOVO (`get_productivity_activity_by_seller`,
caderno `sale_events`) × ANTIGO (bloco `vendido` legado de `20270201000000`, estado
mutável). Portão de reconciliação do SP-3, ADR-0017 §8.

Este arquivo é o registro COMMITADO das divergências sancionadas. Toda célula
divergente que o motor emite (`scripts/reconcile-metrics.sh scripts/reconcile-productivity-1000.sql`)
precisa cair em uma das causas abaixo — cada uma ligada a um finding numerado da
auditoria (`RELATORIO-AUDITORIA-METRICAS-2026-07-02.md`) ou a uma decisão do
ADR-0017. Célula sem causa mapeada = `finding_ref` NULL = **portão FALHA**.

O mapa abaixo é espelhado 1:1 na tabela `recon_known_causes` dentro de
`scripts/reconcile-productivity-1000.sql`. Alterar a política de reconciliação =
editar OS DOIS juntos (mapa + este doc), nunca a lógica de comparação do motor.

## Mapa causa → finding

| suggested_cause (pattern)   | finding_ref   | Por que é esperado e correto |
|-----------------------------|---------------|------------------------------|
| `custom-pipeline%`          | R3            | Venda em funil NÃO-`system` (custom pipeline). O legado filtra `pipelines.type='system' AND slug='propostas'` e é cego a esses funis; o novo lê `sale_events`, que não tem predicado de tipo de funil. Novo > antigo é o R3 sendo corrigido. |
| `atribuicao-multi-chave%`   | R5            | Org-total do mês bate, mas o `vendido` por-vendedor diverge: o legado atribui por `COALESCE(sale_responsible_id, closer_id, metadata->>closer_id)` (chave instável), o novo usa só `sale_responsible_id` (snapshot no evento). |
| `venda-pre-caderno%`        | ADR-0017 §7   | Venda cujo `won` foi alcançado antes do caderno `sale_events` existir (apply de `20270302000030`). O novo não tem `sale_event`; o antigo ainda conta pelo estado. Janela pré-caderno é best-effort declarada. `since` no gate deve ser >= data do apply. |
| `estorno-so-no-caderno%`    | ADR-0017 §3   | Lead saiu de `won` (estorno no caderno). O novo anula a venda (anti-join sale+sale_reversed); o antigo, sem visão de estorno, segue contando. O comportamento NOVO é o correto. |
| `ancora-COALESCE%`          | R4            | Venda cai em mês diferente porque o antigo ancora em `COALESCE(min(lead_history), closed_at, stage_changed_at)` (âncora instável) e o novo ancora em `sold_at` (registro imutável). |
| `tz-utc-vs-org%`            | ADR-0017 §5   | Venda perto da meia-noite cai em mês diferente: antigo corta nos bounds UTC que o app calcula (`getMonthRangeUTC`), novo ancora no `sold_at` absoluto cortado no timezone da org. |

## Invariante interna (motor NOVO)

`Σ(vendido por vendedor, mês) <= total(mês)` por org — vendas sem `sale_responsible_id`
(não-atribuídas) entram no total mas em nenhum bucket de vendedor, então a soma dos
membros nunca ULTRAPASSA o total. `Σ > total` seria dupla contagem — exatamente o
R5 que esta fatia mata. Violação derruba o portão.

## Catch-all (fica NULL de propósito)

`verificar: ancora-COALESCE-vs-sold_at | tz-utc-vs-org | estorno-so-no-caderno`
— a heurística não conseguiu isolar a causa. `finding_ref` fica **NULL** e o portão
FALHA até um humano classificar a célula em uma das causas acima (e, se for uma causa
nova legítima, adicioná-la ao mapa + a esta tabela). É o mecanismo que impede delta
silencioso virar bug novo escondido (ADR-0017 §8).

## Como rodar

```bash
PROD_DATABASE_URL=... scripts/reconcile-metrics.sh scripts/reconcile-productivity-1000.sql \
  -v org_id="'6030520a-2ca7-477d-be89-55758e2cd808'" -v since="'2027-01-01'"
# exit 0 = portão passou; exit != 0 = delta inexplicado ou invariante violada.
```
