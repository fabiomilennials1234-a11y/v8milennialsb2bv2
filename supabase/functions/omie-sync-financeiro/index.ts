/**
 * omie-sync-financeiro
 *
 * Pull da camada de dinheiro do Omie → notas_fiscais (S7, ADR-0020). Cada NF liga
 * a um pedido/cliente já sincronizado quando possível (best-effort). Títulos /
 * contas a receber entram nesta mesma função em S8.
 *
 * Auth dual: x-cron-secret (cron) OU Authorization (on-demand admin).
 * Paginação resumível via omie_connections.financeiro_cursor.
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { logRuntime } from "../_shared/logger.ts";
import { timingSafeCompare } from "../_shared/auth.ts";
import { OmieClient } from "../_shared/erp/omie-client.ts";
import { loadOmieCredentials } from "../_shared/erp/omie-credentials.ts";
import { mapOmieNfeToCanonical, type OmieNfeRaw } from "../_shared/erp/omie-mappers.ts";
import { supabaseNfeStore } from "../_shared/erp/sync/nfe-store.ts";
import { upsertCanonicalNfe } from "../_shared/erp/sync/upsert-nfe.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

const PAGE_SIZE = 50;
const MAX_PAGES_PER_RUN = 20;

interface ListarNfResp {
  nfCadastro?: OmieNfeRaw[];
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
  withErrorBoundary("omie-sync-financeiro", async (req: Request): Promise<Response> => {
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
      .select("id, erp_sync_mode, status, financeiro_cursor")
      .eq("organization_id", organizationId)
      .eq("status", "connected")
      .maybeSingle();

    if (!conn) {
      return new Response(JSON.stringify({ ok: false, reason: "not_connected" }), {
        status: 200,
        headers,
      });
    }
    if (conn.erp_sync_mode === "off") {
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
    const store = supabaseNfeStore(admin);

    const stats = { pages: 0, seen: 0, created: 0, updated: 0, skipped: 0, failed: 0 };
    const now = new Date().toISOString();

    try {
      let page = (conn.financeiro_cursor ?? 0) + 1;
      let totalPages = page;
      let runs = 0;

      while (runs < MAX_PAGES_PER_RUN) {
        const resp = await client.call<ListarNfResp>("produtos/nfconsultar", "ListarNF", {
          pagina: page,
          registros_por_pagina: PAGE_SIZE,
        });
        totalPages = Number(resp.total_de_paginas ?? 1);
        const rows = resp.nfCadastro ?? [];
        stats.pages++;

        for (const raw of rows) {
          stats.seen++;
          try {
            const canonical = mapOmieNfeToCanonical(raw);
            if (!canonical.externalId) {
              stats.skipped++;
              continue;
            }
            const r = await upsertCanonicalNfe(store, {
              organizationId,
              source: "omie",
              nfe: canonical,
            });
            if (r.action === "created") stats.created++;
            else if (r.action === "updated") stats.updated++;
            else stats.skipped++;
          } catch (e) {
            stats.failed++;
            console.error("[omie-sync-financeiro] falha NF:", e instanceof Error ? e.message : e);
          }
        }

        runs++;
        if (page >= totalPages) break;
        page++;
      }

      const nextCursor = page >= totalPages ? 0 : page;
      await admin
        .from("omie_connections")
        .update({ financeiro_cursor: nextCursor, last_financeiro_sync_at: now, last_error: null })
        .eq("id", conn.id);

      await logRuntime({
        organizationId,
        module: "general",
        action: "omie_sync_financeiro",
        status: "success",
        payloadSnapshot: { ...stats, nextCursor },
      });

      return new Response(JSON.stringify({ ok: true, stats }), { status: 200, headers });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await admin.from("omie_connections").update({ last_error: msg }).eq("id", conn.id);
      await logRuntime({
        organizationId,
        module: "general",
        action: "omie_sync_financeiro",
        status: "error",
        errorMessage: msg,
        payloadSnapshot: stats,
      });
      return new Response(JSON.stringify({ ok: false, error: msg, stats }), {
        status: 200,
        headers,
      });
    }
  }),
);
