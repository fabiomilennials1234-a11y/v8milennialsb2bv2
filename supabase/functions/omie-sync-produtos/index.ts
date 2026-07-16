/**
 * omie-sync-produtos
 *
 * Pull produtos do Omie → products (S12, ADR-0020). Idempotente por
 * (org, external_source, external_id); adota o id externo em produto casado por SKU.
 * Auth dual (x-cron-secret | admin JWT). Cursor resumível produtos_cursor.
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { logRuntime } from "../_shared/logger.ts";
import { timingSafeCompare } from "../_shared/auth.ts";
import { OmieClient } from "../_shared/erp/omie-client.ts";
import { loadOmieCredentials } from "../_shared/erp/omie-credentials.ts";
import { mapOmieProdutoToCanonical, type OmieProdutoRaw } from "../_shared/erp/omie-mappers.ts";
import { supabaseProductStore } from "../_shared/erp/sync/product-store.ts";
import {
  upsertCanonicalProduct,
  type ErpSyncMode,
} from "../_shared/erp/sync/upsert-product.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

const PAGE_SIZE = 50;
const MAX_PAGES_PER_RUN = 20;

interface ListarProdutosResp {
  produto_servico_cadastro?: OmieProdutoRaw[];
  total_de_paginas?: number;
}

async function resolveAdminOrg(
  admin: SupabaseClient,
  authHeader: string,
): Promise<{ organizationId: string } | { error: string }> {
  const asUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
    error,
  } = await asUser.auth.getUser();
  if (error || !user) return { error: "Usuário não autenticado" };

  const { data: member } = await admin
    .from("team_members")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member?.organization_id) return { error: "Usuário não vinculado a uma organização" };
  if (!["admin", "master"].includes(member.role)) {
    return { error: "Apenas administradores podem sincronizar o Omie" };
  }
  return { organizationId: member.organization_id as string };
}

Deno.serve(
  withErrorBoundary("omie-sync-produtos", async (req: Request): Promise<Response> => {
    const headers = withSecurityHeaders({
      ...getCorsHeaders(req.headers.get("origin")),
      "Content-Type": "application/json",
    });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const cronSecret = req.headers.get("x-cron-secret");
    const authHeader = req.headers.get("Authorization");
    const body = await req.json().catch(() => ({}));

    let organizationId: string;
    if (cronSecret) {
      if (!CRON_SECRET || !timingSafeCompare(cronSecret, CRON_SECRET)) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
      }
      if (!body.organization_id) {
        return new Response(JSON.stringify({ error: "organization_id required" }), {
          status: 400,
          headers,
        });
      }
      organizationId = body.organization_id;
    } else if (authHeader) {
      const resolved = await resolveAdminOrg(admin, authHeader);
      if ("error" in resolved) {
        return new Response(JSON.stringify({ error: resolved.error }), { status: 200, headers });
      }
      organizationId = resolved.organizationId;
    } else {
      return new Response(JSON.stringify({ error: "Não autorizado" }), { status: 401, headers });
    }

    const { data: conn } = await admin
      .from("omie_connections")
      .select("id, erp_sync_mode, status, produtos_cursor")
      .eq("organization_id", organizationId)
      .eq("status", "connected")
      .maybeSingle();

    if (!conn) {
      return new Response(JSON.stringify({ ok: false, reason: "not_connected" }), {
        status: 200,
        headers,
      });
    }
    const syncMode = (conn.erp_sync_mode ?? "enrich_only") as ErpSyncMode;
    if (syncMode === "off") {
      return new Response(JSON.stringify({ ok: true, reason: "mode_off", skipped: true }), {
        status: 200,
        headers,
      });
    }

    const creds = await loadOmieCredentials(admin, organizationId);
    if (!creds) {
      return new Response(JSON.stringify({ ok: false, reason: "no_credentials" }), {
        status: 200,
        headers,
      });
    }

    const client = new OmieClient({ appKey: creds.appKey, appSecret: creds.appSecret });
    const store = supabaseProductStore(admin);

    const stats = { pages: 0, seen: 0, created: 0, enriched: 0, skipped: 0, failed: 0 };
    const now = new Date().toISOString();

    try {
      let page = (conn.produtos_cursor ?? 0) + 1;
      let totalPages = page;
      let runs = 0;

      while (runs < MAX_PAGES_PER_RUN) {
        const resp = await client.call<ListarProdutosResp>("geral/produtos", "ListarProdutos", {
          pagina: page,
          registros_por_pagina: PAGE_SIZE,
        });
        totalPages = Number(resp.total_de_paginas ?? 1);
        const rows = resp.produto_servico_cadastro ?? [];
        stats.pages++;

        for (const raw of rows) {
          stats.seen++;
          try {
            const canonical = mapOmieProdutoToCanonical(raw);
            if (!canonical.externalId) {
              stats.skipped++;
              continue;
            }
            const r = await upsertCanonicalProduct(store, {
              organizationId,
              source: "omie",
              product: canonical,
              syncMode,
            });
            if (r.action === "created") stats.created++;
            else if (r.action === "enriched") stats.enriched++;
            else stats.skipped++;
          } catch (e) {
            stats.failed++;
            console.error("[omie-sync-produtos] falha produto:", e instanceof Error ? e.message : e);
          }
        }

        runs++;
        if (page >= totalPages) break;
        page++;
      }

      const nextCursor = page >= totalPages ? 0 : page;
      await admin
        .from("omie_connections")
        .update({ produtos_cursor: nextCursor, last_produtos_sync_at: now, last_error: null })
        .eq("id", conn.id);

      await logRuntime({
        organizationId,
        module: "general",
        action: "omie_sync_produtos",
        status: "success",
        payloadSnapshot: { mode: syncMode, ...stats, nextCursor },
      });

      return new Response(JSON.stringify({ ok: true, mode: syncMode, stats }), {
        status: 200,
        headers,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await admin.from("omie_connections").update({ last_error: msg }).eq("id", conn.id);
      await logRuntime({
        organizationId,
        module: "general",
        action: "omie_sync_produtos",
        status: "error",
        errorMessage: msg,
        payloadSnapshot: { mode: syncMode, ...stats },
      });
      return new Response(JSON.stringify({ ok: false, error: msg, stats }), {
        status: 200,
        headers,
      });
    }
  }),
);
