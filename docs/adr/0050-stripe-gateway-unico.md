# 50. Stripe como gateway único da assinatura do Torque

Date: 2026-11-04

## Status

Proposed. A prova local e em modo teste terminou; migration, deploy, secrets e virada em produção são do CTO. Substitui o Asaas para a primeira assinatura de organização existente; `_shared/payments/*`, `asaas-webhook` e as telas antigas continuam no repositório até a remoção, que é outra entrega.

## Context

Nada do billing do Torque chegou a cobrar: `payment_links` e `payment_link_charges` têm 0 linhas em produção. A troca de gateway não migra dado nenhum. O que existia e valia aproveitar é o motor de preço (`billing_quote_price`), o link de proposta e a provisão.

Achados que moldaram o desenho, medidos no código e em PGlite:

- `billing_apply_paid_subscription` não grava features nem limits: quem pagasse seria rebaixado para o default vazio.
- `billing_provision_existing_org` somava validade a cada execução.
- O worker aplicava `LIMIT` antes do anti-join e deixava pagante de fora.
- `/checkout/:token` era gerada pelo Master e não existia como rota.

## Decision

1. **Elements + Subscriptions API**, com `payment_behavior=default_incomplete`. O preço sai do nosso motor e o estado é nosso; Checkout Sessions tiraria os dois de nós.
2. **Só `existing_org` e só cartão.** O Master gera o link, a autorização é o conhecimento do token. `new_org` responde `target_not_supported` e o Composer não oferece.
3. **Ordem da tela: comprador + autorização → POST → cartão.** A autorização de cobrança recorrente é registrada, com versão, antes de a assinatura existir (`payment_link_buyers`, metadado `torque_consent_version`). A versão da tela (`checkout-copy.ts`) e a do servidor (`flow.ts`) são amarradas por teste; versão divergente responde `consent_required` e a tela pede recarga.
4. **Trava de valor no navegador.** `amount_cents` e `billing_cycle` do POST têm de bater com os do link, e `livemode` com a chave `pk_`. Divergiu, o Elements não monta.
5. **Sem tabela de mapeamento de preço**: `lookup_key = torque_{plano}_{plan|seat}_{ciclo}`, com desconto embutido em `unit_amount`. Cartão não é guardado por nós.
6. **Tema escuro travado na rota.** O iframe da Stripe recebe cor fixa; dois temas exigiriam remontar o Element. Os hex da Appearance API são derivados dos tokens e um teste quebra se divergirem.
7. **Stripe.js só no chunk lazy da rota**, por `@stripe/stripe-js/pure`: a importação comum injeta o script no carregamento do módulo. Fora de `/checkout` o navegador não fala com a Stripe.
8. **CSP nos três lugares** (`index.html`, `Dockerfile`, `cloudflare/headers.json`), só com os hosts necessários. `payment=()` continua: wallets desligadas no Element.

9. **Service Worker fora do caminho da Stripe.** `fetch` no SW obedece ao `connect-src` do `/sw.js`, então interceptar script de outro host é bloqueá-lo. O SW só intercepta ativos da própria origem, de `*.supabase.co` e de `fonts.googleapis.com` (`shared/pwa/asset-routing.ts`); os demais hosts já falhavam sob o SW. Abrir a CSP foi descartado porque o Stripe.js iria para o cache. A rota não registra SW novo. Cliente com SW antigo: `lib/checkout-sw.ts` pergunta ao controller e, sem resposta, ativa a versão publicada, sem recarregar e sem desregistrar, o que derrubaria push.
10. **Replay não grava em `/checkout` nem em `/reset-password`.** O token está na URL e o snapshot a repete em `href`, `rr_src` e `referrer`; `beforeAddRecordingEvent` não alcança isso (medido: o meta com o token chegou ao envelope mesmo com o filtro devolvendo null). A gravação não começa nessas rotas e para ao entrar nelas navegando. O erro continua indo ao Sentry, sem vídeo.
11. **Só se afirma recusa com recusa explícita.** Queda de conexão pode esconder um pagamento feito, e quem decide é o PaymentIntent.
12. **Comprador mudou com assinatura incompleta viva: anula a fatura, cancela e cria `attempt+1`.** A fatura guarda o retrato de nome, e-mail e documento de quando nasceu. A ordem é a trava contra cobrança dupla: a Stripe só anula fatura não paga, de forma atômica; anulada, ela não aceita pagamento em nenhuma aba, e só então a assinatura é cancelada. Perdeu a corrida para um pagamento, responde `already_paid` sem tocar em comprador nem Customer.

## Consequences

- Trocar o texto da autorização exige trocar a versão nos dois lados, e quem já aceitou aceita de novo.
- `src/integrations/supabase/types.ts` só regenera depois do apply; até lá o código usa tipos locais.
- Webhook pela rede real exige deploy: a prova local entrega os eventos reais de `GET /v1/events` assinados ao handler.
- Desconto 10/15 do catálogo versus D5 15/20, preço negociado na renovação e ativação em produção seguem como decisão comercial pendente.

## Aceito como está

- A volta do redirect compara só o valor do PaymentIntent com o do link: só decide a tela, exige o `client_secret` e nunca move dinheiro.
- POST simultâneo com documentos diferentes pode responder 500 em um e `ready` no outro: o próximo POST converge, sem cobrança.
- `torque_buyer_hash` não tem sal: o nome, o e-mail e o documento estão em claro no mesmo objeto da Stripe.

## Alternatives rejected

- **Reaproveitar `PaymentProvider`**: a abstração foi moldada no Asaas; o seam de teste são funções puras com dependência injetada.
- **Stripe Coupon para o desconto de ciclo**: duas fontes de preço.
- **Marcar a autorização na etapa do cartão**: a assinatura nasceria antes do aceite.
- **Pré-preencher o comprador**: não há leitura de volta por decisão de segurança; o comprador sempre digita.
