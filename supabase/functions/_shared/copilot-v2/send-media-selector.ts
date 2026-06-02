/**
 * send-media-selector — Copilot v2 envio estruturado de mídia (Slice 6).
 *
 * ADR #5/#12: a mídia é enviada CRUA (nunca a knowledge base) só quando o gatilho
 * casa, com um gate de momento/repetição ANTES do send. Decisão PURA (sem DB),
 * espelhando rubric-engine/capability-gate. O handler (tool-executor) faz a I/O:
 * resolve o item no DB, busca os já-enviados, chama esta decisão, e só então
 * gera signed URL + delega ao adapter.
 *
 * Fail-CLOSED: item ausente, inativo, de outra org, ou já enviado nesta conversa
 * → bloqueia com motivo explícito (nunca silent-drop — lição VitrineVET).
 */

export type SendMediaKind = "image" | "video" | "audio";

export interface SendMediaItem {
  id: string;
  organization_id: string;
  kind: SendMediaKind;
  storage_path: string;
  is_active: boolean;
  mime_type?: string | null;
}

export interface SendMediaDecisionInput {
  orgId: string;
  item: SendMediaItem | null;
  alreadySentMediaIds: string[];
}

export type SendMediaDenyReason =
  | "not_found" | "cross_org" | "item_inactive" | "already_sent";

export interface SendMediaDecision {
  allowed: boolean;
  reason: SendMediaDenyReason | null;
}

export function decideSendMedia(input: SendMediaDecisionInput): SendMediaDecision {
  const { orgId, item, alreadySentMediaIds } = input;
  if (!item) return { allowed: false, reason: "not_found" };
  // org SEMPRE do ctx (orgId), nunca do item/LLM — defesa em profundidade.
  if (item.organization_id !== orgId) return { allowed: false, reason: "cross_org" };
  if (!item.is_active) return { allowed: false, reason: "item_inactive" };
  if (alreadySentMediaIds.includes(item.id)) return { allowed: false, reason: "already_sent" };
  return { allowed: true, reason: null };
}

// ── Cap da biblioteca (DECISÃO DE PRODUTO ABERTA — ver ## Decisões abertas) ──
// O modo/limite vêm da config (copilot_v2_send_media_limits, Task 3), NUNCA
// hardcoded. assertWithinCap é puro e suporta as DUAS leituras possíveis.

export interface CapPolicy {
  mode: "per_kind" | "total";
  limit: number;
}

export type CapResult =
  | { ok: true }
  | { ok: false; reason: "cap_exceeded"; kind?: SendMediaKind };

export function assertWithinCap(items: SendMediaItem[], policy: CapPolicy): CapResult {
  const active = items.filter((i) => i.is_active);
  if (policy.mode === "total") {
    return active.length <= policy.limit ? { ok: true } : { ok: false, reason: "cap_exceeded" };
  }
  // per_kind
  const byKind = new Map<SendMediaKind, number>();
  for (const i of active) byKind.set(i.kind, (byKind.get(i.kind) ?? 0) + 1);
  for (const [kind, count] of byKind) {
    if (count > policy.limit) return { ok: false, reason: "cap_exceeded", kind };
  }
  return { ok: true };
}
