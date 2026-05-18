/**
 * `primaryInstanceFor` — resolve qual instância WhatsApp default abrir quando
 * o usuário dispara um deep-link de chat (Kanban → /chat-whatsapp?instance=…).
 *
 * Função pura: recebe candidatos (vindos do contexto do lead — instância do
 * responsável de venda, write-instance, histórico) e a lista de instâncias
 * permitidas ao usuário corrente. Retorna o primeiro candidato presente em
 * `allowedInstances`, ou `null` quando nenhum casa.
 *
 * Quando retorna um id válido, o caller pode propagar como `?instance=` no
 * URL e o `ChatShellWithContext` pula `useResolveChatDeepLink` (sem hit no
 * servidor). Quando retorna `null`, o resolver cuida normalmente.
 *
 * Defesa em profundidade: id de instância fora das permitidas NÃO é
 * retornado mesmo que esteja em primeiro lugar nos candidatos.
 */
import type { WhatsAppInstanceForUser } from "@/hooks/chat/types";

export interface PrimaryInstanceForArgs {
  /**
   * IDs candidatos a serem a instância default do lead, em ordem de
   * preferência. Aceita `null`/`undefined` (filtrados).
   */
  candidates: ReadonlyArray<string | null | undefined>;
  /** Instâncias que o usuário corrente pode usar (já filtradas por tenancy). */
  allowedInstances: ReadonlyArray<WhatsAppInstanceForUser>;
}

export function primaryInstanceFor({
  candidates,
  allowedInstances,
}: PrimaryInstanceForArgs): string | null {
  if (allowedInstances.length === 0) return null;
  const allowedIds = new Set(allowedInstances.map((i) => i.id));
  for (const candidate of candidates) {
    if (candidate && allowedIds.has(candidate)) return candidate;
  }
  return null;
}
