# Webhook do Asaas — capacidades reais (pesquisa contra fonte primária)

**Contexto:** decisão SCRUM-281 / #1384. O webhook do Asaas será o endpoint que decide que uma org pagou e dispara provisionamento. Volume alvo: ~R$213k/mês, 89 orgs.

**Data da pesquisa:** 2026-08-11
**Fonte:** exclusivamente `docs.asaas.com` (documentação oficial). Nenhuma afirmação abaixo vem de memória, de blog, ou de "como gateways geralmente fazem".
**Método:** as páginas foram baixadas na versão Markdown canônica que o próprio Asaas publica para LLMs (`https://docs.asaas.com/docs/<slug>.md`, índice em `https://docs.asaas.com/llms.txt`). Datas de `updatedAt` das páginas usadas: 19 a 25/jun/2026.

Convenção deste documento:
- **FATO DOCUMENTADO** — está escrito na doc oficial, com citação literal e link.
- **NÃO DOCUMENTADO** — procurei e não existe na doc. Não preenchi a lacuna.
- **INFERÊNCIA** — leitura minha em cima dos fatos. Marcada como tal, nunca misturada com fato.

---

## Resumo executivo (as 3 respostas que mudam o desenho)

| Pergunta | Resposta curta |
|---|---|
| Autenticação | **Não existe HMAC.** Só um token estático compartilhado no header `asaas-access-token`, definido por você na criação do webhook. Nada do corpo é assinado. Existe allowlist de IP publicada (4 IPs). |
| Idempotência | **Sim, existe e é estável.** Campo `id` do evento (formato `evt_...`). A doc afirma explicitamente que o mesmo evento reenviado carrega o mesmo `id`. |
| A fila trava? | **Sim, e trava feio.** 15 falhas consecutivas pausam a fila daquele webhook. No modo `SEQUENTIALLY`, um único evento envenenado **bloqueia todos os eventos seguintes da fila**. Após 14 dias parados, os eventos são **apagados permanentemente**. |

---

## 1. AUTENTICAÇÃO — como o Asaas prova que o webhook veio dele

### 1.1 Existe assinatura HMAC do corpo? — **NÃO DOCUMENTADO / inexistente**

Varri todas as páginas da seção de Webhooks (`sobre-os-webhooks`, `receba-eventos-do-asaas-no-seu-endpoint-de-webhook`, `criar-novo-webhook-pela-api`, `como-implementar-idempotencia-em-webhooks`, `tipos-de-envio`, `faq-de-webhooks`, `fila-pausada`, `penalização-de-filas`, `logs-de-webhooks`, `ips-oficiais-do-asaas`, `eventos-de-webhooks`, `webhook-para-cobrancas`, `eventos-para-assinaturas`) mais `pci-dss` e `autenticação`. **Nenhuma ocorrência** de HMAC, assinatura, signature, sha256, hash, timestamp assinado, ou header de assinatura.

Não há:
- header de assinatura (nada tipo `X-Signature`, `Asaas-Signature`);
- algoritmo declarado;
- definição de o que seria assinado (corpo cru vs. timestamp+corpo);
- segredo de assinatura distinto do token.

**Conclusão: o Asaas não oferece verificação criptográfica do corpo.** Registro isso como fato negativo verificado, não como lacuna de busca.

Fonte (ausência verificada em): <https://docs.asaas.com/docs/sobre-os-webhooks>, <https://docs.asaas.com/docs/receba-eventos-do-asaas-no-seu-endpoint-de-webhook>, <https://docs.asaas.com/docs/faq-de-webhooks>

### 1.2 É só um token compartilhado em header — **FATO DOCUMENTADO. Sim, é só isso.**

> "Para impedir que a sua aplicação receba requisições de outras origens, você tem a opção de utilizar um token para autenticar as requisições vindas do Asaas. Este token pode ser informado na configuração do Webhook. O token informado será enviado em todas as notificações no header `asaas-access-token`."
> — <https://docs.asaas.com/docs/sobre-os-webhooks>

Note o **"você tem a opção de"**: a autenticação é **opcional**. Se você não mandar o campo, o Asaas gera um valor:

> "**Caso o campo não seja enviado, o Asaas gerará automaticamente um valor seguro.**"
> — <https://docs.asaas.com/docs/criar-novo-webhook-pela-api>

Regras do token (**FATO DOCUMENTADO**):
> "O token deve: possuir entre 32 e 255 caracteres; não conter espaços em branco; não utilizar sequências simples; não ser uma API Key do Asaas."
> — <https://docs.asaas.com/docs/receba-eventos-do-asaas-no-seu-endpoint-de-webhook>

Como se obtém o segredo (**FATO DOCUMENTADO**): **você define**, no `POST /v3/webhooks`, campo `authToken`. Não é derivado da API Key.
> "O valor do token é retornado apenas no momento da criação do Webhook. Certifique-se de armazená-lo em local seguro, pois ele será necessário para validar as requisições recebidas."
> — <https://docs.asaas.com/docs/criar-novo-webhook-pela-api>

Na leitura (`GET /v3/webhooks`) o token **não** volta — volta só o booleano `hasAuthToken`.
— <https://docs.asaas.com/reference/criar-novo-webhook>

E o Asaas nega explicitamente Bearer Token (**FATO DOCUMENTADO**):
> "**O Asaas envia Bearer Token nos webhooks?** Não. Os Webhooks do Asaas não utilizam autenticação padrão Bearer Token. Caso sua aplicação exija autenticação, recomenda-se implementar uma validação própria."
> — <https://docs.asaas.com/docs/faq-de-webhooks>

### 1.3 Allowlist de IP publicada — **FATO DOCUMENTADO. Sim.**

IPs oficiais de **produção**:
```
52.67.12.206
18.230.8.159
54.94.136.112
54.94.183.101
```
> "Atualmente, os Webhooks do Asaas são enviados através dos seguintes IPs: ... Esses IPs são utilizados para comunicação dos Webhooks em ambiente de produção."
> — <https://docs.asaas.com/docs/ips-oficiais-do-asaas>

Ressalva documentada: **Sandbox tem IPs adicionais não publicados.**
> "Em ambiente Sandbox podem existir IPs adicionais."
> — mesma página, e repetido em <https://docs.asaas.com/docs/faq-de-webhooks>

Armadilha documentada, e relevante pra nós: bloquear IP errado gera 403 → penalização → **fila interrompida**.
> "Caso os IPs estejam bloqueados, é comum observar: erro 403 nos logs; penalização da fila; interrupção da fila após 15 falhas consecutivas; atraso ou ausência de sincronização entre os sistemas."
> — <https://docs.asaas.com/docs/ips-oficiais-do-asaas>

### 1.4 Outros fatos de transporte

- **Content-Type**: `application/json`. — <https://docs.asaas.com/docs/faq-de-webhooks>
- **Método**: `POST`. — <https://docs.asaas.com/docs/sobre-os-webhooks>
- **Redirects não são seguidos** (301/302/307/308 contam como **falha**):
  > "O Asaas segue redirecionamentos HTTP? Não. Os seguintes retornos não são seguidos automaticamente: 301, 302, 307, 308. A URL configurada deve responder diretamente ao POST enviado pelo webhook."
  > — <https://docs.asaas.com/docs/faq-de-webhooks>
- **Timeout de resposta: 10 segundos.**
  > "O Asaas aguarda até 10 segundos pela resposta do seu servidor. Caso esse prazo seja excedido, a tentativa é considerada falha."
  > — <https://docs.asaas.com/docs/faq-de-webhooks>
- **Limite de 10 webhooks por conta.** — <https://docs.asaas.com/docs/criar-novo-webhook-pela-api>

### 1.5 INFERÊNCIA (não é doc) — o que isso força no desenho

Token estático + corpo não assinado = **quem tiver o token pode forjar qualquer evento**, inclusive `PAYMENT_RECEIVED` de valor arbitrário, e pode **repetir** uma requisição capturada. O token no header é credencial de portador, não prova de origem nem de integridade. Portanto:
1. comparação do token em **tempo constante**, nunca `===` cru;
2. o webhook **não deve confiar no corpo como verdade financeira** — o corpo diz "olha esse `payment.id`", e nós **reconsultamos** `GET /v3/payments/{id}` com a nossa API Key para decidir se provisiona. Isso neutraliza tanto forja quanto replay de valor;
3. allowlist dos 4 IPs como camada 2 (não substitui, complementa);
4. o `authToken` é secret de verdade — cofre, rotacionável, e não commitado.

---

## 2. IDEMPOTÊNCIA — o evento carrega identificador único e estável?

### 2.1 Qual o campo — **FATO DOCUMENTADO: `id` do evento (raiz do payload), formato `evt_...`**

Não é o `id` do pagamento. O payload tem os dois:
```json
{
   "id": "evt_05b708f961d739ea7eba7e4db318f621&368604920",
   "event": "PAYMENT_RECEIVED",
   "dateCreated": "2024-06-12 16:45:03",
   "account": { "id": "47ed0d25-f9fb-4b35-b23a-d8895caf92b7", "ownerId": null },
   "payment": { "object": "payment", "id": "pay_080225913252", "...": "..." }
}
```
— <https://docs.asaas.com/docs/webhook-para-cobrancas>

⚠️ Note o exemplo real da doc: o `id` do evento **contém `&`** e tem ~50 caracteres. Não assuma UUID nem charset alfanumérico. A doc mostra outro exemplo mais curto (`evt_123456789`) em <https://docs.asaas.com/docs/sobre-os-webhooks> — **o formato não é especificado formalmente em lugar nenhum**; comprimento máximo é **NÃO DOCUMENTADO**. Guardar como `text`, não `varchar(n)`.

### 2.2 É estável entre RE-ENTREGAS? — **FATO DOCUMENTADO: SIM.** (a pergunta que mais importa)

Duas afirmações independentes, ambas explícitas:

> "Cada evento enviado pelos Webhooks possui um ID próprio, **que se repete caso se trate do mesmo evento**."
> — <https://docs.asaas.com/docs/sobre-os-webhooks>

> "Os eventos enviados pelos Webhooks do Asaas possuem IDs únicos e, **mesmo que sejam enviados mais de uma vez, você sempre receberá o mesmo ID**."
> — <https://docs.asaas.com/docs/como-implementar-idempotencia-em-webhooks>

O Asaas inclusive recomenda o padrão exato: `UNIQUE` no `id` do evento, tratar violação de unicidade como "já processado" e responder 200. O exemplo oficial é Postgres + código de erro `23505`:
```sql
CREATE TABLE asaas_events (
    id bigint PRIMARY KEY,
    asaas_event_id text UNIQUE NOT NULL,
    payload JSON NOT NULL,
    status ENUM('PENDING','DONE') NOT NULL
);
```
— <https://docs.asaas.com/docs/como-implementar-idempotencia-em-webhooks>

Modelo de entrega declarado: **at least once**.
> "Os webhooks garantem a entrega '*at least once*' (ao menos uma entrega). Isso significa que seu endpoint pode receber ocasionalmente o mesmo evento de webhook mais de uma vez."
> — <https://docs.asaas.com/docs/sobre-os-webhooks>

### 2.3 Contradição encontrada na própria doc — registrar

Na página de idempotência, o Asaas escreve:
> "Lembre-se de **retornar 200 somente após a confirmação da persistência do evento** na sua tabela no banco de dados, pois **não garantimos que este evento será reenviado automaticamente**."
> — <https://docs.asaas.com/docs/como-implementar-idempotencia-em-webhooks>

Isso conflita com a FAQ, que afirma sem ressalva:
> "**O Asaas faz novas tentativas de envio?** Sim. Quando ocorre uma falha, o Asaas realiza novas tentativas automaticamente."
> — <https://docs.asaas.com/docs/faq-de-webhooks>

**Leitura conservadora obrigatória:** trate o reenvio como **não garantido**. Persistir primeiro, responder 200 depois, processar assíncrono. É exatamente o que a doc manda fazer.

---

## 3. ORDEM E ENTREGA

### 3.1 Garante ordem? — **FATO DOCUMENTADO: depende do `sendType`, configurável por webhook.**

Dois modos, campo `sendType` no `POST /v3/webhooks`, enum `SEQUENTIALLY` | `NON_SEQUENTIALLY`
(— <https://docs.asaas.com/reference/criar-novo-webhook>, <https://docs.asaas.com/docs/criar-novo-webhook-pela-api>):

> "No envio **Sequencial**, os eventos são enviados respeitando a ordem em que ocorreram. No envio **Não Sequencial**, os eventos podem ser enviados simultaneamente, sem garantir ordem entre eles, proporcionando maior vazão e menor tempo de entrega."
> — <https://docs.asaas.com/docs/tipos-de-envio>

O próprio Asaas recomenda **Sequencial para cobranças e assinaturas**:
> "O envio Sequencial é recomendado para: Cobranças; Assinaturas; Fluxos que dependem da ordem dos eventos; ..."
> — <https://docs.asaas.com/docs/tipos-de-envio>

### 3.2 Há número de sequência no payload? — **NÃO DOCUMENTADO**

Não existe campo de sequência, offset, versão ou `sequenceNumber` em nenhum exemplo de payload da doc. O único carimbo temporal é `dateCreated` do evento (`"2024-06-12 16:45:03"`, **sem timezone declarado** — o timezone é **NÃO DOCUMENTADO**). Ordenar por `dateCreated` tem resolução de 1 segundo e nenhum desempate documentado.

A doc só diz, genericamente:
> "Caso a ordem dos eventos seja importante para o seu sistema, lembre-se de buscá-los e processá-los em ordem ascendente."
> — <https://docs.asaas.com/docs/como-implementar-idempotencia-em-webhooks>

### 3.3 Política de retentativa — **FATO DOCUMENTADO, com tabela exata**

> "Após a primeira falha, o Asaas inicia automaticamente um ciclo progressivo de retentativas:"

| Tentativa | Tempo | Ação de notificação |
|---|---|---|
| 1 | 0 | |
| 2 | 30 segundos | |
| 3 | 1 min | |
| 4 | 3,5 min | |
| 5 | 5 min | 1º E-mail de alerta |
| 6 | 15 min | |
| 7 | 25 min | |
| 8 | 1 hora | |
| 9 | 1 hora | |
| 10 | 1 hora | 2º E-mail de alerta |
| 11 | 1 hora | |
| 12 | 1 hora | |
| 13 | 2 horas | |
| 14 | 2 horas | |
| 15 | 3 horas | 3º E-mail (Fila pausada) |

> "Após 15 falhas consecutivas, a fila do webhook será interrompida."
> — <https://docs.asaas.com/docs/penaliza%C3%A7%C3%A3o-de-filas>

Soma da janela: ~**11h15min** entre a primeira falha e a pausa da fila. **INFERÊNCIA:** é essa a janela real de "auto-cura" — se a nossa edge function ficar fora por 12h, a fila pausa e vira intervenção manual.

Gatilhos de penalização (**FATO DOCUMENTADO**): qualquer resposta fora de `2xx`, mais falhas de conexão e timeouts — `400`, `403`, `404`, `408 Read Timed Out`, `500`, "Falhas de conexão", "Timeouts". — mesma página.

### 3.4 O que o Asaas considera "entregue" — **CONTRADIÇÃO DOCUMENTAL. Registrar e agir pelo mais restrito.**

Duas páginas oficiais discordam:

**Versão A — família 2xx:**
> "Para que o Asaas considere a notificação como processada com sucesso, o status HTTP da resposta deve ser maior ou igual a `200` e menor que 300."
> — <https://docs.asaas.com/docs/sobre-os-webhooks>
E ainda: "recomenda-se retornar uma resposta HTTP de sucesso: `HTTP/1.1 200 OK` ou `HTTP/1.1 204 No Content`" — mesma página.

**Versão B — somente 200:**
> "Embora existam diversos códigos de sucesso da família 2xx, atualmente o Asaas considera **apenas o retorno HTTP 200** como sucesso no processamento do evento."
> — <https://docs.asaas.com/docs/faq-de-webhooks>
> "Qualquer outro retorno (`201`, `204`, `308`, `400`, `403`, `404`, `500`, etc.) será interpretado como **falha** na comunicação."
> — <https://docs.asaas.com/docs/fila-pausada>

A versão B é mais recente na intenção (é a que aparece nas duas páginas operacionais de troubleshooting, ambas atualizadas em 22/jun/2026) e é a mais restritiva. **Decisão segura: responder exatamente `200`. Nunca `204`.** Um `204` — que é o retorno idiomático de um handler que não devolve corpo — seria contado como falha e nos levaria à fila pausada em ~11h.

### 3.5 Pausa após N falhas — **FATO DOCUMENTADO: 15 consecutivas, por configuração de webhook**

> "caso seu sistema falhe em responder sucesso 15 vezes consecutivas, a fila de sincronização será interrompida. Novas notificações continuam sendo geradas e incluídas na fila de sincronia, porém não são enviadas para a sua aplicação."
> — <https://docs.asaas.com/docs/sobre-os-webhooks>

Escopo da interrupção (**FATO DOCUMENTADO**):
> "**A interrupção ocorre por configuração de webhook. Caso existam outros webhooks cadastrados, eles continuarão funcionando normalmente.**"
> — <https://docs.asaas.com/docs/penaliza%C3%A7%C3%A3o-de-filas>

### 3.6 Existe fila por conta, e ela TRAVA se o endpoint devolver erro? — **FATO DOCUMENTADO: SIM, TRAVA.** (a pergunta decisiva)

Granularidade: a fila é **por configuração de webhook** (e portanto por conta Asaas, já que os webhooks pertencem a uma conta/subconta). Até 10 webhooks por conta, cada um com sua própria fila e seu próprio estado de interrupção.

E o head-of-line blocking é explícito no modo Sequencial:

> "No modo **Sequencial**, a ordem de entrega é garantida. Isso significa que, se um evento estiver penalizado, **todos os eventos seguintes daquela fila permanecerão aguardando** até que o evento atual seja entregue com sucesso."
>
> Exemplo dado pela doc:
> ```
> PAYMENT_CREATED → PAYMENT_CONFIRMED → PAYMENT_RECEIVED → PAYMENT_REFUNDED
> ```
> "Se o envio do `PAYMENT_CONFIRMED` estiver penalizado, os eventos `PAYMENT_RECEIVED` e `PAYMENT_REFUNDED` não serão enviados até que o evento pendente seja processado."
> — <https://docs.asaas.com/docs/penaliza%C3%A7%C3%A3o-de-filas>

**Isto responde a pergunta do brief de forma inequívoca: devolver 500 num evento envenenado, em modo `SEQUENTIALLY`, congela a fila inteira daquela conta.** Com 89 orgs num único webhook, um evento que o nosso código não sabe digerir para o provisionamento de *todas* elas.

Se a penalização escalar por evento individual ou por fila no modo `NON_SEQUENTIALLY` (ou seja: se "15 falhas consecutivas" conta falhas do mesmo evento ou falhas quaisquer na fila paralela) é **NÃO DOCUMENTADO**. A doc só afirma que "Este mecanismo se aplica tanto aos Webhooks configurados no modo Sequencial quanto no modo Não Sequencial".

Durante a pausa (**FATO DOCUMENTADO**):
> "Novos eventos continuam sendo gerados normalmente. Os eventos permanecem armazenados em fila. Nenhum novo envio será realizado até que a fila seja reativada. Os eventos permanecem disponíveis por até 14 dias. Eventos com mais de 14 dias serão excluídos permanentemente."
> — <https://docs.asaas.com/docs/penaliza%C3%A7%C3%A3o-de-filas>

> "**Os eventos que estiverem mais de 14 dias parados na fila serão excluídos permanentemente.**"
> — <https://docs.asaas.com/docs/sobre-os-webhooks>

### 3.7 Como destravar — **FATO DOCUMENTADO**

Três caminhos:
1. **Painel:** Minha Conta → Integração (ou Integrações → Webhooks), reativar. — <https://docs.asaas.com/docs/sobre-os-webhooks>, <https://docs.asaas.com/docs/como-reativar-fila-interrompida>
2. **API:** `PUT` em [Atualizar webhook existente] enviando `interrupted: false`.
   > "Também é possivel reativar utilizando o endpoint de Atualizar webhook existente enviando o atributo `interrupted` como `false`. **Todos os eventos pendentes serão processados em ordem cronológica.**"
   > — <https://docs.asaas.com/docs/sobre-os-webhooks> / <https://docs.asaas.com/reference/atualizar-webhook-existente>
3. **Remover penalização** (sem esperar o ciclo acabar): endpoint dedicado, <https://docs.asaas.com/reference/remover-penalizacao-webhook>
   > "Este endpoint possui um **rate limit mais restrito** para desencorajar automações que removam a penalização repetidamente. A funcionalidade foi projetada para ser utilizada somente após a correção do problema."
   > — <https://docs.asaas.com/docs/penaliza%C3%A7%C3%A3o-de-filas>

Ou seja: **auto-reativação programática existe, mas é explicitamente desencorajada e rate-limitada.** Não dá pra desenhar um watchdog que só fica destravando.

### 3.8 Observabilidade — **FATO DOCUMENTADO, e é uma limitação séria**

> "Também é possível consultar e configurar webhooks via API utilizando os endpoints da documentação. Entretanto, **os logs de entrega estão disponíveis apenas pela interface web**."
> — <https://docs.asaas.com/docs/logs-de-webhooks>

Retenção de logs e eventos: **14 dias**. Alerta de falha vai por **e-mail** (campo `email` do webhook), em 3 disparos (tentativas 5, 10 e 15).

**INFERÊNCIA:** não existe API para auditar entregas. Nosso monitoramento tem que ser do nosso lado — e o campo `email` do webhook deve apontar para um canal que alguém realmente lê (ver memória `canal-suporte-caiu-24-dias`: alerta em canal cego = 24 dias de silêncio). Além disso, `GET /v3/webhooks` devolve `interrupted` e `penalizedRequestsCount` — dá pra fazer um cron que **detecta** a fila pausada mesmo sem log de entrega.
— campos confirmados em <https://docs.asaas.com/reference/criar-novo-webhook>

---

## 4. EVENTOS DE PAGAMENTO — nomes exatos

Fonte única desta seção: <https://docs.asaas.com/docs/webhook-para-cobrancas> (todas as descrições são citação literal).

### 4.1 Os que importam para confirmar cobrança de assinatura

| Evento | Descrição oficial (literal) | Papel no nosso fluxo |
|---|---|---|
| `PAYMENT_CREATED` | "Geração de nova cobrança." | cobrança emitida, ninguém pagou nada |
| `PAYMENT_CONFIRMED` | "Cobrança confirmada (pagamento efetuado, porém, o saldo ainda não foi disponibilizado)." | **cliente pagou** |
| `PAYMENT_RECEIVED` | "Cobrança recebida. (Valor disponível na conta Asaas)" | **dinheiro na conta** |
| `PAYMENT_OVERDUE` | "Cobrança vencida." | venceu sem pagamento |
| `PAYMENT_REFUNDED` | "Cobrança estornada." | estorno total |
| `PAYMENT_PARTIALLY_REFUNDED` | "Cobrança estornada parcialmente." | estorno parcial |
| `PAYMENT_REFUND_IN_PROGRESS` | "Estorno em processamento (liquidação já está agendada, cobrança será estornada após executar a liquidação)." | estorno agendado |
| `PAYMENT_REFUND_DENIED` | "Estorno negado(Somente para boletos)." | — |
| `PAYMENT_CHARGEBACK_REQUESTED` | "Recebido chargeback." | chargeback aberto |
| `PAYMENT_CHARGEBACK_DISPUTE` | "Em disputa de chargeback (caso sejam apresentados documentos para contestação)." | disputa em curso |
| `PAYMENT_AWAITING_CHARGEBACK_REVERSAL` | "Disputa vencida, aguardando repasse da adquirente." | ganhamos a disputa |

### 4.2 `PAYMENT_CONFIRMED` vs `PAYMENT_RECEIVED` — a diferença sutil que importa

**FATO DOCUMENTADO:**
- `PAYMENT_CONFIRMED` = "pagamento efetuado, **porém, o saldo ainda não foi disponibilizado**".
- `PAYMENT_RECEIVED` = "**Valor disponível na conta Asaas**".

O intervalo entre os dois **não é simbólico**, e a doc dá os números:

> "**Cobrança recebida em Cartão de Crédito, sem atraso:** `PAYMENT_CREATED` → `PAYMENT_CONFIRMED` → `PAYMENT_RECEIVED` **(32 dias após `PAYMENT_CONFIRMED`)**"
> "**Cobrança recebida em Cartão de Débito, sem atraso:** `PAYMENT_CREATED` → `PAYMENT_CONFIRMED` → `PAYMENT_RECEIVED` **(3 dias após `PAYMENT_CONFIRMED`)**"
> — <https://docs.asaas.com/docs/webhook-para-cobrancas>

**INFERÊNCIA, mas é a decisão central do SCRUM-281:** se o provisionamento esperar `PAYMENT_RECEIVED`, o cliente que paga no cartão fica **32 dias sem acesso**. Liberar acesso em `PAYMENT_CONFIRMED`; usar `PAYMENT_RECEIVED` só para conciliação financeira/liquidação. E o inverso também é armadilha: **Pix não emite `PAYMENT_CONFIRMED`** (ver 5.1) — quem escutar só `CONFIRMED` nunca libera cliente Pix.

### 4.3 Fluxos completos por meio de pagamento — **FATO DOCUMENTADO, literal**

```
Boleto, sem atraso:     PAYMENT_CREATED > PAYMENT_CONFIRMED > PAYMENT_RECEIVED
Boleto, com atraso:     PAYMENT_CREATED > PAYMENT_OVERDUE > PAYMENT_CONFIRMED > PAYMENT_RECEIVED
Pix, sem atraso:        PAYMENT_CREATED → PAYMENT_RECEIVED
Pix, com atraso:        PAYMENT_CREATED → PAYMENT_OVERDUE → PAYMENT_RECEIVED
Cartão Crédito:         PAYMENT_CREATED → PAYMENT_CONFIRMED → PAYMENT_RECEIVED (32 dias depois)
Cartão Débito:          PAYMENT_CREATED → PAYMENT_CONFIRMED → PAYMENT_RECEIVED (3 dias depois)
Cartão c/ atraso:       PAYMENT_CREATED → PAYMENT_OVERDUE → PAYMENT_CONFIRMED → PAYMENT_RECEIVED
Estorno na confirmação: PAYMENT_CREATED → PAYMENT_CONFIRMED → PAYMENT_REFUNDED
Estorno pós-recebido:   PAYMENT_CREATED → PAYMENT_CONFIRMED → PAYMENT_RECEIVED → PAYMENT_REFUNDED
Estorno Boleto/Pix:     PAYMENT_CREATED → PAYMENT_RECEIVED → PAYMENT_REFUNDED
Chargeback (ganho p/ nós):  ... → PAYMENT_CHARGEBACK_REQUESTED → PAYMENT_CHARGEBACK_DISPUTE → PAYMENT_AWAITING_CHARGEBACK_REVERSAL → PAYMENT_CONFIRMED ou PAYMENT_RECEIVED
Chargeback (ganho p/ cliente): ... → PAYMENT_CHARGEBACK_REQUESTED → PAYMENT_CHARGEBACK_DISPUTE → PAYMENT_REFUNDED
Chargeback sem disputa:     ... → PAYMENT_CHARGEBACK_REQUESTED → PAYMENT_REFUNDED
Confirmado em dinheiro:     PAYMENT_CREATED → PAYMENT_RECEIVED (billingType = RECEIVED_IN_CASH)
```
> "É importante frisar que sempre que a cobrança sofrer atraso de vencimento, ela passará pelo status `PAYMENT_OVERDUE`."
> — mesma página

⚠️ Note no fluxo de chargeback: o mesmo pagamento pode emitir `PAYMENT_CONFIRMED`/`PAYMENT_RECEIVED` **duas vezes** (uma no pagamento, outra na reversão da disputa). São eventos com `id` diferente. **Idempotência por `payment.id` + tipo de evento não basta — a chave tem que ser o `id` do evento.**

### 4.4 Lista completa dos eventos de cobrança

Além dos acima: `PAYMENT_AWAITING_RISK_ANALYSIS`, `PAYMENT_APPROVED_BY_RISK_ANALYSIS`, `PAYMENT_REPROVED_BY_RISK_ANALYSIS`, `PAYMENT_AUTHORIZED` ("Pagamento em cartão que foi autorizado e precisa ser capturado"), `PAYMENT_UPDATED`, `PAYMENT_CREDIT_CARD_CAPTURE_REFUSED` ("Falha no pagamento de cartão de crédito"), `PAYMENT_ANTICIPATED`, `PAYMENT_DELETED`, `PAYMENT_RESTORED`, `PAYMENT_RECEIVED_IN_CASH_UNDONE`, `PAYMENT_DUNNING_RECEIVED`, `PAYMENT_DUNNING_REQUESTED`, `PAYMENT_BANK_SLIP_CANCELLED`, `PAYMENT_BANK_SLIP_VIEWED`, `PAYMENT_CHECKOUT_VIEWED`, `PAYMENT_SPLIT_CANCELLED`, `PAYMENT_SPLIT_DIVERGENCE_BLOCK`, `PAYMENT_SPLIT_DIVERGENCE_BLOCK_FINISHED`.

### 4.5 Eventos de assinatura (entidade, não cobrança)

Fonte: <https://docs.asaas.com/docs/eventos-para-assinaturas>

`SUBSCRIPTION_CREATED`, `SUBSCRIPTION_UPDATED`, `SUBSCRIPTION_INACTIVATED`, `SUBSCRIPTION_DELETED`, `SUBSCRIPTION_SPLIT_DISABLED`, `SUBSCRIPTION_SPLIT_DIVERGENCE_BLOCK`, `SUBSCRIPTION_SPLIT_DIVERGENCE_BLOCK_FINISHED`.

⚠️ **Não existe evento de "assinatura paga" nem de "assinatura renovada".** A confirmação de dinheiro vem sempre pelos `PAYMENT_*` da cobrança gerada pela assinatura. O vínculo é o campo `payment.subscription` (ex.: `"subscription": "sub_VXJBYgP2u0eO"`) presente no payload de cobrança. — <https://docs.asaas.com/docs/webhook-para-cobrancas>

### 4.6 Campo `account` no payload — relevante para multi-tenant

O payload de cobrança traz:
```json
"account": { "id": "47ed0d25-f9fb-4b35-b23a-d8895caf92b7", "ownerId": null }
```
— <https://docs.asaas.com/docs/webhook-para-cobrancas>

A semântica exata de `account.id` / `ownerId` (conta principal vs. subconta) é **NÃO DOCUMENTADA** nas páginas de webhook. **INFERÊNCIA:** para o nosso caso (Torque cobrando as orgs a partir de **uma** conta Asaas), o discriminador de tenant não é esse campo — é `payment.externalReference`, que o payload expõe e nós controlamos na criação da cobrança (`"externalReference":"056984"` no exemplo oficial).

---

## 5. PIX × CARTÃO — o fluxo de evento difere?

### 5.1 Pix pula o `PAYMENT_CONFIRMED` — **FATO DOCUMENTADO**

```
Pix:            PAYMENT_CREATED → PAYMENT_RECEIVED
Cartão crédito: PAYMENT_CREATED → PAYMENT_CONFIRMED → PAYMENT_RECEIVED (32 dias depois)
```
— <https://docs.asaas.com/docs/webhook-para-cobrancas>

Faz sentido com a semântica: no Pix o dinheiro cai na hora, então "confirmado" e "recebido" colapsam num evento só. No cartão, existe um mês de intervalo entre os dois.

**INFERÊNCIA (a regra prática):** o gatilho de provisionamento tem que aceitar **`PAYMENT_CONFIRMED` OU `PAYMENT_RECEIVED`**, o que vier primeiro, com deduplicação por `payment.id`. Escutar só um dos dois quebra metade dos meios de pagamento.

### 5.2 Pix tem evento próprio? — **Para Pix comum (QR Code dinâmico): NÃO.**

Não há eventos `PIX_*` para cobrança Pix comum. Pix aparece como `billingType: "PIX"` dentro dos eventos `PAYMENT_*`, e o payload tem um campo `pixTransaction` (no exemplo oficial vem `null` porque o exemplo é de cartão).
— <https://docs.asaas.com/docs/webhook-para-cobrancas>, <https://docs.asaas.com/docs/cobrancas-via-pix>

**Existem** eventos `PIX_*`, mas são de **Pix Automático** (produto distinto, jornada de autorização do Banco Central), não de cobrança Pix comum:
`PIX_AUTOMATIC_RECURRING_ELIGIBILITY_UPDATED`, `PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CREATED` / `_ACTIVATED` / `_CANCELLED` / `_EXPIRED` / `_REFUSED`, `PIX_AUTOMATIC_RECURRING_PAYMENT_INSTRUCTION_CREATED` / `_SCHEDULED` / `_REFUSED` / `_CANCELLED`.
— <https://docs.asaas.com/docs/eventos-para-pix-autom%C3%A1tico>

Se o Torque **não** for usar Pix Automático, esses eventos são ruído — não assinar.

### 5.3 Cartão recorrente reenvia evento a cada ciclo? — **FATO DOCUMENTADO: sim, via cobrança nova.**

Não existe um "evento de renovação". A assinatura **gera uma cobrança nova** a cada ciclo, e essa cobrança emite o ciclo completo de eventos `PAYMENT_*` normalmente:

> "Utilize Webhooks para acompanhar os pagamentos das **cobranças geradas pela assinatura**."
> "**Não considere a validação inicial do cartão como garantia de aprovação das cobranças futuras.**"
> — <https://docs.asaas.com/docs/criando-assinatura-com-cartao-de-credito>

> "[emissão de notas fiscais; envio de notificações; processamento de Webhooks] devem considerar que **novas cobranças poderão ser criadas e processadas automaticamente sem novas chamadas para criação da assinatura**."
> — mesma página

Ou seja: por ciclo mensal, cada assinatura ativa produz no mínimo `PAYMENT_CREATED` + `PAYMENT_CONFIRMED` (+ `PAYMENT_RECEIVED` 32 dias depois, no cartão). **INFERÊNCIA de volume:** 89 orgs × ~3 eventos relevantes/ciclo ≈ 270 eventos/mês no caminho feliz — volume trivial. O risco não é vazão; é a fila travar.

Eventos de falha de cartão recorrente: `PAYMENT_CREDIT_CARD_CAPTURE_REFUSED` ("Falha no pagamento de cartão de crédito") e o trilho de risco (`PAYMENT_AWAITING_RISK_ANALYSIS` → `_APPROVED_BY_` / `_REPROVED_BY_RISK_ANALYSIS`). **Não há evento documentado de "retentativa de cobrança de assinatura"** — a política de retentativa de cobrança recorrente do Asaas (distinta da retentativa de *webhook*) é **NÃO DOCUMENTADA** nas páginas consultadas.

---

## 6. Inventário do que ficou NÃO DOCUMENTADO

Registro explícito — cada um destes é uma lacuna real, não uma busca preguiçosa:

1. **Assinatura HMAC do corpo** — não existe. Nenhum header, algoritmo ou segredo de assinatura em nenhuma página.
2. **Formato / comprimento máximo do `id` do evento** — só exemplos (um deles com `&` e ~50 chars). Sem contrato formal.
3. **Timezone do `dateCreated`** — string `"2024-06-12 16:45:03"` sem offset nem menção a fuso.
4. **Número de sequência / offset / versão do evento** — não existe. Ordem só via `sendType: SEQUENTIALLY`.
5. **Semântica de `account.id` vs `account.ownerId`** no payload de webhook.
6. **Como "15 falhas consecutivas" é contado no modo `NON_SEQUENTIALLY`** (por evento? por fila?).
7. **IPs de origem em Sandbox** — a doc admite que existem outros e não os lista.
8. **Rate limit numérico** do endpoint de remover penalização — só "mais restrito".
9. **Política de retentativa de *cobrança* recorrente** (cartão recusado → quando o Asaas tenta de novo).
10. **API de logs de entrega** — declaradamente inexistente; só interface web.
11. **Se o `authToken` pode ser rotacionado via `PUT`** sem recriar o webhook — não afirmado.

---

## 7. Implicações de desenho (INFERÊNCIA — insumo para a decisão do CTO, não é doc)

Cinco consequências que caem direto do que está documentado:

1. **Nunca devolver não-200.** Nem `204`, nem `500` em erro de negócio. Handler responde `200` assim que persistir o evento; erro de processamento vira estado na nossa tabela, nunca status HTTP. Motivo: 15 não-200 consecutivos pausam a fila, e em `SEQUENTIALLY` um evento envenenado congela as 89 orgs.
2. **Persistir cru antes de processar.** `INSERT` do payload inteiro com `UNIQUE` no `id` do evento → `200` → worker assíncrono. É literalmente o padrão que o Asaas publica, e resolve de uma vez idempotência, o timeout de 10s e o head-of-line blocking.
3. **O corpo não é fonte de verdade financeira.** Token estático sem assinatura = forjável e replayável. Reconsultar `GET /v3/payments/{id}` antes de provisionar.
4. **Gatilho de acesso = `PAYMENT_CONFIRMED` OU `PAYMENT_RECEIVED`.** Esperar `RECEIVED` = 32 dias de espera no cartão. Escutar só `CONFIRMED` = cliente Pix nunca liberado.
5. **A fila pausada é o modo de falha caro, e é silencioso pra nós.** Não há API de log de entrega; o aviso é e-mail. Precisa de um cron que leia `GET /v3/webhooks` e alarme em `interrupted: true` / `penalizedRequestsCount > 0`, num canal que alguém lê. E o relógio de 14 dias apaga evento de dinheiro.

---

## Apêndice — páginas consultadas

| Página | URL | `updatedAt` |
|---|---|---|
| Introdução - Webhooks | <https://docs.asaas.com/docs/sobre-os-webhooks> | 2026-06-25 |
| Como implementar idempotência em Webhooks | <https://docs.asaas.com/docs/como-implementar-idempotencia-em-webhooks> | 2026-06-22 |
| Tipos de envio | <https://docs.asaas.com/docs/tipos-de-envio> | 2026-06-22 |
| Penalização de filas | <https://docs.asaas.com/docs/penaliza%C3%A7%C3%A3o-de-filas> | 2026-06-22 |
| Fila pausada | <https://docs.asaas.com/docs/fila-pausada> | 2026-06-22 |
| Como reativar fila interrompida | <https://docs.asaas.com/docs/como-reativar-fila-interrompida> | 2026-06-22 |
| FAQ de Webhooks | <https://docs.asaas.com/docs/faq-de-webhooks> | 2026-06-22 |
| Receba eventos no seu endpoint | <https://docs.asaas.com/docs/receba-eventos-do-asaas-no-seu-endpoint-de-webhook> | 2026-06-22 |
| Criar novo Webhook pela API | <https://docs.asaas.com/docs/criar-novo-webhook-pela-api> | 2026-06-19 |
| Eventos de Webhooks | <https://docs.asaas.com/docs/eventos-de-webhooks> | 2026-06-22 |
| Eventos para cobranças | <https://docs.asaas.com/docs/webhook-para-cobrancas> | 2026-06-19 |
| Eventos para assinaturas | <https://docs.asaas.com/docs/eventos-para-assinaturas> | 2026-06-19 |
| Eventos para Pix Automático | <https://docs.asaas.com/docs/eventos-para-pix-autom%C3%A1tico> | — |
| Logs de Webhooks | <https://docs.asaas.com/docs/logs-de-webhooks> | 2026-06-22 |
| IPs oficiais do Asaas | <https://docs.asaas.com/docs/ips-oficiais-do-asaas> | 2026-06-22 |
| Cobranças via Pix / QR Code dinâmico | <https://docs.asaas.com/docs/cobrancas-via-pix> | 2025-09-08 |
| Criando assinatura com cartão de crédito | <https://docs.asaas.com/docs/criando-assinatura-com-cartao-de-credito> | — |
| Referência: Criar novo webhook | <https://docs.asaas.com/reference/criar-novo-webhook> | — |
| Referência: Atualizar webhook existente | <https://docs.asaas.com/reference/atualizar-webhook-existente> | — |
| Referência: Remover penalização | <https://docs.asaas.com/reference/remover-penalizacao-webhook> | — |
