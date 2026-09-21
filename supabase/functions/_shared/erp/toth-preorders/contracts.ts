/** Internal normalized contracts. None of these fields defines a Toth API. */
export type TothPreorderDeliveryState =
  | "queued" | "sending" | "awaiting_confirmation" | "received" | "failed" | "blocked";
export type TothPreorderCommercialState = "pending" | "approved" | "rejected" | "unknown";
export type TothPreorderReconciliationState = "not_due" | "pending" | "complete" | "blocked";
export type TothPreorderJson = string | number | boolean | null
  | TothPreorderJson[] | { [key: string]: TothPreorderJson };

export interface TothPreorderOperation {
  id: string;
  organization_id: string;
  deal_id: string;
  draft_revision: number;
  delivery_state: TothPreorderDeliveryState;
  commercial_state: TothPreorderCommercialState;
  reconciliation_state: TothPreorderReconciliationState;
  external_id: string | null;
  approved_total: number | null;
  source_marker: string | null;
  source_order: number | null;
  /** Frozen by the server from the exact reviewed draft; never supplied by a worker caller. */
  request_snapshot: { [key: string]: TothPreorderJson };
  lease_token: string | null;
  lease_expires_at: string | null;
}

export interface TothPreorderObservation {
  operation_id: string;
  /** Stable normalized identity. Mapping pre-order -> approved order needs a verified contract. */
  external_id: string;
  status: TothPreorderCommercialState;
  /** Attested by a verified adapter, never copied blindly from supplier JSON. */
  source: "authoritative_create" | "authoritative_lookup";
  source_marker: string;
  /**
   * Monotonic ordering derived from a verified authoritative supplier marker.
   * It may be backed by a sequence or documented timestamp; it is NOT an
   * assumed ERP version, local arrival time, polling counter or random value.
   * Until such ordering is verified, the production adapter remains unavailable.
   */
  source_order: number;
  approved_total: number | null;
}

export interface TothPreorderAdapter {
  readonly can_create: boolean;
  readonly can_lookup: boolean;
  /** Adapter methods return normalized observations; unknown forces runtime validation. */
  create(operation: Readonly<TothPreorderOperation>): Promise<unknown>;
  lookup(operation: Readonly<TothPreorderOperation>): Promise<unknown>;
}

/**
 * All transitions atomically compare an unexpired lease token on the server.
 * A null result means the lease was lost; no subsequent network write is allowed.
 * Reads/confirmation are independent of the switch for new submissions.
 */
export interface TothPreorderStore {
  /** Existing durable operation only. Expired `sending` stays `sending`, never queued. */
  claim(operation_id: string): Promise<TothPreorderOperation | null>;
  /** CAS queued -> sending committed BEFORE any external create call. */
  mark_sending(operation_id: string, lease_token: string): Promise<TothPreorderOperation | null>;
  /**
   * Bind identity, ignore older source_order, reject same-order conflicts and
   * deduplicate exact observations. Approved requires authoritative_lookup.
   * After a recognized sale, later status/total divergence is blocked for
   * review, never reversed, resubmitted, or recognized as a second sale.
   */
  record_observation(operation_id: string, lease_token: string, observation: TothPreorderObservation): Promise<TothPreorderOperation | null>;
  /** Preserve confirmed observations; after receipt only annotate the failed check. */
  mark_uncertain(operation_id: string, lease_token: string, error_code: string): Promise<TothPreorderOperation | null>;
  block(operation_id: string, lease_token: string, error_code: string): Promise<TothPreorderOperation | null>;
  /** Reconcile persisted approval exactly once; a failed transaction leaves it pending. */
  reconcile(operation_id: string, lease_token: string): Promise<TothPreorderOperation | null>;
  release(operation_id: string, lease_token: string): Promise<void>;
}

export interface TothPreorderProcessResult {
  operation_id: string;
  disposition: "busy" | "blocked" | "awaiting_confirmation" | "received"
    | "reconciled" | "reconciliation_pending" | "lease_lost";
  reason_code?: string;
}

export interface TothPreorderEngineOptions {
  store: TothPreorderStore;
  adapter: TothPreorderAdapter;
  /** Strict boolean; controls new creates only, never lookups or local recovery. */
  send_enabled: boolean;
  /** Local lease preflight; the database remains authoritative for every CAS. */
  now?: () => number;
}

/** This rollout is deliberately restricted to the approved Café Jurerê pilot. */
export const TOTH_PREORDER_PILOT_ORG_ID = "4922638c-4909-494e-ba10-12282ec0b161";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string => typeof value === "string" && uuidPattern.test(value);
/** Match PostgreSQL length(text), not JavaScript's UTF-16 code-unit count. */
export const tothPreorderTextLength = (value: string): number => Array.from(value).length;
const isIdentifier = (value: unknown): value is string => typeof value === "string"
  && value.length > 0 && tothPreorderTextLength(value) <= 256
  // SQL btrim(text) trims ASCII spaces; preserve every other canonical character.
  && !value.startsWith(" ") && !value.endsWith(" ") && !/\p{Cc}/u.test(value);
const isObject = (value: unknown): value is Record<string, unknown> => !!value
  && typeof value === "object" && !Array.isArray(value);

/** Internal BRL amount constraint; does not calculate or override supplier prices. */
export function isTothPreorderApprovedTotal(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    && value <= 9999999999.99 && Math.round(value * 100) / 100 === value;
}

function isReviewedSnapshot(value: Record<string, unknown>, deal_id: string, revision: number): boolean {
  if (value.schema_version !== 1 || !isUuid(value.id) || value.deal_id !== deal_id
    || value.revision !== revision || !isUuid(value.lead_id) || !isUuid(value.client_id)
    || !isIdentifier(value.customer_external_id) || tothPreorderTextLength(value.customer_external_id) > 128
    || value.currency !== "BRL" || !["open", "won"].includes(value.deal_outcome as string)
    || (value.deal_value !== null && (typeof value.deal_value !== "number" || !Number.isFinite(value.deal_value) || value.deal_value < 0))
    || typeof value.notes !== "string" || tothPreorderTextLength(value.notes) > 1000
    || !Array.isArray(value.items) || value.items.length < 1 || value.items.length > 200) return false;
  const products = new Set<string>();
  for (const item of value.items) {
    if (!isObject(item) || Object.keys(item).length !== 2
      || !isIdentifier(item.product_external_id) || tothPreorderTextLength(item.product_external_id) > 128
      || products.has(item.product_external_id) || typeof item.quantity !== "number"
      || !Number.isFinite(item.quantity) || item.quantity <= 0 || item.quantity > 1e9) return false;
    products.add(item.product_external_id);
  }
  return true;
}

/** Validate JSON without accepting functions, non-finite values or recursive objects. */
function isBoundedJson(value: unknown, remaining: { nodes: number }, depth = 0): value is TothPreorderJson {
  if (--remaining.nodes < 0 || depth > 10) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "string") return value.length <= 10000;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 1000 && value.every((item) => isBoundedJson(item, remaining, depth + 1));
  if (!isObject(value)) return false;
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
  return Object.entries(value).every(([key, item]) => key.length <= 128 && isBoundedJson(item, remaining, depth + 1));
}

/** Runtime boundary for service-only RPC output; never exposes or mutates the raw object. */
export function parseTothPreorderOperation(raw: unknown): TothPreorderOperation | null {
  if (!isObject(raw) || !isUuid(raw.id) || !isUuid(raw.deal_id)
    || raw.organization_id !== TOTH_PREORDER_PILOT_ORG_ID
    || typeof raw.draft_revision !== "number" || !Number.isSafeInteger(raw.draft_revision)
    || raw.draft_revision <= 0 || raw.draft_revision > 2147483647
    || typeof raw.delivery_state !== "string" || !["queued", "sending", "awaiting_confirmation", "received", "failed", "blocked"].includes(raw.delivery_state)
    || typeof raw.commercial_state !== "string" || !["pending", "approved", "rejected", "unknown"].includes(raw.commercial_state)
    || typeof raw.reconciliation_state !== "string" || !["not_due", "pending", "complete", "blocked"].includes(raw.reconciliation_state)
    || (raw.external_id !== null && (!isIdentifier(raw.external_id) || tothPreorderTextLength(raw.external_id) > 128))
    || (raw.source_marker !== null && !isIdentifier(raw.source_marker))
    || (raw.source_order !== null && (typeof raw.source_order !== "number" || !Number.isSafeInteger(raw.source_order) || raw.source_order < 0))
    || (raw.approved_total !== null && !isTothPreorderApprovedTotal(raw.approved_total))
    || (raw.lease_token !== null && !isUuid(raw.lease_token))
    || (raw.lease_expires_at !== null && (typeof raw.lease_expires_at !== "string" || !Number.isFinite(Date.parse(raw.lease_expires_at))))
    || !isObject(raw.request_snapshot) || !isBoundedJson(raw.request_snapshot, { nodes: 10000 })
    || !isReviewedSnapshot(raw.request_snapshot, raw.deal_id, raw.draft_revision)) return null;
  if ((raw.lease_token === null) !== (raw.lease_expires_at === null)
    || (raw.source_marker === null) !== (raw.source_order === null)) return null;
  if (raw.commercial_state === "approved" && (raw.external_id === null
    || raw.source_marker === null || raw.approved_total === null)) return null;
  if ((raw.reconciliation_state === "pending" || raw.reconciliation_state === "complete")
    && raw.commercial_state !== "approved") return null;
  return {
    id: raw.id,
    organization_id: TOTH_PREORDER_PILOT_ORG_ID,
    deal_id: raw.deal_id,
    draft_revision: raw.draft_revision,
    delivery_state: raw.delivery_state as TothPreorderDeliveryState,
    commercial_state: raw.commercial_state as TothPreorderCommercialState,
    reconciliation_state: raw.reconciliation_state as TothPreorderReconciliationState,
    external_id: raw.external_id as string | null,
    approved_total: raw.approved_total as number | null,
    source_marker: raw.source_marker as string | null,
    source_order: raw.source_order as number | null,
    request_snapshot: JSON.parse(JSON.stringify(raw.request_snapshot)) as TothPreorderOperation["request_snapshot"],
    lease_token: raw.lease_token as string | null,
    lease_expires_at: raw.lease_expires_at as string | null,
  };
}
