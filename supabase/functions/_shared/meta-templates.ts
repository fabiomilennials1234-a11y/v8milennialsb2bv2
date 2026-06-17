/**
 * meta-templates — pure helpers for Meta WhatsApp Cloud message TEMPLATES
 * (Slice 6, ADR-0009). No DB, no global state. Network I/O is injectable via
 * `fetchImpl` so the Graph submit/poll calls are testable without touching Meta.
 *
 * WHY templates: Meta blocks free-form WhatsApp messages outside the 24h
 * customer-service window. Only pre-approved TEMPLATES may be sent to (re)open a
 * conversation. This module owns the pure parts: input validation, the Graph
 * create payload, and mapping Meta's template status back to our DB enum.
 *
 * The WABA access token is supplied by the caller (resolved via the service_role
 * RPC get_meta_cloud_credentials) and is NEVER persisted or logged here.
 */

const DEFAULT_VERSION = "v21.0";
const GRAPH_BASE = "https://graph.facebook.com";

export type FetchImpl = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

// ─── Domain enums ────────────────────────────────────────────────

/** Our persisted status enum — mirrors the migration CHECK constraint. */
export type TemplateStatus = "pending" | "approved" | "rejected" | "paused" | "disabled";

/** Meta's template categories (Graph requires one of these). */
export type TemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";

export const TEMPLATE_CATEGORIES: readonly TemplateCategory[] = [
  "MARKETING",
  "UTILITY",
  "AUTHENTICATION",
] as const;

export const TEMPLATE_STATUSES: readonly TemplateStatus[] = [
  "pending",
  "approved",
  "rejected",
  "paused",
  "disabled",
] as const;

// ─── Template components (Graph shape) ───────────────────────────

export type TemplateComponentType = "HEADER" | "BODY" | "FOOTER" | "BUTTONS";

export interface TemplateComponent {
  type: TemplateComponentType;
  format?: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";
  text?: string;
  buttons?: Array<Record<string, unknown>>;
  example?: Record<string, unknown>;
  // Graph permits additional component-specific keys; we pass them through.
  [key: string]: unknown;
}

// ─── Input validation ────────────────────────────────────────────

export interface CreateTemplateInput {
  name: string;
  language: string;
  category: string;
  components: unknown;
}

export interface ValidatedTemplate {
  name: string;
  language: string;
  category: TemplateCategory;
  components: TemplateComponent[];
}

export interface ValidationOk {
  ok: true;
  value: ValidatedTemplate;
}

export interface ValidationErr {
  ok: false;
  error: string;
}

export type ValidationResult = ValidationOk | ValidationErr;

/**
 * Meta template names must be lowercase letters, digits and underscores only,
 * 1–512 chars. We enforce the same so a name that Meta would reject never even
 * reaches the Graph API (and never lands a row that can't be submitted).
 */
const NAME_RE = /^[a-z0-9_]{1,512}$/;

/**
 * Validates raw create input into a normalized, Graph-ready template. Pure —
 * returns a Result rather than throwing, so the edge function maps it to a 400.
 */
export function validateCreateInput(input: CreateTemplateInput): ValidationResult {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) return { ok: false, error: "name é obrigatório" };
  if (!NAME_RE.test(name)) {
    return {
      ok: false,
      error: "name inválido: apenas minúsculas, números e underscore (a-z0-9_), até 512 chars",
    };
  }

  const language = typeof input.language === "string" && input.language.trim()
    ? input.language.trim()
    : "pt_BR";

  const category = typeof input.category === "string" ? input.category.trim().toUpperCase() : "";
  if (!isTemplateCategory(category)) {
    return {
      ok: false,
      error: `category inválida: use ${TEMPLATE_CATEGORIES.join(", ")}`,
    };
  }

  if (!Array.isArray(input.components) || input.components.length === 0) {
    return { ok: false, error: "components deve ser um array não-vazio" };
  }

  const components: TemplateComponent[] = [];
  let hasBody = false;
  for (const raw of input.components) {
    if (!raw || typeof raw !== "object") {
      return { ok: false, error: "cada component deve ser um objeto" };
    }
    const comp = raw as Record<string, unknown>;
    const type = typeof comp.type === "string" ? comp.type.trim().toUpperCase() : "";
    if (!isComponentType(type)) {
      return { ok: false, error: `component.type inválido: ${String(comp.type)}` };
    }
    if (type === "BODY") {
      hasBody = true;
      if (typeof comp.text !== "string" || !comp.text.trim()) {
        return { ok: false, error: "component BODY exige text não-vazio" };
      }
    }
    components.push({ ...(comp as TemplateComponent), type });
  }

  // Meta requires every template to carry exactly one BODY component.
  if (!hasBody) return { ok: false, error: "template exige um component BODY" };

  return { ok: true, value: { name, language, category, components } };
}

function isTemplateCategory(v: string): v is TemplateCategory {
  return (TEMPLATE_CATEGORIES as readonly string[]).includes(v);
}

function isComponentType(v: string): v is TemplateComponentType {
  return v === "HEADER" || v === "BODY" || v === "FOOTER" || v === "BUTTONS";
}

// ─── Graph create payload ────────────────────────────────────────

export interface GraphCreatePayload {
  name: string;
  language: string;
  category: TemplateCategory;
  components: TemplateComponent[];
}

/**
 * Builds the body for POST /{waba_id}/message_templates. Pure: the validated
 * template maps 1:1 to the Graph create shape. Kept separate from the network
 * call so the payload can be asserted in unit tests.
 */
export function buildCreatePayload(t: ValidatedTemplate): GraphCreatePayload {
  return {
    name: t.name,
    language: t.language,
    category: t.category,
    components: t.components,
  };
}

// ─── Status mapping (Meta → our enum) ────────────────────────────

/**
 * Maps a Meta template `status` string to our persisted enum. Meta statuses:
 * APPROVED, REJECTED, PENDING / IN_APPEAL / PENDING_DELETION, PAUSED, DISABLED,
 * plus a few transient ones. Unknown / submission-in-flight statuses fall back
 * to 'pending' (fail-safe: never claim a template is usable on uncertainty).
 */
export function mapMetaStatus(metaStatus: string | null | undefined): TemplateStatus {
  switch ((metaStatus ?? "").toUpperCase()) {
    case "APPROVED":
      return "approved";
    case "REJECTED":
      return "rejected";
    case "PAUSED":
      return "paused";
    case "DISABLED":
      return "disabled";
    case "PENDING":
    case "IN_APPEAL":
    case "PENDING_DELETION":
    case "":
      return "pending";
    default:
      return "pending";
  }
}

// ─── Graph client (thin, injectable) ─────────────────────────────

export interface MetaTemplateGraph {
  /** POST a new template to a WABA; returns the created template id. */
  createTemplate(
    wabaId: string,
    payload: GraphCreatePayload,
  ): Promise<{ id: string; status?: string }>;
  /**
   * Reads a single template's current status by its Graph node id.
   * Returns null if Meta no longer knows the id (deleted upstream).
   */
  getTemplateStatus(
    templateId: string,
  ): Promise<{ status: string; rejectedReason: string | null } | null>;
}

function graphError(error: { message?: string; code?: number }): Error {
  const code = error.code != null ? ` (code ${error.code})` : "";
  // Never echoes the access token — only Meta's message + code.
  return new Error(`Meta Graph error: ${error.message ?? "unknown"}${code}`);
}

export function createMetaTemplateGraph(opts: {
  token: string;
  fetchImpl?: FetchImpl;
  version?: string;
}): MetaTemplateGraph {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const version = opts.version ?? DEFAULT_VERSION;
  const base = `${GRAPH_BASE}/${version}`;

  return {
    async createTemplate(wabaId, payload) {
      const res = await fetchImpl(`${base}/${wabaId}/message_templates`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${opts.token}`,
        },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (json.error) throw graphError(json.error);
      if (!json.id) throw new Error("Meta Graph: resposta sem template id");
      return { id: String(json.id), status: json.status };
    },

    async getTemplateStatus(templateId) {
      const res = await fetchImpl(
        `${base}/${templateId}?fields=status,rejected_reason`,
        { headers: { Authorization: `Bearer ${opts.token}` } },
      );
      const json = await res.json();
      if (json.error) {
        // code 100 / "does not exist" → template was deleted on Meta's side.
        if (json.error.code === 100) return null;
        throw graphError(json.error);
      }
      return {
        status: String(json.status ?? "PENDING"),
        rejectedReason: json.rejected_reason ? String(json.rejected_reason) : null,
      };
    },
  };
}
