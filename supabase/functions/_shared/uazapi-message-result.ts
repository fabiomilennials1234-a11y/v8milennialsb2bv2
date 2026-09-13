import type { SendResult } from "./whatsapp-client.ts";

/** HTTP acceptance is not delivery. UAZAPI returns Pending before a receipt. */
export function normalizeUazapiMessageResult(raw: unknown): SendResult {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const id = value.id ?? value.messageid;
  const time = value.messageTimestamp ?? value.timestamp;
  if (typeof id !== "string" || !id.trim() || typeof time !== "number" || !Number.isFinite(time) || time <= 0) {
    throw { status: 502, provider_code: "invalid_send_response",
      message: "Uazapi accepted a send without a usable message identity or timestamp" };
  }
  const state = typeof value.status === "string" ? value.status.toLowerCase() : "";
  return {
    message_id: id,
    status: ["error", "failed"].includes(state) ? "failed"
      : ["sent", "delivered", "read", "played", "server_ack", "delivery_ack", "read_ack"].includes(state) ? "sent" : "queued",
    timestamp: time >= 1e12 ? Math.floor(time / 1000) : time,
  };
}
