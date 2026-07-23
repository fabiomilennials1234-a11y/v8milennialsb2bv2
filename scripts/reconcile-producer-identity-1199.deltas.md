# Reconciliação antes/depois — identidade de produtor (#1199)

Critério de aceite: **"nenhuma linha de receita muda de valor nesta fatia,
provado por reconciliação antes/depois"**. Este arquivo traz o número dos dois
lados, não a afirmação.

Gerado em 2026-07-22.

---

## O experimento

A fatia é DDL puro. Para provar isso empiricamente, e não por argumento:

1. Reverter o banco local ao estado pré-#1199 (`supabase/migrations/rollback/20260722234500_…`)
2. Semear 23 linhas determinísticas: 20 vendas + 3 estornos, valores `g × 1000,55`,
   um terço etiquetado `carteira`
3. Tirar a **impressão digital** do livro
4. Aplicar a migration
5. Tirar a impressão digital de novo

A impressão digital não é só um somatório — é o `md5` de
`(id | sale_value | revenue_stream | sold_at)` de **todas** as linhas, ordenado
por id. Somatórios iguais podem esconder duas linhas que trocaram valor entre
si; o hash por linha não.

## Resultado

| | Linhas | Vendas | Estornos | Bruto | Líquido | Carteira | Impressão digital |
|---|---:|---:|---:|---:|---:|---:|---|
| **Antes** | 23 | 20 | 3 | 216.118,80 | 204.112,20 | 63.034,65 | `12858c59d69459ba96aca4724c07849e` |
| **Depois** | 23 | 20 | 3 | 216.118,80 | 204.112,20 | 63.034,65 | `12858c59d69459ba96aca4724c07849e` |
| **Δ** | 0 | 0 | 0 | **0,00** | **0,00** | **0,00** | **idêntica** |

Hash idêntico ⇒ nenhuma linha mudou de valor, de etiqueta ou de data.

## O retroativo aconteceu, e sem UPDATE

| Verificação | Resultado |
|---|---|
| Linhas retroagidas a `producer='funnel'` | **23 de 23** |
| Linhas com `producer` nulo | **0** |
| Linhas com `origin_record_id` nulo (funil legado) | 23 |

O retroativo veio do `DEFAULT` da coluna, não de `UPDATE` — que
`trg_sale_events_immutable` bloqueia sem escape. Desde o PG11 o `ADD COLUMN …
DEFAULT` grava no catálogo e materializa na leitura, sem rewrite e sem disparar
trigger de linha. É por isso que o hash não mudou: nenhuma linha foi reescrita.

## Reversibilidade

O rollback rodou limpo (exit 0) **antes** deste experimento — ele é o passo 1.
Ou seja, a reversibilidade não é afirmada, é o que tornou o teste possível.

`supabase/migrations/rollback/20260722234500_sale_events_producer_identity.sql`
falha de propósito se já houver linha sem funil no livro: reverter o schema com
linhas de Carteira dentro deixaria o banco inconsistente em silêncio.

## Baseline de produção, para quando a migration for aplicada lá

Medido em prod nesta data. A mesma impressão digital deve valer depois do apply:

| | |
|---|---|
| `sale` | 214 |
| `sale_reversed` | 9 |
| Bruto | R$ 1.016.510,71 |
| Líquido | R$ 751.020,71 |
| Vendas vivas | 205 |

A migration **não foi aplicada em produção** — a fatia é escura e aditiva, e
ligar produtor novo é da #1201.

## Auditoria dos quatro leitores canônicos para linha sem funil

Exigida pela issue: "cada um dos quatro leitores canônicos é auditado para o
caso nulo — auditoria explícita, não presumida". Auditado no corpo real das
funções em produção, não por inspeção do repo.

| Leitor | Usa `sale_events.pipeline_id`? | Comportamento com `pipeline_id IS NULL` | Veredito |
|---|---|---|---|
| `get_sales_metrics` | sim — `(p_pipeline_id IS NULL OR se.pipeline_id = p_pipeline_id)` | **Sem** filtro: a condição é verdadeira e a linha **entra** no total da org. **Com** filtro: `NULL = <uuid>` é NULL, a linha **sai**. | ✅ correto nos dois modos |
| `get_ranking` | sim — mesmo predicado | idem | ✅ correto |
| `get_commission_ledger` | **não referencia** funil nem etapa | indiferente | ✅ imune |
| `get_funnel_flow` | lê `pipeline_stage_events`, não `sale_events`; e **exige** `p_pipeline_id` (levanta `22023` se nulo) | linha de Carteira nunca o alcança | ✅ imune |

**Os quatro estão corretos — mas estavam corretos por consequência da lógica de
três valores, não por decisão defendida por teste.** Um refactor que trocasse
`(p IS NULL OR col = p)` por um `col = coalesce(p, col)` mudaria o
comportamento sem que nada acusasse. Por isso o pgTAP desta fatia fixa os dois
modos de `get_sales_metrics` e a imunidade dos outros três: o que hoje é
acidente feliz passa a ser contrato.

Semanticamente é o comportamento desejado: receita de Carteira **conta** no
total da organização e **não aparece** quando se filtra por um funil — porque
ela não pertence a funil nenhum.

## Nota sobre a projeção de comissão

A issue avisa que escapar da normalização de data via `source='backfill'`
desligaria a projeção de comissão. Confirmado no repo:

```sql
CREATE TRIGGER trg_sale_events_project_commission … WHEN (NEW.source = 'trigger')
```

Por isso a isenção é **por produtor**, e Carteira mantém `source='trigger'`.

**Estado real medido em produção**, que vale registrar: o trigger
`trg_sale_events_project_commission` e a função de projeção **não existem** em
prod — só a coluna `commissions.source` chegou lá, e `commissions` tem **0
linhas**. Hoje, em produção, nenhum dos dois caminhos ligaria ou desligaria
comissão, porque não há projeção ligada. A isenção foi feita do jeito certo
mesmo assim: quando a projeção for religada, Carteira cai do lado certo sem que
ninguém precise lembrar deste detalhe.

Esta fatia **não liga projeção de comissão**. O CTO decidiu que Carteira gera
comissão, mas não desde quando nem para quem; a #1201 entrega com projeção
desligada, que é o estado seguro.
