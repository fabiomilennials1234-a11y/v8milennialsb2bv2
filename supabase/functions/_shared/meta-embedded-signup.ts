/**
 * meta-embedded-signup — pure helpers for the WhatsApp Cloud CONNECTION flow
 * via Meta Embedded Signup (Slice 3, ADR-0009). No DB, no global state. All
 * network I/O goes through an injectable `fetchImpl`, so the OAuth code exchange,
 * WABA/phone validation, number registration and app-subscription calls are
 * testable without ever touching Meta.
 *
 * WHY this is a SEPARATE flow from `meta-oauth-callback` (Messenger/IG): that one
 * is a redirect-based OAuth that returns Page tokens. Embedded Signup is a popup
 * (Facebook JS SDK) that returns a short-lived `code` plus the WABA/phone the
 * user selected — exchanged here for a business token used to drive the WhatsApp
 * Cloud API. The two never share state.
 *
 * SECURITY: the access token resolved here is the WhatsApp Cloud token. It is
 * returned to the edge function ONLY so it can be stored via the service_role RPC
 * `set_meta_cloud_credentials` into the deny-all secrets table. It is NEVER
 * placed on a selectable column, logged, or echoed in an error (graphError
 * strips it). The org is resolved by the edge function from validated auth — this
 * module deals only with Meta-side resolution and the row/creds SHAPE.
 *
 * INERT until Meta App Review (Tech Provider) approves the app AND an Embedded
 * Signup `config_id` exists. With neither, the frontend never reaches here.
 */

const DEFAULT_VERSION = "v21.0";
const GRAPH_BASE = "https://graph.facebook.com";

export type FetchImpl = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

// ─── Errors ──────────────────────────────────────────────────────

/**
 * A typed error carrying a stable machine `code` plus a human message. The edge
 * function maps `code` → HTTP status and returns `{ error, code }` JSON so the
 * client can branch without string-matching. NEVER carries the access token.
 */
export class EmbeddedSignupError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "EmbeddedSignupError";
    this.code = code;
  }
}

/**
 * Normalizes a Graph `error` object into an EmbeddedSignupError. Deliberately
 * carries only the Graph-supplied message + code — never the access token, which
 * would otherwise leak through logs/Sentry if a caller prints the error.
 */
export function graphError(error: { message?: string; code?: number; type?: string }): EmbeddedSignupError {
  const code = error.code != null ? ` (code ${error.code})` : "";
  return new EmbeddedSignupError("graph_error", `Meta Graph error: ${error.message ?? "unknown"}${code}`);
}

// ─── Input validation (pure) ─────────────────────────────────────

export interface ExchangeRequestInput {
  code: unknown;
  waba_id?: unknown;
  phone_number_id?: unknown;
}

export interface ValidatedExchangeRequest {
  code: string;
  wabaId: string | null;
  phoneNumberId: string | null;
}

export interface ValidationOk {
  ok: true;
  value: ValidatedExchangeRequest;
}
export interface ValidationErr {
  ok: false;
  code: string;
  error: string;
}
export type ValidationResult = ValidationOk | ValidationErr;

/**
 * Validates the request body shape. `code` is mandatory (the Embedded Signup
 * short-lived code). `waba_id` / `phone_number_id` are optional here — Embedded
 * Signup posts them via sessionInfo, but a defensive flow can re-derive them from
 * the token's granted WABAs, so we accept their absence and resolve later.
 *
 * Pure: returns a Result the edge function maps to a 400. Note: it deliberately
 * does NOT accept/trust `organization_id` — the org is authoritative from the
 * validated auth context, never the body (tenant-forgery class).
 */
export function validateExchangeRequest(input: ExchangeRequestInput): ValidationResult {
  const code = typeof input.code === "string" ? input.code.trim() : "";
  if (!code) {
    return { ok: false, code: "missing_code", error: "code é obrigatório (Embedded Signup)" };
  }

  const wabaId = typeof input.waba_id === "string" && input.waba_id.trim() ? input.waba_id.trim() : null;
  const phoneNumberId =
    typeof input.phone_number_id === "string" && input.phone_number_id.trim()
      ? input.phone_number_id.trim()
      : null;

  return { ok: true, value: { code, wabaId, phoneNumberId } };
}

// ─── Row + creds construction (pure) ─────────────────────────────

export interface MetaCloudInstanceRow {
  organization_id: string;
  provider: "meta_cloud";
  instance_name: string;
  phone_number: string | null;
  status: "connected";
}

/**
 * Builds the `whatsapp_instances` row for a freshly-connected Meta Cloud number.
 * `displayPhoneNumber` (e.g. "+55 11 98888-7777") becomes the instance name when
 * present, otherwise we fall back to a phone_number_id-tagged label so the row is
 * still human-identifiable. `phone_number` stores the digits-only form for
 * lookups/formatting parity with Uazapi rows.
 *
 * Pure so the row can be asserted in tests; the edge function feeds the org from
 * the VALIDATED auth context — never the body.
 */
export function buildInstanceRow(args: {
  organizationId: string;
  phoneNumberId: string;
  displayPhoneNumber?: string | null;
  verifiedName?: string | null;
}): MetaCloudInstanceRow {
  const display = (args.displayPhoneNumber ?? "").trim();
  const verified = (args.verifiedName ?? "").trim();
  const instanceName = verified || display || `Meta WhatsApp ${args.phoneNumberId}`;
  const digits = display ? display.replace(/\D/g, "") : null;
  return {
    organization_id: args.organizationId,
    provider: "meta_cloud",
    instance_name: instanceName,
    phone_number: digits && digits.length > 0 ? digits : null,
    status: "connected",
  };
}

export interface MetaCloudCredsArgs {
  instanceId: string;
  organizationId: string;
  wabaId: string;
  phoneNumberId: string;
  accessToken: string;
}

/**
 * Builds the positional args for the `set_meta_cloud_credentials` RPC. Kept pure
 * so tests assert the exact mapping (including that the token is passed through
 * the RPC, never written to a selectable column). The RPC is service_role-only
 * and writes the deny-all `whatsapp_instance_secrets` table.
 */
export function buildSetCredentialsParams(args: MetaCloudCredsArgs): {
  p_instance_id: string;
  p_organization_id: string;
  p_meta_waba_id: string;
  p_meta_phone_number_id: string;
  p_meta_access_token: string;
} {
  return {
    p_instance_id: args.instanceId,
    p_organization_id: args.organizationId,
    p_meta_waba_id: args.wabaId,
    p_meta_phone_number_id: args.phoneNumberId,
    p_meta_access_token: args.accessToken,
  };
}

/**
 * The idempotency key for a Meta Cloud connection: (organization_id,
 * phone_number_id). Re-running Embedded Signup for the same number in the same
 * org must UPDATE the existing instance + creds, never spawn a duplicate. The
 * edge function looks up an existing instance with this key before inserting.
 */
export function idempotencyKey(organizationId: string, phoneNumberId: string): string {
  return `${organizationId}:${phoneNumberId}`;
}

// ─── Graph client (thin, injectable) ─────────────────────────────

export interface PhoneNumberInfo {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
}

export interface MetaEmbeddedSignupGraph {
  /**
   * Exchanges the Embedded Signup short-lived `code` for an access token
   * (Graph GET /oauth/access_token with client_id/client_secret/code). Returns
   * the token + optional expiry. Throws EmbeddedSignupError on Graph error.
   */
  exchangeCode(code: string): Promise<{ accessToken: string; expiresIn: number | null }>;

  /**
   * Lists the WABA ids the token can reach (debug_token granular_scopes →
   * whatsapp_business_management). Used to VALIDATE a body-supplied waba_id
   * against what the token actually granted (anti-forgery), and to derive it
   * when the body omitted it.
   */
  listGrantedWabaIds(token: string): Promise<string[]>;

  /** Reads a single phone number node (display number + verified name). */
  getPhoneNumber(phoneNumberId: string, token: string): Promise<PhoneNumberInfo>;

  /** Lists the phone numbers under a WABA (to derive phone_number_id if absent). */
  listPhoneNumbers(wabaId: string, token: string): Promise<PhoneNumberInfo[]>;

  /**
   * Registers a Cloud API phone number (POST /{phone_number_id}/register with a
   * 6-digit PIN). Idempotent on Meta's side: a re-register of an already-
   * registered number returns success. Returns true on success.
   */
  registerNumber(phoneNumberId: string, token: string, pin: string): Promise<boolean>;

  /** Subscribes the app to the WABA's webhooks (POST /{waba_id}/subscribed_apps). */
  subscribeApp(wabaId: string, token: string): Promise<boolean>;
}

export interface ExchangeCredentials {
  appId: string;
  appSecret: string;
  /** Optional — Embedded Signup token exchange does NOT require a redirect_uri. */
  redirectUri?: string;
}

export function createMetaEmbeddedSignupGraph(opts: {
  credentials: ExchangeCredentials;
  fetchImpl?: FetchImpl;
  version?: string;
}): MetaEmbeddedSignupGraph {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const version = opts.version ?? DEFAULT_VERSION;
  const base = `${GRAPH_BASE}/${version}`;
  const { appId, appSecret, redirectUri } = opts.credentials;

  async function readJson(res: Response): Promise<Record<string, unknown>> {
    const json = (await res.json()) as Record<string, unknown>;
    if (json.error) throw graphError(json.error as { message?: string; code?: number });
    return json;
  }

  return {
    async exchangeCode(code) {
      const params = new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        code,
      });
      // Embedded Signup with response_type:'code' does not use a redirect_uri,
      // but pass it through if the app config requires one.
      if (redirectUri) params.set("redirect_uri", redirectUri);

      const res = await fetchImpl(`${base}/oauth/access_token?${params}`);
      const json = await readJson(res);
      const token = typeof json.access_token === "string" ? json.access_token : "";
      if (!token) {
        throw new EmbeddedSignupError("token_exchange_failed", "Meta não retornou access_token");
      }
      const expiresIn = typeof json.expires_in === "number" ? json.expires_in : null;
      return { accessToken: token, expiresIn };
    },

    async listGrantedWabaIds(token) {
      // debug_token exposes granular_scopes; whatsapp_business_management carries
      // the WABA ids the user granted during Embedded Signup.
      const params = new URLSearchParams({
        input_token: token,
        // App access token form: {app_id}|{app_secret}.
        access_token: `${appId}|${appSecret}`,
      });
      const res = await fetchImpl(`${base}/debug_token?${params}`);
      const json = await readJson(res);
      const data = (json.data ?? {}) as { granular_scopes?: Array<{ scope?: string; target_ids?: string[] }> };
      const scopes = data.granular_scopes ?? [];
      const ids = new Set<string>();
      for (const s of scopes) {
        if (s.scope === "whatsapp_business_management" || s.scope === "whatsapp_business_messaging") {
          for (const id of s.target_ids ?? []) ids.add(String(id));
        }
      }
      return [...ids];
    },

    async getPhoneNumber(phoneNumberId, token) {
      const params = new URLSearchParams({
        fields: "id,display_phone_number,verified_name",
        access_token: token,
      });
      const res = await fetchImpl(`${base}/${phoneNumberId}?${params}`);
      const json = await readJson(res);
      return {
        id: String(json.id ?? phoneNumberId),
        display_phone_number: typeof json.display_phone_number === "string" ? json.display_phone_number : undefined,
        verified_name: typeof json.verified_name === "string" ? json.verified_name : undefined,
      };
    },

    async listPhoneNumbers(wabaId, token) {
      const params = new URLSearchParams({
        fields: "id,display_phone_number,verified_name",
        limit: "100",
        access_token: token,
      });
      const res = await fetchImpl(`${base}/${wabaId}/phone_numbers?${params}`);
      const json = await readJson(res);
      const rows = (json.data ?? []) as Array<Record<string, unknown>>;
      return rows.map((r) => ({
        id: String(r.id),
        display_phone_number: typeof r.display_phone_number === "string" ? r.display_phone_number : undefined,
        verified_name: typeof r.verified_name === "string" ? r.verified_name : undefined,
      }));
    },

    async registerNumber(phoneNumberId, token, pin) {
      const res = await fetchImpl(`${base}/${phoneNumberId}/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ messaging_product: "whatsapp", pin }),
      });
      const json = (await res.json()) as Record<string, unknown>;
      if (json.error) {
        const err = json.error as { message?: string; code?: number };
        // 133005 = already registered (a re-run) → treat as success (idempotent).
        if (err.code === 133005) return true;
        throw graphError(err);
      }
      return json.success === true;
    },

    async subscribeApp(wabaId, token) {
      const res = await fetchImpl(`${base}/${wabaId}/subscribed_apps`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });
      const json = (await res.json()) as Record<string, unknown>;
      if (json.error) throw graphError(json.error as { message?: string; code?: number });
      return json.success === true;
    },
  };
}

// ─── Orchestration helper (pure-ish — only Graph I/O via injected client) ──

export interface ResolveResult {
  wabaId: string;
  phoneNumberId: string;
  phone: PhoneNumberInfo;
}

/**
 * Resolves + validates the WABA and phone number against the token's actual
 * grants, after exchanging the code. The token's granted WABA ids are the source
 * of truth: a body-supplied `waba_id` MUST be among them (anti-forgery — a client
 * cannot bind a WABA it didn't grant). When the body omits the ids, they are
 * derived from the token. Returns the confirmed pair + phone display info.
 *
 * Throws EmbeddedSignupError with stable codes the edge fn maps to HTTP status.
 */
export async function resolveWabaAndPhone(
  graph: MetaEmbeddedSignupGraph,
  token: string,
  requested: { wabaId: string | null; phoneNumberId: string | null },
): Promise<ResolveResult> {
  const grantedWabas = await graph.listGrantedWabaIds(token);
  if (grantedWabas.length === 0) {
    throw new EmbeddedSignupError(
      "no_waba_granted",
      "O login Meta não concedeu acesso a nenhuma conta WhatsApp Business",
    );
  }

  let wabaId = requested.wabaId;
  if (wabaId) {
    // Anti-forgery: the requested WABA must be one the token actually granted.
    if (!grantedWabas.includes(wabaId)) {
      throw new EmbeddedSignupError(
        "waba_not_granted",
        "A conta WhatsApp Business informada não foi concedida por este login",
      );
    }
  } else {
    // Derive: when Embedded Signup didn't post a waba_id, and exactly one was
    // granted, use it. Ambiguous (multiple) → ask the client to re-run.
    if (grantedWabas.length > 1) {
      throw new EmbeddedSignupError(
        "ambiguous_waba",
        "Múltiplas contas WhatsApp Business concedidas — selecione uma no login",
      );
    }
    wabaId = grantedWabas[0];
  }

  let phoneNumberId = requested.phoneNumberId;
  let phone: PhoneNumberInfo;
  if (phoneNumberId) {
    phone = await graph.getPhoneNumber(phoneNumberId, token);
  } else {
    const numbers = await graph.listPhoneNumbers(wabaId, token);
    if (numbers.length === 0) {
      throw new EmbeddedSignupError("no_phone_number", "A conta WhatsApp Business não tem número cadastrado");
    }
    phone = numbers[0];
    phoneNumberId = phone.id;
  }

  return { wabaId, phoneNumberId, phone };
}
