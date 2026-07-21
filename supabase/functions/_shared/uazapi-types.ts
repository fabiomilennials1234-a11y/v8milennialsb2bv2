// deno-lint-ignore-file no-explicit-any

/**
 * Uazapi WhatsApp API — shared types
 *
 * Uazapi uses per-instance auth via `token` header for instance-scoped ops,
 * and `admintoken` header for admin-level ops (instance create/delete/etc).
 *
 * Docs: https://api.uazapi.com/docs
 */

// ---------------------------------------------------------------------------
// Client config
// ---------------------------------------------------------------------------

export type UazapiClientConfig = {
  /** Base URL of the Uazapi server — env UAZAPI_BASE_URL */
  baseUrl: string;
  /** Per-instance token, stored in whatsapp_instance_secrets via RPC */
  token?: string;
  /** Admin token — env UAZAPI_ADMIN_TOKEN. Required only for admin ops */
  adminToken?: string;
  /** Request timeout in ms. Default 15 000. Use 60 000 for media. */
  timeoutMs?: number;
  /**
   * The WhatsApp number's DB id (whatsapp_instances.id), WHEN the construction
   * site knows it. Optional + purely additive: when set, a ban-ish 4xx (463/429)
   * is correlated by id and fed into the Send Governor reputation state machine
   * (record_ban_signal). When omitted, behavior is 100% unchanged — the signal
   * is still captured out-of-band keyed by the token hash. Never used for auth.
   */
  instanceId?: string;
};

// ---------------------------------------------------------------------------
// Send — text
// ---------------------------------------------------------------------------

export type UazapiSendTextInput = {
  number: string;
  text: string;
  /** Typing delay in ms shown before sending */
  delay?: number;
  /** message_id to quote/reply */
  replyid?: string;
  /** Mark chat as read */
  readchat?: boolean;
  /** Mark message as read */
  readmessages?: boolean;
  /** JIDs to mention */
  mentions?: string[];
  forward?: boolean;
  viewOnce?: boolean;
  /** Source tag in our system (e.g. "copilot-agent-xxx") */
  track_source?: string;
  /** ID in our system for deduplication/status lookup */
  track_id?: string;
  /** Enqueue server-side instead of sending immediately */
  async?: boolean;
};

// ---------------------------------------------------------------------------
// Send — media
// ---------------------------------------------------------------------------

export type UazapiSendMediaInput = {
  number: string;
  type:
    | "image"
    | "video"
    | "audio"
    | "document"
    | "ptt"
    | "myaudio"
    | "sticker"
    | "videoplay"
    | "ptv";
  /** base64-encoded content OR public URL */
  file: string;
  filename?: string;
  caption?: string;
  delay?: number;
  replyid?: string;
  readchat?: boolean;
  track_source?: string;
  track_id?: string;
  viewOnce?: boolean;
  async?: boolean;
};

// ---------------------------------------------------------------------------
// Send — interactive menus
// ---------------------------------------------------------------------------

export type UazapiSendMenuInput = {
  number: string;
  type: "button" | "list" | "poll" | "carousel";
  text: string;
  footer?: string;
  /** Button/list/poll choices */
  choices?: string[];
  /** Poll multi-select count */
  selectableCount?: number;
  delay?: number;
  track_source?: string;
  track_id?: string;
};

// ---------------------------------------------------------------------------
// Send — PIX button
// NOTE: Uazapi docs specify `amount` as a decimal value (e.g. 49.90 = R$ 49,90).
// ---------------------------------------------------------------------------

export type UazapiSendPixButtonInput = {
  number: string;
  pixkey: string;
  pixkeyType: "cpf" | "cnpj" | "email" | "phone" | "random";
  merchantName: string;
  /** Decimal amount in BRL — e.g. 49.90 for R$ 49,90 */
  amount: number;
  text?: string;
  delay?: number;
  track_source?: string;
  track_id?: string;
};

// ---------------------------------------------------------------------------
// Instance
// ---------------------------------------------------------------------------

export type UazapiInstanceInitInput = {
  /** Identifier name for this instance in Uazapi */
  name: string;
  /** Name shown inside the WhatsApp app */
  systemName?: string;
  /** Free-form admin field — use to store our whatsapp_instances.id */
  adminField01?: string;
  adminField02?: string;
  webhookUrl?: string;
  /** e.g. ["messages","connection","messages_update","presence"] */
  webhookEvents?: string[];
  /**
   * Messages to exclude from webhook delivery.
   * Use ["wasSentByApi"] to suppress echo of messages we send.
   */
  webhookExcludeMessages?: string[];
  webhookAddUrlTypesMessages?: boolean;
  webhookAddUrlEvents?: boolean;
};

export type UazapiInstanceResponse = {
  /** Top-level fields returned by /instance/init */
  instance: {
    id: string;
    token: string;
    status: string;
    name: string;
    qrcode?: string;
    paircode?: string;
  };
  /** Per-instance token (also at top level) */
  token: string;
  name: string;
  response: string;
  status: { connected: boolean; jid: unknown; loggedIn: boolean };
};

// ---------------------------------------------------------------------------
// Message response
// ---------------------------------------------------------------------------

export type UazapiMessageResponse = {
  /** Uazapi-assigned message ID */
  id: string;
  status: "sent" | "queued" | "failed";
  timestamp: number;
  track_id?: string;
};

/**
 * One entry of the POST /chat/check ("Verificar Números no WhatsApp") response.
 * Uazapi returns 200 with one object per queried number — `isInWhatsapp:false`
 * is the authoritative, deterministic "not registered on WhatsApp" verdict
 * (unlike /send/text which surfaces unreachable recipients as an opaque 500).
 */
export type UazapiNumberCheck = {
  /** Echo of the queried input (the number string we sent) */
  query: string;
  /** Resolved WhatsApp JID, when registered */
  jid?: string;
  /** Resolved WhatsApp LID, when available */
  lid?: string;
  /** KEY field — false means the number is NOT on WhatsApp */
  isInWhatsapp: boolean;
  verifiedName?: string;
  groupName?: string;
  /** Per-item error, when Uazapi could not resolve this specific entry */
  error?: string;
};

// ---------------------------------------------------------------------------
// Sender (mass send)
// ---------------------------------------------------------------------------

/**
 * Item of a /sender/advanced batch.
 *
 * CONTRACT (verified live 2026-06-15): every item MUST carry `type`
 * ("text" for plain text, "image" for media). An item without `type` makes
 * Uazapi silently accept 0 messages (count=0) → empty campaign → 0 sent.
 */
export type UazapiSenderMessageItem = {
  number: string;
  type: "text" | "image";
  text?: string;
  file?: string;
  caption?: string;
};

export type UazapiSenderAdvancedInput = {
  messages: UazapiSenderMessageItem[];
  /** Min inter-message delay in ms */
  delayMin?: number;
  /** Max inter-message delay in ms */
  delayMax?: number;
  /** Epoch milliseconds — schedule for later. Undefined → send immediately. */
  scheduled_for?: number;
  track_source?: string;
};

/**
 * Canonical, app-level sender status enum. Maps from the Uazapi vocabulary
 * (queued | scheduled | running | done | deleting) — see mapUazapiSenderStatus.
 */
export type UazapiSenderStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * Response of CREATE — POST /sender/advanced.
 * `count` = number of messages ACCEPTED; `folder_id` = the campaign id (the
 * same value surfaced as `id` in /sender/listfolders).
 */
export type UazapiSenderCreateResponse = {
  folder_id: string;
  count: number;
  status: string;
};

/**
 * Entity of LIST — GET /sender/listfolders. `id` === the CREATE `folder_id`.
 * Note `log_sucess` is spelled with a single 'c' by Uazapi (sic).
 */
export type UazapiSenderFolder = {
  id: string;
  info?: string;
  status: string;
  scheduled_for?: number;
  delayMin?: number;
  delayMax?: number;
  log_total?: number;
  log_sucess?: number;
  log_delivered?: number;
  log_failed?: number;
  log_read?: number;
  log_played?: number;
  owner?: string;
};

/**
 * Normalized view of a single sender campaign, mapped from a UazapiSenderFolder.
 * This is what senderGet returns to callers (mass-send-status, etc.).
 */
export type UazapiSenderResponse = {
  status: UazapiSenderStatus;
  total: number;
  sent: number;
  failed: number;
};

/**
 * Per-message row of POST /sender/listmessages (spike #943 / ADR-0016).
 * `status` lifecycle: Queued | Canceled | Failed | Sent | Delivered | Read
 * (open enum — documented by examples); `error` is free text ("" when none);
 * `chatid` is the JID `<phone>@s.whatsapp.net`. Every field optional: Uazapi
 * has documented doc↔server drift, so consumers parse defensively.
 */
export type UazapiSenderMessage = {
  id?: string;
  messageid?: string;
  chatid?: string;
  sender?: string;
  status?: string;
  error?: string;
  send_folder_id?: string;
  track_source?: string;
  track_id?: string;
  messageTimestamp?: number;
};

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export type UazapiError = {
  /** Provider-level error code (e.g. "instance_not_connected") */
  provider_code?: string;
  status: number;
  message: string;
  raw?: unknown;
};
