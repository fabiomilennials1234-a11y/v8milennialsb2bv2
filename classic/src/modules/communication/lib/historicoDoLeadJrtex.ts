import { normalizePhone } from "@/lib/normalizePhone";
import { buildWhatsAppConversationKey } from "@/modules/communication/hooks/chat/types";

/** Exceção solicitada pela Jrtex; não muda links de notificações nem outras orgs. */
export function priorizarHistoricoDoLead(organizationId: string | null | undefined, leadId: string | null | undefined): boolean {
  return organizationId === "30bb5c27-88f4-4f91-9493-835405ae2e11" && !!leadId;
}

/** Mantém a caixa validada pelo resolver, mesmo com a lista do inbox antiga/vazia. */
export function chaveDoHistoricoDoLead(
  historico: { instanceId: string; phoneNumber: string },
  allowedInstanceIds: readonly string[],
): string | null {
  const phone = normalizePhone(historico.phoneNumber);
  if (!phone || !allowedInstanceIds.includes(historico.instanceId)) return null;
  return buildWhatsAppConversationKey(historico.instanceId, historico.phoneNumber);
}
