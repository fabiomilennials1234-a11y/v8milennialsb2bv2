---
status: accepted
date: 2026-09-04
---

# 36. `deal_created` nasce na posição do Negócio

O evento `deal_created` passa a nascer quando uma `pipeline_entries` fica ligada
a um Negócio e possui funil e etapa, em vez de nascer no `INSERT deals`. Essa é
a única fonte capaz de congelar a posição de nascimento e declarar o sujeito da
execução sem depender do timing do worker; materializações e backfills são
correções técnicas e não emitem o evento.

Decisão confirmada no grill com o CTO em 2026-09-04. Spec executável:
[#2001](https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2/issues/2001).

## Consequências

- Negócio sem posição completa não dispara `deal_created`.
- Funil e etapa do evento são snapshot; movimentos posteriores não alteram a
  elegibilidade.
- Configs antigas sem filtro continuam aceitando qualquer nascimento
  operacional.
- `pipeline_entry_id` e `deal_id` acompanham toda execução.
- O trigger legado em `deals` é removido para existir uma única fonte.

## Alternativas consideradas

- Consultar posição corrente no worker: rejeitada porque transforma latência em
  regra de negócio.
- Adiar o trigger de `deals` até o fim da transação: rejeitada porque não cobre
  vínculo feito em transação posterior e preserva nascimento sem posição.
- Emitir ao materializar card antigo: rejeitada porque manutenção de dados
  poderia iniciar mensagens e movimentos retroativos.
