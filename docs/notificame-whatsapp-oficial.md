# NotificaMe — WhatsApp oficial: envio, recebimento, templates

**Levantado em 2026-08-18.** Duas fontes independentes, conferidas entre si:
doc do fornecedor (`app.notificame.com.br/docs/api.md`) e node oficial
`n8n-nodes-notificame-hub@0.3.3`. Onde divergem, está anotado.

> ⚠️ **Regra que atravessa tudo:** o fornecedor **mente no status HTTP**. Falha de
> autenticação vem `404`; erro da Meta vem `200` com o erro dentro do corpo;
> método não permitido vem `200` com `METHOD_NOT_ALLOWED`. **Decidir sempre pelo
> CORPO** — é o que `parseNotificameBody` faz.

## Autenticação e identificadores

| Coisa | O que é | Onde entra |
|---|---|---|
| `X-Api-Token` | token da **subconta** (é o `company_uuid`) | header de toda chamada |
| `from` | **id do canal** (não é telefone, não é a subconta) | corpo do envio |
| `channelToken` | **token do canal** — distinto do id | URL de templates e no `criteria` da subscription |

O `company_uuid` **é credencial**: com ele sozinho se lista canais e se envia
mensagem. Tratar como segredo.

## 1. Envio — `POST /v2/channels/whatsapp/messages`

Envelope sempre `{ from, to, contents: [ … ] }`, com `contents` array mesmo para
um item só.

### Texto
```json
{ "type": "text", "text": "Mensagem" }
```

### Arquivo — imagem, vídeo, áudio, documento, sticker
```json
{ "type": "file", "fileMimeType": "image|video|audio|document|sticker",
  "fileUrl": "https://…", "fileCaption": "Legenda" }
```

⚠️ **O `type` é sempre `"file"`**; quem discrimina é `fileMimeType`. A forma
intuitiva (`type:"image"`, `url`, `caption`) é aceita no corpo e **recusada no
envio** — foi o defeito do PR #1627.

**Áudio como GRAVAÇÃO e não anexo:** acrescentar `"voice": true`. Existe **só no
WhatsApp** — a doc não o traz em Instagram, Facebook, Telegram nem Mercado Livre.

### Localização
```json
{ "type": "location", "latitude": -48.310882, "longitude": -25.510785,
  "name": "Local", "address": "Endereço" }
```

### Botões (até 3)
```json
{ "type": "interactive", "interactive": { "type": "button",
  "body": { "text": "Texto" },
  "action": { "buttons": [ { "type": "reply", "reply": { "id": "1", "title": "Botão" } } ] } } }
```

### Lista
```json
{ "type": "interactive", "interactive": { "type": "list",
  "body": { "text": "Selecione" },
  "action": { "button": "Menu",
    "sections": [ { "title": "Seção", "rows": [ { "id": 1, "title": "Opção", "description": "Desc" } ] } ] } } }
```

### CTA com URL
```json
{ "type": "interactive", "interactive": { "type": "cta_url",
  "body": { "text": "Visite" },
  "action": { "name": "cta_url",
    "parameters": { "display_text": "Clique", "url": "https://…" } } } }
```

### Contato, reação, digitando, resposta citada
```json
{ "type": "contacts", "contacts": [ { "name": { "formatted_name": "Nome" },
                                      "phones": [ { "phone": "+55…", "wa_id": "55…" } ] } ] }
{ "type": "reaction", "reaction": { "message_id": "{{wamid}}", "emoji": "😀" } }
{ "type": "typing" }
```
Resposta citada é **fora** do `contents`, no corpo raiz:
`{ "messageId": "{{providerMessageId}}", "reply": true, "contents": [ … ] }`

## 2. Recebimento

### Registrar — `POST /v1/subscriptions/`
```json
{ "criteria": { "channel": "{{TOKEN_do_canal}}" },
  "webhook": { "url": "https://…", "url2": "opcional" } }
```

⚠️ **`criteria.channel` é o TOKEN do canal, não a palavra `"whatsapp"`.** Assinar
a palavra é aceito **calado**, não assina nada, e o sintoma é idêntico a "ninguém
mandou mensagem". Custou um dia na fatia do Instagram.

### Payload de entrada
```json
{ "from": "{{id_do_canal}}", "to": "{{número_remetente}}",
  "contents": "{JSON serializado}", "id": "{{id_da_mensagem}}",
  "direction": "IN", "visitor": { "name": "…", "firstName": "…" } }
```

⚠️ Duas armadilhas já pagas, **iguais às do Instagram**:
- `contents` chega **serializado como string**, não como objeto.
- `visitor.name` é o **@/identificador**; `visitor.firstName` é o **nome humano**.
  A inversão é do fornecedor.

**É o mesmo formato do Instagram** — o que significa que o parser de entrada que
já existe (`_shared/notificame-inbound.ts`) serve para os dois; o que muda é só o
endereçamento da linha (`instance_id` vs `messaging_channel_id`).

Tipos de evento: `text`, `file`, `interactive`, `reaction`, `location`,
`contacts`.

## 3. Templates

| Ação | Método | Rota |
|---|---|---|
| Criar | POST | `/v1/templates/{{channelToken}}` |
| Listar (e ver status) | GET | `/v1/templates/{{channelToken}}` |
| Excluir | DELETE | `/v2/channels/whatsapp/templates/{{channel_id}}/{{template_name}}` |
| Enviar | POST | `/v2/channels/whatsapp/messages` |

⚠️ Criar e listar usam **`channelToken` na URL**; excluir usa **`channel_id`**.
São identificadores diferentes e a doc não avisa.

### Criar
```json
{ "from": "{{channelToken}}",
  "contents": [ { "template": { "name": "template_api", "language": "pt_BR",
    "category": "MARKETING",
    "components": [
      { "type": "HEADER", "format": "TEXT", "text": "Bem vindo, {{1}}!",
        "example": { "header_text": ["Valor"] } },
      { "type": "BODY", "text": "Criando um {{1}} pela API.",
        "example": { "body_text": [["template"]] } },
      { "type": "BUTTONS", "buttons": [ { "type": "QUICK_REPLY", "text": "Botão" } ] }
    ] } } ] }
```
Resposta: `{ "id": "…", "status": "PENDING", "category": "MARKETING" }`

### Status de aprovação
`PENDING` → `APPROVED` | `REJECTED`. **Sai na listagem** — não há endpoint
dedicado de consulta por template. A aprovação é da Meta e leva de minutos a
horas: quem cria um template **não pode** enviá-lo em seguida.

### Enviar template
```json
{ "type": "template", "template": { "name": "…",
  "language": { "code": "pt_BR" },
  "components": [ { "type": "body",
    "parameters": [ { "type": "text", "text": "valor" } ] } ] } }
```
Botão vira `{ "type": "button", "sub_type": "url", "index": 0, "parameters": [ … ] }`.
Parâmetro nomeado: `{ "type": "text", "parameter_name": "nome", "text": "valor" }`.

## 4. Janela de 24 horas

> *"precisa estar dentro do período de mensagens (até 24 horas após a última
> resposta do destinatário)"*

- **Dentro** da janela: texto livre, qualquer tipo de conteúdo.
- **Fora**, ou para iniciar conversa: **só template aprovado**.

É por isso que `sendTemplate` é a válvula de escape que a regra P5 do
`send-governor` pressupõe: sem ela, automação em canal oficial com janela fechada
não tem por onde sair.

## 5. Outros

| Função | Método | Rota |
|---|---|---|
| Upload de arquivo para a Meta | POST | `/v2/channels/meta/upload` |
| Saúde do número | POST | `/v2/meta/health_status` |
| Listar canais da subconta | GET | `/v1/channels` |
| Abrir o Seamless | GET | `/v2/oauth/meta/start?company_uuid=…&type=…` |

**Não existe** endpoint para desconectar/remover canal, nem para excluir
subconta — confirmado na doc e no node. Subconta é **irremovível e faturável**.

⚠️ `channels: N` em `GET /v1/resale/` é **cota** (`number_channels`), não canal
liberado. Cota esgotada faz o Seamless responder `channel limit exceeded`
(Instagram) ou o enganoso `Nenhum canal de whatsapp liberado`.

## 6. Realtime

O fornecedor **não** oferece websocket/SSE. O tempo real é: webhook dele →
`notificame-webhook` → `channel_messages` → Supabase Realtime (postgres_changes)
→ front. O elo em tempo real é **nosso**, não dele.

## O que o Torque já implementa

Atualizado em 2026-08-20, depois das fatias F1–F6.

| Capacidade | Estado |
|---|---|
| Enviar texto e mídia (envelope `file`) | ✅ |
| `voice: true` no áudio de WhatsApp | ✅ |
| Enviar figurinha (`fileMimeType: "sticker"`) | ✅ WebP vira figurinha no canal oficial |
| Enviar template, criar e listar | ✅ |
| **Botões de template** (`QUICK_REPLY`/`URL`/`PHONE_NUMBER`) | ✅ — `URL` e `PHONE_NUMBER` **não medidos** contra a conta |
| Botões, listas e CTA (mensagem interativa) | ✅ dentro da janela de 24h |
| Localização e contato | ✅ |
| Reagir a uma mensagem | ✅ |
| Responder citando | ✅ |
| Balão de digitando | ✅ |
| Receber (texto, mídia, reação, localização, contato, botão, `postback`) | ✅ |
| Download de arquivo do CDN | ✅ espelhado no nosso storage |
| Saúde do número | ✅ formato da resposta **não medido** |
| Bloquear / desbloquear / listar bloqueados | ✅ formato da resposta **não medido** |
| Criar e listar convite de opt-in | ✅ formato da resposta **não medido** |
| Marcar como lida | ❌ **não existe na doc do fornecedor** — procurado no índice e no corpo |
| Editar, fixar e apagar mensagem | ❌ a Cloud API não expõe |

### Três asserções falsas que estavam no código

Valem como aviso: as três diziam que uma capacidade não existia, nenhuma tinha
sido medida, e as três estavam erradas.

- *"o canal oficial não tem figurinha, e mapeá-la seria adivinhar"* — a doc tem
  a seção "Enviar um sticker", com o campo nomeado.
- *"botões, listas, CTA — NotSupportedError"* — a doc traz os três envelopes.
- *"o canal oficial não tem digitando…"* — a doc tem "Balão de digitando".

### Duas divergências conscientes da doc

- A seção de **resposta citada** manda `"to": "whatsapp"` — a palavra, não o
  número. É o único envelope de mensagem do documento com essa forma, vizinho do
  endpoint de download, de onde provavelmente foi copiada. Mandamos o número:
  `normalizeNotificameRecipient` derruba não-dígitos, e seguir a doc garantiria
  `invalid_recipient` antes do envio.
- A seção do **balão de digitando** traz um `messageId` comentado como "id da
  mensagem que você ira responder" — texto copiado da seção acima. Um balão não
  responde a nada, e mandar o campo propagaria o erro do fornecedor.

### Uma armadilha silenciosa

Criar e listar **convite de opt-in** usam o mesmo `type: "list"`. O que distingue
é a presença de `signup_content`: um corpo de criação sem ele vira uma listagem,
sem erro nenhum.
