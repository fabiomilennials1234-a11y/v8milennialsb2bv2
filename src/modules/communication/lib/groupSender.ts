export interface GroupSenderFields {
  is_group?: boolean | null;
  remote_jid?: string;
  direction: string;
  push_name?: string | null;
  group_sender?: unknown;
  group_sender_phone?: unknown;
  raw_payload?: unknown;
}
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
export function groupSender(message: GroupSenderFields): { name: string; key: string } | null {
  if (
    message.direction !== "incoming" || !(message.is_group || message.remote_jid?.endsWith("@g.us"))
  ) return null;
  const raw = object(message.raw_payload);
  const phone = text(message.group_sender_phone ?? raw.sender_pn);
  const sender = text(message.group_sender ?? raw.sender ?? object(raw.key).participant);
  const name = text(message.push_name) || text(raw.senderName);
  // LIDs and group JIDs are not phone numbers. Do not display them as one.
  const phoneJid = [phone, sender].find((jid) => /^\d+(?::\d+)?@s\.whatsapp\.net$/.test(jid));
  const label = name ||
    (phoneJid ? `+${phoneJid.split("@")[0].split(":")[0]}` : "Participante sem nome");
  return { name: label, key: (phone || sender).replace(/:\d+@/, "@") || name || "unknown" };
}
