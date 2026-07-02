/**
 * failure-sync-runner — orchestration seam of the per-recipient
 * delivery-failure sync (ADR-0016, #948).
 *
 * The mass-send-status poll refreshes a uazapi_sender_jobs row's aggregates
 * and then calls syncFolderFailures with the job row. The runner:
 *
 *   1. gates on the dispatch provenance ({plan_id, lot_index} in the job
 *      payload, written by runUazapiSenderJob — #945). No provenance = legacy
 *      folder or non-blast dispatch → zero provider calls (no retrofit);
 *   2. fetches the folder's Failed messages through the provider seam
 *      (undefined seam = provider without /sender/listmessages → silent skip);
 *   3. fetches the plan/lot's `sent` recipients through the store seam and
 *      computes the transitions with the pure core (computeFailedTransitions,
 *      #947 — idempotent: only `sent` rows are candidates);
 *   4. applies each transition through the store seam.
 *
 * Contract: NEVER throws. Any provider/store error is captured in the result
 * ({synced, error}) so the caller's job-refresh path (HTTP 200) is preserved
 * by construction — a failure-visibility problem must never break the
 * aggregate poll that operators depend on.
 *
 * Deps-injected (same seam style as the blast-plan store/dispatch split): the
 * HTTP handler only builds the deps and relays the result to logRuntime.
 */
import {
  computeFailedTransitions,
  parseDispatchProvenance,
  type FailedTransition,
  type FailureSyncRecipient,
} from "./failure-sync.ts";

/** Projection of the uazapi_sender_jobs row the poll hands the runner. */
export interface FailureSyncJobRow {
  /** Provider folder id (uazapi_sender_jobs.uazapi_sender_id). */
  uazapi_sender_id: string | null;
  /** Job payload jsonb — carries the dispatch provenance {plan_id, lot_index}. */
  payload: unknown;
}

export interface FailureSyncDeps {
  /**
   * Provider seam — the folder's Failed messages (raw /sender/listmessages
   * rows, already filtered to messageStatus "Failed" and fully paginated).
   * Leave undefined when the provider doesn't expose per-message listing
   * (non-Uazapi) → the runner skips silently.
   */
  listFolderFailedMessages?: (folderId: string) => Promise<unknown[]>;
  /** Store seam — the plan/lot's recipients currently `sent`. */
  getSentRecipients: (
    planId: string,
    lotIndex: number,
  ) => Promise<FailureSyncRecipient[]>;
  /**
   * Store seam — applies one sent→failed transition. The writer must keep the
   * `status = 'sent'` guard in the UPDATE so a concurrent re-poll can never
   * clobber a row twice.
   */
  markFailed: (transition: FailedTransition) => Promise<void>;
}

export interface FailureSyncResult {
  /** Transitions actually applied in this run. */
  synced: number;
  /** Why the run was a no-op, when it never reached the provider. */
  skipped?: "no_provenance" | "provider_unsupported" | "no_folder_id";
  /** Captured provider/store error — the runner itself never throws. */
  error?: string;
}

export async function syncFolderFailures(
  deps: FailureSyncDeps,
  job: FailureSyncJobRow,
): Promise<FailureSyncResult> {
  // Gate order: provenance first — a legacy/non-blast folder must cost zero
  // provider calls, whatever the provider is.
  const provenance = parseDispatchProvenance(job.payload);
  if (!provenance) return { synced: 0, skipped: "no_provenance" };
  if (!deps.listFolderFailedMessages) {
    return { synced: 0, skipped: "provider_unsupported" };
  }
  if (!job.uazapi_sender_id) return { synced: 0, skipped: "no_folder_id" };

  let synced = 0;
  try {
    const messages = await deps.listFolderFailedMessages(job.uazapi_sender_id);
    // Fast path: no failures reported → don't touch the store at all.
    if (!Array.isArray(messages) || messages.length === 0) return { synced: 0 };

    const recipients = await deps.getSentRecipients(
      provenance.plan_id,
      provenance.lot_index,
    );
    const transitions = computeFailedTransitions(
      { provenance: job.payload, messages },
      recipients,
    );
    for (const transition of transitions) {
      await deps.markFailed(transition);
      synced += 1;
    }
    return { synced };
  } catch (e) {
    return { synced, error: e instanceof Error ? e.message : String(e) };
  }
}
