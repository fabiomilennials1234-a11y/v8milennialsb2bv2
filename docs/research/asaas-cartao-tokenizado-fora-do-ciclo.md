# Asaas cobra cartão tokenizado fora do ciclo da assinatura?

Research do ticket [#1581](https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2/issues/1581), parte do mapa [#1579](https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2/issues/1579) — Créditos de IA.

**Data:** 2026-08-12 · **Método:** só fonte primária (`docs.asaas.com`, incluindo os OpenAPI embutidos nas páginas de referência, e a página pública de preços do Asaas). Onde a documentação oficial não responde, está escrito **"sem fonte primária"** — nenhum buraco foi preenchido com plausibilidade.

**Precedente que rege a desconfiança:** o [#1378](https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2/issues/1378) derrubou a decisão #10 do mapa de checkout ao descobrir que o Asaas não tokeniza cartão client-side. Cada suposição aqui foi tratada com a mesma desconfiança.

---

## Veredito de cabeçalho

**A decisão #9 do mapa (auto-recarga no cartão salvo) SOBREVIVE — mas condicionada, e com um item sem fonte primária que precisa de teste real antes de virar spec.**

O mecanismo existe e é inequívoco: `POST /v3/payments` com `creditCardToken`, valor arbitrário, sem assinatura envolvida. Isso é fonte primária, item 1.

O que **não** existe é a semântica de MIT. O Asaas não tem campo de indicação de transação iniciada pelo estabelecimento, e o único campo que carrega essa informação — `remoteIp` — é **obrigatório** e documentado como *"IP de onde o cliente está fazendo a compra. Não deve ser informado o IP do seu servidor."* Numa auto-recarga disparada por cron não existe cliente na ponta. O contrato da API modela CIT; MIT é uso não documentado.

Três condições precisam ser verdade antes da spec ser escrita, e **nenhuma delas é verdade hoje**:

1. **Tokenização habilitada em produção** — não vem ligada, depende do gerente de contas, e *"está sujeita a análise prévia, podendo ser aprovada ou negada de acordo com os riscos da operação"*. Pode ser **negada**. Mesma pendência que o #1378 já registrou e que segue aberta.
2. **`remoteIp` numa cobrança sem cliente presente** — resolver operacionalmente (guardar o IP da última sessão do admin? enviar o IP do servidor e aceitar o risco de antifraude?). A doc não autoriza nenhuma das duas.
3. **Teste em Sandbox de uma cobrança tokenizada sem interação**, medindo latência real e o corpo do erro em recusa.

---

## 1. Cartão de assinatura vira token reutilizável para cobrança avulsa?

**Veredito: SIM, com uma ressalva de origem do token.**

O recurso chama-se **tokenização de cartão de crédito**. Dois caminhos de obtenção:

**(a) Token devolvido por uma transação aprovada.** Da página de cobranças via cartão:

> "Após uma transação aprovada, a resposta pode retornar o campo `creditCardToken`.
> Nas próximas cobranças do mesmo cliente, envie o token no lugar dos objetos `creditCard` e `creditCardHolderInfo`"

→ https://docs.asaas.com/docs/cobrancas-via-cartao-de-credito

O exemplo literal da doc é exatamente a cobrança avulsa que a auto-recarga precisa — valor arbitrário, `dueDate` livre, nenhuma assinatura envolvida:

```json
{
  "customer": "cus_000005219613",
  "billingType": "CREDIT_CARD",
  "value": 100.00,
  "dueDate": "2027-01-15",
  "creditCardToken": "76496073-536f-4835-80db-c45d00f33695",
  "remoteIp": "203.0.113.10"
}
```

E a mesma página fecha a porta do parcelamento por omissão explícita: *"Para cobranças avulsas, não envie `installmentCount`, `installmentValue` ou `totalValue`. Utilize apenas `value`."*

**(b) Token gerado direto.** `POST /v3/creditCard/tokenizeCreditCard`, devolvendo `creditCardToken`, descrito no OpenAPI como *"Token do cartão de crédito que poderá ser enviado nas próximas transações sem a necessidade de informar novamente os dados de cartão e do titular"*.
→ https://docs.asaas.com/reference/tokenizacao-de-cartao-de-credito

**Endpoint da cobrança avulsa:** `POST /v3/payments`, com `creditCardToken` aceito no `PaymentSaveWithCreditCardRequestDTO`. Existe ainda uma variante de resposta enxuta, `POST` com "dados resumidos na resposta", que aceita os mesmos campos de cartão e token.
→ https://docs.asaas.com/reference/criar-cobranca-com-cartao-de-credito · https://docs.asaas.com/reference/criar-cobranca-com-cartao-de-credito-com-dados-resumidos-na-resposta

### A ressalva de origem

A doc **não afirma em lugar nenhum que o cartão informado numa assinatura devolve um token consultável depois**. O que está documentado:

- token vem de *"uma transação aprovada"* (cobrança), ou do endpoint de tokenização;
- na criação de assinatura com cartão, *"o cartão **não é cobrado no momento da criação da assinatura**"* — só é validado. Não há transação aprovada, logo não há o gatilho documentado do token.
  → https://docs.asaas.com/docs/criando-assinatura-com-cartao-de-credito
- o webhook de cobrança devolve `payment.creditCard.creditCardToken` no payload de qualquer cobrança de cartão, inclusive as geradas pela assinatura — esse é o caminho realista de captura do token de uma assinatura ativa, mas a doc não o nomeia como tal.
  → https://docs.asaas.com/docs/webhook-para-cobrancas

**Consequência de desenho:** não conte com "o cartão da assinatura já é um token nosso". O desenho seguro é **tokenizar explicitamente no momento da venda** (`POST /v3/creditCard/tokenizeCreditCard` ou capturar o `creditCardToken` da primeira cobrança) e **persistir o token**. Hoje o repo não persiste: `cardToken` é parâmetro de entrada em `supabase/functions/_shared/payments/types.ts` e some — não existe coluna de token em nenhuma migration.

**Restrição dura, repetida em três páginas:** *"O token pertence ao cliente para o qual foi criado e não pode ser utilizado em cobranças de outro cliente."* Token é por `customer` do Asaas, o que casa com "um cartão por org".

---

## 2. A cobrança avulsa exige presença do titular (CIT), ou pode ser MIT?

**Veredito: mecanicamente MIT é possível. Contratualmente, NÃO HÁ indicação de MIT na API — e `remoteIp` é obrigatório e definido como o IP do comprador.**

### Não existe campo de MIT

O `PaymentSaveWithCreditCardRequestDTO` do OpenAPI oficial tem exatamente estas propriedades:

`customer`, `billingType`, `value`, `dueDate`, `description`, `daysAfterDueDateToRegistrationCancellation`, `externalReference`, `installmentCount`, `totalValue`, `installmentValue`, `discount`, `interest`, `fine`, `postalService`, `split`, `callback`, `pixAutomaticAuthorizationId`, `creditCard`, `creditCardHolderInfo`, `creditCardToken`, `authorizeOnly`, `remoteIp`.

→ https://docs.asaas.com/reference/criar-cobranca-com-cartao-de-credito

Nenhum campo de `transactionType`, `initiator`, `recurring`, `unscheduled` ou equivalente. **Não há indicador de MIT / recorrência não-agendada.** Isso não é ausência de documentação — é a lista completa e enumerada do schema.

### `remoteIp` é obrigatório e é o IP do pagador

O bloco `required` do mesmo DTO:

```json
"required": ["customer", "billingType", "value", "dueDate", "remoteIp"]
```

E a descrição do campo, literal: *"IP de onde o cliente está fazendo a compra. Não deve ser informado o IP do seu servidor."* A página-guia repete: *"Informe em `remoteIp` o IP do dispositivo do pagador, não o IP do servidor da sua aplicação."*
→ https://docs.asaas.com/docs/cobrancas-via-cartao-de-credito

Numa auto-recarga por cron não existe dispositivo de pagador. **Este é o furo real da decisão #9** — não a existência da cobrança avulsa tokenizada, que existe.

### O que joga a favor

- Não há nenhuma exigência documentada de CVV, 3DS ou reautenticação para cobrança com `creditCardToken`. O token substitui integralmente `creditCard` **e** `creditCardHolderInfo`.
- O próprio Asaas opera MIT internamente: assinatura de cartão cobra sozinha na data de vencimento — *"O Asaas realiza automaticamente a tentativa de cobrança na data de vencimento"* (https://docs.asaas.com/docs/faq-assinaturas). Ou seja, o rail suporta MIT; o que falta é a API expor isso ao integrador.
- O próprio Asaas recomenda cobrança avulsa iniciada pelo servidor num caso vizinho — o pro-rata de upgrade de plano: *"calcular o valor proporcional; emitir uma cobrança avulsa; atualizar ou recriar a assinatura"*. É o mesmo formato da auto-recarga.
  → https://docs.asaas.com/docs/criando-assinatura-com-cartao-de-credito

**Sem fonte primária:** que o Asaas sancione cobrança tokenizada sem titular presente; qual valor de `remoteIp` é aceitável nesse caso; e se o antifraude penaliza IP de datacenter. Precisa de teste em Sandbox + confirmação do gerente de contas.

---

## 3. Latência entre criar a cobrança e ter confirmação

**Veredito: SÍNCRONO no caminho feliz — segundos. Mas o Asaas proíbe tratar a resposta síncrona como final, e existe um ramo assíncrono de análise de risco.**

Resposta síncrona, literal:

> "Quando a transação for autorizada:
> * a cobrança será criada;
> * a API retornará `HTTP 200`;
> * o pagamento será processado no momento da requisição.
>
> Quando a transação for recusada:
> * a cobrança não será persistida;
> * a API retornará `HTTP 400`."

→ https://docs.asaas.com/docs/cobrancas-via-cartao-de-credito

E o `dueDate` não adia nada: *"O campo `dueDate` não agenda a captura do cartão. Quando os dados do cartão são enviados na criação, o processamento ocorre imediatamente."* A página de referência repete: *"Independentemente da data informada em `dueDate`, a captura da cobrança no cartão ocorre no momento da criação."*

### Os três contrapesos

1. **A doc manda não confiar só no síncrono.** *"Não utilize somente a resposta síncrona para concluir o processamento. Considere também os eventos recebidos por Webhook e as alterações posteriores no status da cobrança."* (https://docs.asaas.com/docs/testando-pagamento-com-cartão-de-crédito). A página-guia é mais direta: *"Não libere o produto ou serviço considerando apenas a criação da cobrança."*
2. **Ramo de análise de risco.** O enum de status inclui `AWAITING_RISK_ANALYSIS`, e o evento `PAYMENT_AWAITING_RISK_ANALYSIS` é descrito como *"Pagamento em cartão aguardando aprovação pela **análise manual** de risco"*, seguido de `PAYMENT_APPROVED_BY_RISK_ANALYSIS` / `PAYMENT_REPROVED_BY_RISK_ANALYSIS`. **Análise manual não tem SLA documentado — sem fonte primária para o tempo.**
   → https://docs.asaas.com/docs/webhook-para-cobrancas
3. **Timeout recomendado de 60s.** *"Para reduzir risco de timeout e evitar tentativas duplicadas de captura, a recomendação é configurar timeout mínimo de 60 segundos nessa requisição."* Isso é o teto de latência da chamada, não a mediana.

### Fluxo de eventos do cartão

`PAYMENT_CREATED` → `PAYMENT_CONFIRMED` → `PAYMENT_RECEIVED` **(32 dias após `PAYMENT_CONFIRMED`)**.

**Para a auto-recarga, o gate abre em `CONFIRMED`, nunca em `RECEIVED`.** `RECEIVED` significa dinheiro disponível na conta Asaas e chega 32 dias depois. Amarrar a liberação de crédito ao `RECEIVED` significaria bloquear o cliente por um mês.

**Resposta prática:** o caminho feliz desbloqueia em segundos (HTTP 200 + status `CONFIRMED`), com o webhook `PAYMENT_CONFIRMED` como confirmação de segunda opinião. O caminho de análise de risco desbloqueia em tempo indeterminado. O desenho precisa dos dois estados na máquina: *recarregado* e *em análise*.

---

## 4. Comportamento em recusa: código distinguível? Política de retentativa?

**Veredito: PARCIAL. Por padrão a mensagem é genérica por decisão de segurança. Retorno detalhado existe, mas só com tokenização habilitada — e a lista de códigos não é publicada. Política de retentativa: sem fonte primária.**

### O que é documentado

Recusa devolve `HTTP 400` e a cobrança **não é persistida**. O corpo, literal:

```json
{
  "errors": [
    {
      "code": "invalid_creditCard",
      "description": "Transação não autorizada. Verifique os dados do cartão de crédito e tente novamente."
    }
  ]
}
```

Com o preâmbulo explícito: *"Por segurança, uma transação recusada pode retornar uma mensagem genérica."*
→ https://docs.asaas.com/docs/cobrancas-via-cartao-de-credito

**Ou seja: no default não dá para distinguir limite insuficiente de cartão expirado de recusa de antifraude.** A doc até instrui a não tentar: *"não exponha detalhes internos ao pagador; oriente-o a revisar os dados ou utilizar outro cartão; registre o código retornado para análise."*

### A porta que a tokenização abre

Da página de referência da tokenização, literal:

> "Ao habilitar a tokenização, também será ativado o retorno detalhado dos erros sobre as tentativas de transações recusadas."

→ https://docs.asaas.com/reference/tokenizacao-de-cartao-de-credito

Isso amarra os itens 2 e 4 na mesma habilitação: sem tokenização em produção não há nem token nem erro discriminado. **Mas a lista dos códigos detalhados não está publicada em nenhuma página do `llms.txt` — sem fonte primária.** O que se pode afirmar é que o retorno detalhado existe, não qual é.

*(A página "Motivos de Recusa" do `llms.txt` — https://docs.asaas.com/docs/motivos-de-recusa — pertence à trilha do Pix Automático, não a cartão.)*

### Retentativa

**Sem fonte primária.** Nem a FAQ de assinaturas nem as páginas de cartão definem número de tentativas, intervalo ou política imposta. O que a FAQ diz sobre cartão que falha é só a consequência: *"As próximas tentativas de cobrança poderão falhar normalmente. Nesses casos, recomenda-se atualizar o cartão cadastrado antes do próximo vencimento."*
→ https://docs.asaas.com/docs/faq-assinaturas

Esta é a **mesma lacuna que o #1378 já registrou e que continua aberta** — precisa ir para o gerente de contas.

### Uma armadilha operacional documentada

> "Em caso de timeout ou resposta inconclusiva, consulte a cobrança antes de repetir a requisição. Uma nova tentativa sem verificação pode gerar uma cobrança duplicada."

Não há chave de idempotência na criação de cobrança. **Retry cego cobra o cliente duas vezes.** Numa auto-recarga por cron, isso é o formato exato do incidente dos 29.811 envios de WhatsApp que o mapa cita como precedente a não repetir: o retry precisa de `GET /v3/payments` antes, e o `externalReference` precisa carregar uma chave nossa por tentativa.

---

## 5. Teto de valor ou de frequência para cobrança avulsa em cartão salvo?

**Veredito: NÃO há teto de valor documentado. Há teto de frequência, mas o número é por conta e só é conhecido consultando a API.**

### Valor

O campo `value` é documentado apenas como *"Valor da cobrança. Deve ser utilizado em cobranças avulsas de parcela única"*. Nenhum mínimo, nenhum máximo em nenhuma página de cobrança ou cartão.
→ https://docs.asaas.com/reference/criar-nova-cobranca

**Sem fonte primária** para teto ou piso de valor.

### Frequência — três camadas, todas documentadas

**(a) Limite diário de criação de cobranças, por conta.** `GET /v3/payments/limits` devolve `creation.daily` com `{ limit, used, wasReached }`, descrito como *"Limites diários"* de *"Limites de criação"*. O valor de `limit` é da conta — o exemplo do schema mostra `10`, o que não é promessa. A doc posiciona o endpoint como *"validação prévia antes da emissão"*.
→ https://docs.asaas.com/reference/recuperando-limites-de-cobrancas-1

**Isto é o achado operacional deste item:** existe um teto diário de criação de cobranças e ele é desconhecido para a conta de produção do Torque. Uma auto-recarga que dispare para muitas orgs no mesmo dia compete com as cobranças de assinatura pela mesma cota. **Rodar `GET /v3/payments/limits` na conta de produção antes de fechar a spec** — mesma classe de verificação do `GET /v3/myAccount/fees` que o #1378 deixou pendente.

**(b) Rate limit por endpoint.** Headers `RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset`; estourar devolve `HTTP 429`.

**(c) Cota de 12h.** *"O limite é de 25.000 requisições por conta independente do endpoint acessado"*, por janela de 12h a partir da primeira requisição. Mais *"até 50 requisições concorrentes do tipo `GET`"*.
→ https://docs.asaas.com/reference/rate-e-quota-limit

---

## 6. Tarifa de uma cobrança avulsa em cartão

**Veredito: MESMA da assinatura — R$ 0,49 + 2,99% (à vista). Sem tarifa própria de recorrência.**

Tabela pública: cartão à vista **R$ 0,49 + 2,99%**; 2–6× R$ 0,49 + 3,49%; 7–12× R$ 0,49 + 3,99%; 13–21× R$ 0,49 + 4,29%. Sem mensalidade: *"não há mensalidade ou taxa de adesão. Você só paga pelos serviços que utilizar."* E a base de cálculo, literal: as tarifas incidem *"sobre o valor total da venda para parcelamentos e por cobranças recebidas para assinaturas"* — ou seja, cada cobrança gerada pela assinatura é tarifada como cartão à vista, igual a uma avulsa.
→ https://www.asaas.com/precos-e-taxas

O OpenAPI de `GET /v3/myAccount/fees` confirma a forma da tarifa e devolve a **efetiva da conta**, que pode ser negociada: `payment.creditCard` tem `operationValue` (*"Taxa operacional por cobrança"*, exemplo `0.49`), `oneInstallmentPercentage` (*"Taxa percentual à vista"*, exemplo `2.99`) e os percentuais por faixa de parcelas, mais os campos `discount*` de tarifa promocional.
→ https://docs.asaas.com/reference/recuperar-taxas-da-conta

**A promoção de 1,99% vale só nos 3 primeiros meses de conta nova** — a conta de produção do Torque já está ativa, então a régua é a cheia.

### O que isso decide: o valor mínimo de recarga

Custo da tarifa como % da recarga, com `0,49 + 2,99%`:

| Recarga | Tarifa | % devorado |
|---|---|---|
| R$ 20 | R$ 1,09 | **5,44%** |
| R$ 50 | R$ 1,99 | **3,98%** |
| R$ 100 | R$ 3,48 | **3,48%** |
| R$ 200 | R$ 6,47 | **3,24%** |
| R$ 500 | R$ 15,44 | **3,09%** |
| R$ 1.000 | R$ 30,39 | **3,04%** |

A componente fixa de R$ 0,49 é o que decide: abaixo de ~R$ 100 ela pesa mais de meio ponto percentual e cresce rápido. **Piso recomendado de recarga: R$ 100.** Abaixo de R$ 50 a tarifa passa de 4% e a auto-recarga vira um mecanismo caro de mover pouco dinheiro. Como o crédito comprado vale 12 meses (decisão #5 do mapa), recargas maiores e menos frequentes são estritamente melhores para o caixa — e o teto diário de criação de cobranças do item 5 dá o mesmo empurrão.

---

## 7. O webhook distingue pagamento de assinatura de cobrança avulsa?

**Veredito: SIM, e o campo é explícito. Este item é o mais limpo dos oito.**

O payload de webhook de cobrança carrega *"os dados completos da cobrança"*, e o objeto `payment` traz o campo `subscription`:

```json
"payment":{
   "object":"payment",
   "id":"pay_080225913252",
   "customer":"cus_G7Dvo4iphUNk",
   "subscription":"sub_VXJBYgP2u0eO",
   "installment":"2765d086-c7c5-5cca-898a-4262d212587c",
   "paymentLink":"123517639363",
   ...
}
```

E a nota de campos opcionais, literal e decisiva:

> "`subscription`: retornado apenas quando a cobrança pertence a uma assinatura."

→ https://docs.asaas.com/docs/webhook-para-cobrancas

O mesmo campo existe tipado no schema de resposta de cobrança: *"Identificador único da assinatura (quando cobrança recorrente)"*.
→ https://docs.asaas.com/reference/criar-cobranca-com-cartao-de-credito

**Regra para o handler:** `payment.subscription` ausente/`null` **e** `payment.installment` ausente **e** `payment.paymentLink` ausente ⇒ cobrança avulsa. É o discriminador que impede a auto-recarga de ser lida como renovação de assinatura em `supabase/functions/asaas-webhook`.

**Reforço obrigatório:** não confiar só na ausência do campo. O mesmo doc avisa que *"é possível que novos atributos sejam incluídos no Webhook"* e que exceção no handler *"poderá causar interrupção na fila de sincronização"*. O discriminador forte é o **`externalReference` nosso**, gravado na criação da cobrança de recarga com um prefixo próprio — a doc recomenda `externalReference` justamente *"para facilitar a conciliação entre sistemas"* (https://docs.asaas.com/docs/faq-assinaturas). Ausência de `subscription` é a checagem secundária.

---

## 8. Pix iniciado pelo servidor sem interação é alternativa mais barata?

**Veredito: EXISTE (Pix Automático), é MUITO mais barato — e NÃO SERVE para auto-recarga. A janela de criação da instrução mata o caso de uso.**

O Pix Automático é *"uma modalidade do Pix que permite automatizar pagamentos recorrentes mediante autorização prévia do pagador"*, com *"uma experiência semelhante ao débito automático"*. A integração via API usa a **Jornada 3**: o consentimento é obtido *"durante o pagamento da primeira cobrança"*, com um QR Code único que reúne a primeira cobrança e a autorização.
→ https://docs.asaas.com/docs/pix-automatico

### Os três bloqueios, todos documentados

**(1) A janela de criação torna a recarga instantânea impossível.** Literal:

> "A instrução de pagamento deve ser criada entre **2 e 10 dias úteis antes do vencimento**.
> Caso a cobrança seja criada fora dessa janela, a API retornará uma exceção."

→ https://docs.asaas.com/docs/pix-automatico-implementacao

**Isto é fatal para a decisão #9.** Auto-recarga por definição dispara no instante em que o saldo cruza o piso. Uma instrução que só pode ser criada com 2 dias úteis de antecedência não desbloqueia ninguém em segundos. O Pix Automático serve para **mensalidade agendada**, não para **reposição sob demanda**.

**(2) Consentimento prévio com pagamento real.** *"a autorização somente é ativada após a liquidação do primeiro pagamento"* — e *"Somente após esse momento sua aplicação deve iniciar a criação das cobranças recorrentes."* Nenhuma cobrança recorrente antes disso.

**(3) O calendário vira nosso.** *"as cobranças recorrentes precisam ser criadas pela integração conforme a periodicidade desejada"*, cada uma referenciando `pixAutomaticAuthorizationId`. É o inverso da posse do calendário que o #1378 já apontou como razão para preferir Assinatura a Pix Automático no #1376.

### Se um dia o piso mudar

A tarifa Pix é **R$ 1,99 fixo por transação recebida** (https://www.asaas.com/precos-e-taxas). Numa recarga de R$ 200 isso é **1,00%** contra 3,24% do cartão — 3× mais barato; numa de R$ 500, 0,40% contra 3,09% — quase 8× mais barato. A economia é real e grande.

**Mas ela só se materializa se a recarga puder ser agendada com 2+ dias úteis de antecedência.** Ou seja: Pix Automático é candidato natural para uma **recarga programada** (o admin escolhe "reponho R$ X todo dia 5"), e é inservível para a **auto-recarga por gatilho de saldo** que a decisão #9 descreve. Se o mapa quiser as duas coisas, são dois mecanismos, não um.

**Sem fonte primária:** disponibilidade do Pix Automático para a conta de produção do Torque (a doc não diz se exige habilitação, como a tokenização exige).

---

## Resumo

| # | Item | Veredito |
|---|---|---|
| 1 | Token reutilizável em cobrança avulsa | ✅ **SIM** — `POST /v3/payments` + `creditCardToken`, valor livre. Ressalva: token vem de transação aprovada, não da criação da assinatura |
| 2 | MIT / iniciada pelo servidor | ⚠️ **mecanicamente sim, contratualmente não documentado** — zero campos de MIT; `remoteIp` obrigatório e definido como IP do comprador |
| 3 | Latência | ✅ **síncrono** (HTTP 200/400, captura imediata) — mas a doc proíbe confiar só nisso, e `AWAITING_RISK_ANALYSIS` é análise **manual** sem SLA. Gate abre em `CONFIRMED`, nunca em `RECEIVED` (32 dias) |
| 4 | Recusa e retentativa | ⚠️ **genérico por padrão**; detalhado só com tokenização habilitada, **lista de códigos não publicada**. Retentativa: **sem fonte primária**. Sem chave de idempotência — retry cego duplica cobrança |
| 5 | Teto | ⚠️ valor: **sem fonte primária**. Frequência: **existe** teto diário de criação (`GET /v3/payments/limits`), valor desconhecido para a conta de prod + 25k req/12h |
| 6 | Tarifa | ✅ **igual à assinatura**: R$ 0,49 + 2,99%. Piso de recarga recomendado **R$ 100** (abaixo disso a tarifa passa de 3,5%) |
| 7 | Webhook distingue | ✅ **SIM** — `payment.subscription` *"retornado apenas quando a cobrança pertence a uma assinatura"*. Reforçar com `externalReference` nosso |
| 8 | Pix sem interação | ⚠️ **existe e é 3–8× mais barato, mas NÃO serve** — instrução só pode ser criada 2–10 dias úteis antes do vencimento |

### Itens sem fonte primária (não preenchidos com plausibilidade)

1. Sanção do Asaas a cobrança tokenizada sem titular presente, e valor legítimo de `remoteIp` nesse caso.
2. Lista dos códigos de erro detalhados liberados junto com a tokenização.
3. Política de retentativa de cartão recusado (mesma lacuna do #1378, ainda aberta).
4. SLA da análise manual de risco.
5. Teto e piso de **valor** de uma cobrança em cartão.
6. Valor do `creation.daily.limit` da conta de produção.
7. Disponibilidade do Pix Automático para a conta de produção.

### Verificações operacionais antes da spec

1. `GET /v3/payments/limits` na conta de produção — descobrir o teto diário de criação de cobranças.
2. `GET /v3/myAccount/fees` na conta de produção — tarifa efetiva de cartão (pendência herdada do #1378).
3. Pedir ao gerente de contas a **habilitação da tokenização em produção** — pode ser negada por análise de risco; sem ela a decisão #9 é inexecutável.
4. Perguntar ao gerente: `remoteIp` em cobrança sem titular presente, política de retentativa, e a lista de códigos de recusa detalhados.
5. Sandbox: cobrança com `creditCardToken` sem interação — medir latência real e capturar o corpo do erro em recusa (cartões de teste `5184019740373151` / `4916561358240741`, https://docs.asaas.com/docs/testando-pagamento-com-cartão-de-crédito).

### Achados colaterais no repo (não pedidos, mas relevantes)

- **`supabase/functions/_shared/payments/asaas-provider.ts` não envia `remoteIp`** em `createCharge` nem em `createSubscription`, e o campo é `required` no OpenAPI de cartão. Se essas chamadas ainda não rodaram em produção com cartão, vão falhar.
- **O `creditCardToken` nunca é persistido.** `cardToken` é só parâmetro de entrada em `supabase/functions/_shared/payments/types.ts`; nenhuma migration tem coluna de token. A auto-recarga precisa de um lugar para guardá-lo (e de RLS deny-all, no molde de `whatsapp_instance_secrets`).
