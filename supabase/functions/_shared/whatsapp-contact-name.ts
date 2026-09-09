/** Names belong to the contact on the connected account, never an outgoing sender. */
export function nonBlankName(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
}

export function historyContactName(message: Record<string, unknown>, fromMe: boolean): string | null {
  return nonBlankName(message.wa_contactName) ??
    (fromMe ? null : nonBlankName(message.pushName, message.wa_pushName)) ?? null;
}
