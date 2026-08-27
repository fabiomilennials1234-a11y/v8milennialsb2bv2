# Toth × Torque — folha de conferência

**Para quem:** alguém da Café Jurerê com acesso à tela do Toth.
**Por quê:** o próprio fornecedor pediu — *"esses ws que já existem, sempre bom
orientar o cliente a conferir, porque pode ter particularidades neles que podem
atrapalhar, vamos ajustando"* (18/08). Os endpoints não foram feitos para esta
integração; nunca comparamos nossos números com os deles.

**Como usar:** para cada linha, abrir a tela correspondente no Toth e escrever o
número que aparece lá. Divergência **não** significa integração quebrada — é
insumo. O que interessa é *quanto* diverge e *para que lado*.

Medido no Torque em **27/08/2026**, organização Café Jurerê.

---

## 1. Cadastro de clientes

| O que | Torque | Toth | Bate? |
|---|---:|---:|:--:|
| Clientes na carteira (todas as empresas do grupo) | **12.639** | | |
| Atendidos pela empresa **CAFE JURERE** | **11.210** | | |
| Com representante/vendedor definido | **11.210** | | |
| Representantes distintos | **215** | | |

⚠️ A carteira do Torque tem as quatro empresas do grupo juntas porque a carga
inicial foi feita sem o filtro — hoje só CAFE JURERE é sincronizada, e as demais
(CAMIPLACE, ALIMENTA MAIS, COSTA ESMERALDA) ficaram paradas do jeito que
entraram. Não são erro, são resíduo da primeira carga.

## 2. Recorte de cliente ativo (novo, 27/08)

O ERP passou a filtrar de verdade: `marcas=1,2,3,4,5,6` + `diasCompras=365`.

| O que | Torque | Toth | Bate? |
|---|---:|---:|:--:|
| Clientes ativos sincronizados (últimos 365 dias) | **1.467** | | |
| Compraram e faturaram nos últimos 60 dias | **320** | | |
| Compraram e faturaram nos últimos 365 dias | **939** | | |

**Pergunta que só vocês respondem:** 365 dias é o certo para "cliente ativo" de
café? Com 60 dias, o recorte cai para 320 clientes.

## 3. Último pedido faturado por cliente

`dataEmissaoUltimoPedidoFaturado`, campo que o fornecedor entregou em 24/08.
**4.141** clientes da CAFE JURERE têm data; os demais nunca faturaram nada.

| Ano do último pedido faturado | Clientes |
|---|---:|
| 2026 | 778 |
| 2025 | 508 |
| 2024 | 479 |
| 2023 | 608 |
| 2022 | 601 |
| 2021 | 634 |
| 2020 | 533 |

**Conferir:** a data mais antiga é **30/01/2020**. Existe cliente com pedido
faturado ANTES de 2020 no Toth? Se existir, o campo tem um corte que não
conhecemos.

## 4. Financeiro — títulos a receber

| O que | Torque | Toth | Bate? |
|---|---:|---:|:--:|
| Títulos em aberto (quantidade) | **252** | | |
| Valor em aberto | **R$ 832.918,99** | | |
| Títulos atrasados (quantidade) | **50** | | |
| Valor atrasado | **R$ 132.406,69** | | |

⚠️ Três cuidados ao comparar:

1. **`valorDocumento` é o SALDO**, não o valor de face. O Torque soma o que falta
   receber, não o valor original do título. Se a tela do Toth mostrar valor de
   face, o número dela será maior — e isso não é divergência.
2. **A janela de consulta é de ±45 dias** por padrão. Título que vence daqui a
   três meses e não teve alteração ainda não entrou. Se o Toth mostrar um total
   bem maior, é provavelmente isto.
3. **Não existe campo de situação** no retorno. "Pago" e "atrasado" são derivados
   por nós: saldo ≤ 0 → pago; senão, vencido → atrasado.

## 5. Conferência caso a caso (o que mais vale)

Escolher **três clientes** e comparar a ficha inteira, lado a lado:

- **um com título quitado** — o Torque deve mostrá-lo sem valor em aberto;
- **um com pagamento parcial** — é onde a semântica de saldo foi corrigida em
  18/08, e o caso que mais errou antes;
- **um que comprou nas últimas semanas** — conferir se a data do último pedido
  faturado bate com o último pedido faturado na tela deles.

## 6. O que ainda não dá para conferir

- **Pedidos de venda.** O endpoint `/pedidos` foi construído e ainda responde 404
  — o fornecedor aguarda a GON Informática liberar um redirecionamento. Enquanto
  isso, o Torque não tem o histórico de compras, só a data do último faturado.
- **Prazo médio de recebimento.** Depende de `dataUltimoPagamento` em
  `/cobrancas`, ofertado pelo fornecedor em 18/08 e ainda não entregue.

---

## Perguntas abertas para o fornecedor

1. **Vocabulário completo de `statuspedido`.** Conhecemos `NORMAL` (emitido, não
   faturado) e `FATURADO`. Falta saber como aparecem cancelado, bloqueado e
   orçamento — é isso que decide o que o CRM conta como receita.
2. **`/pedidos` aceita filtro por data?** Sem ele, cada sincronização relê o
   histórico inteiro.
3. **Quando `/pedidos` fica no ar?** O código do nosso lado está pronto e
   deployado, atrás de uma trava — o dia em que o caminho responder, é ligar.
4. **`dataUltimoPagamento` em `/cobrancas`** — ofertada em 18/08, sem prazo.
5. **`situacaoParceiro`** devolve 0, 1, 2 e 3 sem legenda. O que significam?
