import type { ChatContact } from "../hooks/chat/types";

export interface LeadByPhoneLike {
  id: string;
  name: string | null;
}

export interface EffectiveLead {
  leadId: string | null;
  leadName: string | null;
}

/**
 * Resolve o lead efetivo de uma conversa do chat.
 *
 * A lista de contatos deriva `lead_id` de `whatsapp_messages.lead_id`, gravado
 * no ingest da mensagem. Um lead criado/migrado DEPOIS das suas mensagens — ou
 * sem nenhuma mensagem WhatsApp — deixa o contato sem `lead_id` apesar de
 * existir um lead com o mesmo telefone. `leadByPhone` é o fallback por match em
 * `leads.normalized_phone`. O vínculo do contato vence; o match por telefone
 * preenche a lacuna.
 *
 * Sem esse fallback, o header mostra "Sem lead" enquanto o ContextPanel (que já
 * resolve por telefone) mostra o lead — inconsistência visível ao usuário.
 */
export function resolveEffectiveLead(
  contact: Pick<ChatContact, "lead_id" | "lead_name"> | null | undefined,
  leadByPhone: LeadByPhoneLike | null | undefined,
): EffectiveLead {
  return {
    leadId: contact?.lead_id ?? leadByPhone?.id ?? null,
    leadName: contact?.lead_name ?? leadByPhone?.name ?? null,
  };
}
