/**
 * notificame-inbound — TODO o julgamento sobre o corpo de um evento de entrada do
 * NotificaMe, PURO e testável sem rede.
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️ O FORMATO DO EVENTO NÃO FOI OBSERVADO UMA ÚNICA VEZ.                  ║
 * ║                                                                          ║
 * ║  Nenhum canal foi conectado ainda; `channel_messages` tem 10.982 linhas   ║
 * ║  e 100% delas são `channel='whatsapp'`. Zero instagram, zero messenger.   ║
 * ║  Todo alias deste arquivo é DERIVADO DE DOC — e a doc do fornecedor já    ║
 * ║  se provou errada uma vez (duas versões em dois hosts, `hub.` e `app.`).  ║
 * ║                                                                          ║
 * ║  Por isso este módulo é UM arquivo só, puro e sem I/O: quando o primeiro  ║
 * ║  evento real chegar — parkado em `notificame_webhook_events` com o CORPO  ║
 * ║  INTEGRAL —, ajustar o formato é editar ESTE arquivo e mais nenhum. Se    ║
 * ║  os pickers estivessem espalhados pelo handler, "aprender o formato"      ║
 * ║  seria refatorar o ingress inteiro sob tráfego real.                      ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ─── AS TRÊS REGRAS QUE NÃO PODEM SER RELAXADAS ─────────────────────────────
 *
 * 1. NUNCA INVENTAR `external_id`. Não existe caminho aqui que produza um id a
 *    partir de relógio, contador ou uuid local. `pickExternalId` devolve `null` e
 *    quem chama PARKA. O defeito que isto existe para não copiar mora em
 *    `send-meta-message/index.ts:137` — `result.message_id || \`meta_${Date.now()}\``.
 *    Um id sintético é NOVO a cada reentrega: ele derrota a UNIQUE
 *    `(external_id, channel, organization_id)`, que é a ÚNICA guarda de
 *    idempotência desta rota, e transforma cada reentrega numa mensagem duplicada
 *    no inbox do cliente. É por isso que este módulo não importa nada que dê horas.
 *
 * 2. TOLERANTE NO ALIAS, INTOLERANTE NO DESCONHECIDO. Aceitar `id`, `message_id`
 *    e `mid` custa nada e cobre a variação que a doc já mostra. Adivinhar o que um
 *    valor desconhecido de direção significa custa uma mensagem gravada com o
 *    sentido invertido. Onde não dá para saber, o retorno é `null` — e `null`
 *    SEMPRE significa "o chamador parka", nunca "assuma o caso comum".
 *
 * 3. STRING VAZIA É AUSÊNCIA. Molde de `pickInstanceId` (`whatsapp-webhook` L247).
 *    `""` num alias de id passaria pelo `typeof === "string"` e viraria um
 *    `external_id` vazio — que colide com TODA outra mensagem vazia da mesma org
 *    na UNIQUE, e faz mensagens diferentes se absorverem como reentrega uma da
 *    outra.
 *
 * ─── O QUE ESTE MÓDULO NÃO FAZ ──────────────────────────────────────────────
 *
 * Não resolve tenant (isso sai do PATH, não do corpo — ver `notificame-webhook`),
 * não fala com banco, não conhece `fetch`, não decide status HTTP.
 */

// ─── Leitura defensiva de caminhos ───────────────────────────────────────────

/**
 * Lê um caminho pontilhado (`message.id`) de um valor `unknown`. Devolve
 * `undefined` para qualquer travessia impossível — nunca lança.
 *
 * Existe porque os aliases da doc misturam topo e aninhado (`id` e `message.id`),
 * e um `payload.message.id` sobre `message: null` seria um TypeError dentro do
 * `withErrorBoundary`: 500 para o fornecedor e o corpo cru perdido.
 */
function readPath(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const key of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * Primeiro alias que produza uma string NÃO-VAZIA depois do trim. Número finito
 * conta (ids numéricos existem; o `mid` da Meta às vezes chega assim), booleano e
 * objeto não.
 *
 * ⚠️ O `.trim()` e o teste de vazio são a regra 3 do cabeçalho, aplicada num lugar
 * só. Espalhá-los pelos pickers é como um deles fica de fora numa edição futura.
 */
function firstNonEmpty(source: unknown, paths: readonly string[]): string | null {
  for (const path of paths) {
    const value = readPath(source, path);
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

// ─── Identidade da mensagem ──────────────────────────────────────────────────

/**
 * Aliases do id da mensagem NO FORNECEDOR. Ordem = preferência: o mais específico
 * primeiro, para o dia em que o corpo trouxer dois.
 */
const EXTERNAL_ID_PATHS = [
  "id",
  "message_id",
  "messageId",
  "mid",
  "externalId",
  "external_id",
  "message.id",
  "message.mid",
  "data.id",
  "data.message_id",
] as const;

/**
 * O id da mensagem NO FORNECEDOR, ou `null`.
 *
 * ⚠️ `null` NÃO tem fallback. Quem chama PARKA o evento inteiro. Ver a regra 1 do
 * cabeçalho: é esta função que impede o defeito de `send-meta-message:137` de ser
 * copiado para cá, e é por isso que ela não recebe nem `now` nem gerador de id.
 */
export function pickExternalId(payload: unknown): string | null {
  return firstNonEmpty(payload, EXTERNAL_ID_PATHS);
}

// ─── Identidade do canal ─────────────────────────────────────────────────────

/**
 * As PALAVRAS de canal do vocabulário do fornecedor e do nosso.
 *
 * ⚠️ Esta lista é a razão de ser de `pickChannelId`. Na doc da subscription,
 * `criteria.channel` é o TIPO do canal (a palavra `"instagram"`), não um
 * identificador — e é plausível que o evento ecoe o mesmo campo com o mesmo
 * sentido. Sem esta exclusão, `pickChannelId` devolveria `"instagram"` como se
 * fosse um id, o resolvedor procuraria em `messaging_channels` um canal cujo
 * `external_channel_id` é literalmente `'instagram'`, não acharia, e TODO evento
 * de TODA org pararia em `unresolved_channel` — com o sintoma apontando para o
 * banco, não para o picker.
 */
const CHANNEL_WORDS = new Set([
  "whatsapp",
  "wa",
  "instagram",
  "ig",
  "facebook",
  "fb",
  "messenger",
]);

/**
 * Aliases de id de canal que NÃO são o campo ambíguo `channel`.
 *
 * ⚠️ `to.id` E `destination` FORAM REMOVIDOS DAQUI, e a razão é de MODELO, não de
 * gosto. Num evento de ENTRADA, `to` é o DESTINATÁRIO — NÓS —, e "nós" não é uma
 * entidade só: pode ser o id do CANAL no fornecedor, mas pode igualmente ser o
 * IGSID da nossa conta de Instagram, o page id, ou o @usuário. São entidades
 * DIFERENTES, e `external_channel_id` casa com exatamente UMA delas.
 *
 * O custo é ASSIMÉTRICO, e é isso que decide:
 *
 *   • se `to.id` FOR o id do canal, tirá-lo daqui não perde nada — o corpo sem id
 *     de canal cai no desempate por org do handler (um canal conectado ⇒ resolve;
 *     mais de um ⇒ `ambiguous_channel`), a mensagem ENTRA, e o `raw_payload`
 *     guardado ensina o formato;
 *   • se `to.id` NÃO for o id do canal — o caso provável, porque a doc do envelope
 *     de ENVIO diz que quem carrega o id do canal é `from` —, mantê-lo aqui
 *     DESLIGA aquele desempate: `pickChannelId` devolve um valor, o handler faz
 *     busca global por `external_channel_id`, não acha, e parka em
 *     `unresolved_channel`. TODO evento de TODA org, para sempre, com o sintoma
 *     apontando para o banco em vez de para o picker.
 *
 * Uma declaração ERRADA é pior que declaração NENHUMA: ela substitui um caminho
 * que funciona por um que falha em silêncio. E a evidência interna é o próprio
 * arquivo: `pickAccountHandle` lê `to.username`/`to.handle` como identidade da
 * NOSSA conta. `to.*` não pode significar "nossa conta" numa função e "id do
 * canal" na outra.
 *
 * REABRIR SÓ COM PAYLOAD REAL na mão (`notificame_webhook_events.payload`), não
 * com doc: a doc do fornecedor já se provou errada uma vez.
 */
const CHANNEL_ID_PATHS = [
  "channelId",
  "channel_id",
  "channelUuid",
  "channel_uuid",
  "channel.id",
  "channel.uuid",
  "data.channelId",
  "data.channel_id",
] as const;

/**
 * O id do canal NO FORNECEDOR declarado pelo corpo, ou `null`.
 *
 * ⚠️ O valor daqui NÃO escolhe tenant e NÃO escolhe destino sozinho: a org sai do
 * uuid da subconta no PATH, que nós registramos. Este id só ESTREITA a busca
 * dentro daquela org, e a linha encontrada ainda é conferida contra a org do path
 * (`channel_org_mismatch`). O remetente não tem como mover um evento para outro
 * tenant nomeando um canal alheio.
 *
 * `payload.channel` entra como ÚLTIMO recurso e só quando NÃO é palavra de canal
 * conhecida — ver `CHANNEL_WORDS`.
 */
export function pickChannelId(payload: unknown): string | null {
  const direct = firstNonEmpty(payload, CHANNEL_ID_PATHS);
  if (direct) return direct;

  const loose = firstNonEmpty(payload, ["channel"]);
  if (!loose) return null;
  return CHANNEL_WORDS.has(loose.toLowerCase()) ? null : loose;
}

// ─── A chave `type`, que responde a DUAS perguntas ───────────────────────────

/**
 * `type` é AMBÍGUA e por isso não pertence a nenhuma lista de alias INEQUÍVOCO.
 *
 * ⚠️ O defeito que este bloco desfaz: `readEventType` e `pickChannelWord` liam
 * ambos a chave `type` dentro das SUAS listas de alias, disputando a mesma chave
 * para duas perguntas diferentes ("que evento é este?" e "de que canal é?"), e
 * ainda existe uma terceira reivindicação legítima — `contents[].type` é o tipo do
 * CONTEÚDO (`'text'`, `'image'`), lido por `pickContent`. Com a chave dentro da
 * lista, quem decidia era `firstNonEmpty`, isto é, a ORDEM: um `{type:'instagram',
 * event:'MESSAGE'}` fazia `readEventType` devolver `unknown` — e PARKAR uma
 * mensagem perfeitamente legível — porque parou na primeira chave não-vazia e
 * nunca chegou em `event`.
 *
 * A separação: a mesma CHAVE só pode alimentar duas perguntas quando é o VALOR que
 * decide qual delas ele responde — e só porque os dois vocabulários são FECHADOS e
 * DISJUNTOS (`message|message_status|…` × `whatsapp|instagram|…`). É o mesmo
 * expediente que `pickChannelId` já usa em `channel` via `CHANNEL_WORDS`: palavra
 * conhecida ⇒ não é id; valor de fora do vocabulário ⇒ é id.
 *
 * Daí as três regras que valem para as duas perguntas:
 *   1. aliases INEQUÍVOCOS primeiro, na ordem da lista;
 *   2. o PRIMEIRO alias inequívoco presente é AUTORITATIVO — valor que não
 *      classifica não faz a busca continuar; ele É a resposta ("desconhecido").
 *      Seguir procurando seria deixar um alias posterior desmentir uma declaração
 *      explícita do remetente;
 *   3. `type` entra só DEPOIS, e só quando o VALOR pertence ao vocabulário daquela
 *      pergunta. Fora dele, `type` é ruído para essa pergunta — e provavelmente
 *      resposta da outra.
 */
const AMBIGUOUS_TYPE_PATHS = ["type"] as const;

/** Aliases INEQUÍVOCOS da PALAVRA de canal. `type` não está aqui — ver acima. */
const CHANNEL_WORD_PATHS = ["channel", "channel_type", "channelType"] as const;

/**
 * A PALAVRA de canal declarada pelo corpo (`'instagram'`, `'IG'`, …), ou `null`.
 *
 * Serve só para CONFERIR contra o `channel_type` da nossa linha de
 * `messaging_channels` — nunca para escolher destino. O `channel` do corpo é
 * declarado pelo remetente; o tipo que decide onde a linha vai é NOSSO.
 *
 * `null` significa "o corpo não declarou canal que eu reconheça" e o handler NÃO
 * confere nada — nunca "confere e passou".
 */
export function pickChannelWord(payload: unknown): string | null {
  for (const path of CHANNEL_WORD_PATHS) {
    const raw = firstNonEmpty(payload, [path]);
    if (!raw) continue;
    // Regra 2: autoritativo. `channel:'MESSAGE'` responde "não é palavra de canal
    // que eu conheça" — e NÃO manda procurar em `type`.
    return CHANNEL_WORDS.has(raw.toLowerCase()) ? raw : null;
  }

  const ambiguous = firstNonEmpty(payload, AMBIGUOUS_TYPE_PATHS);
  if (!ambiguous) return null;
  // Regra 3: `type` só vale como canal quando o VALOR é palavra de canal.
  return CHANNEL_WORDS.has(ambiguous.toLowerCase()) ? ambiguous : null;
}

// ─── Tipo de evento ──────────────────────────────────────────────────────────

export type InboundEventType = "message" | "message_status" | "unknown";

/** Aliases INEQUÍVOCOS do tipo de evento. `type` não está aqui — ver acima. */
const EVENT_TYPE_PATHS = ["eventType", "event_type", "event"] as const;

/**
 * O vocabulário FECHADO de evento. `null` = "esta palavra não é de evento" — o que
 * é diferente de `"unknown"`, que é o VEREDITO ("é evento, e não sei qual").
 * Manter os dois separados é o que permite a `type` cair para a outra pergunta em
 * vez de virar um `unknown` que parka a mensagem.
 */
function classifyEventWord(raw: string): InboundEventType | null {
  const v = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (v === "message" || v === "messages" || v === "message_received") return "message";
  if (v === "message_status" || v === "messagestatus" || v === "status") return "message_status";
  return null;
}

/**
 * `MESSAGE` / `MESSAGE_STATUS` são os dois `eventType` que a doc da subscription
 * nomeia. Tolerante em alias e caixa; `unknown` para o resto — e `unknown` PARKA,
 * não descarta.
 *
 * ⚠️ O default é PARKAR e não ignorar. Um `eventType` que não reconhecemos pode
 * ser exatamente a mensagem que o cliente está esperando ver no inbox, sob um
 * nome que a doc não listou. Descartar produziria o pior sintoma possível:
 * silêncio, indistinguível de "ninguém mandou nada".
 */
export function readEventType(payload: unknown): InboundEventType {
  for (const path of EVENT_TYPE_PATHS) {
    const raw = firstNonEmpty(payload, [path]);
    if (!raw) continue;
    // Regra 2: autoritativo. `eventType:'MESSAGE_REACTION'` É a resposta
    // (`unknown` ⇒ parka), e não licença para procurar em `event` ou `type` um
    // valor mais conveniente.
    return classifyEventWord(raw) ?? "unknown";
  }

  const ambiguous = firstNonEmpty(payload, AMBIGUOUS_TYPE_PATHS);
  if (!ambiguous) return "unknown";
  // Regra 3: `type:'instagram'` e `type:'text'` NÃO são declarações de evento —
  // são as outras duas reivindicações da mesma chave. Cair em `unknown` aqui é
  // correto (parka), mas não porque `type` "disse" algo: porque ninguém disse.
  return classifyEventWord(ambiguous) ?? "unknown";
}

// ─── Direção ─────────────────────────────────────────────────────────────────

export type InboundDirection = "incoming" | "outgoing";

/**
 * A direção da mensagem no vocabulário do BANCO — `incoming` | `outgoing`.
 *
 * ⚠️ `'inbound'` VIOLA `channel_messages_direction_check`. O CHECK aceita
 * EXATAMENTE `incoming|outgoing`, e é por isso que a tradução acontece aqui, num
 * lugar só, em vez de o handler repassar o literal do fornecedor. O mesmo engano
 * já deixou `useIncomingMessageToast.ts:51` morto por construção — ele compara com
 * `'inbound'`, valor que nenhum writer jamais pôde gravar.
 *
 * Valor desconhecido ⇒ `null`, e o chamador PARKA. Assumir `incoming` por omissão
 * gravaria uma mensagem NOSSA como se o cliente a tivesse enviado — erro que a UI
 * mostra invertido e que nenhum log denuncia.
 */
export function readDirection(payload: unknown): InboundDirection | null {
  const raw = firstNonEmpty(payload, [
    "direction",
    "criteria.direction",
    "message.direction",
    "data.direction",
  ]);
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (v === "in" || v === "inbound" || v === "incoming" || v === "received") return "incoming";
  if (v === "out" || v === "outbound" || v === "outgoing" || v === "sent") return "outgoing";
  return null;
}

// ─── Contato ─────────────────────────────────────────────────────────────────

export interface InboundContact {
  /** O IGSID do INTERLOCUTOR. Sem ele não há conversa para agrupar. */
  externalId: string | null;
  name: string | null;
  avatarUrl: string | null;
  /** @usuário do interlocutor, quando o corpo o traz. */
  handle: string | null;
}

/**
 * O INTERLOCUTOR — quem está do outro lado, independente de direção.
 *
 * ⚠️ NÃO é "o remetente". `contact_external_id` precisa ser o mesmo valor no
 * inbound e no outbound, senão a coluna de agrupamento muda de significado quando
 * a fatia de envio chegar e toda linha escrita até lá fica errada. O defeito a não
 * copiar é `useMetaMessages.ts`, que casa a thread por `sender_id =
 * conv.external_user_id`: na mensagem de SAÍDA o `sender_id` é a PÁGINA, então a
 * saída nunca aparece na conversa.
 *
 * Nesta fatia (inbound-only) o interlocutor é o remetente, e é isso que os aliases
 * refletem. Quando o outbound entrar, o `to.*` de baixo é que passa a valer — e é
 * por isso que ele já está listado.
 */
export function pickContact(payload: unknown): InboundContact {
  return {
    externalId: firstNonEmpty(payload, [
      "contact.id",
      "contact.external_id",
      "from.id",
      "from",
      "sender.id",
      "senderId",
      "sender_id",
      "user.id",
      "message.from",
      "data.from",
    ]),
    name: firstNonEmpty(payload, [
      "contact.name",
      "contact.profile.name",
      "from.name",
      "sender.name",
      "senderName",
      "sender_name",
      "user.name",
      "profile.name",
      // ⚠️ `visitor.firstName` e NUNCA `visitor.name`: no corpo do fornecedor o
      // campo `name` do visitante é o @ do Instagram (`m.montemezzo`) e
      // `firstName` é o nome humano (`Marcelo Montemezzo`). A troca faria o CRM
      // chamar o cliente pelo @ em toda tela, e-mail e disparo. Medido no
      // primeiro payload real, 2026-08-17.
      "message.visitor.firstName",
    ]),
    avatarUrl: firstNonEmpty(payload, [
      "contact.picture",
      "contact.profile_pic",
      "contact.avatar",
      "from.picture",
      "sender.picture",
      "sender.avatar",
      "profile.picture",
      "message.visitor.picture",
    ]),
    handle: firstNonEmpty(payload, [
      "contact.username",
      "contact.handle",
      "from.username",
      "sender.username",
      "profile.username",
      // O @ do interlocutor — o SEGUNDO sinal de identidade do detector de
      // duplicatas, ao lado do telefone digitado no texto. O handoff desta fatia
      // afirmava que o payload não trazia o handle; a primeira mensagem real
      // provou o contrário, e é aqui que ele vem.
      "message.visitor.name",
    ]),
  };
}

/**
 * O handle da NOSSA conta (a que recebeu), quando o corpo o traz.
 *
 * Existe para o backfill de `messaging_channels.handle`, que
 * `buildMessagingChannelRow` deixou NULL com o comentário "a fatia 2-IG resolve com
 * o payload de entrada" — `GET /v1/channels` não devolve o @usuário.
 *
 * ⚠️ Aliases DELIBERADAMENTE distintos dos de `pickContact`: gravar o handle do
 * interlocutor como se fosse o da nossa conta exibiria, na lista de caixas, o nome
 * de um cliente qualquer como identidade da empresa.
 */
export function pickAccountHandle(payload: unknown): string | null {
  const raw = firstNonEmpty(payload, [
    "account.username",
    "account.handle",
    "to.username",
    "to.handle",
    "recipient.username",
    "channel.username",
    "channel.handle",
  ]);
  if (!raw) return null;
  return raw.startsWith("@") ? raw.slice(1) : raw;
}

// ─── Conteúdo ────────────────────────────────────────────────────────────────

export interface InboundContent {
  content: string | null;
  mediaUrl: string | null;
  /** `channel_messages.message_type` é NOT NULL DEFAULT 'text'. */
  messageType: string;
}

/**
 * Texto, mídia e tipo. TUDO opcional menos o tipo — que cai em `'text'`, o mesmo
 * default da coluna.
 *
 * Conteúdo ilegível NÃO parka: o `raw_payload` guarda o corpo integral, então uma
 * mensagem sem texto reconhecido ainda aparece na thread com a hora e o remetente
 * certos, e o corpo está lá para ensinar o formato. Parkar por causa do texto
 * esconderia a conversa inteira por um campo cosmético.
 */
export function pickContent(payload: unknown): InboundContent {
  const content = firstNonEmpty(payload, [
    "content",
    "text",
    "body",
    "message.text",
    "message.body",
    "message.content",
    "data.text",
    "contents.0.text",
    // ⚠️ O CAMINHO REAL, medido no primeiro payload de mensagem (2026-08-17).
    // `contents.0.text` já estava na lista, mas UM NÍVEL ACIMA de onde o
    // fornecedor põe: ele aninha tudo sob `message`. Sem este alias a mensagem
    // entrava com texto vazio e o chat renderizava "[Mensagem não suportada]".
    "message.contents.0.text",
  ]);

  const mediaUrl = firstNonEmpty(payload, [
    "media_url",
    "mediaUrl",
    "attachment.url",
    "attachments.0.url",
    "message.media_url",
    "contents.0.url",
    "message.contents.0.url",
    "url",
  ]);

  const declaredType = firstNonEmpty(payload, [
    "message_type",
    "messageType",
    "message.type",
    "contents.0.type",
    "message.contents.0.type",
  ]);

  return {
    content,
    mediaUrl,
    messageType: declaredType ? declaredType.toLowerCase() : (mediaUrl ? "media" : "text"),
  };
}

/**
 * O instante declarado pelo corpo, em ISO — ou `null`.
 *
 * ⚠️ NÃO cai no relógio local aqui. `null` sobe para o chamador, que decide (e
 * hoje decide `new Date().toISOString()`, porque `channel_messages.timestamp` é
 * NOT NULL). Manter o relógio FORA deste módulo é o que permite ao teste asserir,
 * por grep, que nenhum caminho de identidade toca `Date.now()`.
 *
 * Aceita epoch em segundos e em milissegundos (o corte de 10^11 separa os dois
 * por ordem de grandeza: 10^11 s seria o ano 5138) e string ISO já pronta.
 */
export function pickTimestampIso(payload: unknown): string | null {
  const raw = readPath(payload, "timestamp") ?? readPath(payload, "created_at") ??
    readPath(payload, "createdAt") ?? readPath(payload, "message.timestamp");

  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    const ms = raw < 1e11 ? raw * 1000 : raw;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof raw === "string" && raw.trim()) {
    const d = new Date(raw.trim());
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

// ─── A linha de `channel_messages` ───────────────────────────────────────────

/**
 * O recorte de `channel_messages` que esta rota escreve. Declarado aqui, e não
 * importado de `src/integrations/supabase/types.ts`, porque edge function não
 * enxerga `src/` — e porque as duas colunas novas (`messaging_channel_id`,
 * `contact_external_id`) só existem em types.ts depois do regen.
 */
/**
 * ONDE a linha aponta, e é a única diferença real entre os dois canais.
 *
 * Canal de Instagram é linha de `messaging_channels`; o de WhatsApp oficial é
 * linha de `whatsapp_instances`. As duas colunas já são nullable em
 * `channel_messages` — medido em produção, nenhuma migration para isto.
 */
export type InboundTarget =
  | { kind: "instagram"; messagingChannelId: string }
  | { kind: "whatsapp"; instanceId: string };

export interface InboundChannelMessageRow {
  organization_id: string;
  channel: "instagram" | "whatsapp";
  /** Preenchido só no Instagram. */
  messaging_channel_id: string | null;
  /** Preenchido só no WhatsApp. */
  instance_id: string | null;
  contact_external_id: string;
  external_id: string;
  direction: "incoming";
  message_type: string;
  content: string | null;
  media_url: string | null;
  status: "received";
  sender_id: string | null;
  sender_name: string | null;
  sender_profile_pic: string | null;
  /**
   * O @usuário do INTERLOCUTOR. Coluna, e não só `raw_payload`, porque é o
   * segundo sinal de identidade do detector de duplicatas — e sinal preso em
   * jsonb não é pesquisável. `null` quando o corpo não traz.
   */
  contact_handle: string | null;
  /**
   * JID é conceito do WhatsApp NÃO-oficial (Uazapi). O canal oficial endereça
   * por telefone puro, então segue nulo nos dois canais desta rota.
   */
  remote_jid: null;
  /**
   * Telefone do interlocutor — preenchido SÓ no WhatsApp, onde o
   * `contact_external_id` é o próprio número. No Instagram fica nulo: o IGSID
   * não é telefone. Ver o ⚠️ abaixo — NUNCA `''`.
   */
  phone_number: string | null;
  page_id: null;
  /**
   * CACHE do vínculo, RESOLVIDO — nunca criado. `null` quando esta identidade
   * ainda não foi vinculada por um humano. Ver o ⚠️ de
   * `buildInboundChannelMessageRow`.
   */
  lead_id: string | null;
  timestamp: string;
  raw_payload: unknown;
}

/**
 * Monta a linha. PURO — recebe tudo já decidido, inclusive o instante.
 *
 * ⚠️ `phone_number: null`, e isso é o campo mais afiado da função. A coluna é
 * NULLABLE (baseline L22364), e a tentação é preenchê-la com o handle ou com `''`
 * para "não deixar vazio". `normalizePhone('')` devolve `''`, e `''` casa com `''`:
 * TODOS os contatos de Instagram da org colapsariam num único contato. Pior, dois
 * caminhos EXECUTAM esse campo — `formatPhoneForWhatsApp` e `LeadContactModal` —,
 * então um handle ali vira tentativa de discar para um @usuário.
 *
 * ⚠️ `direction: 'incoming'` é literal, não parâmetro. `'inbound'` violaria o
 * CHECK, e esta fatia é inbound-only por decisão.
 *
 * ⚠️ `lead_id` é CACHE DERIVADO, e este caminho RESOLVE — NUNCA CRIA.
 *
 * A FONTE DA VERDADE do vínculo é `public.lead_social_identities`
 * (20270817090000): lá mora a linha `(organization_id, channel_type,
 * external_user_id) → lead_id`, escrita EXCLUSIVAMENTE por RPC SECURITY DEFINER
 * no clique de um humano autenticado no chat. O chamador desta função consulta
 * essa tabela pelo `contact_external_id` e passa o resultado em `leadId`; ausência
 * de vínculo (o caso comum) é `null`, e a mensagem entra igual.
 *
 * Por que esta função nunca poderia CRIAR o lead: o fornecedor confirmou POR
 * ESCRITO que não assina o corpo do webhook. Quem descobrir o secret do path e o
 * uuid da subconta consegue POSTAR mensagem forjada numa org — e se este caminho
 * criasse lead, ele seria um botão de INFLAR A BASE de qualquer org, uma
 * requisição por lead. É o mesmo molde do WhatsApp: `whatsapp-webhook` não tem
 * uma única chamada a `getOrCreateLead`; quem cria é `useCreateLeadFromWhatsApp`.
 * Qualquer PR que faça este arquivo escrever em `leads` ou em
 * `lead_social_identities` está fora do desenho.
 *
 * ⚠️ `raw_payload` recebe o corpo INTEGRAL, sempre. É ele que ensina o formato
 * quando a doc do fornecedor estiver errada de novo.
 */
export function buildInboundChannelMessageRow(params: {
  organizationId: string;
  /** Instagram aponta por `messaging_channel_id`; WhatsApp por `instance_id`. */
  target: InboundTarget;
  externalId: string;
  contact: InboundContact;
  contactExternalId: string;
  content: InboundContent;
  timestampIso: string;
  rawPayload: unknown;
  /**
   * `lead_id` já RESOLVIDO pelo chamador (SELECT em `lead_social_identities`).
   *
   * OPCIONAL e com default `null` de propósito: o módulo é PURO e não conhece
   * banco, e omitir o campo tem de significar exatamente o que significava antes
   * desta fatia — linha sem vínculo. Um parâmetro obrigatório aqui só moveria a
   * decisão para o chamador sem mudar o resultado do caminho não-vinculado.
   */
  leadId?: string | null;
}): InboundChannelMessageRow {
  return {
    organization_id: params.organizationId,
    channel: params.target.kind,
    messaging_channel_id: params.target.kind === "instagram"
      ? params.target.messagingChannelId
      : null,
    instance_id: params.target.kind === "whatsapp" ? params.target.instanceId : null,
    contact_external_id: params.contactExternalId,
    // No WhatsApp o `contact_external_id` É o telefone, e a coluna existe para as
    // telas que só sabem falar de número. No Instagram fica NULA de propósito: o
    // IGSID não é telefone, e preenchê-la faria 13 superfícies mentirem.
    phone_number: params.target.kind === "whatsapp" ? params.contactExternalId : null,
    external_id: params.externalId,
    direction: "incoming",
    message_type: params.content.messageType,
    content: params.content.content,
    media_url: params.content.mediaUrl,
    status: "received",
    // No inbound, quem enviou É o interlocutor. A coluna fica preenchida para o
    // histórico; QUEM AGRUPA é `contact_external_id`, e é essa a diferença que
    // `useMetaMessages` não fez.
    sender_id: params.contact.externalId,
    sender_name: params.contact.name,
    sender_profile_pic: params.contact.avatarUrl,
    // O @ do interlocutor, em COLUNA e não só no `raw_payload`. Preso no jsonb
    // ele não é pesquisável nem casável, e é justamente o segundo sinal do
    // detector de duplicatas: comparar o @ do Instagram com o que o vendedor
    // anotou no lead. Ninguém faz isso varrendo jsonb linha a linha.
    //
    // ⚠️ Vem de `message.visitor.name`, que é o @ — NÃO o nome humano, que mora
    // em `firstName`. A inversão é do fornecedor; ver `pickContact`.
    contact_handle: params.contact.handle,
    remote_jid: null,
    page_id: null,
    lead_id: params.leadId ?? null,
    timestamp: params.timestampIso,
    raw_payload: params.rawPayload,
  };
}

// ─── Snapshot para `runtime_logs` ────────────────────────────────────────────

/**
 * Os campos NOSSOS e ESCALARES que podem ir para `runtime_logs`.
 *
 * ⚠️ `redactSecrets` (`_shared/logger.ts`) redige por NOME DE CHAVE. Um
 * `JSON.stringify(payload)` sob a chave `raw_truncated` — o que `whatsapp-webhook`
 * L1470 faz — não casa nenhuma chave e atravessa token inteiro para uma tabela que
 * humanos leem. Por isso o corpo cru vai para
 * `notificame_webhook_events.payload` (service_role-only) e para
 * `channel_messages.raw_payload`, e NUNCA para o log.
 *
 * Nada aqui vem do corpo do fornecedor como texto livre: só o veredito dos nossos
 * pickers, e ids que já são identificadores públicos do nosso lado.
 */
export function buildPayloadSnapshot(params: {
  sourceIp?: string | null;
  subaccountHint?: string | null;
  channelHint?: string | null;
  eventType?: InboundEventType | null;
  reason?: string | null;
  organizationId?: string | null;
  messagingChannelId?: string | null;
}): Record<string, unknown> {
  return {
    source_ip: params.sourceIp ?? null,
    subaccount_hint: params.subaccountHint ?? null,
    // Um id de canal do FORNECEDOR, não credencial — o token da subconta é outro
    // campo e nunca passa por aqui.
    channel_hint: params.channelHint ?? null,
    event_type: params.eventType ?? null,
    reason: params.reason ?? null,
    organization_id: params.organizationId ?? null,
    messaging_channel_id: params.messagingChannelId ?? null,
  };
}
