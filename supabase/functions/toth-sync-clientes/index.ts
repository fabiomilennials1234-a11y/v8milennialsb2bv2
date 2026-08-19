/**
 * toth-sync-clientes
 *
 * Puxa clientes do ERP Toth → `upsell_clients` (Carteira). Camada de sync do
 * ADR-0020: casa por `external_id`, depois por CNPJ, e respeita
 * `toth_connections.erp_sync_mode` (off | enrich_only | canonical).
 *
 * Auth dual, igual ao Omie:
 *   - `x-cron-secret`  → execução agendada, org vem de `body.organization_id`
 *   - `Authorization`  → "sincronizar agora" na UI, org vem do JWT (admin/master)
 *
 * ⚠️ Duas defesas que existem porque a paginação do Toth NÃO é documentada:
 *
 *  1. **Parada por página curta.** Se a página veio com menos linhas que o
 *     limite pedido, acabou.
 *  2. **Parada por página repetida.** Se a API ignora `page` e devolve sempre o
 *     mesmo bloco, a página seguinte não traz nenhum id novo — paramos aí. Sem
 *     isso, uma API que ignora paginação faz este laço girar até o teto de
 *     páginas em toda execução, martelando o servidor do cliente à toa.
 *
 * O cursor é reiniciado a cada execução: sem filtro por data de alteração
 * (pedido em aberto com o fornecedor), a sincronização é varredura completa e
 * `clientes_cursor` serve para retomar de onde parou quando o teto de páginas
 * corta a execução no meio.
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { logRuntime } from "../_shared/logger.ts";
import { timingSafeCompare } from "../_shared/auth.ts";
import { resolveAdminOrg } from "../_shared/erp/erp-admin-auth.ts";
import { TothClient, TothAuthError, TothRequestError } from "../_shared/erp/toth-client.ts";
import { loadTothCredentials, tothUrlPolicy } from "../_shared/erp/toth-credentials.ts";
import { extractRows, mapTothClienteToCanonical, TothMappingError } from "../_shared/erp/toth-mappers.ts";
import { TOTH_PROVIDER_ID } from "../_shared/erp/toth-provider.ts";
import { supabaseClientStore } from "../_shared/erp/sync/client-store.ts";
import { upsertCanonicalClient, type ErpSyncMode } from "../_shared/erp/sync/upsert-client.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

const PAGE_SIZE = 100;
const MAX_PAGES_PER_RUN = 20;
/** Pausa entre páginas: o alvo é o servidor de UM cliente, não uma nuvem. */
const PAGE_DELAY_MS = 300;

const json = (body: unknown, headers: Record<string, string>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function resolveOrganization(
  req: Request,
  admin: SupabaseClient,
): Promise<{ ok: true; organizationId: string } | { ok: false; error: string; status: number }> {
  const cronSecret = req.headers.get("x-cron-secret");
  if (cronSecret) {
    if (!CRON_SECRET || !timingSafeCompare(cronSecret, CRON_SECRET)) {
      return { ok: false, error: "Não autorizado", status: 401 };
    }
    const body = await req.clone().json().catch(() => ({}));
    const orgId = typeof body.organization_id === "string" ? body.organization_id : "";
    if (!orgId) return { ok: false, error: "organization_id é obrigatório", status: 400 };
    return { ok: true, organizationId: orgId };
  }

  const auth = await resolveAdminOrg(admin, req.headers.get("Authorization"), "sincronizar o ERP");
  if (!auth.ok) return { ok: false, error: auth.error, status: 403 };
  return { ok: true, organizationId: auth.organizationId };
}

Deno.serve(
  withErrorBoundary("toth-sync-clientes", async (req) => {
    const cors = withSecurityHeaders(getCorsHeaders(req.headers.get("origin")));
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const resolved = await resolveOrganization(req, admin);
    if (!resolved.ok) return json({ error: resolved.error }, cors, resolved.status);
    const { organizationId } = resolved;

    const { data: conn } = await admin
      .from("toth_connections")
      .select("id, erp_sync_mode, clientes_cursor, status")
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (!conn || conn.status !== "connected") {
      return json({ error: "Nenhuma conexão ativa com o ERP Toth" }, cors);
    }

    const syncMode = (conn.erp_sync_mode as ErpSyncMode) ?? "enrich_only";
    if (syncMode === "off") {
      return json({ skipped: true, reason: "sync_mode_off" }, cors);
    }

    const creds = await loadTothCredentials(admin, organizationId);
    if (!creds) {
      return json({ error: "Credenciais do ERP indisponíveis. Reconecte a integração." }, cors);
    }

    const client = new TothClient(creds, { urlPolicy: tothUrlPolicy(creds) });
    const store = supabaseClientStore(admin, TOTH_PROVIDER_ID);

    const seenIds = new Set<string>();
    const stats = { pages: 0, rows: 0, created: 0, enriched: 0, skipped: 0, failed: 0 };
    const mappingErrors: string[] = [];
    let page = conn.clientes_cursor ?? 1;
    let stopReason = "max_pages";

    try {
      for (let i = 0; i < MAX_PAGES_PER_RUN; i++) {
        const payload = await client.get("clientes", {
          page: String(page),
          limit: String(PAGE_SIZE),
        });
        const rows = extractRows(payload);
        stats.pages++;

        if (rows.length === 0) {
          stopReason = "empty_page";
          break;
        }

        let newInThisPage = 0;
        for (const row of rows) {
          stats.rows++;
          let canonical;
          try {
            canonical = mapTothClienteToCanonical(row);
          } catch (err) {
            stats.failed++;
            if (err instanceof TothMappingError && mappingErrors.length < 3) {
              mappingErrors.push(err.message);
            }
            continue;
          }

          if (seenIds.has(canonical.externalId)) continue;
          seenIds.add(canonical.externalId);
          newInThisPage++;

          const result = await upsertCanonicalClient(store, {
            organizationId,
            source: TOTH_PROVIDER_ID,
            client: canonical,
            syncMode,
          });
          if (result.action === "created") stats.created++;
          else if (result.action === "enriched") stats.enriched++;
          else stats.skipped++;
        }

        // A API ignorou a paginação e repetiu o bloco anterior.
        if (newInThisPage === 0) {
          stopReason = "no_new_records";
          break;
        }
        if (rows.length < PAGE_SIZE) {
          stopReason = "last_page";
          break;
        }

        page++;
        await sleep(PAGE_DELAY_MS);
      }
    } catch (err) {
      const message =
        err instanceof TothAuthError || err instanceof TothRequestError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Erro desconhecido";

      await admin
        .from("toth_connections")
        .update({
          last_error: message,
          // Só a falha de autenticação marca a conexão como expirada: erro de
          // rede é o ERP fora do ar, não credencial inválida, e derrubar o
          // status obrigaria o admin a redigitar a senha por causa de uma queda.
          ...(err instanceof TothAuthError ? { status: "expired" } : {}),
          clientes_cursor: page,
        })
        .eq("id", conn.id);

      await logRuntime({
        organizationId,
        module: "general",
        action: "toth_sync_clientes",
        status: "error",
        errorMessage: message,
        payloadSnapshot: { ...stats, page },
      });

      return json({ error: message, stats }, cors);
    }

    await admin
      .from("toth_connections")
      .update({
        // Terminou a varredura → volta pro começo. Parou no teto → retoma daqui.
        clientes_cursor: stopReason === "max_pages" ? page : 1,
        last_clientes_sync_at: new Date().toISOString(),
        last_error: mappingErrors.length > 0 ? mappingErrors[0] : null,
      })
      .eq("id", conn.id);

    await logRuntime({
      organizationId,
      module: "general",
      action: "toth_sync_clientes",
      status: "success",
      payloadSnapshot: { ...stats, stop_reason: stopReason, mapping_errors: mappingErrors.length },
    });

    return json({ success: true, stop_reason: stopReason, stats, mapping_errors: mappingErrors }, cors);
  }),
);
