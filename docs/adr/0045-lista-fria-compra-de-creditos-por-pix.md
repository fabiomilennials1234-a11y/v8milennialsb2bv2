# 45. Lista Fria: compra de créditos por PIX, com liberação do saldo pelo time

Date: 2026-10-29

## Status

Accepted (CTO, 2026-10-29). Estende o ADR-0044 (preço e dois saldos). Não há migration: a entrega é de front.

## Context

O ADR-0044 fixou o preço de lista (crédito Google R$ 0,15, crédito Meta R$ 1,00), mas o produto não tem como o cliente comprar: o master concede os créditos à mão (`lista_fria_creditos_conceder`). O CTO pediu o fluxo de compra:

- um botão **"+"** ao lado dos créditos, oferecendo **seis pacotes**: Google, Google + e Google Max (100, 500 e 1.000 créditos) e os três equivalentes da Meta;
- o "+" é o **mais comprado**; o "+" tem **5%** de desconto e o "Max", **10%**, sobre o crédito de lista;
- ao escolher um pacote, **chave PIX com QR Code** apontando para uma conta específica;
- uma opção **"Outro"** que abre um **chamado novo** com o texto pronto "Quero adquirir créditos".

## Decision

1. **Pacotes e preços** (centavos, inteiros), `lib/pacotes.ts`:

   | Pacote | Créditos | Desconto | Preço |
   |---|---|---|---|
   | Google | 100 | 0 | R$ 15,00 |
   | Google + | 500 | 5% | R$ 71,25 |
   | Google Max | 1.000 | 10% | R$ 135,00 |
   | Meta | 100 | 0 | R$ 100,00 |
   | Meta + | 500 | 5% | R$ 475,00 |
   | Meta Max | 1.000 | 10% | R$ 900,00 |

   "Google" é o nome comercial do crédito padrão (serve para Maps e CNPJ); "Meta" é o do Instagram.
2. **PIX estático gerado no navegador** (BR Code, padrão EMV do Banco Central, `lib/pix.ts`), com o valor do pacote e uma **referência** de 25 letras e números. Sem serviço de terceiro e sem segredo: a chave PIX existe para ser divulgada. O QR usa a biblioteca que o projeto já tem (`qrcode.react`).
3. **A conta que recebe é uma constante** (`RECEBEDOR_PIX`: chave, nome e cidade). Enquanto for `null`, a tela **não mostra QR nenhum** e leva o cliente ao chamado, em vez de mostrar um código que mande o dinheiro para o lugar errado.
4. **O pagamento NÃO é confirmado pelo sistema.** O QR estático não avisa ninguém. O cliente clica em **"Já paguei"**, que abre um chamado com pacote, créditos, valor e referência (e pede o comprovante em anexo); o time confere o PIX na conta e **libera o saldo à mão** (`lista_fria_creditos_conceder`, com `p_tipo`).
5. **"Outro" e "Já paguei" abrem o chamado como `solicitacao`** (não como defeito), com impacto "não é urgente". Para isso o rascunho do painel de suporte (`SupportPrefill`) ganhou `tipo` e `impacto` opcionais. Sem eles nada muda: o rascunho de um erro continua abrindo como `bug`.
6. **O "+" só aparece para quem pode editar a Lista fria**, e o chamado só abre onde o painel de suporte existe (o perfil gestor não o tem). Nesse caso "Outro" e "Já paguei" ficam desligados, mas o PIX continua visível.
7. O texto do chamado de "Outro" é "Quero adquirir créditos", com a grafia corrigida do pedido original ("adiquirir").

## Consequences

- **Reconciliação manual.** Cada compra depende de uma pessoa do time ver o PIX cair e conceder o saldo. Não escala e há atraso entre pagar e receber. O próximo passo natural é um PIX dinâmico com confirmação por webhook (PSP) e a concessão automática; isso exige conta em PSP e uma tabela de pedidos, e não é deste ADR.
- **O valor mostrado no front não é uma fonte de verdade.** Quem altera o código no navegador pode gerar um QR de outro valor. Como quem libera o saldo é o time, olhando o extrato, isso não dá crédito de graça: o que importa é o valor que entrou.
- **"Mais comprado" é um posicionamento**, não um dado: ainda não há nenhuma venda para medir.
- **Sem nota fiscal nem recibo automático.** Fica por fora do sistema.
- **Fica pendente** o preenchimento de `RECEBEDOR_PIX` com a conta real (chave, nome do recebedor e cidade).
