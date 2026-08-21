/**
 * toth-sync-cobrancas
 *
 * Puxa cobranças do ERP Toth → `titulos_receber`. É a capacidade `receivables`
 * do ADR-0020: o momento **recebido**, que alimenta inadimplência e receita em
 * risco na Carteira.
 *
 * ⚠️ **O endpoint é por CNPJ, não por página.** `POST /cobrancas` recebe `cnpj`
 * no corpo e devolve os títulos daqueles clientes. Não existe listagem geral.
 * Consequências que moldam esta função:
 *
 *  1. O laço é sobre os CLIENTES da carteira já sincronizados com
 *     `external_source = 'toth'` e CNPJ preenchido — ou seja,
 *     `toth-sync-clientes` roda ANTES. Sem cliente casado, não há de quem
 *     cobrar, e a função devolve zero em vez de varrer o ERP.
 *  2. **CNPJs vão em lote** (`cnpj=a,b,c`), conforme o fornecedor confirmou em
 *     18/08. Isso troca uma requisição por cliente por uma por lote — com 600
 *     clientes, 12 chamadas em vez de 600. Ainda há teto por execução e pausa
 *     entre lotes: o alvo é o servidor de uma empresa só.
 *
 * Auth dual: `x-cron-secret` (org no corpo) ou `Authorization` (org do JWT).
 *
 * Body opcional:
 *   - `{ data_inicio, data_fim }` em `aaaa-mm-dd` — sobrepõe a janela padrão;
 *   - `{ full: true }` — desliga a janela e varre tudo (reconciliação).
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
import {
  buildCobrancaWindow,
  chunkCnpjs,
  extractRows,
  formatTothDate,
  mapTothCobrancaToCanonical,
  TothMappingError,
} from "../_shared/erp/toth-mappers.ts";
import { TOTH_PROVIDER_ID } from "../_shared/erp/toth-provider.ts";
import { supabaseTituloStore } from "../_shared/erp/sync/titulo-store.ts";
import { upsertCanonicalTitulo } from "../_shared/erp/sync/upsert-titulo.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

/** Teto de clientes consultados por execução. */
const MAX_CLIENTS_PER_RUN = 600;
/**
 * CNPJs por requisição. O fornecedor indicou que `cnpj=a,b,c` devolve os três,
 * mas disse "pelo que vi" — não é contrato firmado. Lote conservador: erra num
 * lote, perde 50 clientes naquela execução, não a execução inteira.
 */
const CNPJ_BATCH_SIZE = 50;
/** Pausa entre lotes: o alvo é o servidor de UMA empresa, não uma nuvem. */
const BATCH_DELAY_MS = 400;

/**
 * Folga da janela padrão, em dias.
 *
 * Para trás cobre a virada aberto → atrasado: um título que venceu ontem precisa
 * reaparecer para ser reavaliado, e a janela casa por `vence no período`. Para
 * frente cobre o que está por vencer, que é o que alimenta a previsão de caixa.
 */
const WINDOW_BACK_DAYS = 45;
const WINDOW_FORWARD_DAYS = 45;

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
  withErrorBoundary("toth-sync-cobrancas", async (req) => {
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
      .select("id, erp_sync_mode, status")
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (!conn || conn.status !== "connected") {
      return json({ error: "Nenhuma conexão ativa com o ERP Toth" }, cors);
    }
    if (conn.erp_sync_mode === "off") {
      return json({ skipped: true, reason: "sync_mode_off" }, cors);
    }

    const creds = await loadTothCredentials(admin, organizationId);
    if (!creds) {
      return json({ error: "Credenciais do ERP indisponíveis. Reconecte a integração." }, cors);
    }

    // Alvos: clientes da carteira já casados com o Toth e com CNPJ.
    const { data: clients, error: clientsErr } = await admin
      .from("upsell_clients")
      .select("id, cnpj")
      .eq("organization_id", organizationId)
      .eq("external_source", TOTH_PROVIDER_ID)
      .not("cnpj", "is", null)
      .order("updated_at", { ascending: true })
      .limit(MAX_CLIENTS_PER_RUN);

    if (clientsErr) {
      return json({ error: `Erro ao listar clientes: ${clientsErr.message}` }, cors);
    }
    if (!clients || clients.length === 0) {
      return json(
        {
          success: true,
          skipped: true,
          reason: "no_synced_clients",
          hint: "Rode toth-sync-clientes primeiro — as cobranças são consultadas por CNPJ de cliente já casado.",
        },
        cors,
      );
    }

    const client = new TothClient(creds, { urlPolicy: tothUrlPolicy(creds) });
    const store = supabaseTituloStore(admin);

    // Data de referência do atraso, fixada uma vez por execução: se cada linha
    // recalculasse "hoje", uma execução que cruzasse a meia-noite classificaria
    // dois títulos de mesmo vencimento de formas diferentes.
    const todayIso = new Date().toISOString().slice(0, 10);
    const body = await req.clone().json().catch(() => ({}));

    // Janela LIGADA por padrão desde 18/08, quando o fornecedor esclareceu a
    // semântica: casa a parcela emitida OU que vence OU que teve alteração no
    // período. É um OU entre três datas, e é isso que a torna segura — pagamento
    // conta como alteração, então título que muda entra; e `vence no período` é
    // o que captura a virada aberto → atrasado.
    //
    // Overrides: `{ data_inicio, data_fim }` em aaaa-mm-dd, ou `{ full: true }`
    // para varrer sem janela (reconciliação completa, mais cara).
    const window: Record<string, string> = {};
    if (body.full !== true) {
      const custom: Record<string, string> = {};
      for (const [param, raw] of [
        ["dataInicio", body.data_inicio],
        ["dataFim", body.data_fim],
      ] as const) {
        if (typeof raw !== "string" || !raw.trim()) continue;
        const formatted = formatTothDate(raw);
        if (!formatted) {
          return json({ error: `${param} inválido: use aaaa-mm-dd (recebido "${raw}")` }, cors, 400);
        }
        custom[param] = formatted;
      }
      Object.assign(
        window,
        Object.keys(custom).length > 0
          ? custom
          : buildCobrancaWindow(todayIso, {
              backDays: WINDOW_BACK_DAYS,
              forwardDays: WINDOW_FORWARD_DAYS,
            }),
      );
    }

    const batches = chunkCnpjs(
      clients.map((c) => String(c.cnpj ?? "")),
      CNPJ_BATCH_SIZE,
    );

    const stats = {
      clients: 0,
      batches: 0,
      titulos: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      batchesFailed: 0,
    };
    const errors: string[] = [];

    for (const batch of batches) {
      stats.batches++;
      stats.clients += batch.length;

      let payload: unknown;
      try {
        // `cnpj=a,b,c` devolve os três. Cada linha da resposta carrega o seu
        // `codigoCliente`, e é por ele que `upsertCanonicalTitulo` resolve o
        // dono — o lote não precisa saber de quem é cada título.
        payload = await client.postForm("cobrancas", { cnpj: batch.join(","), ...window });
      } catch (err) {
        // Falha de auth aborta tudo: o token não vale e insistir só martela o
        // servidor. Falha de um lote não derruba os outros.
        if (err instanceof TothAuthError) {
          await admin
            .from("toth_connections")
            .update({ status: "expired", last_error: err.message })
            .eq("id", conn.id);
          await logRuntime({
            organizationId,
            module: "general",
            action: "toth_sync_cobrancas",
            status: "error",
            errorMessage: err.message,
            payloadSnapshot: { ...stats },
          });
          return json({ error: err.message, stats }, cors);
        }
        stats.batchesFailed++;
        if (errors.length < 3) {
          errors.push(err instanceof TothRequestError ? err.message : String(err));
        }
        await sleep(BATCH_DELAY_MS);
        continue;
      }

      for (const cobranca of extractRows(payload)) {
        stats.titulos++;
        try {
          const canonical = mapTothCobrancaToCanonical(cobranca, todayIso);
          const result = await upsertCanonicalTitulo(store, {
            organizationId,
            source: TOTH_PROVIDER_ID,
            titulo: canonical,
          });
          if (result.action === "created") stats.created++;
          else if (result.action === "updated") stats.updated++;
          else stats.skipped++;
        } catch (err) {
          stats.failed++;
          if (err instanceof TothMappingError && errors.length < 3) errors.push(err.message);
        }
      }

      await sleep(BATCH_DELAY_MS);
    }

    await admin
      .from("toth_connections")
      .update({
        last_cobrancas_sync_at: new Date().toISOString(),
        last_error: errors.length > 0 ? errors[0] : null,
      })
      .eq("id", conn.id);

    await logRuntime({
      organizationId,
      module: "general",
      action: "toth_sync_cobrancas",
      status: "success",
      payloadSnapshot: { ...stats, truncated: clients.length === MAX_CLIENTS_PER_RUN },
    });

    return json(
      {
        success: true,
        stats,
        // Silêncio sobre truncamento lê-se como "cobriu tudo". Diga quando não cobriu.
        truncated: clients.length === MAX_CLIENTS_PER_RUN,
        errors,
      },
      cors,
    );
  }),
);
