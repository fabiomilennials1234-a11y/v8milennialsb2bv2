// deno-lint-ignore-file no-explicit-any

/**
 * Uazapi WhatsApp API — HTTP client
 *
 * Responsibilities:
 *  - Per-request auth header selection (token vs admintoken)
 *  - Timeout via AbortController
 *  - Exponential backoff retry on 5xx / timeout (max 3 attempts)
 *  - In-memory circuit breaker per token key (3 failures → 2 min cooldown)
 *  - 4xx errors are NOT retried and carry provider_code for upstream handling
 *  - Token never appears in logs
 *
 * NOTE: This module has no Deno-only runtime dependency — fetch,
 * AbortController, and setTimeout are available in both Deno and Node/Vitest.
 */

import {
  classifyBanSignal,
  instanceKeyFromToken,
  recordBanSignal,
} from "./reputation-signal.ts";
import type {
  UazapiClientConfig,
  UazapiError,
  UazapiInstanceInitInput,
  UazapiInstanceResponse,
  UazapiMessageResponse,
  UazapiSenderAdvancedInput,
  UazapiSenderCreateResponse,
  UazapiSenderFolder,
  UazapiSenderMessage,
  UazapiSenderResponse,
  UazapiSenderStatus,
  UazapiSendMediaInput,
  UazapiSendMenuInput,
  UazapiSendPixButtonInput,
  UazapiSendTextInput,
  UazapiNumberCheck,
} from "./uazapi-types.ts";
import { buildPixButtonBody } from "./uazapi-pix.ts";

// ---------------------------------------------------------------------------
// Sender status mapping — Uazapi vocabulary → app canonical enum
// ---------------------------------------------------------------------------

/**
 * Map the Uazapi /sender folder status to the app's canonical enum.
 *
 * Uazapi statuses observed live (2026-06-15):
 *   queued | scheduled | running | done | deleting
 *
 *   done     → completed
 *   scheduled→ queued
 *   queued   → queued
 *   running  → running
 *   failed   → failed       (defensive — not observed but mapped 1:1)
 *   deleting → cancelled    (terminal; user stop/cancel via /sender/edit delete)
 */
export function mapUazapiSenderStatus(raw: string | undefined): UazapiSenderStatus {
  switch ((raw ?? "").toLowerCase()) {
    case "done":
      return "completed";
    case "scheduled":
    case "queued":
      return "queued";
    case "running":
      return "running";
    case "paused":
      return "paused";
    case "failed":
      return "failed";
    case "deleting":
      // Folder is being torn down — reached only via /sender/edit action:delete,
      // which is how a user-initiated stop/cancel manifests. Surface as the
      // canonical "cancelled" (a terminal, non-running state in the DB CHECK) so
      // pollers stop and a user stop is never mislabelled as a failure.
      return "cancelled";
    default:
      return "failed";
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 15_000;
const MEDIA_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 3;
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 120_000;

/**
 * Path prefixes whose writes ENQUEUE message delivery. Treated as replay-unsafe
 * by default so a delivery endpoint added later inherits the safe behaviour.
 */
const DELIVERY_PATH_PREFIXES = ["/send/", "/sender/"] as const;

/**
 * The exceptions inside {@link DELIVERY_PATH_PREFIXES}: non-GET requests that do
 * NOT enqueue delivery, so replaying them is safe.
 *
 * - `/sender/edit` sets state (pause/resume/stop) on an existing campaign.
 *   Repeating it converges on the same result, and a failed pause is worse than
 *   a double pause.
 * - `/sender/listmessages` is a READ that happens to be a POST. It paginates a
 *   campaign's per-message statuses and is the failure-sync source; dropping its
 *   retry would let one transient 5xx abort a whole sync mid-pagination.
 *
 * Membership is by path because the delivery families are deny-by-default: an
 * endpoint added later is capped at one attempt until someone deliberately
 * lists it here. That direction is intentional — an unlisted read loses retry
 * (degraded resilience), whereas an unlisted send would re-deliver to leads.
 */
const REPLAY_SAFE_DELIVERY_PATHS: readonly string[] = [
  "/sender/edit",
  "/sender/listmessages",
];

// ---------------------------------------------------------------------------
// In-memory circuit breaker state (per token key, process-scoped)
// ---------------------------------------------------------------------------

interface CircuitState {
  failures: number;
  openUntil: number;
}

const circuitState = new Map<string, CircuitState>();

// ---------------------------------------------------------------------------
// UazapiClient
// ---------------------------------------------------------------------------

export class UazapiClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly adminToken?: string;
  private readonly timeoutMs: number;
  /** Optional DB id of this number — only for ban-signal correlation, never
   *  auth. Undefined at most construction sites today (see UazapiClientConfig). */
  private readonly instanceId?: string;

  constructor(config: UazapiClientConfig) {
    if (!config.baseUrl) {
      throw new Error("UazapiClient: baseUrl is required");
    }
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.token = config.token;
    this.adminToken = config.adminToken;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.instanceId = config.instanceId;
  }

  // =========================================================================
  // Instance (admin-token ops)
  // =========================================================================

  async initInstance(
    input: UazapiInstanceInitInput
  ): Promise<UazapiInstanceResponse> {
    return this.request<UazapiInstanceResponse>(
      "POST",
      "/instance/init",
      input,
      { useAdminToken: true }
    );
  }

  async getInstanceStatus(): Promise<{
    status: string;
    connected: boolean;
    paircode?: string;
    qrcode?: string;
  }> {
    return this.request(
      "GET",
      "/instance/status",
      undefined,
      { useAdminToken: false }
    );
  }

  /**
   * Regional proxy catalog. Uazapi caches it for 24h on their side; today the
   * public regional pool is Brazil-only. Requires a valid instance token.
   */
  async listProxyCities(
    country = "br",
    state?: string
  ): Promise<{ country: string; state?: string; cities: Array<{ value: string; label: string; state?: string }> }> {
    const qs = new URLSearchParams({ country });
    if (state) qs.set("state", state);
    return this.request(
      "GET",
      `/proxy-managed/cities?${qs.toString()}`,
      undefined,
      { useAdminToken: false }
    );
  }

  /**
   * Connect the instance, optionally pinning the managed proxy to a region.
   *
   * `proxy_managed_*` is accepted ONLY here — not on instance creation — so the
   * region is decided at connect time. Since connect only runs on a disconnected
   * instance, this never interrupts a live session, and existing instances adopt
   * the region as they naturally reconnect.
   *
   * `region` absent means: send nothing and keep today's behaviour. Failure to
   * derive a region must never cost a connection.
   */
  async connectInstance(
    phone?: string,
    region?: {
      proxy_managed_country: string;
      proxy_managed_state: string;
      proxy_managed_city: string;
    }
  ): Promise<{
    qrcode?: string;
    paircode?: string;
  }> {
    const body: Record<string, unknown> = {};
    if (phone) body.phone = phone;
    if (region) Object.assign(body, region);

    return this.request(
      "POST",
      "/instance/connect",
      Object.keys(body).length > 0 ? body : undefined,
      { useAdminToken: false }
    );
  }

  async deleteInstance(): Promise<void> {
    // uazapiGO: DELETE /instance authenticated with the INSTANCE token.
    // (The previous `DELETE /instance/delete` + admintoken was rejected 405 by
    //  the managed server, silently orphaning the Uazapi instance + its WhatsApp
    //  linked-device session — the "logged out from another device" flapping.)
    await this.request<unknown>(
      "DELETE",
      "/instance",
      undefined,
      { useAdminToken: false }
    );
  }

  async logoutInstance(): Promise<void> {
    // uazapiGO: POST /instance/disconnect (instance token) frees the WhatsApp
    // linked-device session without deleting the instance record.
    await this.request<unknown>(
      "POST",
      "/instance/disconnect",
      undefined,
      { useAdminToken: false }
    );
  }

  async updateWebhook(config: {
    url: string;
    events: string[];
    excludeMessages?: string[];
    addUrlTypesMessages?: boolean;
    addUrlEvents?: boolean;
    enabled?: boolean;
    id?: string;
    action?: "add" | "update" | "delete";
  }): Promise<void> {
    const body = { enabled: true, ...config };
    await this.request<unknown>(
      "POST",
      "/webhook",
      body,
      { useAdminToken: false }
    );
  }

  /**
   * Reads the webhook config Uazapi currently has stored for this instance.
   * Read-only (GET /webhook, per-instance token). Used to VERIFY that an
   * updateWebhook actually persisted — a POST /webhook returns 200 even when
   * Uazapi silently no-ops, so a 200 is not proof the webhook is bound
   * (incident 2026-06-24). Returns the raw provider object; callers normalise.
   */
  async getWebhook(): Promise<unknown> {
    return this.request<unknown>(
      "GET",
      "/webhook",
      undefined,
      { useAdminToken: false }
    );
  }

  async getMessageLimits(): Promise<{
    current: number;
    limit: number;
    reachout_timelock?: number;
  }> {
    return this.request(
      "GET",
      "/instance/wa_messages_limits",
      undefined,
      { useAdminToken: false }
    );
  }

  // =========================================================================
  // Send
  // =========================================================================

  async sendText(input: UazapiSendTextInput): Promise<UazapiMessageResponse> {
    return this.request<UazapiMessageResponse>("POST", "/send/text", input);
  }

  async sendMedia(
    input: UazapiSendMediaInput
  ): Promise<UazapiMessageResponse> {
    return this.request<UazapiMessageResponse>(
      "POST",
      "/send/media",
      input,
      { timeoutMs: MEDIA_TIMEOUT_MS }
    );
  }

  async sendMenu(input: UazapiSendMenuInput): Promise<UazapiMessageResponse> {
    return this.request<UazapiMessageResponse>("POST", "/send/menu", input);
  }

  async sendPixButton(
    input: UazapiSendPixButtonInput
  ): Promise<UazapiMessageResponse> {
    // Mapeia pros nomes de campo que a Uazapi exige (pixKey/pixType/pixName) —
    // mandar `pixkey`/`pixkeyType`/`merchantName` dava "Missing required fields".
    return this.request<UazapiMessageResponse>(
      "POST",
      "/send/pix-button",
      buildPixButtonBody(input)
    );
  }

  // =========================================================================
  // Chat
  // =========================================================================

  /**
   * Check whether numbers are registered on WhatsApp (POST /chat/check).
   * Returns one verdict per input number; `isInWhatsapp:false` is the
   * authoritative "not on WhatsApp" signal. Uazapi answers 200 even for
   * unregistered numbers — a 5xx here means the instance is disconnected
   * (transient infra), not a per-number verdict, so callers must treat a
   * thrown error as "unknown" and NOT as "not reachable".
   */
  async checkNumbers(numbers: string[]): Promise<UazapiNumberCheck[]> {
    return this.request<UazapiNumberCheck[]>("POST", "/chat/check", { numbers });
  }

  // =========================================================================
  // Sender (mass send)
  // =========================================================================

  /**
   * CREATE a sender campaign. Returns { folder_id, count, status } where
   * `folder_id` is the campaign id and `count` is the number of messages
   * ACCEPTED by Uazapi (0 if any item was rejected — e.g. missing `type`).
   */
  async senderAdvanced(
    input: UazapiSenderAdvancedInput
  ): Promise<UazapiSenderCreateResponse> {
    return this.request<UazapiSenderCreateResponse>(
      "POST",
      "/sender/advanced",
      input
    );
  }

  /** LIST all sender campaigns (folders). GET /sender/list is 404 — use listfolders. */
  async senderList(): Promise<UazapiSenderFolder[]> {
    const res = await this.request<UazapiSenderFolder[]>(
      "GET",
      "/sender/listfolders"
    );
    return Array.isArray(res) ? res : [];
  }

  /**
   * Resolve a single campaign by id. GET /sender/{id} is 404; the campaign
   * lives in /sender/listfolders. Find by id, then map the Uazapi metric/status
   * vocabulary to the app's canonical shape.
   */
  async senderGet(folderId: string): Promise<UazapiSenderResponse> {
    const folders = await this.senderList();
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) {
      throw {
        status: 404,
        message: `Sender folder ${folderId} not found in /sender/listfolders`,
        provider_code: "sender_folder_not_found",
      } satisfies UazapiError;
    }
    return {
      status: mapUazapiSenderStatus(folder.status),
      sent: folder.log_sucess ?? 0,
      failed: folder.log_failed ?? 0,
      total: folder.log_total ?? 0,
    };
  }

  /**
   * LIST a sender campaign's per-message statuses — POST /sender/listmessages
   * (spike #943 / ADR-0016). Instance-token endpoint, same auth scheme as
   * /sender/listfolders. Paginates until exhausted (limit 1000/page, capped at
   * 100 pages as a runaway guard) and flattens the {messages, pagination}
   * envelope. Rows come back raw: Uazapi has documented doc↔server drift, so
   * shape guarantees live with the consumer (failure-sync core), not here —
   * this method only guarantees "array, never throws on a weird envelope".
   */
  async senderListMessages(
    folderId: string,
    opts: { messageStatus?: "Scheduled" | "Sent" | "Failed" } = {}
  ): Promise<UazapiSenderMessage[]> {
    const limit = 1000;
    const maxPages = 100; // 100k messages — far beyond any real folder
    const messages: UazapiSenderMessage[] = [];
    for (let page = 0; page < maxPages; page++) {
      const res = await this.request<unknown>("POST", "/sender/listmessages", {
        folder_id: folderId,
        ...(opts.messageStatus ? { messageStatus: opts.messageStatus } : {}),
        limit,
        offset: page * limit,
      });
      const batch: UazapiSenderMessage[] = Array.isArray((res as any)?.messages)
        ? (res as any).messages
        : Array.isArray(res)
          ? (res as UazapiSenderMessage[])
          : [];
      messages.push(...batch);
      if (batch.length < limit) break;
    }
    return messages;
  }

  /**
   * Sender campaign control. Uazapi exposes only POST /sender/edit with
   * action stop | continue | delete (no pause/resume primitive).
   */
  private async senderEdit(
    folderId: string,
    action: "stop" | "continue" | "delete"
  ): Promise<void> {
    await this.request<unknown>("POST", "/sender/edit", {
      folder_id: folderId,
      action,
    });
  }

  // NOTE: Uazapi has no native pause/resume. We map the app's pause→stop and
  // resume→continue onto /sender/edit. A stopped campaign that is continued
  // resumes from where it stopped.
  async senderPause(folderId: string): Promise<void> {
    await this.senderEdit(folderId, "stop");
  }

  async senderResume(folderId: string): Promise<void> {
    await this.senderEdit(folderId, "continue");
  }

  async senderStop(folderId: string): Promise<void> {
    await this.senderEdit(folderId, "delete");
  }

  // =========================================================================
  // Message actions
  // =========================================================================

  async react(
    messageId: string,
    number: string,
    emoji: string
  ): Promise<void> {
    await this.request<unknown>("POST", "/message/react", {
      id: messageId,
      number,
      emoji,
    });
  }

  async edit(
    messageId: string,
    number: string,
    newText: string
  ): Promise<void> {
    await this.request<unknown>("POST", "/message/edit", {
      id: messageId,
      number,
      text: newText,
    });
  }

  async pin(messageId: string, number: string): Promise<void> {
    await this.request<unknown>("POST", "/message/pin", {
      id: messageId,
      number,
    });
  }

  async deleteForAll(messageId: string, number: string): Promise<void> {
    await this.request<unknown>("POST", "/message/delete", {
      id: messageId,
      number,
    });
  }

  /**
   * Marca mensagens como lidas (tique azul para o contato).
   *
   * ⚠️ `id` PRECISA ser array. Mandar string devolve HTTP 400
   * `{"error":"Invalid payload"}` — era o que este método fazia, e por isso
   * NENHUM read receipt jamais saiu do CRM (11/11 chamadas registradas em
   * runtime_logs falharam, em 3 orgs e 4 dias). Contrato verificado contra o
   * servidor em 28/07/2026:
   *   {id:"X", number}   → 400 Invalid payload
   *   {id:"X"}           → 400 Invalid payload
   *   {id:["X"]}         → 200 {"results":[{message_id, status, error?}]}
   * `number` é ignorado pelo endpoint; mantido fora do payload.
   *
   * A Uazapi responde **200 mesmo quando o item falha** (`status:"error"`,
   * ex. "Message not found"), então o resultado é inspecionado item a item —
   * sem isso uma falha real voltaria a passar por sucesso.
   */
  async markRead(messageIds: string | string[]): Promise<void> {
    const ids = (Array.isArray(messageIds) ? messageIds : [messageIds]).filter(
      (id) => typeof id === "string" && id.length > 0,
    );
    if (ids.length === 0) return;

    const res = await this.request<{
      results?: Array<{ message_id?: string; status?: string; error?: string }>;
    }>("POST", "/message/markread", { id: ids });

    const results = res?.results ?? [];
    const failed = results.filter((r) => r?.status === "error");
    if (results.length > 0 && failed.length === results.length) {
      const err: UazapiError = {
        status: 422,
        message: `markRead falhou para ${failed.length} mensagem(ns): ${
          failed[0]?.error ?? "erro desconhecido"
        }`,
        provider_code: "markread_all_failed",
      };
      throw err;
    }
  }

  async downloadMedia(messageId: string): Promise<{
    base64: string;
    mimetype: string;
    filename?: string;
  }> {
    return this.request(
      "POST",
      "/message/download",
      { id: messageId },
      { timeoutMs: MEDIA_TIMEOUT_MS }
    );
  }

  async listChats(type: "all" | "individual" | "group" = "all"): Promise<Array<{ id: string; name?: string; isGroup?: boolean; lastMessageTimestamp?: number }>> {
    const body: Record<string, unknown> = {
      sort: "-wa_lastMsgTimestamp",
      limit: 100,
      offset: 0,
    };
    if (type !== "all") {
      body.operator = "AND";
      body.filter = [{ field: "wa_isGroup", operator: "eq", value: type === "group" }];
    }
    const result = await this.request<any>("POST", "/chat/find", body);
    const raw: any[] = Array.isArray(result)
      ? result
      : Array.isArray(result?.data)
        ? result.data
        : Array.isArray(result?.chats)
          ? result.chats
          : [];
    return raw.map((c: any) => ({
      id: c.wa_chatid ?? c.jid ?? c.chatId ?? c.wa_id ?? c.phone ?? c.id ?? "",
      name: c.wa_contactName ?? c.wa_name ?? c.name ?? c.pushName ?? c.notify ?? undefined,
      isGroup: c.wa_isGroup === true || String(c.wa_chatid ?? c.jid ?? c.id ?? "").endsWith("@g.us"),
      lastMessageTimestamp: c.wa_lastMsgTimestamp ?? c.lastMessageTimestamp ?? c.t ?? undefined,
    }));
  }

  async historySync(input: {
    number: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ messages: unknown[]; nextCursor?: string }> {
    const body: Record<string, unknown> = {
      chatId: input.number,
      limit: input.limit ?? 100,
    };
    if (input.cursor) {
      body.offset = Number(input.cursor) || 0;
    }
    const result = await this.request<any>("POST", "/message/find", body);
    const messages: unknown[] = Array.isArray(result)
      ? result
      : Array.isArray(result?.data)
        ? result.data
        : Array.isArray(result?.messages)
          ? result.messages
          : [];
    const offset = (Number(input.cursor) || 0) + messages.length;
    return {
      messages,
      nextCursor: messages.length >= (input.limit ?? 100) ? String(offset) : undefined,
    };
  }

  async setPresence(input: {
    number: string;
    presence:
      | "composing"
      | "recording"
      | "paused"
      | "available"
      | "unavailable";
    delay?: number;
  }): Promise<void> {
    await this.request<unknown>("POST", "/message/presence", input);
  }

  // =========================================================================
  // Internal
  // =========================================================================

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    opts?: { useAdminToken?: boolean; timeoutMs?: number }
  ): Promise<T> {
    const useAdmin = opts?.useAdminToken ?? false;
    const scope = useAdmin
      ? `admin:${this.adminToken ? "[present]" : "[missing]"}`
      : `token:${this.token ? "[present]" : "[missing]"}`;
    // Circuit breaker is scoped per endpoint group so a transient failure on
    // one endpoint never blocks unrelated ones sharing the same token. Media
    // sends transcode server-side on the provider (mp3/webm → ogg/opus for
    // WhatsApp voice notes) and 500 intermittently under load; isolating their
    // circuit prevents a media blip from cascading to text sends in the same
    // cron batch (observed: workflow audio 500 opening the shared breaker and
    // failing unrelated /send/text for 2 min).
    const cbKey = `${scope}:${UazapiClient.circuitGroup(path)}`;

    // ---- circuit breaker check ----
    const cb = circuitState.get(cbKey);
    if (cb && cb.openUntil > Date.now()) {
      const err: UazapiError = {
        status: 503,
        message: `Circuit breaker open for ${path} until ${new Date(
          cb.openUntil
        ).toISOString()}`,
        provider_code: "circuit_breaker_open",
      };
      throw err;
    }

    // ---- build auth headers ----
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (useAdmin) {
      if (!this.adminToken) {
        throw new Error(
          `UazapiClient: adminToken is required for ${method} ${path}`
        );
      }
      headers["admintoken"] = this.adminToken;
    } else {
      if (!this.token) {
        throw new Error(
          `UazapiClient: token is required for ${method} ${path}`
        );
      }
      headers["token"] = this.token;
    }

    const url = `${this.baseUrl}${path}`;
    const timeout = opts?.timeoutMs ?? this.timeoutMs;

    const maxAttempts = UazapiClient.isReplaySafe(method, path)
      ? MAX_RETRIES
      : 1;

    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      try {
        const res = await fetch(url, {
          method,
          headers,
          body:
            body !== undefined && method !== "GET"
              ? JSON.stringify(body)
              : undefined,
          signal: controller.signal,
        });
        clearTimeout(timer);

        // 4xx — do not retry, surface immediately
        if (res.status >= 400 && res.status < 500) {
          const errBody = await res.json().catch(() => ({}));
          const err: UazapiError = {
            provider_code:
              (errBody as any)?.code ??
              (errBody as any)?.error_code ??
              undefined,
            status: res.status,
            message:
              (errBody as any)?.message ??
              (errBody as any)?.error ??
              res.statusText,
            raw: errBody,
          };
          // Reputation signal (anti-ban Onda 0 QW4 + Send Governor foundation)
          // — OUT-OF-BAND telemetry only. Explicitly does NOT call
          // recordFailure/feed the circuit breaker (a ban-ish 4xx must never
          // open the breaker that blocks healthy sends, incl. the human
          // composer), and the 4xx contract is unchanged: throw immediately, no
          // retry. Best-effort by design.
          //
          // 463 (Meta/WhatsApp temporary restriction) and 429 (rate limit) both
          // fall here and are captured to runtime_logs by recordBanSignal. When
          // this client was constructed WITH an instanceId, the signal also
          // feeds the governor reputation state machine (record_ban_signal). At
          // most call sites today instanceId is undefined — request() holds only
          // the per-instance TOKEN, not the id — so the DB-backed reputation
          // update is driven from the governor gate layer instead; correlation
          // by id here is a wiring follow-up (thread instanceId into the
          // UazapiClient at construction). No fragile coupling is introduced.
          try {
            const cls = classifyBanSignal(res.status, errBody, err.message);
            if (cls.isBanSignal) {
              recordBanSignal({
                status: res.status,
                providerCode:
                  err.provider_code != null ? String(err.provider_code) : undefined,
                matchedBy: cls.matchedBy ?? "status",
                path,
                instanceKey: instanceKeyFromToken(useAdmin ? this.adminToken : this.token),
                instanceId: this.instanceId,
              });
            }
          } catch {
            // telemetry must never affect the send result
          }
          throw err;
        }

        // 5xx — record failure, retry. Capture the response body so the
        // provider reason (e.g. "number is not on WhatsApp") survives instead
        // of an opaque "server error 500". Uazapi returns 500 — not 4xx — for
        // some permanent recipient conditions, so the body is the only signal
        // that distinguishes bad-recipient from a genuine outage downstream.
        if (res.status >= 500) {
          const errBody = await res.json().catch(() => ({}));
          // Uazapi /send/text 500 body (per uazapiGO OpenAPI): rich object with
          // { error, error_source, provider_code:int, error_key:string, ... }.
          // error_key is the stable, human-readable marker; fall back to legacy
          // code/error_code, then to the numeric provider_code as a last resort.
          const providerMsg =
            (errBody as any)?.error ?? (errBody as any)?.message ?? null;
          const rawProviderCode =
            (errBody as any)?.error_key ??
            (errBody as any)?.code ??
            (errBody as any)?.error_code ??
            (errBody as any)?.provider_code;
          lastError = {
            provider_code:
              rawProviderCode != null ? String(rawProviderCode) : undefined,
            status: res.status,
            message: providerMsg
              ? `Uazapi server error ${res.status} on ${method} ${path}: ${providerMsg}`
              : `Uazapi server error ${res.status} on ${method} ${path}`,
            raw: errBody,
          } satisfies UazapiError;
          this.recordFailure(cbKey);
          if (attempt < maxAttempts - 1) await this.backoff(attempt);
          continue;
        }

        // 2xx / 3xx — success
        this.resetFailures(cbKey);

        // Some endpoints return 204 No Content
        if (
          res.status === 204 ||
          res.headers.get("content-length") === "0"
        ) {
          return undefined as unknown as T;
        }

        return (await res.json()) as T;
      } catch (e) {
        clearTimeout(timer);

        // AbortError = timeout
        if ((e as Error).name === "AbortError") {
          lastError = {
            status: 504,
            message: `Uazapi timeout after ${timeout}ms on ${method} ${path}`,
            provider_code: "timeout",
          } satisfies UazapiError;
          this.recordFailure(cbKey);
          if (attempt < maxAttempts - 1) await this.backoff(attempt);
          continue;
        }

        // 4xx re-throw immediately (no retry, no circuit breaker increment)
        if (
          typeof (e as any)?.status === "number" &&
          (e as any).status >= 400 &&
          (e as any).status < 500
        ) {
          throw e;
        }

        // Network or unknown error
        lastError = e;
        this.recordFailure(cbKey);
        if (attempt < maxAttempts - 1) await this.backoff(attempt);
      }
    }

    throw lastError;
  }

  /**
   * Maps a request path to a circuit-breaker group. Endpoints in different
   * groups have independent breakers, so a transient outage on one cannot
   * trip the breaker for another. Media is isolated because its server-side
   * transcode fails transiently under load far more often than text sends.
   */
  private static circuitGroup(path: string): string {
    if (path.startsWith("/send/media")) return "media";
    return "default";
  }

  /**
   * Whether a failed request may be replayed by the internal retry loop.
   *
   * Uazapi answers 500/timeout for delivery work it has actually accepted, so
   * replaying that work re-delivers it. For `/send/*` the cost is one duplicate
   * message (SC Beauty "4× Bom dia" incident, 2026-07-07). For
   * `/sender/advanced` it is the ENTIRE campaign — the whole recipient list
   * goes out twice — and it is also our heaviest request, so it is the most
   * likely to time out after the provider already took the job.
   *
   * Ambiguous delivery failures therefore surface once and the caller decides;
   * it treats them as terminal.
   *
   * GETs are always safe. Within the delivery families the default is unsafe,
   * with {@link REPLAY_SAFE_DELIVERY_PATHS} naming the exceptions.
   */
  private static isReplaySafe(method: string, path: string): boolean {
    if (method === "GET") return true;
    const isDelivery = DELIVERY_PATH_PREFIXES.some((p) => path.startsWith(p));
    if (!isDelivery) return true;
    return REPLAY_SAFE_DELIVERY_PATHS.includes(path);
  }

  private async backoff(attempt: number): Promise<void> {
    const base = Math.min(1_000 * Math.pow(2, attempt), 8_000);
    const jitter = Math.random() * 500;
    await new Promise<void>((resolve) =>
      setTimeout(resolve, base + jitter)
    );
  }

  private recordFailure(key: string): void {
    const state = circuitState.get(key) ?? { failures: 0, openUntil: 0 };
    state.failures += 1;
    if (state.failures >= CIRCUIT_BREAKER_THRESHOLD) {
      state.openUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
      state.failures = 0; // reset count after opening
    }
    circuitState.set(key, state);
  }

  private resetFailures(key: string): void {
    const state = circuitState.get(key);
    if (state) {
      state.failures = 0;
      state.openUntil = 0;
    }
  }

  /**
   * Expose circuit state for testing only — not part of the public API.
   * @internal
   */
  static _circuitState(): Map<string, CircuitState> {
    return circuitState;
  }

  /** Clear all circuit state — for test isolation only. @internal */
  static _resetCircuitState(): void {
    circuitState.clear();
  }
}
