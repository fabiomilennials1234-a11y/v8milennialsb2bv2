/**
 * Lead ingest — `POST /api/v1/leads` (scope `lead:ingest`).
 *
 * The public creation path. Before this, partners had two bad options:
 * `lead-webhook` (one shared global WEBHOOK_API_KEY for every tenant, and it
 * could only reach the 3 system pipes) or `import-leads` (JWT-only — it is the
 * in-app file importer, never a public endpoint, despite what the docs claimed).
 *
 * Everything runs inside `api_create_leads`, a SECURITY DEFINER RPC scoped to
 * the org resolved from the API key. Per-item failures do not abort the batch:
 * each result carries its own status, so a partner sending 200 leads with 3 bad
 * rows still gets the other 197 in.
 */
import type { ApiRouteContext } from "../router.ts";
import { apiError, apiResource } from "../responses.ts";

/** Matches the batch cap enforced inside `api_create_leads`. */
export const MAX_BATCH = 500;

interface RpcClient {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data?: unknown; error?: unknown }>;
}

const INVALID = Symbol("invalid-json");

async function readJson(req: Request): Promise<unknown | typeof INVALID> {
  try {
    return await req.json();
  } catch {
    return INVALID;
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * POST /leads — create (or upsert, with `update_existing`) a batch of leads.
 *
 * Accepts either `{ leads: [...] }` or a bare array, since integration tools
 * (n8n, Make) often cannot wrap their output in an envelope.
 */
export async function createLeads(ctx: ApiRouteContext): Promise<Response> {
  const body = await readJson(ctx.req);
  if (body === INVALID) {
    return apiError(400, "invalid_body", "Corpo deve ser JSON válido", ctx.cors);
  }

  const leads = Array.isArray(body)
    ? body
    : isPlainObject(body) && Array.isArray(body.leads)
    ? body.leads
    : null;

  if (!leads) {
    return apiError(
      400,
      "invalid_body",
      "Esperado { leads: [...] } ou um array de leads",
      ctx.cors,
    );
  }
  if (leads.length === 0) {
    return apiError(422, "empty_batch", "Envie ao menos um lead", ctx.cors);
  }
  if (leads.length > MAX_BATCH) {
    return apiError(
      422,
      "batch_too_large",
      `Máximo de ${MAX_BATCH} leads por requisição`,
      ctx.cors,
      { max: MAX_BATCH, received: leads.length },
    );
  }

  const options = isPlainObject(body)
    ? {
      update_existing: body.update_existing === true ||
        body.update_existing === "true",
      origin: typeof body.origin === "string" ? body.origin : undefined,
    }
    : {};

  const supabase = ctx.supabase as RpcClient;
  const { data, error } = await supabase.rpc("api_create_leads", {
    p_org: ctx.organizationId,
    p_leads: leads,
    p_options: options,
  });
  if (error) {
    return apiError(500, "internal_error", "Erro ao criar leads", ctx.cors);
  }

  const r = (data ?? {}) as {
    ok?: boolean;
    code?: string;
    created?: number;
    updated?: number;
    failed?: number;
    results?: unknown[];
  };
  if (!r.ok) {
    return apiError(422, r.code ?? "create_failed", "Falha ao criar leads", ctx.cors);
  }

  return apiResource({
    created: r.created ?? 0,
    updated: r.updated ?? 0,
    failed: r.failed ?? 0,
    results: r.results ?? [],
  }, ctx.cors);
}
