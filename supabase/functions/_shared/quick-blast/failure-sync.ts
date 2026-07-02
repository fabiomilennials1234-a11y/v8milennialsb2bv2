/**
 * failure-sync — pure core of the per-recipient delivery-failure sync
 * (ADR-0016, #947).
 *
 * The mass-send-status poll fetches a sender folder's per-message statuses
 * (`POST /sender/listmessages`, spike #943) and this core computes which of
 * the plan/lot's `sent` recipients must flip to `failed`:
 *
 *   computeFailedTransitions(folder, recipients) → FailedTransition[]
 *
 * Zero provider/store awareness — data in, transitions out. The caller (the
 * cron, #948) applies the transitions through the BlastPlanStore.
 *
 * Matching is by phone within the folder: a folder belongs to exactly one
 * plan+lot dispatch (ADR-0016 §2), so a normalized phone is unique inside it.
 */
import { normalizePhoneForSearch } from "../lead-service.ts";

/** A `sent → failed` transition the caller applies to blast_plan_recipients. */
export interface FailedTransition {
  plan_id: string;
  lot_index: number;
  lead_id: string;
  reason: BlastFailureReason;
  /** Raw provider error text, preserved for incident debugging. */
  error: string;
}

/** The folder snapshot the poll hands the core (provenance + raw messages). */
export interface SenderFolderSnapshot {
  /** `uazapi_sender_jobs.payload` provenance — `{plan_id, lot_index}` written at dispatch (ADR-0016 §3). */
  provenance?: unknown;
  /** Raw `/sender/listmessages` rows — parsed defensively (spike caveat: doc↔server drift). */
  messages?: unknown;
}

/** Projection of a blast_plan_recipients row the poll hands the core. */
export interface FailureSyncRecipient {
  lead_id: string;
  phone: string | null;
  status: string;
}

/**
 * Parses the dispatch provenance written by runUazapiSenderJob. A folder
 * without a valid `{plan_id, lot_index}` link predates the payload link (or is
 * not a blast-plan dispatch) and is ignored — no heuristic retrofit (ADR-0016).
 *
 * Exported so the sync runner (#948) can gate BEFORE hitting the provider —
 * a legacy folder must cost zero /sender/listmessages calls.
 */
export function parseDispatchProvenance(
  raw: unknown,
): { plan_id: string; lot_index: number } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { plan_id, lot_index } = raw as Record<string, unknown>;
  if (typeof plan_id !== "string" || plan_id === "") return null;
  if (typeof lot_index !== "number" || !Number.isInteger(lot_index) || lot_index < 0) return null;
  return { plan_id, lot_index };
}

/** Normalized-phone key of a `/sender/listmessages` chatid (`<phone>@s.whatsapp.net`). */
function chatidPhoneKey(chatid: unknown): string | null {
  if (typeof chatid !== "string") return null;
  return normalizePhoneForSearch(chatid.split("@")[0]);
}

export function computeFailedTransitions(
  folder: SenderFolderSnapshot,
  recipients: readonly FailureSyncRecipient[],
): FailedTransition[] {
  const provenance = parseDispatchProvenance(folder.provenance);
  if (!provenance) return [];
  if (!Array.isArray(folder.messages)) return [];

  // Phone is unique within a folder (one folder = one plan+lot dispatch), so a
  // plain normalized-phone index is a faithful join key. Only `sent` rows are
  // candidates: `failed` stays failed (idempotent re-poll), pending/skipped are
  // not this folder's dispatches.
  const sentByPhone = new Map<string, FailureSyncRecipient>();
  for (const recipient of recipients) {
    if (recipient.status !== "sent") continue;
    const key = normalizePhoneForSearch(recipient.phone);
    if (key) sentByPhone.set(key, recipient);
  }

  const transitions: FailedTransition[] = [];
  const flipped = new Set<string>();
  for (const raw of folder.messages) {
    if (typeof raw !== "object" || raw === null) continue;
    const message = raw as Record<string, unknown>;
    // Open enum, defensively parsed: ONLY an explicit "Failed" reclassifies —
    // Sent/Delivered/Read/Queued/Canceled and unknown values never do.
    if (message.status !== "Failed") continue;
    const phoneKey = chatidPhoneKey(message.chatid);
    if (!phoneKey) continue;
    const recipient = sentByPhone.get(phoneKey);
    if (!recipient || flipped.has(recipient.lead_id)) continue;
    flipped.add(recipient.lead_id);
    const error = typeof message.error === "string" ? message.error : "";
    transitions.push({
      plan_id: provenance.plan_id,
      lot_index: provenance.lot_index,
      lead_id: recipient.lead_id,
      reason: classifyFailureReason(error),
      error,
    });
  }
  return transitions;
}

/** Canonical failure reasons written to blast_plan_recipients.reason. */
export type BlastFailureReason =
  | "invalid_number"
  | "instance_disconnected"
  | "provider_rejected"
  | "provider_error";

/**
 * Maps the provider's free-text `error` onto a canonical failure reason
 * (spike #943 taxonomy). Heuristic by design — the raw text travels alongside
 * in FailedTransition.error, so the classification never loses information.
 */
export function classifyFailureReason(error: string): BlastFailureReason {
  if (/not.*whatsapp|no.*account|unregistered|invalid|not found/i.test(error)) {
    return "invalid_number";
  }
  if (/disconnect|not connected|logged out|unauthorized/i.test(error)) {
    return "instance_disconnected";
  }
  if (/ban|block|spam|rate|limit|forbidden/i.test(error)) {
    return "provider_rejected";
  }
  return "provider_error";
}
