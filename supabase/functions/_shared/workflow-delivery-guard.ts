import type { ActionInput, ActionResult } from "./action-handlers/types.ts";

/** A queued/sent API acknowledgement does not prove WhatsApp delivery.
 * Used by move nodes that explicitly require delivery confirmation. The worker
 * resumes this same move node, never the send node, while callbacks arrive.
 */
export async function guardWorkflowDelivery(
  supabase: ActionInput["supabase"], organizationId: string, executionId: string,
  now = Date.now(),
): Promise<ActionResult | null> {
  const { data, error } = await supabase.from("channel_messages")
    .select("id, status, created_at")
    .eq("organization_id", organizationId)
    .eq("channel", "whatsapp")
    .eq("direction", "outgoing")
    .eq("metadata->origem->>id", executionId)
    .order("created_at", { ascending: false })
    .limit(101);
  if (error) return { success: false, error: `Falha ao verificar entrega: ${error.message}`, retryable: true };
  const messages = data ?? [];
  if (messages.length > 100) {
    return { success: false, error: "Limite de mensagens excedido ao verificar a entrega. Revise a execução.", retryable: false };
  }
  if (messages.some((message) => message.status === "failed")) {
    return { success: false, error: "Envio recusado pelo WhatsApp. O negócio permaneceu na etapa atual.", retryable: false };
  }
  const pending = messages.filter((message) => !["delivered", "read"].includes(message.status ?? ""));
  if (!pending.length) return null;
  if (pending.some((message) => !Number.isFinite(Date.parse(message.created_at)) || now - Date.parse(message.created_at) >= 24 * 60 * 60 * 1000)) {
    return { success: false, error: "Entrega não confirmada em 24 horas. O negócio permaneceu na etapa atual.", retryable: false };
  }
  return { success: false, error: "Aguardando confirmação de entrega no WhatsApp", retryAt: new Date(now + 60_000).toISOString() };
}
