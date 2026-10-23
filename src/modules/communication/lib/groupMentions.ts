/**
 * Menção em conversa de GRUPO: `@<LID>` vira `@Nome` (Chamado 6885e65d).
 *
 * No grupo o WhatsApp não manda o nome de quem foi citado. O texto chega como
 * `@59738817577139 …` e a lista de citados vem à parte, em
 * `raw_payload.content.contextInfo.mentionedJID` (`["59738817577139@lid"]`) — em
 * texto e em legenda de mídia. Esse número é um LID: identificador opaco do
 * participante, não telefone. O chat imprimia `content` cru, e o vendedor via um
 * "número aleatório".
 *
 * O nome vem de quem ESCREVEU no grupo: cada mensagem de grupo traz o LID do
 * remetente (`raw_payload.sender_lid`) ao lado do `push_name`. Não existe tabela
 * de participantes; o histórico do próprio grupo é a fonte.
 *
 * Leitura em dois formatos, como os outros leitores `uazapi*Display`: a thread
 * vem do SELECT com projeções estreitas (`uazapi_mentioned_jids`,
 * `uazapi_sender_lid` — ver `whatsappMessagesQuery.ts`), e o Realtime entrega a
 * linha com o `raw_payload` inteiro. A projeção tem precedência
 * (`realtimeUpdate.ts` a descarta quando chega um `raw_payload` novo).
 *
 * ⚠️ O `raw_payload` é apagado pela retenção (~14 dias). Mensagem mais antiga
 * que isso não tem mais `mentionedJID`: o texto fica como veio, com o número.
 *
 * Só citações DESTA mensagem: a de dentro de `quotedMessage` é do texto citado.
 */

export interface GroupMentionFields {
  raw_payload?: unknown;
  uazapi_mentioned_jids?: unknown;
  uazapi_sender_lid?: unknown;
  push_name?: string | null;
}

/** `lid → nome`, chave com o sufixo (`59738817577139@lid`). */
export type MentionNames = ReadonlyMap<string, string>;

export type MessageSegment =
  | { kind: "text"; text: string }
  /** `raw` é o token como veio (`@59738817577139`); `name`, quando conhecido. */
  | { kind: "mention"; jid: string; raw: string; name: string | null };

/** Teto defensivo: um payload com lista gigante não vira regex gigante. */
const MAX_MENTIONS = 50;
const MENTION_JID = /^(\d{5,20})@(?:lid|s\.whatsapp\.net)$/;
const SENDER_LID = /^\d{5,20}@lid$/;
/** O que não pode vir colado antes do `@`: letra, número ou `_` (e-mail, `a@1`). */
const WORD_CHAR = /[\p{L}\p{N}_]/u;

const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export function readMentionedJids(fields: GroupMentionFields): string[] {
  const list =
    fields.uazapi_mentioned_jids !== undefined && fields.uazapi_mentioned_jids !== null
      ? fields.uazapi_mentioned_jids
      : object(object(object(fields.raw_payload).content).contextInfo).mentionedJID;
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const jid of list) {
    if (typeof jid !== "string" || !MENTION_JID.test(jid) || out.includes(jid)) continue;
    out.push(jid);
    if (out.length >= MAX_MENTIONS) break;
  }
  return out;
}

export function readSenderLid(fields: GroupMentionFields): string | null {
  const lid = fields.uazapi_sender_lid ?? object(fields.raw_payload).sender_lid;
  return typeof lid === "string" && SENDER_LID.test(lid) ? lid : null;
}

/**
 * `lid → push_name` a partir das mensagens (em ordem cronológica: a mais recente
 * vence, como o nome que a pessoa usa hoje). Vale para os dois sentidos — o
 * próprio chip também é participante e pode ser citado.
 */
export function buildMentionNameMap(messages: Iterable<GroupMentionFields>): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of messages) {
    const lid = readSenderLid(m);
    const name = typeof m.push_name === "string" ? m.push_name.trim() : "";
    if (lid && name) map.set(lid, name);
  }
  return map;
}

/** Todos os JIDs citados na thread, na ordem em que aparecem, sem repetir. */
export function collectMentionedJids(messages: Iterable<GroupMentionFields>): string[] {
  const seen = new Set<string>();
  for (const m of messages) for (const jid of readMentionedJids(m)) seen.add(jid);
  return [...seen];
}

/**
 * Quebra o texto em trechos de texto e de menção. Só vira menção o `@<número>`
 * cujo número está em `mentionedJID` — um `@123` qualquer digitado fica texto.
 * Sem citação no texto devolve um único trecho com o texto intocado.
 */
export function splitMentions(text: string, jids: readonly string[], names: MentionNames): MessageSegment[] {
  if (!text || jids.length === 0 || !text.includes("@")) return [{ kind: "text", text }];

  const jidByNumber = new Map<string, string>();
  for (const jid of jids) {
    const number = MENTION_JID.exec(jid)?.[1];
    if (number && !jidByNumber.has(number)) jidByNumber.set(number, jid);
  }
  if (jidByNumber.size === 0) return [{ kind: "text", text }];

  const segments: MessageSegment[] = [];
  let textStart = 0;
  const token = /@(\d{5,20})(?!\d)/g;
  for (let match = token.exec(text); match; match = token.exec(text)) {
    const jid = jidByNumber.get(match[1]);
    const before = match.index > 0 ? text[match.index - 1] : "";
    if (!jid || (before && WORD_CHAR.test(before))) continue;
    if (match.index > textStart) segments.push({ kind: "text", text: text.slice(textStart, match.index) });
    segments.push({ kind: "mention", jid, raw: match[0], name: names.get(jid) ?? null });
    textStart = match.index + match[0].length;
  }
  if (segments.length === 0) return [{ kind: "text", text }];
  if (textStart < text.length) segments.push({ kind: "text", text: text.slice(textStart) });
  return segments;
}
