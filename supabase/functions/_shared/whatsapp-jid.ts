// deno-lint-ignore-file no-explicit-any

/**
 * Classificação de JID do WhatsApp — telefone, grupo ou LID.
 *
 * O LID (`@lid`, "LinkedID") é o identificador opaco que o WhatsApp emite no
 * lugar do número quando o telefone do outro lado não é exposto à conta. Tem
 * 14–18 dígitos e **não é telefone**: não tem país, não tem DDD, não casa com
 * `leads.normalized_phone` e não serve para enviar mensagem.
 *
 * O webhook já sabia disso (`whatsapp-webhook/index.ts`, resolução de
 * `resolvedJid`) e o extrator de dono também (`whatsapp-owner.ts`). O backfill
 * de histórico não sabia: gravava o LID em `whatsapp_messages.phone_number`, o
 * gatilho de resumo criava uma conversa com aquela chave, e o inbox passava a
 * listar contatos chamados `210028246085780` — duplicando conversas que já
 * existiam pelo número real. Este módulo é a definição única dessa distinção,
 * para que a terceira porta a aprender a lição não precise reinventá-la.
 */

const LID_SUFFIX = "@lid";
const GROUP_SUFFIX = "@g.us";

/**
 * Sufixos de JID que **não** são conversa individual, com o rótulo que vai para
 * o log. `@newsletter` é canal/Status do WhatsApp e entrou aqui pelo mesmo
 * caminho do LID: 301 mensagens em 10 dias na Café Jurerê, cada canal virando
 * um "contato" chamado `120363404701403742`.
 *
 * É blocklist, não allowlist, de propósito: sufixo novo do provedor continua
 * sendo gravado (e visível) em vez de sumir em silêncio.
 */
const NON_INDIVIDUAL_SUFFIXES: ReadonlyArray<readonly [string, string]> = [
  [GROUP_SUFFIX, "group"],
  ["@newsletter", "newsletter"],
  ["@broadcast", "broadcast"],
];

/** É um LinkedID (`@lid`)? Nunca é telefone. */
export function isLidJid(value: unknown): boolean {
  return typeof value === "string" && value.includes(LID_SUFFIX);
}

/** É JID de grupo (`@g.us`)? */
export function isGroupJid(value: unknown): boolean {
  return typeof value === "string" && value.includes(GROUP_SUFFIX);
}

/**
 * Rótulo do motivo, quando o JID não é conversa individual — `undefined` se for
 * individual (ou LID, que tem tratamento próprio: às vezes dá para resolver).
 */
export function nonIndividualKind(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  for (const [suffix, kind] of NON_INDIVIDUAL_SUFFIXES) {
    if (value.includes(suffix)) return kind;
  }
  return undefined;
}

/** Strip a WhatsApp JID / raw value down to a bare phone-number string. */
export function jidToPhone(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (isLidJid(value) || nonIndividualKind(value)) return undefined;
  // Drop everything from the first "@" (s.whatsapp.net / c.us) and any
  // ":NN" multi-device suffix that precedes it.
  const local = value.split("@")[0].split(":")[0];
  const digits = local.replace(/\D/g, "");
  // E.164-ish sanity: WhatsApp numbers are 10–15 digits (country + DDD + line).
  if (digits.length < 10 || digits.length > 15) return undefined;
  return digits;
}

export type JidResolution =
  /** JID utilizável como conversa individual — `jid` é o que deve ser gravado. */
  | { kind: "phone"; jid: string }
  /** Grupo, canal (`@newsletter`) ou lista de transmissão: não é conversa 1:1. */
  | { kind: "non_individual"; reason: string }
  /** LID sem número correspondente no payload. Não dá para gravar sem mentir. */
  | { kind: "unresolved_lid"; lid: string }
  /** Nenhum identificador de conversa no payload. */
  | { kind: "missing" };

/** Chaves que carregam o JID da conversa, em ordem de confiança. */
const CHAT_KEYS = ["chatid", "chatId", "remoteJid", "jid"] as const;

/**
 * Chaves que carregam o **telefone** quando a conversa vem identificada por
 * LID. Mesma escada do webhook (`_phone_jid ?? sender_pn ?? from`), acrescida
 * das variantes camelCase — o schema da Uazapi é conhecido-instável
 * (incidente 2026-05-14), então lê-se um conjunto, não um nome.
 */
const PHONE_HINT_KEYS = [
  "_phone_jid",
  "sender_pn",
  "senderPn",
  "chat_pn",
  "chatPn",
  "participant_pn",
] as const;

function pickString(msg: Record<string, any>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = msg[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return undefined;
}

function pickPhoneJid(msg: Record<string, any>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = msg[key];
    if (typeof value !== "string") continue;
    if (jidToPhone(value)) return value.trim();
  }
  return undefined;
}

/**
 * De quem é a conversa desta mensagem de histórico?
 *
 * Só o ramo LID muda o comportamento anterior do worker. JID de telefone segue
 * gravado exatamente como vinha (inclusive valores estranhos que não passam por
 * `jidToPhone`): o defeito em produção é o LID, e alargar o corte aqui
 * arriscaria descartar conversa legítima por um formato que ninguém mediu.
 */
export function resolveHistoryChatJid(msg: Record<string, any>): JidResolution {
  const fromMe = msg.fromMe === true || msg.fromme === true || msg.wa_fromMe === true;
  // Quem está do outro lado: numa mensagem nossa é o destinatário, numa recebida
  // é o remetente. Trocar os dois faria toda conversa enviada apontar para o
  // nosso próprio número.
  const counterpartKey = fromMe ? "to" : "from";

  const primary = pickString(msg, [...CHAT_KEYS, counterpartKey]);
  if (!primary) return { kind: "missing" };
  const excluded = nonIndividualKind(primary);
  if (excluded) return { kind: "non_individual", reason: excluded };
  if (!isLidJid(primary)) return { kind: "phone", jid: primary };

  const resolved = pickPhoneJid(msg, [...PHONE_HINT_KEYS, counterpartKey]);
  if (resolved) return { kind: "phone", jid: resolved };
  return { kind: "unresolved_lid", lid: primary };
}
