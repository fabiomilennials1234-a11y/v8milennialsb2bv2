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

import type {
  UazapiClientConfig,
  UazapiError,
  UazapiInstanceInitInput,
  UazapiInstanceResponse,
  UazapiMessageResponse,
  UazapiSenderAdvancedInput,
  UazapiSenderResponse,
  UazapiSendMediaInput,
  UazapiSendMenuInput,
  UazapiSendPixButtonInput,
  UazapiSendTextInput,
} from "./uazapi-types.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 15_000;
const MEDIA_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 3;
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 120_000;

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

  constructor(config: UazapiClientConfig) {
    if (!config.baseUrl) {
      throw new Error("UazapiClient: baseUrl is required");
    }
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.token = config.token;
    this.adminToken = config.adminToken;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
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

  async connectInstance(phone?: string): Promise<{
    qrcode?: string;
    paircode?: string;
  }> {
    return this.request(
      "POST",
      "/instance/connect",
      phone ? { phone } : undefined,
      { useAdminToken: false }
    );
  }

  async deleteInstance(): Promise<void> {
    await this.request<unknown>(
      "DELETE",
      "/instance/delete",
      undefined,
      { useAdminToken: true }
    );
  }

  async logoutInstance(): Promise<void> {
    await this.request<unknown>(
      "POST",
      "/instance/logout",
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
    return this.request<UazapiMessageResponse>(
      "POST",
      "/send/pix-button",
      input
    );
  }

  // =========================================================================
  // Sender (mass send)
  // =========================================================================

  async senderAdvanced(
    input: UazapiSenderAdvancedInput
  ): Promise<UazapiSenderResponse> {
    return this.request<UazapiSenderResponse>(
      "POST",
      "/sender/advanced",
      input
    );
  }

  async senderList(): Promise<UazapiSenderResponse[]> {
    return this.request<UazapiSenderResponse[]>("GET", "/sender/list");
  }

  async senderGet(senderId: string): Promise<UazapiSenderResponse> {
    return this.request<UazapiSenderResponse>(
      "GET",
      `/sender/${encodeURIComponent(senderId)}`
    );
  }

  async senderPause(senderId: string): Promise<void> {
    await this.request<unknown>("POST", "/sender/pause", {
      sender_id: senderId,
    });
  }

  async senderResume(senderId: string): Promise<void> {
    await this.request<unknown>("POST", "/sender/resume", {
      sender_id: senderId,
    });
  }

  async senderStop(senderId: string): Promise<void> {
    await this.request<unknown>("POST", "/sender/stop", {
      sender_id: senderId,
    });
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

  async markRead(messageId: string, number: string): Promise<void> {
    await this.request<unknown>("POST", "/message/markread", {
      id: messageId,
      number,
    });
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
    // Circuit breaker key MUST isolate by credential (per-instance), not by
    // token presence. A presence-only key ("token:[present]") is shared by
    // every tenant in the warm isolate, so one org's 5xx/timeout failures open
    // the breaker for ALL orgs — cross-tenant poisoning. Key by baseUrl+token
    // (per-instance). cbKey is only ever used as an internal Map key, never
    // logged, so the raw token here does not leak.
    const cbKey = useAdmin
      ? `admin:${this.baseUrl}:${this.adminToken ?? "[missing]"}`
      : `token:${this.baseUrl}:${this.token ?? "[missing]"}`;

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

    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
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
          throw err;
        }

        // 5xx — record failure, retry
        if (res.status >= 500) {
          lastError = {
            status: res.status,
            message: `Uazapi server error ${res.status} on ${method} ${path}`,
          } satisfies UazapiError;
          this.recordFailure(cbKey);
          await this.backoff(attempt);
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
          await this.backoff(attempt);
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
        await this.backoff(attempt);
      }
    }

    throw lastError;
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
