# Deltas justificados — reconciliação de comissão (#997)

Projeção (`commissions.source='sale_event_projection'`, #994) × cálculo antigo
on-the-fly (`useCommissionSummary` portado pra SQL fiel). Portão de
reconciliação do SP-3, ADR-0017 §8. É o LIFT de `reconcile-commissions-994.sql`
pro contrato genérico `recon_cells`.

Toda célula divergente que o motor emite (`scripts/reconcile-metrics.sh
scripts/reconcile-commission-997.sql`) precisa cair em uma das causas abaixo —
cada uma ligada a um finding numerado ou a uma decisão do ADR-0017. Célula sem
causa mapeada = `finding_ref` NULL = **portão FALHA**.

O mapa abaixo é espelhado 1:1 na tabela `recon_known_causes` dentro de
`scripts/reconcile-commission-997.sql`. Alterar a política = editar OS DOIS.

## Mapa causa → finding

| suggested_cause (pattern)   | finding_ref   | Por que é esperado e correto |
|-----------------------------|---------------|------------------------------|
| `venda-pre-caderno%`        | ADR-0017 §7   | Comissão de venda cujo evento não existe no caderno (`won` pré-`20270302000030`). O antigo calcula on-the-fly pelo estado; a projeção não tem linha. Janela pré-caderno best-effort declarada. |
| `estorno-so-no-caderno%`    | ADR-0017 §3   | Projeção tem linha NEGATIVA de estorno (par se anula); o cálculo antigo não vê saída de won e segue creditando. Comportamento novo é o correto (comissão de venda estornada não é devida). |
| `taxa-viva-vs-snapshot%`    | ADR-0017 §6   | Amount difere porque o antigo aplica a taxa VIVA do `team_member` (mudou depois da venda) e a projeção usa a taxa SNAPSHOTADA no momento do evento (`rate_percent`). Snapshot é o correto — mudar a taxa não reescreve comissão já ganha (finding #11). |

## Catch-all (fica NULL de propósito)

`verificar: ancora-COALESCE-vs-sold_at | tz-utc-vs-org | valor-editado-pos-venda`
— a heurística não isolou a causa entre:
- **ancora-COALESCE-vs-sold_at** → R4: o antigo ancora em
  `COALESCE(metrics_period_at, closed_at)`; a projeção usa `sold_at` (via o mês
  materializado no evento). Venda pode cair em mês diferente.
- **tz-utc-vs-org** → ADR-0017 §5: o antigo corta o mês em UTC; a projeção no
  timezone da org.
- **valor-editado-pos-venda** → R6: a base mudou na `pipe_propostas` depois da
  venda; a projeção fixou o snapshot.

`finding_ref` fica **NULL** e o portão FALHA até um humano classificar a célula
em uma dessas (e preencher o mapa se for causa nova legítima). É o mecanismo que
impede delta silencioso virar bug novo (ADR-0017 §8).

## Invariante interna (recon_invariants)

- **`projeção: estorno anula a venda original (soma por par = 0)`** — para cada
  linha de estorno projetada, `original.amount + estorno.amount = 0`. Fixa o
  net-by-construction e a idempotência 1:1 evento⇒linha (#994).

## Como rodar

```bash
PROD_DATABASE_URL=... scripts/reconcile-metrics.sh scripts/reconcile-commission-997.sql \
  -v org_id="'6030520a-2ca7-477d-be89-55758e2cd808'" -v since="'2027-01-01'"
# exit 0 = portão passou; exit != 0 = delta inexplicado ou invariante violada.
```
