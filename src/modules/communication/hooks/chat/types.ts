/**
 * Tipos compartilhados entre os hooks de chat.
 * Extraídos de src/hooks/useWhatsAppChat.ts (C12).
 *
 * Barrel useWhatsAppChat.ts re-exporta todos estes tipos para backwards-compat.
 */

export interface WhatsAppMessage {
  id: string;
  organization_id: string;
  instance_id: string | null;
  message_id: string;
  remote_jid: string;
  phone_number: string;
  direction: "incoming" | "outgoing";
  message_type: string;
  content: string | null;
  media_url: string | null;
  /** True when media was purged by the 30-day retention job. Renders "expired" state. */
  media_expired?: boolean | null;
  push_name: string | null;
  status: string;
  lead_id: string | null;
  timestamp: string;
  created_at: string;
  /** Whether this message was sent by the Copilot AI agent */
  sent_by_ai: boolean | null;
  sent_source: "manual" | "copilot" | "workflow" | null;
  /**
   * Por que o envio falhou, quando o provider soube dizer. Opcional: só o canal
   * oficial preenche hoje, a partir do callback da Meta.
   */
  failure_reason?: string | null;
  /** Código da Meta (ex.: "132012"). Serve para investigação, não para a frase. */
  failure_code?: string | null;
}

/** Mensagem que falhou ao ser enviada — armazenada em cache paralelo para retry. */
export interface FailedMessage {
  id: string;
  phoneNumber: string;
  instanceId: string | null;
  instanceName: string;
  message: string | null;
  mediaUrl: string | null;
  mediaType: string | null;
  error: string;
  timestamp: string;
  direction: "outgoing";
  status: "failed";
  sent_by_ai: false;
}

export interface ChatContactTag {
  id: string;
  name: string;
  color: string;
}

export interface ChatContact {
  /**
   * Discriminador da união `InboxContact`. Literal e OBRIGATÓRIO de propósito:
   * é o compilador que aponta todo sítio de CONSTRUÇÃO de contato quando um
   * segundo canal entra no inbox. Opcional (ou com default) o campo faria os
   * mesmos sítios compilarem calados e produzirem contatos sem canal, que a
   * lista renderizaria com o selo errado. Nenhum sítio de LEITURA quebra: quem
   * já tinha `ChatContact` continua tendo.
   */
  channel: "whatsapp";
  /**
   * A CAIXA de onde esta conversa veio — `whatsapp_instances.id`.
   *
   * Existe porque a lista deixou de ser de uma caixa só. Com duas caixas
   * visíveis ao mesmo tempo, o telefone para de ser identidade: o mesmo número
   * falando com dois números nossos são duas Conversas do Lead, com históricos
   * diferentes, e sem este campo as duas linhas colidiriam em `contactKey` —
   * mesma `key` de React, mesma seleção, e a thread de uma abrindo no lugar da
   * outra.
   *
   * `null` significa "não sei de qual caixa", e não é hipótese: a bolha de chat
   * agrupa por telefone ATRAVESSANDO caixas (W4 a migra para o motor novo) e o
   * contador de não-lidas do badge constrói contato sem origem. Quem produz
   * `null` produz uma linha que a caixa unificada não sabe marcar — e é melhor
   * que a alternativa, que seria carimbar uma caixa arbitrária e mostrar o selo
   * errado.
   */
  instance_id: string | null;
  phone_number: string;
  push_name: string | null;
  last_message: string | null;
  last_message_time: string;
  /** Direção da última mensagem: incoming = lead enviou, outgoing = você enviou */
  last_message_direction: "incoming" | "outgoing" | null;
  last_message_sent_source: "manual" | "copilot" | "workflow" | null;
  unread_count: number;
  lead_id: string | null;
  lead_name: string | null;
  /** ID do registro em whatsapp_conversations (null se nunca teve ação) */
  conversation_id: string | null;
  /** Se a conversa está arquivada */
  archived_at: string | null;
  /** Tags combinadas: lead_tags + conversation_tags (sem duplicatas) */
  tags: ChatContactTag[];
  /** True quando o "contato" representa um grupo do WhatsApp (remote_jid @g.us). */
  is_group: boolean;
  /**
   * Funis em que o lead está + etapa atual em cada um. Enriquecido pela camada de
   * dados (useLeadInboxMeta) a partir de pipeline_entries. Lead pode estar em
   * vários funis ao mesmo tempo. **Opcional**: só o inbox principal (/chat)
   * enriquece — outros consumidores (bubble, meta) deixam undefined, e o engine
   * trata como "sem funil".
   */
  funnels?: { pipelineId: string; stageKey: string }[];
  /** qualification_tier do lead (diamante/ouro/prata/bronze/desqualificado). Opcional — ver funnels. */
  qualification_tier?: string | null;
}

/** Instância de WhatsApp que o usuário pode acessar (para seletor de inbox) */
export interface WhatsAppInstanceForUser {
  id: string;
  instance_name: string;
  status: string;
  /** Provider — drives capability gating (Uazapi/Evolution/Meta Cloud). Rule 13. */
  provider?: string;
  /** Telefone da instância — opcional porque dublês e leituras antigas não o trazem. */
  phone_number?: string | null;
}

// ─── Canais sociais (Instagram via NotificaMe) ───────────────────────────────

/**
 * Conversa de um canal SOCIAL (hoje só Instagram Direct).
 *
 * Tipo IRMÃO de `ChatContact`, não uma flexibilização dele. O motivo é o
 * `phone_number`: em `ChatContact` ele é `string` obrigatório e é a IDENTIDADE
 * da conversa — 18 referências só na bolha de chat contam com isso. Um contato
 * de Instagram não tem telefone, e afrouxar o campo para `string | null` faria
 * cada um desses sítios ter de decidir o que fazer com o nulo. Pior: preencher
 * com `''` colapsaria TODOS os contatos de IG numa conversa só, porque
 * `normalizePhone('')` devolve `''` e a chave vira a mesma para todo mundo.
 *
 * A identidade aqui é `(messaging_channel_id, external_user_id)`, materializada
 * em `conversation_key` — a MESMA string que vai para
 * `conversation_read_state.conversation_key`, prefixada por `instagram:` desde o
 * dia zero para nunca colidir com o recorte `whatsapp:%` da RPC de WhatsApp.
 */
export interface SocialContact {
  /**
   * A CAIXA de origem, que é também o namespace da `conversation_key`.
   *
   * `whatsapp_oficial` é o canal da API oficial da Meta via NotificaMe. Ele mora
   * em `whatsapp_instances` (não em `messaging_channels`) e ainda assim é um
   * `SocialContact`, porque o que define este tipo é a TABELA DE MENSAGENS —
   * `channel_messages` — e não a rede do outro lado.
   */
  channel: "instagram" | "whatsapp_oficial";
  /** `${channel}:${messaging_channel_id}:${external_user_id}` — chave de leitura e de cache. */
  conversation_key: string;
  /**
   * O id da CAIXA, qualquer que seja a tabela em que ela mora: um
   * `messaging_channels.id` no Instagram, um `whatsapp_instances.id` no canal
   * oficial. O nome ficou do primeiro caso (decisão Q10 do spec — documentar em
   * vez de renomear: são 25 usos em 12 arquivos, e o caminho de Instagram já
   * roda em produção).
   */
  messaging_channel_id: string;
  /** IGSID do INTERLOCUTOR (nunca da nossa conta). */
  external_user_id: string;
  /** @handle do interlocutor, quando o payload informa. */
  handle: string | null;
  display_name: string | null;
  avatar_url: string | null;
  last_message: string | null;
  last_message_time: string;
  last_message_direction: "incoming" | "outgoing" | null;
  unread_count: number;
  /**
   * Lead vinculado a esta identidade de Instagram, quando alguém vinculou.
   *
   * A fonte da verdade é `lead_social_identities` — NÃO
   * `channel_messages.lead_id`, que é cache derivado e nasce nulo em toda
   * mensagem que chega antes do vínculo existir. Quem preenche este campo é o
   * LEFT JOIN da RPC da lista; o vínculo em si só é criado por humano
   * autenticado no chat (o webhook de entrada não é assinado e por isso não
   * cria nada).
   */
  lead_id: string | null;
  /**
   * Nome do lead vinculado. Vem JUNTO na RPC, não de um segundo fetch: a lista
   * do WhatsApp paga um fanout de enriquecimento por lote e é ele que produz a
   * janela em que a linha aparece sem nome.
   */
  lead_name: string | null;
  /** Sempre `[]` nesta fatia: etiqueta hoje pendura em lead ou em conversa de WhatsApp. */
  tags: ChatContactTag[];
}

/** Uma conversa do inbox, de qualquer canal. Discriminada por `channel`. */
export type InboxContact = ChatContact | SocialContact;

/**
 * Uma CAIXA DE ENTRADA. O seletor do inbox deixou de ser "lista de números de
 * WhatsApp" e passou a ser esta união: `whatsapp_instances` ∪
 * `messaging_channels`. Org sem canal social não tem linha na segunda metade e
 * a união degrada, byte a byte, para o comportamento de hoje — por isso não há
 * feature flag plumbada no front.
 */
export type InboxBox =
  | { kind: "whatsapp"; id: string; name: string; status: string; provider?: string }
  | { kind: "instagram"; id: string; name: string; status: string; handle: string | null };

/**
 * True quando o contato é de WhatsApp — narrowing para os caminhos legados.
 *
 * Canal AUSENTE conta como WhatsApp, e isso não é leniência: toda conversa era
 * WhatsApp antes do NotificaMe, e o tipo EXIGIR `channel` não faz dado antigo
 * passar a tê-lo — tipo não roda em runtime. Sem o default, contato sem canal
 * caía no ramo social e três coisas quebravam de uma vez: `contactKey` devolvia
 * `conversation_key` inexistente (chave `undefined`, seleção e onPress mortos),
 * e a linha do mobile pedia ao ChannelBadge um ícone que não existe, derrubando
 * a conversa inteira com TypeError.
 *
 * Continua sendo PREDICADO e não `===` inline porque só o predicado estreita a
 * união discriminada; comparar com `??` no call-site resolve o runtime e cega o
 * TS para `phone_number`, `avatar_url` e companhia.
 */
export function isWhatsAppContact(c: InboxContact): c is ChatContact {
  return (c.channel ?? "whatsapp") === "whatsapp";
}

/**
 * True quando o contato vem de uma caixa que lê `channel_messages`.
 *
 * A negação de `isWhatsAppContact`, e escrita assim de propósito: enumerar os
 * canais sociais faria cada canal novo precisar de uma edição aqui, e o esquecimento
 * apareceria como contato que não renderiza — foi assim que a mensagem do canal
 * oficial ficou invisível em 18/08.
 */
export function isSocialContact(c: InboxContact): c is SocialContact {
  return c.channel !== "whatsapp";
}

/**
 * Identidade da conversa, num lugar só.
 *
 * É o que o shell guarda em `selectedKey`, o que vira `key` de cada linha da
 * lista e o que compara seleção. Um helper e não dois campos porque a alternativa
 * — cada call-site escolher entre `phone_number` e `conversation_key` — é como o
 * `chat-meta` casou thread por `sender_id` e fez toda mensagem de SAÍDA sumir.
 */
export function contactKey(c: InboxContact): string {
  return isWhatsAppContact(c)
    ? buildWhatsAppConversationKey(c.instance_id, c.phone_number)
    : c.conversation_key;
}

/**
 * A chave de conversa de uma caixa de WhatsApp por QR.
 *
 * `whatsapp:<instância>:<telefone>` — a MESMA forma de três segmentos das
 * caixas sociais, agora também aqui. Antes desta onda a chave era o telefone
 * cru, e ele bastava porque a lista mostrava uma caixa por vez.
 *
 * ⚠️ NÃO É A CHAVE DO BANCO, apesar do namespace idêntico.
 * `conversation_read_state.conversation_key` guarda
 * `whatsapp:<instância>:<telefone NORMALIZADO>`, montada pela RPC
 * `mark_conversation_read` a partir de `(p_instance_id, p_normalized_phone)`.
 * Aqui o terceiro segmento é o telefone COMO A LISTA O RECEBEU, porque é ele
 * que o composer, o painel de contexto e o fetch da thread consomem — trocar
 * por normalizado mudaria o número para o qual a mensagem sai. As duas chaves
 * convivem porque nenhuma das duas atravessa a fronteira da outra: esta nunca
 * é gravada no banco, e a do banco nunca é comparada com seleção de tela.
 *
 * Instância ausente vira `sem-caixa`, e não string vazia: `whatsapp::5511...`
 * seria uma chave de dois segmentos disfarçada, e o parser devolveria o
 * interlocutor errado.
 */
export function buildWhatsAppConversationKey(
  instanceId: string | null | undefined,
  phoneNumber: string,
): string {
  return `whatsapp:${instanceId || "sem-caixa"}:${phoneNumber}`;
}

/**
 * A caixa de uma chave de conversa — segundo segmento, qualquer que seja o
 * canal. `null` para uma chave que não tem a forma de três segmentos.
 */
export function caixaDaChave(chave: string | null | undefined): string | null {
  if (!chave) return null;
  const partes = chave.split(":");
  if (partes.length < 3) return null;
  return partes[1] || null;
}

/**
 * O interlocutor de uma chave de conversa — TUDO depois do segundo `:`.
 *
 * Fatiar por índice, e não `split(':')[2]`: id de rede social é opaco e pode
 * conter `:` (há teste guardando isso desde a fatia do Instagram). Para uma
 * caixa de WhatsApp devolve exatamente o telefone que entrou na chave — é o que
 * o composer e o painel de contexto consomem.
 */
export function interlocutorDaChave(chave: string | null | undefined): string | null {
  if (!chave) return null;
  const primeiro = chave.indexOf(":");
  if (primeiro === -1) return null;
  const segundo = chave.indexOf(":", primeiro + 1);
  if (segundo === -1) return null;
  return chave.slice(segundo + 1) || null;
}

/**
 * Nome exibido da conversa.
 *
 * Para Instagram o `@handle` ganha do nome de exibição porque é o que o usuário
 * vê no app do Instagram; sem nenhum dos dois, o sufixo do IGSID é preferível a
 * um rótulo genérico — dois contatos sem nome precisam continuar distinguíveis
 * na lista.
 */
export function contactLabel(c: InboxContact): string {
  if (c.channel === "whatsapp") {
    return (c.push_name || c.lead_name || c.phone_number || "").trim() || "Contato";
  }
  // O NOME primeiro, e o @ como queda.
  //
  // A ordem era inversa até 2026-08-17, quando o @ e o nome passaram a chegar
  // juntos no payload real. Com os dois em mãos, quem vai no título é o nome —
  // é ele que o vendedor reconhece na lista. O @ não some: vira subtítulo, via
  // `contactHandleLabel`, onde continua servindo de evidência citável.
  if (c.display_name?.trim()) return c.display_name.trim();

  // O NOME DO LEAD é melhor queda que qualquer id. No WhatsApp oficial o
  // interlocutor pode ser conhecido do CRM sem nunca ter mandado mensagem — é o
  // caso de quem foi chamado a partir do funil.
  if (c.lead_name?.trim()) return c.lead_name.trim();

  if (c.handle?.trim()) return `@${c.handle.trim().replace(/^@+/, "")}`;

  // ⚠️ "Instagram" É SÓ DO INSTAGRAM. No canal oficial o interlocutor é um
  // TELEFONE, e chamá-lo de Instagram foi o que a tela fez ao abrir a primeira
  // conversa vinda do funil: "Instagram 176628" no lugar do nome do lead.
  if (c.channel === "whatsapp_oficial") return c.external_user_id;

  return `Instagram ${c.external_user_id.slice(-6)}`;
}

/**
 * O @ do interlocutor pronto para exibição, ou `null`.
 *
 * `null` e não string vazia: quem chama decide NÃO renderizar a linha, em vez de
 * desenhar um subtítulo em branco ocupando altura na lista.
 */
export function contactHandleLabel(c: InboxContact): string | null {
  if (c.channel === "whatsapp") return null;
  const handle = c.handle?.trim().replace(/^@+/, "");
  return handle ? `@${handle}` : null;
}

/** Semente estável do gradiente do avatar — nunca string vazia. */
export function contactAvatarSeed(c: InboxContact): string {
  return c.channel === "whatsapp"
    ? c.phone_number || contactLabel(c)
    : c.external_user_id || c.conversation_key;
}

/**
 * Monta a `conversation_key` de um contato de caixa que lê `channel_messages`.
 * Único produtor da string.
 *
 * ⚠️ O NAMESPACE É UMA FRONTEIRA, NÃO UM RÓTULO. A chave vai para
 * `conversation_read_state.conversation_key`, e `get_whatsapp_conversation_list`
 * lê aquela tabela com `split_part(conversation_key, ':', 3)` sob o recorte
 * `LIKE 'whatsapp:%'`. Uma chave da caixa oficial gravada em `whatsapp:` seria
 * lida por aquela função como se o `contact_external_id` fosse telefone, e o
 * contador de não lidas do inbox de ~30 organizações passaria a somar conversa
 * alheia. Daí `whatsapp_oficial:` — e o teste que prova que nada aqui emite
 * `whatsapp:`.
 *
 * O terceiro segmento NÃO pode ser recuperado por fatiamento: id de rede social
 * é opaco e pode conter ':'. Quem consome compara a chave inteira.
 */
export function buildSocialConversationKey(
  channel: SocialContact["channel"],
  boxId: string,
  externalUserId: string,
): string {
  return `${channel}:${boxId}:${externalUserId}`;
}
