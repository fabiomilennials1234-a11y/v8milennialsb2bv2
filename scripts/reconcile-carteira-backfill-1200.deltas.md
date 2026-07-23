# Reconciliação dos 273 pedidos de Carteira contra o livro-razão (#1200)

**Somente leitura.** Nenhuma escrita, em nenhuma tabela. O artefato é este
relatório; script em `scripts/reconcile-carteira-backfill-1200.sql`.

Gerado em 2026-07-22 contra produção (`jsjsmuncfkbsbzqzqhfq`).

Insumo para duas decisões: a #1202 (backfill) e o tratamento das sobreposições,
que é do CTO.

---

## Resumo executivo

| | Hoje | Depois do backfill | Δ |
|---|---:|---:|---:|
| Linhas vivas no livro | 205 | 476 | **+132%** |
| Receita viva | R$ 751.020,71 | R$ 1.587.810,55 | **+R$ 836.789,84** |
| Etiquetadas `carteira` | 0 | 55 | +55 |
| Receita não-atribuída | R$ 58.713,90 | R$ 761.294,49 | **+R$ 702.580,59** |

Três coisas para decidir antes de rodar o backfill, em ordem de dinheiro
envolvido: **o não-atribuído** (R$ 702 mil), **a ordem de inserção** (R$ 230 mil
de rótulo em jogo) e **as sobreposições** (R$ 638,40).

---

## 1. Universo

| Estado | Pedidos | Valor |
|---|---:|---:|
| `approved` | 271 | R$ 836.789,84 |
| `rejected` | 2 | R$ 5.900,00 |
| **Total** | **273** | **R$ 842.689,84** |

Só os aprovados entram. Os 2 rejeitados nunca foram aprovados, então não há
venda para estornar — não geram par venda+estorno, geram nada.

## 2. Efeito da ordem de inserção — de detalhe a requisito provado

Este é o achado mais importante para a #1202.

| Cenário | `carteira` | Valor `carteira` |
|---|---:|---:|
| **1 — cada pedido avaliado contra o livro de HOJE** | **1** | R$ 809,40 |
| **2 — inserção cronológica, em cascata** | **55** | R$ 447.641,37 |

A diferença é inteira do mecanismo: `metric_revenue_stream` pergunta "existe
venda anterior **no livro**?". Avaliados todos contra o livro atual — que não
tem linha de Carteira nenhuma — 270 dos 271 parecem primeira compra. Inseridos
em ordem cronológica, cada um vira venda anterior do seguinte e os rótulos
aparecem em cascata.

**Consequência: o backfill DEVE inserir em ordem cronológica.** Em lote, ou
fora de ordem, o resultado é o cenário 1 — 54 rótulos `carteira` a menos e
R$ 446.831,97 classificados errado.

### 2.1 Por que 55 e não 119

Contando repetições **dentro de `upsell_orders`** dá 119. Pela regra canônica
dá 55. A diferença são os **empates**:

| | Pedidos | Valor |
|---|---:|---:|
| Em grupo com `sold_at` **idêntico** ao de outro pedido do mesmo cliente | **131** | **R$ 230.022,44** |

A #1198 decidiu que empate exato **não conta como anterior** — duas vendas no
mesmo instante não podem ser recompra uma da outra. Então os 131 pedidos
empatados saem todos como primeira compra.

**Isto reconcilia a divergência entre as duas medições.** O relatório do Pauta
deu 119 / R$ 510.069,52; o meu, 119 / R$ 502.004,23. Nenhum estava errado: com
61 grupos empatados, "qual é a primeira" é indefinido, e o valor oscila entre
**R$ 461.278,29 e R$ 559.646,90** conforme o desempate — um intervalo de
R$ 98.368,61. Os dois números caem dentro dele.

**O número certo é 55 / R$ 447.641,37**, porque é o único que aplica a regra já
decidida em vez de um desempate arbitrário. Nenhuma das duas medições anteriores
estava errada; a pergunta é que estava mal-posta.

## 3. Sobreposição com o funil

| Recorte | Pedidos | Valor |
|---|---:|---:|
| Com `pipe_proposta_id` (os 40) | 40 | R$ 99.465,47 |
| Dos 40: lead já tem venda de funil | 37 | R$ 90.205,47 |
| **Dos 40: venda de funil na mesma semana** | **3** | **R$ 826,36** |
| Sem vínculo, mas lead tem venda de funil | 24 | R$ 118.089,50 |
| **Sem vínculo, funil na mesma semana** | **1** | **R$ 12.800,00** |
| Sem sobreposição alguma | 210 | R$ 628.494,87 |

"O lead tem venda de funil" é comum (61 pedidos) e **não** é duplicidade: a
venda de funil é a aquisição original e o pedido é uma compra posterior real —
exatamente o que a Carteira deveria capturar. O risco de contar o mesmo dinheiro
duas vezes só existe quando as duas caem **na mesma janela**.

### 3.1 A LISTA — 4 pedidos, e só 1 é duplicidade provável

| Org | Pedido | Data | Valor do pedido | Valor do funil (7d) | Vínculo | Leitura |
|---|---|---|---:|---:|:--:|---|
| testevideo | `143d766d…` | 2026-07-15 | R$ 12.800,00 | R$ 49.550,00 | não | valores **diferentes** → transações distintas |
| Basic4u | `f6d01a1d…` | 2026-05-04 | R$ 638,40 | R$ 638,40 | **sim** | **valor idêntico → duplicidade provável** |
| Basic4u | `fc2c2fd4…` | 2026-05-04 | R$ 187,95 | R$ 1.572,60 | sim | valores diferentes → distintas |
| Barulinho Bom | `5168fcc3…` | 2026-05-04 | R$ 0,01 | R$ 354,00 | sim | valores diferentes → distintas |

**Igualdade exata de valor é o sinal forte**, não a proximidade de data. Por
esse critério, a duplicidade real do conjunto inteiro é **um pedido, R$ 638,40**
— 0,076% dos R$ 836 mil.

### 3.2 Opções para o CTO, com custo de cada uma

O livro é append-only: não existe "editar a linha do funil".

| Opção | O que faz | Custo |
|---|---|---|
| **A. Não emitir os sobrepostos** | O backfill pula os 4 (ou só o de R$ 638,40) | Perde-se receita real nos 3 casos que **não** são duplicidade: R$ 12.987,96. Simples de executar, some dinheiro verdadeiro. |
| **B. Estornar o evento de funil e emitir o do pedido** | Par `sale_reversed` + `sale` para cada sobreposto | Preserva o total correto e mantém a auditoria. Custo: 8 linhas novas no livro para 4 casos, e o ranking do funil perde R$ 52.115 de crédito já contabilizado — mexe em comissão histórica de quem fechou. |
| **C. Emitir tudo e aceitar a duplicidade** | Backfill sem exceção | Zero trabalho. Superestima a receita em R$ 638,40 (0,076%). |
| **D. Só o caso de valor idêntico** | Opção A restrita a `f6d01a1d…` | Corrige a única duplicidade provável e preserva os R$ 12.987,96 legítimos. |

**Não escolho.** Registro que a diferença entre a melhor e a pior opção é de
R$ 12.987,96 em receita e ~R$ 52 mil em crédito de ranking — o que sugere que
esta decisão merece cinco minutos do CTO, não uma reunião.

## 4. Delta por organização

| Org | Livro antes | Valor antes | Entram | Valor que entra | Valor depois | Crescimento |
|---|---:|---:|---:|---:|---:|---:|
| testevideo | 3 | R$ 78.440,00 | 55 | R$ 498.770,00 | R$ 577.210,00 | **+636%** |
| Basic4u | 51 | R$ 77.971,25 | 166 | R$ 193.411,83 | R$ 271.383,08 | +248% |
| Milennials | 84 | R$ 379.076,00 | 41 | R$ 133.110,00 | R$ 512.186,00 | +35% |
| Improving | 6 | R$ 40.320,00 | 3 | R$ 8.790,00 | R$ 49.110,00 | +22% |
| Drink Express | 2 | R$ 952,00 | 5 | R$ 2.708,00 | R$ 3.660,00 | +284% |
| Barulinho Bom | 10 | R$ 4.501,14 | 1 | R$ 0,01 | R$ 4.501,15 | ~0% |

Seis organizações afetadas. **testevideo multiplica a receita por 7,4** — é uma
org de teste, mas se o piloto começar por ela o número vai assustar quem olhar.

## 5. Impacto no não-atribuído — o maior risco desta entrega

**208 dos 271 pedidos (76,8%) não têm `sale_responsible_id`.**

| Org | Não-atribuído hoje | Entra sem responsável | Depois | % da receita da org |
|---|---:|---:|---:|---:|
| testevideo | R$ 0,00 | R$ 498.770,00 | R$ 498.770,00 | **86%** |
| Basic4u | R$ 0,00 | R$ 181.212,67 | R$ 181.212,67 | **67%** |
| Milennials | R$ 5.540,00 | R$ 14.629,00 | R$ 20.169,00 | 4% |
| Improving | R$ 7.820,00 | R$ 8.790,00 | R$ 16.610,00 | 34% |
| Drink Express | R$ 0,00 | R$ 0,00 | R$ 0,00 | 0% |

testevideo e Basic4u saem de **zero** não-atribuído para **86% e 67%**. O pódio
dessas duas organizações fica majoritariamente vazio no dia seguinte ao
backfill.

Isso é comportamento **correto e decidido** — só a chave canônica, nada de
coalescer com `closer_id` (finding R5). Mas é o tipo de número que, visto sem
aviso, parece defeito. Duas saídas possíveis, ambas fora desta fatia:

1. Preencher `sale_responsible_id` nos pedidos antes do backfill (trabalho de
   dado, não de código).
2. Aceitar e comunicar — o não-atribuído é honesto: essas vendas realmente não
   têm responsável registrado.

## 6. O que este relatório NÃO decide

- Não escolhe tratamento das sobreposições (§3.2) — é do CTO.
- Não roda backfill. A #1202 faz, e agora tem o requisito de ordem cronológica
  provado em número.
- Não altera nada. Zero escrita, reversível por definição.
