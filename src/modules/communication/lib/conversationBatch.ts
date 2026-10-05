import { contactKey, isWhatsAppContact, type ChatContact, type InboxContact } from "../hooks/chat/types";
import { RIOFIX_ORG_ID } from "./negocioNoChat";

export type ConversationBatchAction = "archive" | "unarchive" | "delete";
export type BatchContact = ChatContact & { instance_id: string };
export interface ConversationBatchResult {
  succeeded: BatchContact[];
  failed: BatchContact[];
}

export function selectableConversations(contacts: readonly InboxContact[]): BatchContact[] {
  return contacts.filter((c): c is BatchContact =>
    isWhatsAppContact(c) && !!c.instance_id && !!c.phone_number,
  );
}

/** Exact row identities, bounded requests, and partial results for a safe retry. */
export async function runConversationBatch(
  organizationId: string,
  action: ConversationBatchAction,
  contacts: readonly BatchContact[],
  isAdmin: boolean,
  execute: (contact: BatchContact) => Promise<void>,
): Promise<ConversationBatchResult> {
  if (organizationId !== RIOFIX_ORG_ID) throw new Error("Ação disponível apenas para a Riofix");
  if (action === "delete" && !isAdmin) throw new Error("Apenas administradores podem excluir conversas");
  const pending = [...new Map(contacts.map(c => [contactKey(c), c])).values()];
  const result: ConversationBatchResult = { succeeded: [], failed: [] };
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, pending.length) }, async () => {
    while (next < pending.length) {
      const contact = pending[next++];
      try {
        await execute(contact);
        result.succeeded.push(contact);
      } catch {
        result.failed.push(contact);
      }
    }
  }));
  return result;
}
