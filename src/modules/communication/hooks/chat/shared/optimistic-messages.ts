/**
 * Reconciliação da bolha otimista do chat WhatsApp.
 *
 * O problema que isto resolve — mensagem enviada aparecendo DUAS vezes na tela:
 *
 *   1. `useWhatsAppSend.onMutate` injeta uma bolha otimista no cache. Ela nasce
 *      com um `message_id` sintético (`optimistic_…`) porque o id real só existe
 *      depois que o provider responde.
 *   2. Segundos depois o webhook grava a linha real e o realtime a empurra pro
 *      cache. O dedupe do realtime compara `message_id` — que nunca casa com o
 *      sintético. Resultado: a mensagem real é ANEXADA ao lado da otimista.
 *   3. Só o `invalidateQueries` do `onSettled` limpava a bolha órfã. Enquanto o
 *      refetch não voltasse (provider lento, refetch em backoff, aba sem foco),
 *      o usuário via a mesma mensagem duplicada.
 *
 * A correção é casar as duas pela identidade que a bolha otimista TEM: direção,
 * conteúdo e proximidade temporal. Não dá pra casar por id — o id real é
 * gerado pelo WhatsApp, e fazer o webhook devolver um nonce do cliente exigiria
 * coluna nova e mudança no caminho de ingest.
 *
 * Módulo PURO — sem React, sem Supabase. Testável direto.
 */
import type { WhatsAppMessage } from "../types";

/** Prefixo dos ids sintéticos da bolha otimista. */
export const OPTIMISTIC_ID_PREFIX = "optimistic_";

/**
 * Janela em que uma mensagem real pode reivindicar uma bolha otimista. Precisa
 * cobrir provider lento sem chegar perto de "o usuário mandou a mesma frase de
 * novo mais tarde" — nesse caso as duas bolhas são legítimas e devem coexistir.
 */
export const OPTIMISTIC_MATCH_WINDOW_MS = 2 * 60 * 1000; // 2 min

export function isOptimisticMessage(message: WhatsAppMessage): boolean {
  return message.message_id?.startsWith(OPTIMISTIC_ID_PREFIX) ?? false;
}

/** Id sintético da bolha otimista. Sufixo aleatório evita colisão em envios no mesmo ms. */
export function makeOptimisticId(): string {
  return `${OPTIMISTIC_ID_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeContent(content: string | null | undefined): string {
  return (content ?? "").trim();
}

/**
 * A bolha otimista `candidate` corresponde à mensagem real `incoming`?
 *
 * Só mensagens de saída entram nesta conta — a bolha otimista existe apenas no
 * caminho de envio, e uma mensagem recebida nunca deve consumir uma.
 */
function matchesOptimistic(candidate: WhatsAppMessage, incoming: WhatsAppMessage): boolean {
  if (!isOptimisticMessage(candidate)) return false;
  if (candidate.direction !== "outgoing" || incoming.direction !== "outgoing") return false;
  if (candidate.message_type !== incoming.message_type) return false;
  if (normalizeContent(candidate.content) !== normalizeContent(incoming.content)) return false;

  const candidateAt = new Date(candidate.timestamp).getTime();
  const incomingAt = new Date(incoming.timestamp).getTime();
  if (Number.isNaN(candidateAt) || Number.isNaN(incomingAt)) return false;

  return Math.abs(incomingAt - candidateAt) <= OPTIMISTIC_MATCH_WINDOW_MS;
}

/**
 * Insere `incoming` na lista de mensagens do chat, reconciliando com o que já
 * está lá. Em ordem de precedência:
 *
 *   1. Mesma `message_id` já presente → lista intacta (dedupe do realtime).
 *   2. Existe bolha otimista correspondente → ela é SUBSTITUÍDA no lugar, o que
 *      preserva a posição na timeline e não pisca pro usuário.
 *   3. Caso contrário → anexa no fim.
 *
 * Só a bolha otimista mais antiga que casa é substituída: mandar "ok" duas
 * vezes seguidas gera duas bolhas, e cada mensagem real reivindica uma.
 */
export function upsertRealtimeMessage(
  existing: WhatsAppMessage[],
  incoming: WhatsAppMessage,
): WhatsAppMessage[] {
  if (existing.some((m) => m.message_id === incoming.message_id)) {
    return existing;
  }

  const optimisticIdx = existing.findIndex((m) => matchesOptimistic(m, incoming));
  if (optimisticIdx === -1) {
    return [...existing, incoming];
  }

  const next = [...existing];
  next[optimisticIdx] = incoming;
  return next;
}

/**
 * Promove a bolha otimista assim que o envio resolve e o id real do provider
 * chega — sem esperar o realtime.
 *
 * Promover em vez de remover é deliberado: remover faria a mensagem sumir da
 * tela até a linha real chegar. Com o `message_id` real no lugar, o dedupe
 * normal do realtime (caso 1 de `upsertRealtimeMessage`) reconhece a linha que
 * vem depois e não anexa nada.
 *
 * Se o realtime chegou primeiro — a lista já contém `realMessageId` — a bolha
 * otimista é descartada, senão ficariam duas.
 *
 * `realMessageId` deve ser o id do provider. O fallback local (`local_…`, que o
 * envio gera quando a resposta não traz id) NÃO deve ser passado: ele não casa
 * com a linha do webhook, e manter a bolha como otimista deixa o casamento por
 * conteúdo resolver.
 */
export function promoteOptimisticMessage(
  existing: WhatsAppMessage[] | undefined,
  optimisticId: string,
  realMessageId: string,
): WhatsAppMessage[] {
  if (!existing) return [];

  const realAlreadyPresent = existing.some((m) => m.message_id === realMessageId);
  if (realAlreadyPresent) {
    return existing.filter((m) => m.id !== optimisticId);
  }

  return existing.map((m) =>
    m.id === optimisticId ? { ...m, message_id: realMessageId, status: "sent" } : m,
  );
}
