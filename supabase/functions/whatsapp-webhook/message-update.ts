import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { completeQuotePresentations } from "../_shared/quotes/presentation.ts";
import { logRuntime } from "../_shared/logger.ts";
import { buildMessageIdCandidates, extractRawMessageIds, mapReceiptStatus } from "./message-id.ts";

type Instance = { id: string; organization_id: string; phone_number?: string | null };
type Reaction = Record<string, unknown>;
type Update = Record<string, unknown> & { ids?: unknown; id?: unknown; messageid?: unknown; key?: { id?: unknown } };

/** An atomic SQL predicate prevents late receipts from overwriting later states. */
export function receiptPredecessors(status: string): string[] {
  switch (status) {
    case "read": return ["pending", "sent", "delivered", "failed"];
    case "delivered": return ["pending", "sent", "failed"];
    case "sent": return ["pending", "failed"];
    case "failed": return ["pending", "sent"];
    default: return []; // pending is initial state, never a reason to regress.
  }
}

/** Legacy update events are assignments, not increments. Replays are idempotent. */
export function mergeUpdateReaction(current: unknown, value: unknown): Reaction[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid reaction update");
  const reaction = value as Reaction;
  if (typeof reaction.emoji !== "string") throw new Error("Invalid reaction emoji");
  const from = typeof reaction.from === "string" ? reaction.from : "them";
  const existing = Array.isArray(current) ? current.filter((r): r is Reaction => !!r && typeof r === "object" && !Array.isArray(r)) : [];
  const matches = (row: Reaction) => row.emoji === reaction.emoji && (row.from ?? "them") === from;
  const kept = existing.filter(row => !matches(row));
  if (reaction.remove === true || !reaction.emoji) return kept;
  const old = existing.find(matches);
  // Preserve a provider aggregate already present; a repeated delta must not add one.
  const count = typeof reaction.count === "number" && Number.isInteger(reaction.count) && reaction.count > 0
    ? reaction.count : typeof old?.count === "number" ? old.count : 1;
  const next = { ...old, emoji: reaction.emoji, from, count };
  const index = existing.findIndex(matches);
  if (index < 0) return [...kept, next];
  kept.splice(Math.min(index, kept.length), 0, next);
  return kept;
}

export async function applyMessageUpdate(db: SupabaseClient, instance: Instance, data: Update, options: { requireTarget?: boolean } = {}): Promise<void> {
  const rawIds = extractRawMessageIds(data);
  const receipt = mapReceiptStatus(data.status);
  if (options.requireTarget) {
    // Durable deliveries must retain unknown/malformed targets for investigation,
    // rather than completing after the permissive Edge parser drops bad IDs.
    const malformedList = data.ids != null && !Array.isArray(data.ids);
    const partiallyInvalidList = Array.isArray(data.ids) && data.ids.some(
      id => typeof id !== "string" || id.trim().length === 0,
    );
    if (malformedList || partiallyInvalidList || !rawIds.length || rawIds.some(id => !id.trim())) {
      throw new Error("Message update identifiers unavailable");
    }
    // Unknown provider operations must remain retryable evidence. Validate the
    // complete operation before any write so a valid receipt cannot conceal a
    // malformed pin/reaction bundled in the same delivery.
    const flags = [data.edited, data.deleted, data.pinned];
    const malformedFlag = [...flags, data.fromMe].some(value => value !== undefined && typeof value !== "boolean");
    const malformedStatus = data.status !== undefined && typeof receipt !== "string";
    const malformedReactions = data.reactions !== undefined && !Array.isArray(data.reactions);
    const recognized = receipt || flags.some(value => typeof value === "boolean")
      || Array.isArray(data.reactions) || data.reaction !== undefined;
    if (malformedFlag || malformedStatus || malformedReactions || !recognized) {
      throw new Error("Message update operation unavailable");
    }
    if (data.reaction !== undefined) mergeUpdateReaction([], data.reaction);
  }
  if (!rawIds.length) return;
  const ids = [...new Set(rawIds.flatMap(id => buildMessageIdCandidates(id, instance.phone_number, data.owner)))];
  const scope = () => db.from("whatsapp_messages").select("id,message_id,reactions,status,direction")
    .eq("organization_id", instance.organization_id).eq("instance_id", instance.id).in("message_id", ids);
  const mutates = (receipt && receipt !== "pending" && data.fromMe !== true) || data.edited || data.deleted
    || typeof data.pinned === "boolean" || data.reactions || data.reaction;
  let scopedTargets: Array<{ id: string; message_id: string; reactions: unknown; status: string; direction: string }> | null = null;
  if (options.requireTarget && mutates) {
    const { data: targets, error } = await scope();
    const found = new Set((targets ?? []).map(target => target.message_id));
    if (error || rawIds.some(id => !buildMessageIdCandidates(id, instance.phone_number, data.owner).some(candidate => found.has(candidate)))) {
      throw new Error("Message update target unavailable");
    }
    scopedTargets = targets ?? [];
  }
  if (receipt && data.fromMe !== true) {
    const predecessors = receiptPredecessors(receipt);
    if (predecessors.length) {
      const { data: changed, error } = await db.from("whatsapp_messages").update({ status: receipt })
        .eq("organization_id", instance.organization_id).eq("instance_id", instance.id)
        .eq("direction", "outgoing").in("message_id", ids).in("status", predecessors).select("id");
      if (error) throw new Error("Receipt persistence failed");
      if (!changed?.length) {
        let hasOutgoing = scopedTargets?.some(target => target.direction === "outgoing");
        if (hasOutgoing === undefined) {
          const { data: matches, error: lookupError } = await scope().eq("direction", "outgoing").limit(1);
          if (lookupError) throw new Error("Receipt target lookup failed");
          hasOutgoing = !!matches?.length;
        }
        if (!hasOutgoing) await logRuntime({ organizationId: instance.organization_id,
          module: "webhook", action: "uazapi_receipt_unmatched", status: "skipped",
          errorMessage: "no_row_matched", payloadSnapshot: { instance_id: instance.id, receipt_status: receipt } });
      }
    }
    // A duplicate receipt can finish an earlier interrupted commercial side effect.
    // The quote helper checks actual persisted states before sealing acceptance.
    if (["sent", "delivered", "read"].includes(receipt)) {
      await completeQuotePresentations(db, instance.organization_id, instance.id, ids, { strict: true });
    }
  }

  const update: Record<string, unknown> = {};
  if (data.edited) update.edited = true;
  if (Array.isArray(data.reactions)) update.reactions = data.reactions;
  if (Object.keys(update).length) {
    const { error } = await db.from("whatsapp_messages").update(update)
      .eq("organization_id", instance.organization_id).eq("instance_id", instance.id).in("message_id", ids);
    if (error) throw new Error("Message update persistence failed");
  }
  // Replayed deletion/pin events do not move their first persisted timestamp.
  if (data.deleted) {
    const { error } = await db.from("whatsapp_messages").update({ deleted_at: new Date().toISOString() })
      .eq("organization_id", instance.organization_id).eq("instance_id", instance.id).in("message_id", ids).is("deleted_at", null);
    if (error) throw new Error("Message deletion persistence failed");
  }
  if (typeof data.pinned === "boolean") {
    let query = db.from("whatsapp_messages").update({ pinned_at: data.pinned ? new Date().toISOString() : null })
      .eq("organization_id", instance.organization_id).eq("instance_id", instance.id).in("message_id", ids);
    query = data.pinned ? query.is("pinned_at", null) : query.not("pinned_at", "is", null);
    const { error } = await query;
    if (error) throw new Error("Message pin persistence failed");
  }
  if (!Array.isArray(data.reactions) && data.reaction && typeof data.reaction === "object") {
    let targets = scopedTargets;
    if (targets === null) {
      const lookup = await scope();
      if (lookup.error) throw new Error("Reaction targets unavailable");
      targets = lookup.data ?? [];
    }
    if (!targets?.length) {
      // Preserve the legacy missing-history policy. A durable pre-message inbox is
      // a separate release gate; never claim that absent targets were updated.
      await logRuntime({ organizationId: instance.organization_id, module: "webhook",
        action: "uazapi_reaction_update_unmatched", status: "skipped" });
      return;
    }
    for (const target of targets) {
      let current = target;
      let persisted = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        const next = mergeUpdateReaction(current.reactions, data.reaction);
        if (JSON.stringify(next) === JSON.stringify(current.reactions)) { persisted = true; break; }
        let query = db.from("whatsapp_messages").update({ reactions: next })
          .eq("id", target.id).eq("organization_id", instance.organization_id).eq("instance_id", instance.id);
        query = current.reactions == null ? query.is("reactions", null) : query.eq("reactions", JSON.stringify(current.reactions));
        const { data: changed, error: writeError } = await query.select("id");
        if (writeError) throw new Error("Reaction update persistence failed");
        if (changed?.length) { persisted = true; break; }
        const reread = await scope().eq("id", target.id).maybeSingle();
        if (reread.error || !reread.data) throw new Error("Reaction target disappeared");
        current = reread.data;
      }
      if (!persisted) throw new Error("Reaction update contention");
    }
  }
}
