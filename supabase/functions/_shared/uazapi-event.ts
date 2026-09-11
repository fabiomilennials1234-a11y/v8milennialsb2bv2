type Data = Record<string, unknown>;
const record = (value: unknown): Data => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Data : {};

/** Extract the message without mutating the authenticated envelope. */
export function uazapiEventMessage(payload: Data): Data {
  const message = payload.data ?? payload.message ?? payload;
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw new Error("Invalid UAZAPI message envelope");
  }
  const chat = payload.chat;
  const candidate = typeof chat === "string" ? chat : record(chat).wa_chatid;
  // A group's participant phone must never replace the group's identity.
  const phoneJid = typeof candidate === "string" && /^\d+@(s\.whatsapp\.net|g\.us)$/.test(candidate)
    ? candidate : undefined;
  return { ...record(message), ...(phoneJid ? { _phone_jid: phoneJid } : {}) };
}

export interface UazapiReaction {
  messageId: string;
  emoji: string;
  from: "me" | "them";
  sender: string;
}

/** ReactionMessage refers to content.key.ID, never the reaction's own id. */
export function uazapiMessageReaction(message: Data): UazapiReaction | null {
  if (![message.type, message.messageType].some(type => typeof type === "string" && ["reaction", "reactionmessage"].includes(type.toLowerCase()))) return null;
  const content = record(message.content);
  const key = record(content.key);
  const messageId = key.ID ?? key.id;
  const emoji = content.text;
  const sender = message.sender_pn || message.sender;
  if (typeof messageId !== "string" || !messageId || typeof emoji !== "string" ||
      typeof message.fromMe !== "boolean" || typeof sender !== "string" || !sender) {
    throw new Error("Invalid UAZAPI reaction payload");
  }
  return { messageId, emoji, from: message.fromMe ? "me" : "them", sender };
}

/** One reaction per sender. Replays replace; an empty emoji removes. */
export function mergeUazapiReaction(existing: unknown, reaction: UazapiReaction): Data[] {
  const rows: Data[] = Array.isArray(existing) ? existing.map(record) : [];
  const kept = rows.filter(row => row && typeof row === "object" &&
    (row.sender ? row.sender !== reaction.sender : row.from !== reaction.from));
  return reaction.emoji ? [...kept, { emoji: reaction.emoji, from: reaction.from, sender: reaction.sender, count: 1 }] : kept;
}
