# Deltas justificados — reconciliação de funil (#996)

`get_funnel_flow` (novo, caderno `pipeline_stage_events`) × `get_funnel_health`
(antigo, coorte por `created_at` + estado mutável). Portão de reconciliação do
SP-3, ADR-0017 §8.

Este arquivo é o registro COMMITADO das divergências sancionadas. Toda célula
divergente que o motor emite (`scripts/reconcile-metrics.sh scripts/reconcile-funnel-996.sql`)
precisa cair em uma das causas abaixo — cada uma ligada a um finding numerado
da auditoria (`RELATORIO-AUDITORIA-METRICAS-2026-07-02.md`) ou a uma decisão do
ADR-0017. Célula sem causa mapeada = `finding_ref` NULL = **portão FALHA**.

O mapa abaixo é espelhado 1:1 na tabela `recon_known_causes` dentro de
`scripts/reconcile-funnel-996.sql`. Alterar a política de reconciliação =
editar OS DOIS juntos (mapa + este doc), nunca a lógica de comparação do motor.

## Grão e escopo

Grão da célula: **org × pipeline × role × mês**, `role ∈ {open, meeting_booked,
meeting_held, won}`. O balde terminal `lost` é capacidade NOVA (o motor antigo
não modela perda no funil) e, como o split de Revenue Stream no par de vendas,
**não é reconciliável** — não vira célula.

O motor antigo `get_funnel_health` é ORG-WIDE (não parametriza pipeline) e só
enxerga venda pelo pipeline SYSTEM `propostas`. A réplica atribui toda a
contagem legada a esse pipeline; qualquer outro pipeline tem `old = 0`.

## Mapa causa → finding

| suggested_cause (pattern)    | finding_ref  | Por que é esperado e correto |
|------------------------------|--------------|------------------------------|
| `funil-pre-caderno%`         | ADR-0017 §7  | Célula de mês anterior ao corte contratual do caderno (2026-12-01). O backfill de transições é best-effort declarado; o funil pré-corte "parece mais raso". `since`/`caderno_since` no gate delimitam a janela. |
| `cohort-vs-ever-reached%`    | #14          | Pipeline SYSTEM `propostas`: o motor antigo coorta por `leads.created_at` e conta "ever-reached" sem corte temporal, lendo `meeting_events` ORG-WIDE; o novo coorta pela ENTRADA do lead NO funil, no tz da org. A coorte mudou de definição — por isso o funil não reconcilia célula-a-célula (finding #1), e cada divergência do funil de propostas é essa mudança de coorte/temporalidade (#14). O comportamento NOVO é o correto. |
| `custom-pipe-now-visible%`   | R3           | Pipeline que o legado NÃO enxerga (qualquer funil fora do `propostas` system — todo custom, e whatsapp/confirmacao): o antigo conta 0 por causa do predicado `type='system'`; o novo devolve números REAIS. Custom pipeline vira cidadão de primeira classe. |
| `monotonia-corrigida%`       | #6           | O bug "Reunião→Proposta sempre 100%" (LLM/`LAG ... ELSE 100.0` copy-paste) do funil legado. No novo, a conversão de degrau é NULL-safe (prev=0 → NULL, nunca 100) e o funil é monotônico por construção. Não vira célula de CONTAGEM — é garantido pelas INVARIANTES `monotônico` e `rate ∈ [0,100]` do motor (abaixo). Pattern mantido no mapa para classificação manual caso uma célula de taxa seja adicionada no futuro. |

## Invariantes internas (derrubam o portão se `ok=false`)

- **novo: funil monotônico** — `open >= meeting_booked >= meeting_held >= won`
  por org×pipeline×mês. Verdadeiro por construção (reached(role) = contagem de
  `max_rank >= rank(role)`, rank crescente), mesmo com pulo de etapa. É o
  guardião que mata a classe do #6 (um degrau nunca fica maior que o anterior).
- **novo: rate ∈ [0,100]** — `reached(role) <= reached(open)` (numerador nunca
  excede a coorte), logo toda `conversion_from_top ∈ [0,100]`.

## Catch-all (fica NULL de propósito)

`verificar: divergencia nao classificada (monotonia? tz? governanca de role?)`
— a heurística não conseguiu isolar a causa. `finding_ref` fica **NULL** e o
portão FALHA até um humano classificar a célula em uma das causas acima (e, se
for uma causa nova legítima, adicioná-la ao mapa + a esta tabela). É o mecanismo
que impede delta silencioso virar bug novo escondido (ADR-0017 §8).

## Limitação declarada (governança de role em custom)

`custom_pipeline_stages` ainda não tem `stage_role` (ADR-0017 §1; ponto único de
extensão = `metric_stage_role`). Logo, num pipeline custom, todo `to_stage_key`
resolve role NULL ≙ `open`: a coorte e o degrau `open` são REAIS (mata R3), mas
`meeting_booked`/`meeting_held`/`won` ficam 0 até a governança chegar lá. Isso é
esperado, não um delta inexplicado — some sob `custom-pipe-now-visible` (R3).

## Como rodar

```bash
PROD_DATABASE_URL=... scripts/reconcile-metrics.sh scripts/reconcile-funnel-996.sql \
  -v org_id="'6030520a-2ca7-477d-be89-55758e2cd808'" -v since="'2027-01-01'"
# exit 0 = portão passou; exit != 0 = delta inexplicado ou invariante violada.
```
