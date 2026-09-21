import type {
  TothPreorderEngineOptions,
  TothPreorderObservation,
  TothPreorderOperation,
  TothPreorderProcessResult,
} from "./contracts.ts";
import { isTothPreorderApprovedTotal, parseTothPreorderOperation } from "./contracts.ts";

const observationKeys = new Set([
  "operation_id", "external_id", "status", "source", "source_marker", "source_order", "approved_total",
]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const identifier = (value: unknown): value is string => typeof value === "string"
  && value.length > 0 && value.length <= 256 && value === value.trim() && !/\p{Cc}/u.test(value);

/** Fail closed on malformed/error JSON and unrecognized supplier statuses. */
export function readTothPreorderObservation(
  raw: unknown,
  operation_id: string,
  source: TothPreorderObservation["source"],
): TothPreorderObservation | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some((key) => !observationKeys.has(key))) return null;
  if (!uuid.test(operation_id) || value.operation_id !== operation_id || value.source !== source
    || !identifier(value.external_id) || value.external_id.length > 128 || !identifier(value.source_marker)
    || typeof value.source_order !== "number" || !Number.isSafeInteger(value.source_order) || value.source_order < 0
    || typeof value.status !== "string" || !["pending", "approved", "rejected", "unknown"].includes(value.status)) return null;
  if (value.status === "approved") {
    if (source !== "authoritative_lookup" || !isTothPreorderApprovedTotal(value.approved_total)) return null;
  } else if (value.approved_total !== null) return null;
  // A receipt is not proof of a commercial decision, even if a response happens
  // to contain an approval/rejection-looking label. Query it independently.
  if (source === "authoritative_create" && value.status !== "pending" && value.status !== "unknown") return null;
  return {
    operation_id,
    external_id: value.external_id,
    status: value.status as TothPreorderObservation["status"],
    source,
    source_marker: value.source_marker,
    source_order: value.source_order,
    approved_total: value.approved_total as number | null,
  };
}

export async function processTothPreorder(
  operation_id: string,
  { store, adapter, send_enabled, now = Date.now }: TothPreorderEngineOptions,
): Promise<TothPreorderProcessResult> {
  const result = (disposition: TothPreorderProcessResult["disposition"], reason_code?: string): TothPreorderProcessResult =>
    ({ operation_id, disposition, ...(reason_code ? { reason_code } : {}) });
  if (!uuid.test(operation_id)) return result("blocked", "invalid_operation_id");
  const stored = await store.claim(operation_id);
  if (!stored) return result("busy");
  const claimed = parseTothPreorderOperation(stored);
  if (!claimed) return result("blocked", "invalid_claim");
  const token = claimed.lease_token;
  if (claimed.id !== operation_id || !identifier(token) || !claimed.lease_expires_at
    || Date.parse(claimed.lease_expires_at) <= now()) return result("blocked", "invalid_claim");

  const held = (operation: TothPreorderOperation | null): operation is TothPreorderOperation =>
    !!operation && parseTothPreorderOperation(operation) !== null
    && operation.id === operation_id && operation.lease_token === token
    && operation.lease_expires_at !== null && Date.parse(operation.lease_expires_at) > now();
  const uncertain = async (code: string) => held(await store.mark_uncertain(operation_id, token, code))
    ? result("awaiting_confirmation", code) : result("lease_lost");
  const block = async (code: string) => held(await store.block(operation_id, token, code))
    ? result("blocked", code) : result("lease_lost");
  const reconcile = async (): Promise<TothPreorderProcessResult> => {
    try {
      const updated = await store.reconcile(operation_id, token);
      if (!held(updated)) return result("lease_lost");
      if (updated.reconciliation_state === "complete") return result("reconciled");
      if (updated.reconciliation_state === "blocked") return result("blocked", "reconciliation_blocked");
      return result("reconciliation_pending", "reconciliation_pending");
    } catch {
      // The stored authoritative approval remains pending. This never calls create.
      if (!held(await store.mark_uncertain(operation_id, token, "reconciliation_failed"))) return result("lease_lost");
      return result("reconciliation_pending", "reconciliation_failed");
    }
  };

  try {
    // Recovery of already recorded approval is local and remains available even
    // while the adapter or the switch for new sends is disabled.
    if (claimed.commercial_state === "approved" && claimed.reconciliation_state === "pending") {
      return await reconcile();
    }

    let current = claimed;
    let raw: unknown;
    let source: TothPreorderObservation["source"];
    if (current.delivery_state === "queued") {
      if (current.external_id !== null || current.source_marker !== null) return await block("invalid_queued_state");
      if (send_enabled !== true) return result("blocked", "writes_disabled");
      if (adapter.can_create !== true) return await block("supplier_contract_unverified");
      const sending = await store.mark_sending(operation_id, token);
      if (!held(sending)) return result("lease_lost");
      if (sending.delivery_state === "blocked" || sending.reconciliation_state === "blocked") {
        return result("blocked", "dispatch_preconditions_changed");
      }
      if (sending.delivery_state !== "sending") return result("blocked", "invalid_sending_transition");
      current = sending;
      source = "authoritative_create";
      try { raw = await adapter.create(current); }
      catch { return await uncertain("create_result_uncertain"); }
    } else if (["sending", "awaiting_confirmation", "received"].includes(current.delivery_state)) {
      // Includes expired sending leases, confirmed receipts and recognized sales.
      // An absent lookup result can NEVER cause another create call.
      if (adapter.can_lookup !== true) return await uncertain("lookup_unavailable");
      source = "authoritative_lookup";
      try { raw = await adapter.lookup(current); }
      catch { return await uncertain("lookup_failed"); }
    } else {
      return result("blocked", "operation_not_dispatchable");
    }

    const observation = readTothPreorderObservation(raw, operation_id, source);
    if (!observation) return await uncertain("invalid_provider_observation");
    if (current.external_id !== null && current.external_id !== observation.external_id) {
      return await block("external_identity_changed");
    }
    let saved: TothPreorderOperation | null;
    try { saved = await store.record_observation(operation_id, token, observation); }
    catch { return await uncertain("observation_persistence_failed"); }
    if (!held(saved)) return result("lease_lost");
    if (saved.reconciliation_state === "blocked") return result("blocked", "reconciliation_blocked");
    if (saved.commercial_state === "approved" && saved.reconciliation_state === "pending") {
      return await reconcile();
    }
    return result("received");
  } finally {
    // Server CAS makes an old worker's release harmless if another worker owns
    // the lease. A release failure leaves a lease to expire; it never retries I/O.
    await store.release(operation_id, token);
  }
}
