/**
 * tinyerp-sync-contacts
 *
 * Sincroniza contatos do TinyERP → upsell_clients (carteira). Camada 2 do ERP sync.
 *
 * Match por: tiny_contact_id → cnpj (dígitos) → nome normalizado (fallback).
 * Modo (tinyerp_connections.contact_sync_mode):
 *   off          — não roda
 *   enrich_only  — só casa+enriquece existentes; loga não-casados (DEFAULT)
 *   canonical    — cria os contatos Tiny sem par na carteira
 *
 * dry_run=true  — analisa e devolve amostra + match rate, SEM escrever.
 *
 * Auth: x-cron-secret (cron/serviço). Body: { organization_id, dry_run?, max_pages? }.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSentry } from "../_shared/sentry.ts";
import { logRuntime } from "../_shared/logger.ts";
import { timingSafeCompare } from "../_shared/auth.ts";
import {
  getOrgTinyToken,
  callTinyApi,
  getTinyErrorMessage,
  isTinyNoRecordsError,
  type TinyApiResponse,
} from "../_shared/tinyerp-utils.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

const MAX_PAGES_DEFAULT = 50; // guarda contra loop; ~50*100 contatos

interface TinyContato {
  id?: string;
  codigo?: string;
  nome?: string;
  fantasia?: string;
  tipo_pessoa?: string; // "F" | "J" | "E"
  cpf_cnpj?: string;
  email?: string;
  fone?: string;
  celular?: string;
}

// só dígitos; vazio → null
function normalizeDoc(v?: string | null): string | null {
  if (!v) return null;
  const digits = v.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

function normalizeName(v?: string | null): string {
  return (v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function maskDoc(cnpj: string | null): string | null {
  if (!cnpj) return null;
  return cnpj.length <= 4 ? "***" : `***${cnpj.slice(-4)}`;
}

function maskName(name?: string): string {
  const n = (name ?? "").trim();
  if (!n) return "(vazio)";
  return n.length <= 4 ? `${n[0] ?? ""}***` : `${n.slice(0, 4)}***`;
}

Deno.serve(
  withSentry("tinyerp-sync-contacts", async (req: Request): Promise<Response> => {
    const headers = withSecurityHeaders({
      ...getCorsHeaders(req.headers.get("origin")),
      "Content-Type": "application/json",
    });

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    // Auth cron-secret
    const cronSecret = req.headers.get("x-cron-secret");
    if (!CRON_SECRET || !cronSecret || !timingSafeCompare(cronSecret, CRON_SECRET)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }

    let body: { organization_id?: string; dry_run?: boolean; max_pages?: number };
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "invalid json" }), { status: 400, headers });
    }

    const orgId = body.organization_id;
    const dryRun = body.dry_run === true;
    const maxPages = Math.max(1, Math.min(body.max_pages ?? MAX_PAGES_DEFAULT, 200));

    if (!orgId) {
      return new Response(JSON.stringify({ error: "organization_id required" }), { status: 400, headers });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Conexão + modo
    const { data: conn } = await supabase
      .from("tinyerp_connections")
      .select("id, contact_sync_mode, status")
      .eq("organization_id", orgId)
      .eq("status", "connected")
      .maybeSingle();

    const mode: string = conn?.contact_sync_mode ?? "enrich_only";
    if (!conn) {
      return new Response(JSON.stringify({ ok: false, reason: "not_connected" }), { status: 200, headers });
    }
    if (mode === "off" && !dryRun) {
      return new Response(JSON.stringify({ ok: true, reason: "mode_off", skipped: true }), { status: 200, headers });
    }

    const tokenData = await getOrgTinyToken(supabase, orgId);
    if (!tokenData) {
      return new Response(JSON.stringify({ ok: false, reason: "no_token" }), { status: 200, headers });
    }

    const stats = {
      pages: 0,
      contatos_total: 0,
      with_cnpj: 0,
      matched_by_tiny_id: 0,
      matched_by_cnpj: 0,
      matched_by_name: 0,
      unmatched: 0,
      enriched: 0,
      created: 0,
      failed: 0,
    };
    const sample: Array<Record<string, unknown>> = [];
    const now = new Date().toISOString();

    try {
      let page = 1;
      let hasMore = true;

      while (hasMore && page <= maxPages) {
        const resp: TinyApiResponse = await callTinyApi(tokenData.token, "contatos.pesquisa.php", {
          pagina: page,
        });

        const rows = (resp.retorno.contatos as Array<{ contato: TinyContato }> | undefined) ?? [];
        const numeroPaginas = Number(resp.retorno.numero_paginas ?? 0);

        // Tiny devolve proc="3" tanto p/ "sem registros" quanto às vezes com data —
        // guiar pela presença de contatos, não pelo status. Página vazia = fim,
        // salvo erro real (erros presente e não é no-records).
        if (rows.length === 0) {
          if (resp.retorno.erros && !isTinyNoRecordsError(resp)) {
            throw new Error(
              `Tiny contatos erro: status=${resp.retorno.status} proc=${resp.retorno.status_processamento} ` +
              `erros=${JSON.stringify(resp.retorno.erros)} keys=[${Object.keys(resp.retorno).join(",")}]`,
            );
          }
          break;
        }
        stats.pages++;

        for (const row of rows) {
          const c = row.contato ?? {};
          stats.contatos_total++;
          const cnpj = normalizeDoc(c.cpf_cnpj);
          if (cnpj) stats.with_cnpj++;
          const tinyId = c.id ? String(c.id) : null;
          const nameNorm = normalizeName(c.nome);

          // ── Match: tiny_contact_id → cnpj → nome ──
          let matched: { id: string; cnpj: string | null; phone: string | null; email: string | null } | null = null;
          let matchedBy: "tiny_id" | "cnpj" | "name" | null = null;

          if (tinyId) {
            const { data } = await supabase
              .from("upsell_clients")
              .select("id, cnpj, phone, email")
              .eq("organization_id", orgId)
              .eq("tiny_contact_id", tinyId)
              .maybeSingle();
            if (data) { matched = data; matchedBy = "tiny_id"; stats.matched_by_tiny_id++; }
          }
          if (!matched && cnpj) {
            const { data } = await supabase
              .from("upsell_clients")
              .select("id, cnpj, phone, email")
              .eq("organization_id", orgId)
              .eq("cnpj", cnpj)
              .order("updated_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (data) { matched = data; matchedBy = "cnpj"; stats.matched_by_cnpj++; }
          }
          if (!matched && nameNorm) {
            // fallback por nome exato normalizado (case/space-insensitive)
            const { data } = await supabase
              .from("upsell_clients")
              .select("id, cnpj, phone, email, name")
              .eq("organization_id", orgId)
              .ilike("name", c.nome ?? "")
              .limit(2);
            const exact = (data ?? []).filter((r: { name?: string }) => normalizeName(r.name) === nameNorm);
            if (exact.length === 1) { matched = exact[0]; matchedBy = "name"; stats.matched_by_name++; }
          }

          if (!matched) stats.unmatched++;

          if (sample.length < 8) {
            sample.push({
              tiny_id: tinyId,
              nome: maskName(c.nome),
              tipo_pessoa: c.tipo_pessoa ?? null,
              has_cnpj: !!cnpj,
              cnpj_mask: maskDoc(cnpj),
              matched_by: matchedBy,
            });
          }

          if (dryRun) continue; // análise só

          // ── Escrita ──
          try {
            if (matched) {
              const patch: Record<string, unknown> = {
                tiny_contact_id: tinyId,
                external_source: "tiny",
                tiny_synced_at: now,
              };
              if (!matched.cnpj && cnpj) patch.cnpj = cnpj;
              if (!matched.phone && (c.celular || c.fone)) patch.phone = c.celular || c.fone;
              if (!matched.email && c.email) patch.email = c.email;
              const { error } = await supabase.from("upsell_clients").update(patch).eq("id", matched.id);
              if (error) throw error;
              stats.enriched++;
            } else if (mode === "canonical") {
              const { error } = await supabase.from("upsell_clients").insert({
                organization_id: orgId,
                name: (c.nome || c.fantasia || "Contato ERP").trim(),
                company: c.fantasia || null,
                cnpj,
                phone: c.celular || c.fone || null,
                email: c.email || null,
                tiny_contact_id: tinyId,
                external_source: "tiny",
                tiny_synced_at: now,
                is_active: true,
              });
              if (error) throw error;
              stats.created++;
            }
            // enrich_only + unmatched → não cria (só contabiliza)
          } catch (e) {
            stats.failed++;
            console.error(`[sync-contacts] falha contato ${tinyId}:`, e instanceof Error ? e.message : e);
          }
        }

        hasMore = page < numeroPaginas;
        page++;
      }

      // Dry-run: sonda pedidos.pesquisa pra descobrir onde vive o dado de cliente
      // (muitas contas Tiny não mantêm contatos; identidade vem dentro do pedido).
      let probe: Record<string, unknown> | null = null;
      if (dryRun) {
        try {
          const pr = await callTinyApi(tokenData.token, "pedidos.pesquisa.php", { pagina: 1 });
          const pedidos = (pr.retorno.pedidos as Array<{ pedido: Record<string, any> }> | undefined) ?? [];
          probe = {
            pedidos_numero_paginas: Number(pr.retorno.numero_paginas ?? 0),
            pedidos_page1_count: pedidos.length,
            pedidos_proc: pr.retorno.status_processamento,
            pedidos_keys: Object.keys(pr.retorno),
            pedido_sample: pedidos.slice(0, 3).map((p) => {
              const ped = p.pedido ?? {};
              return {
                numero: ped.numero,
                data: ped.data_pedido,
                valor: ped.valor ?? ped.total_pedido ?? ped.valor_total,
                cliente_nome: maskName(ped.cliente?.nome ?? ped.nome),
                cliente_has_cnpj: !!normalizeDoc(ped.cliente?.cpf_cnpj ?? ped.cpf_cnpj),
                ped_keys: Object.keys(ped),
              };
            }),
          };
        } catch (e) {
          probe = { error: e instanceof Error ? e.message : String(e) };
        }
      }

      if (!dryRun) {
        await supabase
          .from("tinyerp_connections")
          .update({ last_contact_sync_at: now })
          .eq("id", conn.id);
      }

      await logRuntime({
        organizationId: orgId,
        module: "webhook",
        action: dryRun ? "tinyerp_sync_contacts_dryrun" : "tinyerp_sync_contacts",
        status: "success",
        payloadSnapshot: { mode, dryRun, ...stats, sample: dryRun ? sample : undefined, probe },
      });

      return new Response(
        JSON.stringify({ ok: true, mode, dry_run: dryRun, stats, sample, probe }),
        { status: 200, headers },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await logRuntime({
        organizationId: orgId,
        module: "webhook",
        action: "tinyerp_sync_contacts",
        status: "error",
        errorMessage: msg,
        payloadSnapshot: { mode, dryRun, ...stats },
      });
      return new Response(JSON.stringify({ ok: false, error: msg, stats }), { status: 200, headers });
    }
  }),
);
