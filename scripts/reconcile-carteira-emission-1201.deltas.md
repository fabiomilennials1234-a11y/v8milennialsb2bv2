# Carteira emite para o livro-razão (#1201) — provas e simulação

Fatia atrás de flag. **A flag nasce desligada em toda org.** Nada foi ligado.

Gerado em 2026-07-22.

---

## 1. Flag desligada = idêntico byte a byte

Critério mais importante da fatia. Método igual ao da #1199: impressão digital
`md5` de `(id | sale_value | revenue_stream | sold_at)` de **todas** as linhas
do livro, ordenado por id — não somatório, que esconderia duas linhas trocando
valor entre si.

Experimento: 10 pedidos semeados, flag **off**, aprovados os 10 e rejeitados 3.

| | Linhas | Vendas | Estornos | Bruto | Impressão digital |
|---|---:|---:|---:|---:|---|
| **Antes** | 33 | 30 | 3 | 258.871,95 | `f78a9e788b4c5a806905936db2127873` |
| **Depois** | 33 | 30 | 3 | 258.871,95 | `f78a9e788b4c5a806905936db2127873` |
| **Δ** | 0 | 0 | 0 | **0,00** | **idêntica** |

Treze transições de estado de aprovação, zero linhas no livro, hash inalterado.

## 2. pgTAP — 21 asserções

| Bloco | Prova |
|---|---|
| (a) | flag existe e **nasce false**; os 3 gatilhos no lugar |
| (b) | **flag off**: aprovar não emite nada |
| (c) | flag on: emite 1 venda, com a data do **pedido** (não a da aprovação), sem funil, `source='trigger'` |
| (d) | aprovar de novo **não duplica** — a chave da #1199 pega |
| (e) | 1ª compra `novo_negocio`; recompra `carteira` |
| (f) | rejeitar estorna, o estorno referencia a venda **daquele** pedido, rejeitar de novo não duplica |
| (g) | comissão sobre linha de Carteira é **bloqueada**, com contraprova de que linha de funil **não** é |
| (h) | org fora do piloto não emite, mesmo com a vizinha ligada |
| (i) | pedido sem responsável cai em não-atribuído |

O bloco (g) tem contraprova de propósito: um guard que bloqueasse *tudo*
passaria no teste de bloqueio e reprovaria em produção silenciosamente.

## 3. Simulação do piloto — o que aconteceria se a flag fosse ligada

Read-only sobre produção. **Nada foi ligado.**

### 3.1 Ligar a flag hoje emitiria ZERO linhas

O gatilho dispara em **transição** para aprovado. Os 271 pedidos já aprovados
não retroagem — pedido aprovado ontem não transiciona de novo. Ligar a flag
hoje muda o livro em **nada** até que um pedido novo seja aprovado.

Isso corrige a expectativa de que "depois da #1201 o livro quase dobra": o
livro dobra depois do **backfill**, que é outra fatia. Esta entrega o runtime.

### 3.2 Se o backfill rodasse, por org

| Organização | Pedidos aprovados | Valor | Seriam `carteira` | Sem responsável |
|---|---:|---:|---:|---:|
| testevideo | 55 | R$ 498.770,00 | 0 | 55 |
| Basic4u | 166 | R$ 193.411,83 | 1 | 144 |
| Milennials | 41 | R$ 133.110,00 | 0 | 6 |
| Improving | 3 | R$ 8.790,00 | 0 | 3 |
| Drink Express | 5 | R$ 2.708,00 | 0 | 0 |
| Barulinho Bom | 1 | R$ 0,01 | 0 | 0 |
| **Total** | **271** | **R$ 836.789,84** | **1** | **208** |

### 3.3 O achado que a próxima fatia precisa saber: 119 ≠ 1

| Medida | Valor |
|---|---:|
| Recompras contadas **dentro de `upsell_orders`** | **119** (R$ 502.004,23) |
| Rotuladas `carteira` avaliando contra o **livro atual** | **1** (R$ 809,40) |

Não é contradição — são perguntas diferentes. `metric_revenue_stream` pergunta
"existe venda anterior **no livro-razão**?", e hoje o livro não tem nenhuma
linha de Carteira. Avaliados todos contra o livro *como está agora*, 270 dos 271
parecem primeira compra.

**Consequência para o backfill: o rótulo depende da ORDEM DE INSERÇÃO.** Se os
271 forem inseridos em ordem cronológica, cada um vira venda anterior do
seguinte e os ~119 rótulos `carteira` aparecem em cascata, corretamente. Se
forem inseridos em lote, ou fora de ordem, o resultado é outro — e errado.

Não é problema desta fatia: no runtime os pedidos chegam um a um, em ordem
natural, e cada aprovação enxerga o livro já contendo as anteriores. Mas a fatia
de backfill precisa tratar ordem cronológica como requisito, não detalhe.

### 3.4 Atribuição: 77% cairia em não-atribuído

**208 dos 271** pedidos não têm `sale_responsible_id`. `testevideo` não tem
nenhum em 55 pedidos — quase meio milhão de reais sem responsável.

É o comportamento correto e decidido (só a chave canônica; nada de coalescer
com `closer_id`, que é o finding R5). Mas significa que, ligado o piloto, o
balde de não-atribuído do ranking cresce muito. Vale o CTO saber antes, não
depois.

## 4. Decisões de contrato honradas

- **Comissão desligada para Carteira** — bloqueio declarado por trigger em
  `commissions`, provado por teste. Registrado de novo: o gatilho de projeção
  **não existe em produção** e `commissions` tem 0 linhas, então não há projeção
  viva para bloquear. O guard existe para quando religarem.
- **Estorno usa `sale_reversed`**, o valor que já existe no enum. Sem sinônimo.
- **Gatilho, não job** — emissão atômica com a aprovação.
- **Sem backfill** — os 40 pedidos com `pipe_proposta_id` são histórico
  congelado (o vínculo morreu na consolidação de pipelines), e tratá-los é
  regra de backfill sobre conjunto fechado.

## 5. Reversibilidade

Desligar a flag para a emissão parar. As linhas já emitidas são identificáveis e
removíveis por `producer = 'carteira'` — a identidade da #1199 é o que torna
isso possível sem adivinhação.
