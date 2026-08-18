# Fatia — caixa de entrada do WhatsApp oficial no chat

**Desenhado em 2026-08-18**, por grilling, com 14 decisões fechadas.
Continuação de `.specs/notificame/INBOUND-WHATSAPP.md` (recebimento, concluído).

## O ponto de partida, medido

O recebimento funciona **até o banco** e a mensagem é **invisível na tela**:

```
channel_messages: channel='whatsapp', instance_id=7312692e-…,
                  content='Olá, testando a conexão'   ← existe
```

| Quem | Lê |
|---|---|
| Chat de WhatsApp (`useWhatsAppContacts`) | `whatsapp_messages` |
| Chat social (`useSocialMessages`) | `channel_messages` ← a linha está aqui |

E o seletor de caixa decide o modo social por `kind === "instagram"` — não há caixa
para um WhatsApp-NotificaMe.

## As três saídas, e por que a escolhida

1. **Chat de WhatsApp lê as duas tabelas** — toca o inbox de 30 orgs em produção.
2. **Inbound grava em `whatsapp_messages`** — modelada para Uazapi (JID, instance);
   perderia o que `channel_messages` guarda.
3. **Caixa própria, reusando a view social.** ⇐ ESCOLHIDA. Não mexe no que 30 orgs
   usam hoje, e o caminho de leitura já existe montado.

## As 14 decisões

| # | Decisão | Por quê |
|---|---|---|
| Q1 | Envia pelo caminho normal de WhatsApp (`getWhatsAppProvider` → `NotificameProvider`), **não** por `notificame-send-social` | Aquela rota **recusa WhatsApp por modelo** (`SOCIAIS={instagram,facebook}` ⇒ `channel_not_social`). Reusar a view sem reusar o envio. |
| Q2 | Reusar o `SocialChatView` inteiro, injetando o enviador por prop/estratégia | A view já faz mídia, áudio e composer; só o envio difere. Uma superfície só. |
| Q3 | Corrigir `pickContact` por canal **nesta fatia** | No WhatsApp `visitor.name` é o NOME humano e `firstName` vem vazio — inverso do Instagram. Hoje grava `contact_handle="Gabriel Gipp"`, `sender_name=null`: o contato apareceria sem nome. |
| Q4 | A caixa existe se houver `whatsapp_instances` com `provider='notificame'` e `status='connected'` | Presença do canal é o fato. Flag seria um segundo estado a sincronizar — foi assim que features viraram invisíveis neste produto. |
| Q5 | Hook próprio (`useNotificameWhatsAppSend`), **sem** o upsert local em `whatsapp_messages` | O `useWhatsAppSend` faz upsert otimista em `whatsapp_messages`; herdá-lo partiria a conversa (entrada em `channel_messages`, saída na outra). O provider já grava no lugar certo. |
| Q6 | Contador da janela de 24h **mostra e não bloqueia** (v1) | Bloquear exige a hora da última resposta do cliente com confiança, e essa conta não existe para este canal. Relógio errado deixa o vendedor refém. |
| Q7 | Mídia entra na v1 | Provider já suporta (`fileMimeType`, `voice:true`) e o composer já tem clipe e microfone. Cortar daria trabalho. |
| Q8 | Vínculo de lead pelo caminho **por telefone** que já existe no WhatsApp | Telefone casa com lead direto; usar o fluxo do IGSID ignoraria o identificador forte. |
| Q9 | Invalidação otimista no `onSuccess`, **sem** escrever linha | O `onSuccess` já tem o `message_id` real do provider. Escrever linha recriaria a segunda verdade descartada em Q5. |
| Q10 | Reusar as queryKeys sociais, com `instance_id` na posição do canal | Chave é opaca; `instance_id` é UUID como `messaging_channel_id`, e o `useSocialRealtime` já invalida por prefixo — realtime vem de graça. Documentar que a posição carrega "o id do canal, qualquer que seja a tabela". |
| Q11 | Nome da instância + ícone do WhatsApp + selo **"Oficial"** | `phone_number` está NULL (o `/v1/channels` não devolve), então telefone mostraria vazio. O selo separa do QR na mesma lista. |
| Q12 | Qualquer org com o canal conectado (sem flag) | Q4 já deriva da presença; hoje só a Chique tem, então "qualquer org" e "só a Chique" dão o mesmo resultado sem criar flag para remover depois. |
| Q13 | **Harness de teste do handler do webhook entra na fatia** | `notificame-webhook` tem 200+ linhas de resolução com ZERO testes. Foi a fresta dos três defeitos de 18/08 — inclusive um `if/else` que só apareceu na reinjeção do payload. Sem harness, verificar continua sendo "deploya e manda mensagem". |
| Q14 | **Duas PRs**: (1) `pickContact` + harness · (2) hook de envio + caixa/view | O (1) conserta dado que JÁ entra errado e não depende de UI; o harness protege o resto. A caixa vem sobre terreno testado. |

## PR 1 — dado e rede de proteção

- `pickContact` decide por canal: WhatsApp ⇒ `visitor.name` é nome (vai para
  `sender_name`), `contact_handle` fica nulo; Instagram ⇒ regra atual intocada.
- Harness do handler com Supabase dublado, cobrindo os **quatro ramos** de
  resolução de canal: social por hint · WhatsApp por hint · fallback por org ·
  parked. Incluir o caso do `if/else` que quebrou (`res.data` nulo no ramo do
  WhatsApp) — ele tem de ficar VERMELHO com o código de antes do #1648.

## PR 2 — superfície

- `useNotificameWhatsAppSend`: envia pelo provider, sem upsert local, invalida no
  `onSuccess`.
- Seletor de caixas aceita `kind: "whatsapp_oficial"` derivado de
  `whatsapp_instances` (Q4), com rótulo do Q11.
- `SocialChatView` recebe a estratégia de envio por prop.
- Vínculo de lead por telefone (Q8).

## Armadilhas já pagas — não redescobrir

- `notificame-send-social` **recusa WhatsApp**. Não é bug.
- O envio por `whatsapp_instances` **já funciona** desde o #1640 — não reimplementar.
- `NotificameProvider.persist()` grava a saída em `channel_messages`, não em
  `whatsapp_messages`.
- Normalizar SEMPRE com `normalizeSeamlessType`: o fornecedor diz
  `whatsapp_business_account`. Quatro defeitos em 18/08 saíram de comparar cru.
- Teste que COPIA um predicado em vez de importá-lo passa verde com o bug vivo.
