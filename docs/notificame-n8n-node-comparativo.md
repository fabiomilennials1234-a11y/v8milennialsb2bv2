# O que os nodes do n8n revelam sobre Instagram/WhatsApp — NotificaMe vs Meta vs concorrentes

**Data:** 2026-08-15
**Pergunta:** o que dá para aprender, sobre a integração de Instagram e WhatsApp, lendo
os nodes do n8n — e o que isso muda para o detector de leads duplicados e para a
decisão de continuar (ou não) atrás do NotificaMe.

**Método:** fontes primárias apenas — código do node publicado pelo fornecedor,
descritores de nodes lidos via MCP do n8n, e documentação de primeira mão da Meta.
Nada de write-up secundário. Cada afirmação abaixo aponta para onde foi medida.

---

## Resumo em cinco linhas

1. Existe um node do **próprio NotificaMe**, encomendado por eles — é o contrato deles
   escrito em código, e vale mais que a doc (que já apareceu em duas versões divergentes).
2. O NotificaMe **não expõe perfil de contato em lugar nenhum**. Um concorrente direto
   expõe, e a Meta suporta. É o buraco que obriga o detector a depender de telefone digitado.
3. A Meta assina todo webhook com **HMAC SHA256**. O NotificaMe **não assina** — e o node
   deles confirma, porque o "Definir Webhook" recebe duas URLs e nenhum segredo.
4. Mesmo indo direto na Meta, **não se obtém telefone nem e-mail** de um usuário de
   Instagram. O que se ganha é o **`username` (@handle)**, que hoje não chega.
5. O pacote do fornecedor aponta para **dois hosts diferentes** — o mesmo sintoma de
   documentação bifurcada que já tínhamos medido.

---

## Eixo A — Autenticidade do webhook (quem garante que a mensagem é real)

| | Meta (oficial) | NotificaMe | Fiwano (concorrente) |
|---|---|---|---|
| Assinatura do corpo | `X-Hub-Signature-256`, HMAC SHA256 sobre o payload inteiro, com o App Secret | **nenhuma** | segredo por canal, configurável |
| Handshake de verificação | `hub.mode` + `hub.challenge` + `hub.verify_token` | não aplicável | — |
| Como se protege hoje no Torque | — | segredo no **caminho** da URL | — |

- Meta: *"We sign all Event Notification payloads with a SHA256 signature and include the
  signature in the request's `X-Hub-Signature-256` header, preceded with `sha256=`."*
  — `developers.facebook.com/docs/graph-api/webhooks/getting-started`
- NotificaMe: o node do fornecedor define o webhook com os campos `webhookUrl` e
  `webhookUrl2` e **nada mais** — não há campo de segredo, token ou assinatura.
  — `nodes/NotificaMeHub/fields/revenda/DefinirWebhook.fields.ts`
- Fiwano: operação *"Update Webhook — Update the webhook URL and/or secret for a channel"*.
  — descritor do node `n8n-nodes-fiwano.fiwano`

**O que isso confirma:** a decisão de o `notificame-webhook` **nunca criar lead** não era
conservadorismo — é a única resposta correta para um endpoint sem autenticidade de conteúdo.
Segredo no caminho da URL prova que quem chamou conhece o segredo; assinatura prova que o
**corpo** não foi forjado nem alterado. São garantias diferentes, e só temos a primeira.

**O que isso abre:** um concorrente da mesma categoria oferece segredo por canal. Ou seja,
não é limitação da categoria "agregador" — é limitação **deste** fornecedor. Vira pedido
concreto: assinatura HMAC do corpo, ou o Instagram vai direto na Meta.

---

## Eixo B — Identidade do contato (o que ataca o detector direto)

| | Meta (oficial) | NotificaMe | Fiwano |
|---|---|---|---|
| Buscar perfil do contato | `GET graph.facebook.com/v25.0/<IGSID>` | **não existe** | *"Get Profile — Fetch sender profile from Meta (Instagram & Facebook only)"* |
| Campos | `name`, `username`, `profile_pic`, `is_verified_user`, `follower_count`, `is_user_follow_business`, `is_business_follow_user` | — | (repassa os da Meta) |
| Telefone / e-mail | **não** | não | não |

- Meta: campos e endpoint em
  `developers.facebook.com/docs/messenger-platform/instagram/features/user-profile`.
  Exige consentimento, e o consentimento nasce **exatamente do ato de a pessoa mandar
  mensagem para o negócio** — que é o nosso caso. Não funciona se a pessoa bloqueou a conta.
- NotificaMe: o node cobre Instagram com sete operações — enviar texto, áudio, arquivo,
  responder comentário, template de botões, publicar post, listar postagens. **Nenhuma**
  de leitura de perfil. Não há recurso `contact` no node inteiro.
  — `nodes/NotificaMeHub/operations/instagram/Instagram.operations.ts`

**O achado que mais importa:** *a Meta não dá telefone de usuário de Instagram — para
ninguém.* Isso encerra a hipótese de que existiria um atalho oficial ligando IG a WhatsApp.
O extrator de telefone do texto da conversa (`src/lib/extractPhones.ts`) não é contorno;
é o caminho.

**O que ainda assim se ganha:** o `username` — o @ da pessoa. Para o detector ele vale por
dois motivos: casa com o que o vendedor já anotou no lead ("cliente do @loja.da.ana") e é
**evidência citável na tela**, no mesmo padrão do telefone — o vendedor confere, em vez de
aceitar um percentual.

⚠️ **Mas não sabemos se ele chega.** O parser do inbound já procura o handle do
interlocutor em cinco aliases (`contact.username`, `contact.handle`, `from.username`,
`sender.username`, `profile.username`) e devolve `null` quando nenhum casa
— `supabase/functions/_shared/notificame-inbound.ts`. Quem afirma que o fornecedor não
manda é um comentário da migration, não uma medição. Ver "O que ainda não foi observado".

---

## Eixo C — Sinais de saúde e risco de bloqueio

O `WhatsApp Trigger` core do n8n lista os eventos oficiais que a Meta emite:

> Account Review Update · Account Update · Business Capability Update · Message Template
> Quality Update · Message Template Status Update · Messages · Phone Number Name Update ·
> **Phone Number Quality Update** · Security · Template Category Update

— documentação do node `nodes-base.whatsAppTrigger`

Os eventos de **qualidade** (número e template) são o aviso antecipado de degradação —
o sinal que chega *antes* da limitação de envio. Nada disso é consumido hoje pelo Torque, e
nenhum deles aparece no node do NotificaMe, que não tem trigger nenhum.

Também documentado ali, e relevante para arquitetura: *"WhatsApp only allows you to register
a single webhook per app"* — um webhook por app, o que empurra o roteamento multi-tenant
para dentro da nossa aplicação.

---

## Eixo D — Superfície que o fornecedor tem e o Torque não usa

O node do fornecedor expõe, e hoje não consumimos:

- **WhatsApp:** sticker, localização, mensagem com listas, CTA/link, **reagir** a mensagem,
  **responder** (citar) mensagem, criar/listar templates.
- **Instagram:** **responder comentário**, template de botões, publicar post, listar posts.
- **Revenda:** listar subcontas e definir webhook.

Rotas do Torque hoje: `POST /v2/accounts`, `GET /v1/resale/`, `/v1/channels`, `/v2/channels`,
`/v2/templates`, `POST /v1/subscriptions` — todas em `api.notificame.com.br`, autenticadas
por header `X-Api-Token`.
— `supabase/functions/_shared/notificame.ts`

**Responder comentário de Instagram** é o item comercialmente mais interessante da lista:
é o caminho de "comentou no anúncio → vira conversa no direct", que é literalmente o funil
de entrada do ICP via Meta Ads.

---

## Achado colateral: o fornecedor aponta para dois hosts

Dentro do **mesmo pacote**:

- teste de credencial → `https://api.notificame.com.br/v1` (`credentials/NotificaMeHubApi.credentials.ts`)
- todas as operações → `https://hub.notificame.com.br/v1` (`nodes/NotificaMeHub/NotificaMeHub.node.ts`)

O Torque usa `api.`. É o mesmo sintoma da documentação bifurcada já registrada (dois hosts,
tamanhos e conteúdos diferentes, ambos respondendo). Não é bug conhecido nosso — é um risco
de contrato: se os hosts divergirem em versão, a superfície que testamos não é a que roda.

**Refutado no caminho:** cogitei que o `GET /resale` do node fosse uma rota alternativa capaz
de contornar o bloqueio de revenda (`422 "company não é revenda"` em `/v2/accounts`). Não é —
é exatamente a rota que o Torque já usa para reconciliar subcontas órfãs. O bloqueio é de
permissão da conta, não de caminho.

---

## Validação cruzada: o node do fornecedor CONFIRMA a nossa implementação de templates

Nosso `_shared/notificame-templates.ts` foi escrito a partir da documentação, sem nunca
tocar uma conta viva — e a documentação do fornecedor existe em duas versões divergentes.
O node que eles encomendaram é uma segunda fonte independente, e as duas batem:

| | Node do fornecedor (`transport/whatsapp/*.ts`) | Nosso módulo |
|---|---|---|
| Listar | `GET /templates/{channelToken}` + `X-Api-Token` | `GET /v1/templates/{channel_id}` + `X-Api-Token` ✅ |
| Criar | `POST /templates/{channelToken}` | `POST /v1/templates/{channel_id}` ✅ |
| Corpo do criar | `{ from, contents: [ { template: { name, language, category, components } } ] }` | idêntico, inclusive a repetição do canal em `from` ✅ |

A redundância do `from` — que no nosso código está marcada como "as duas redundâncias do
fornecedor que parecem engano" — **é real**: o node oficial repete o mesmo valor na URL e
no corpo. E o `channelToken` do node é o mesmo valor que nós guardamos em
`provider_config.channel_id`: nos envios ele vai no campo `from`, exatamente como no nosso
`buildNotificameEnvelope`.

**Duas divergências que sobram:**

1. **Envio.** O node usa `/v1/channels/{kind}/messages`; nós usamos
   `/v2/channels/{kind}/messages`. Não é necessariamente erro — o cabeçalho do nosso módulo
   registra que `/v2/channels` responde (em texto puro, não JSON), então a v2 existe. Mas
   são versões diferentes da mesma operação, e ninguém verificou qual o fornecedor mantém.
2. **Apagar template.** Nós usamos `DELETE /v2/channels/whatsapp/templates/{canal}/{nome}`.
   O node não implementa apagar — não há segunda fonte para essa rota.

**O que isso muda:** a leitura de templates deixa de ser fé em documentação e passa a ter
confirmação independente. O envio continua sem confirmação, e é o caminho que mais dói se
estiver errado (`Hub404` chega como HTTP 200 com erro dentro).

---

## O que ainda não foi observado — e por que isso limita todo o resto

Medido em prod (`jsjsmuncfkbsbzqzqhfq`) em 2026-08-15:

| Medida | Valor |
|---|---|
| Mensagens de Instagram em prod | 3 |
| Destas, sintéticas inseridas por nós | **3** |
| Payloads que mencionam `username` ou `handle` | 0 (de 3 sintéticos) |

**Nunca chegou uma mensagem real de Instagram.** Tudo o que "sabemos" sobre o formato do
payload vem da documentação do fornecedor — a mesma que existe em duas versões divergentes.
O parser cobre cinco aliases por conta disso: ele foi escrito defensivamente, não a partir
de um exemplo observado.

Consequência prática: os zeros da tabela **não provam** que o fornecedor omite o handle.
Provam que ninguém nunca viu o payload real. É verde por ausência.

**E não existe canal real para receber essa mensagem.** Medido no mesmo dia: o único canal
em toda a base é o sintético `TESTE-ch-sintetico-001` (`inbound=not_applicable`), e há
**zero** canais em qualquer outra org. Conectar um canal passa pelo Embedded Signup, que
depende de `GET /v2/oauth/meta/start` — hoje `401 "Invalid company"` porque a revenda está
desativada.

**Logo o teste que falta tem um pré-requisito operacional, não técnico:** ou a revenda
volta, ou conecta-se um canal **pelo painel web do NotificaMe** (a conta-mãe é uma conta
comum; a revenda só governa a criação de subcontas) e adota-se esse canal na
`messaging_channels` — o mesmo contorno já usado para a subconta `Torque Teste 01`. Com um
canal real ligado, uma única mensagem responde de uma vez se vêm `username`, telefone,
e-mail, e em que formato: o `raw_payload` já é gravado inteiro.

No mesmo espírito: o Torque **ainda não envia nada** pelo NotificaMe. As funções exportadas
cobrem provisionar subconta, listar canais, registrar webhook e receber — não há uma única
chamada de envio (`supabase/functions/_shared/notificame.ts`). Toda a superfície de envio
descrita no Eixo D é território inexplorado, não capacidade subutilizada.

---

## O que os nodes NÃO respondem

Limites de envio por tier, comportamento sob carga, o que exatamente dispara bloqueio, e as
nuances da janela de 24h. Nenhum node carrega isso — sai de doc oficial e de conta viva.

---

## Decisões que este levantamento coloca na mesa

0. **Conseguir um canal real ligado, e então mandar uma mensagem real.** É o pré-requisito
   dos outros três: uma única mensagem revela o payload verdadeiro e substitui documentação
   bifurcada por fato. Não depende de esperar a revenda **se** o canal for conectado pelo
   painel do fornecedor e adotado na `messaging_channels` — o contorno já usado na subconta.
   Enquanto não houver canal real, toda conclusão sobre campos faltantes é leitura de doc.
1. **Pedir HMAC ao NotificaMe** — com um concorrente direto oferecendo segredo por canal, o
   pedido deixa de ser teórico. Enquanto não houver, o webhook segue proibido de criar lead.
2. **Puxar o `username` do Instagram** — se a mensagem real mostrar que ele não vem, restam
   duas saídas: o fornecedor passa a repassar, ou o campo só existe indo direto na Meta. É o
   segundo sinal do detector, ao lado do telefone digitado no texto.
3. **Instagram direto na Meta** — o levantamento mostra o que o intermediário custa: sem
   assinatura de corpo, sem perfil de contato, sem eventos de qualidade. O que ele entrega em
   troca é multi-canal e a revenda.
4. **Responder comentário de Instagram** — capacidade que o fornecedor já expõe, encostada
   no funil de Meta Ads que o ICP usa.
