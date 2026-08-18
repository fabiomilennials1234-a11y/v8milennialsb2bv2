# Fatia — recebimento de WhatsApp oficial via NotificaMe

**Data:** 2026-08-18 · **Origem:** Chique Distribuidora, primeiro cliente com canal
oficial pré-existente.

## O estado que motivou

O envio foi destravado (PR #1640, `ecb32012`). O RECEBIMENTO não existe, e não é
bug: está declarado em `notificame-channel-finish`.

```ts
// SÓ INSTAGRAM: o WhatsApp Oficial do NotificaMe não recebe por esta rota nesta
// fatia, e registrar uma subscription para ele mandaria eventos de WhatsApp para
// um endpoint que só sabe gravar `channel='instagram'` — todos parkados.
if (channelKind === "instagram") {
```

Sintoma para o cliente: manda mensagem, o cliente responde, **a resposta não
aparece no Torque**. Pior que não ter a integração — o vendedor perde a venda
achando que não responderam.

## O que já está pronto (medido, não suposto)

- `channel_type` (enum PG) **já tem `whatsapp`** → sem migration para o enum.
- `channel_messages.messaging_channel_id` e `.instance_id` são ambos **nullable**
  → a linha de WhatsApp aponta por `instance_id`, a de Instagram por
  `messaging_channel_id`. Sem migration.
- O envelope de saída (`buildOutboundChannelMessageRow`) já grava
  `channel: params.channelKind` e já preenche `phone_number` quando é WhatsApp —
  o lado de saída já é bi-canal. Só o INBOUND está chumbado.

## As 5 peças

### 1. `_shared/notificame-inbound.ts` — tirar o `"instagram"` chumbado
- `InboundChannelMessageRow.channel`: `"instagram"` → `"instagram" | "whatsapp"`.
- `buildInboundChannelMessageRow` passa a receber o canal e o ALVO:
  `{ kind: "instagram", messagingChannelId }` | `{ kind: "whatsapp", instanceId }`.
- WhatsApp preenche `phone_number` (o `contact_external_id` é o telefone);
  Instagram mantém `contact_handle`.
- Linhas 549 e 638 são os dois pontos chumbados.

### 2. `notificame-webhook` — resolver canal em DUAS tabelas
- Hoje: `messaging_channels` por `(provider='notificame', external_channel_id)`.
- Falta: `whatsapp_instances` por `(provider='notificame',
  provider_config->>'channel_id')`.
- **Ordem importa**: procurar nas duas e falhar se aparecer nos dois (não deve
  acontecer — o índice único parcial impede — mas silenciar seria adivinhar).
- Manter a busca GLOBAL sem filtro de org e comparar a org depois: é o que
  transforma forja em `channel_org_mismatch` visível em vez de "não achei".

### 3. `notificame-channel-finish` — registrar subscription para WhatsApp
- Remover o gate `if (channelKind === "instagram")`.
- ⚠️ O estado de recebimento hoje mora em `messaging_channels.inbound_subscription_*`
  (migration 20270816120000) e o cron `notificame-subscription-repair` varre ESSA
  tabela. WhatsApp mora em `whatsapp_instances`, que **não tem essas colunas**.

### 4. Migration — `inbound_subscription_*` em `whatsapp_instances`
Mesmas 5 colunas: `status` (CHECK pending|active|failed|not_applicable),
`attempts`, `last_error`, `last_attempt_at`, `next_attempt_at`,
`registered_at`. Guardar em `provider_config` seria repetir o defeito que a
20270816120000 corrigiu: sinal sem leitor.

### 5. `notificame-subscription-repair` — varrer as duas tabelas
O cron é o que torna a recuperação independente de alguém PERCEBER. Sem estender,
uma falha de registro no WhatsApp fica órfã para sempre.

## Ordem de execução sugerida
1 (puro, testável) → 4 (migration) → 3 → 2 → 5. Testes a cada passo.

## Estado da execução

- [x] **Peça 1 — núcleo puro** (PR desta branch). `InboundTarget` discrimina
      Instagram (`messaging_channel_id`) de WhatsApp (`instance_id`);
      `phone_number` preenchido só no WhatsApp. 6 testes novos, 363 no conjunto
      tocado, ratchet 0.
- [x] **Peça 4 — migration** `inbound_subscription_*` em `whatsapp_instances`
      (`20270818150000`). Default `not_applicable` (diverge da irmã de propósito:
      a tabela é majoritariamente Uazapi, que não tem subscription). Ensaiada
      contra prod com ROLLBACK: 140 instâncias, 140 fora da fila. **NÃO APLICADA.**
- [x] **Peça 3 — finish** registra subscription para WhatsApp. O gate virou
      `instagram || whatsapp`; `subscriptionTable` segue o canal; e o `channelKind`
      vai REAL para `registerInboundSubscription` (chumbar "instagram" faria o
      degrau de fallback assinar a palavra errada — aceito calado, não assina nada).
- [ ] **Peça 2 — webhook** resolve canal em `whatsapp_instances`.
      Ponto de entrada: `notificame-webhook/index.ts` ~1108, no ramo `channelHint`.
      Antes de parkar `unresolved_channel`, procurar
      `whatsapp_instances` por `(provider='notificame',
      provider_config->>'channel_id' = channelHint)`. Manter a busca GLOBAL e
      comparar a org depois — é o que faz forja virar `channel_org_mismatch`
      visível. O fallback SEM hint deve seguir só para Instagram: para WhatsApp,
      exigir o hint é o recorte seguro.
- [ ] **Peça 5 — cron repair** varre as duas tabelas.

⚠️ O chamador em `notificame-webhook` está com
`target: { kind: "instagram", … }` FIXO e um comentário apontando para a peça 2.
Enquanto ela não entrar, o comportamento é exatamente o de antes — nenhuma
mensagem de WhatsApp chega, e nenhuma de Instagram muda.

## Armadilhas já pagas nesta fatia — não redescobrir
- O fornecedor chama o canal de **`whatsapp_business_account`**, nunca `whatsapp`.
  Sempre passar por `normalizeSeamlessType`. Foi o bug do #1640, e a terceira
  ocorrência do mesmo padrão (as outras: `fileMimeType`, `vendorDetailFromParse`).
- **Decidir pelo CORPO, nunca por `res.ok`/status**: auth falha vem 404, erro da
  Meta vem 200 com erro dentro.
- Teste que copia o predicado em vez de importá-lo **passa verde com o bug vivo**.
  Aconteceu no #1640. Importar a função real e provar que fica vermelha antes.


## Levantamento da doc (2026-08-18) — o que MUDA no plano

Referência completa em `docs/notificame-whatsapp-oficial.md`, conferida em duas
fontes. Três achados encurtam a fatia:

1. **A subscription é a MESMA rota do Instagram**: `POST /v1/subscriptions/` com
   `{criteria: {channel: "<TOKEN do canal>"}, webhook: {url}}`. Não há rota
   separada por tipo de canal ⇒ `registerInboundSubscription` serve como está.
   ⚠️ `criteria.channel` é o **token** do canal, nunca a palavra `"whatsapp"` —
   assinar a palavra é aceito calado e não assina nada.

2. **O payload de entrada é o MESMO formato**: `{from, to, contents, id,
   direction:"IN", visitor}`, com `contents` serializado como string e
   `visitor.name` = @ / `visitor.firstName` = nome humano. Ou seja: os pickers de
   `notificame-inbound.ts` (`pickContent`, `pickContact`, `pickTimestampIso`)
   valem para os dois canais **sem alteração**. Só o endereçamento da linha muda,
   e isso a peça 1 já resolveu.

3. **O fornecedor não tem realtime** (nem websocket nem SSE). O tempo real é
   nosso: webhook → `channel_messages` → Supabase Realtime → front. Nada a fazer
   nesta fatia.

Consequência prática: a peça 3 vira **remover o gate `if (channelKind ===
"instagram")`** e carimbar o estado nas colunas novas da tabela certa
(`whatsapp_instances` para WhatsApp, `messaging_channels` para Instagram). Não há
contrato novo a descobrir.
