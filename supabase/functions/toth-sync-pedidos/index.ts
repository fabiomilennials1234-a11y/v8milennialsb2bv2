/**
 * toth-sync-pedidos
 *
 * Puxa pedidos de venda do ERP Toth → `upsell_orders` + `erp_order_items`. É o
 * momento **vendido** do ADR-0020, o que faltava entre o **quem** (clientes) e o
 * **recebido** (cobranças).
 *
 * 🟠 **O endpoint ainda não responde.** Em 25/08/2026 `/pedidos` devolve 404 no
 * ERP da Café Jurerê: o fornecedor construiu o serviço, mandou o retorno real, e
 * aguarda a GON Informática mudar um redirecionamento. Esta função existe agora
 * porque o contrato existe agora — quando o caminho abrir, o trabalho é rodar
 * `toth-probe`, conferir a forma e ligar a capacidade, não escrever um sync.
 *
 * Diferenças de forma em relação às outras duas sincronizações:
 *
 *  1. **É paginada de verdade** — `{ data: [...], page, hasNext }`. `/clientes`
 *     devolve tudo de uma vez e `/cobrancas` é por CNPJ; este é o primeiro
 *     endpoint do Toth com cursor próprio, e o cursor vive em
 *     `toth_connections.pedidos_cursor` para atravessar execuções.
 *  2. **O cliente vem pelo DOCUMENTO** (`numeroinscricao`), não pelo
 *     `codigoCliente`. A resolução por CNPJ em `upsertCanonicalOrder` é o único
 *     caminho — sem ela, todo pedido cairia em `client_not_synced`.
 *  3. **Situação importa.** `NORMAL` é pedido emitido e não faturado; só
 *     `FATURADO` entra como receita aprovada. Ver `approvalForErpStatus`.
 *
 * Auth dual: `x-cron-secret` (org no corpo) ou `Authorization` (org do JWT).
 *
 * Body opcional:
 *   - `{ dry_run: true }` — lê, mapeia e relata SEM escrever;
 *   - `{ page: N }` — começa nesta página, ignorando o cursor;
 *   - `{ max_pages: N }` — teto desta execução;
 *   - `{ filtros: { ... } }` — parâmetros extras repassados ao ERP (allowlist).
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
  extractHasNext,
  extractRows,
  mapTothPedidoToCanonical,
  TothMappingError,
} from "../_shared/erp/toth-mappers.ts";
import { TOTH_PROVIDER_ID } from "../_shared/erp/toth-provider.ts";
import { supabaseOrderStore } from "../_shared/erp/sync/order-store.ts";
import { upsertCanonicalOrder } from "../_shared/erp/sync/upsert-order.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

/**
 * Páginas por execução.
 *
 * Conservador de propósito enquanto o tamanho da página do ERP é desconhecido —
 * a amostra do fornecedor trouxe 10 pedidos, mas amostra não é contrato. Com
 * `hasNext` verdadeiro ao fim, o cursor guarda onde parou e a próxima execução
 * continua; nada se perde por parar cedo, e o servidor do cliente agradece.
 */
const MAX_PAGES_PER_RUN = 20;
/** Pausa entre páginas: o alvo é o servidor de UMA empresa, não uma nuvem. */
const PAGE_DELAY_MS = 400;
/** Parâmetros que podem ser repassados ao ERP pelo corpo. Ver a nota abaixo. */
const ALLOWED_FILTERS = ["cnpj", "dataInicio", "dataFim", "situacao", "marcas"];

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
  withErrorBoundary("toth-sync-pedidos", async (req) => {
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
      .select("id, erp_sync_mode, status, pedidos_cursor")
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

    const body = await req.clone().json().catch(() => ({}));
    const dryRun = body.dry_run === true;

    /**
     * Filtros repassados ao ERP.
     *
     * Allowlist estrita, e a razão não é estética: parâmetro que o Toth não
     * conhece já provocou HTTP 500 em `/clientes` (19/08). Os nomes aqui são
     * palpites plausíveis para um endpoint que ainda não respondeu — por isso
     * nenhum é enviado por padrão, e quem sondar decide o que mandar sem
     * precisar de um deploy por tentativa.
     */
    const filtros: Record<string, string> = {};
    if (body.filtros && typeof body.filtros === "object") {
      for (const [k, v] of Object.entries(body.filtros as Record<string, unknown>)) {
        if (!ALLOWED_FILTERS.includes(k)) continue;
        if (typeof v === "string" || typeof v === "number") filtros[k] = String(v);
      }
    }

    const maxPages =
      typeof body.max_pages === "number" && body.max_pages > 0
        ? Math.min(Math.floor(body.max_pages), MAX_PAGES_PER_RUN)
        : MAX_PAGES_PER_RUN;

    const client = new TothClient(creds, { urlPolicy: tothUrlPolicy(creds) });
    const store = supabaseOrderStore(admin);

    let page =
      typeof body.page === "number" && body.page > 0
        ? Math.floor(body.page)
        : ((conn.pedidos_cursor as number | null) ?? 1);

    const stats = {
      pages: 0,
      rows: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      items: 0,
      /** Pedidos cujo cliente não está na carteira — o número que denuncia ordem errada. */
      clientNotSynced: 0,
      /** Pedidos que entraram como pendentes por não estarem faturados. */
      pending: 0,
    };
    const errors: string[] = [];
    const amostra: Array<Record<string, unknown>> = [];
    let stopReason = "max_pages";
    let hasNext: boolean | null = null;

    try {
      for (let i = 0; i < maxPages; i++) {
        const payload = await client.get("pedidos", { ...filtros, page: String(page) });
        const rows = extractRows(payload);
        hasNext = extractHasNext(payload);
        stats.pages++;

        if (rows.length === 0) {
          stopReason = "empty_page";
          break;
        }

        for (const row of rows) {
          stats.rows++;
          try {
            const canonical = mapTothPedidoToCanonical(row);
            stats.items += canonical.items?.length ?? 0;

            if (dryRun) {
              if (amostra.length < 5) {
                amostra.push({
                  pedido: canonical.externalId,
                  emitido_em: canonical.soldAt,
                  situacao: canonical.erpStatus,
                  valor: canonical.saleValue,
                  itens: canonical.items?.length ?? 0,
                  // Só a contagem de dígitos: a prévia responde "casou?", e
                  // documento inteiro em resposta de diagnóstico é PII à toa.
                  cnpj_digitos: canonical.clientCnpj?.length ?? 0,
                  produto: canonical.productName,
                });
              }
              continue;
            }

            const result = await upsertCanonicalOrder(store, {
              organizationId,
              source: TOTH_PROVIDER_ID,
              order: canonical,
            });
            if (result.action === "created") stats.created++;
            else if (result.action === "updated") stats.updated++;
            else {
              stats.skipped++;
              if (result.reason === "client_not_synced") stats.clientNotSynced++;
            }
            if (
              result.action !== "skipped" &&
              canonical.erpStatus &&
              canonical.erpStatus.trim().toUpperCase() !== "FATURADO"
            ) {
              stats.pending++;
            }
          } catch (err) {
            stats.failed++;
            if (errors.length < 3) {
              errors.push(err instanceof TothMappingError ? err.message : String(err));
            }
          }
        }

        // `hasNext: false` é o fim declarado pelo ERP. `null` é o ERP calado —
        // e aí quem encerra é a página curta ou vazia da volta seguinte. Tratar
        // silêncio como fim traria só a primeira página, sem ninguém notar.
        if (hasNext === false) {
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

      // 404 tem tratamento próprio: enquanto a GON não publica o caminho, este é
      // o erro ESPERADO, e dizer "o endpoint ainda não existe" evita que alguém
      // vá caçar defeito de credencial ou de rede.
      const naoPublicado = err instanceof TothRequestError && err.status === 404;

      if (!dryRun) {
        await admin
          .from("toth_connections")
          .update({
            last_error: message,
            ...(err instanceof TothAuthError ? { status: "expired" } : {}),
            // Cursor congela onde parou: a próxima execução retoma a página.
            pedidos_cursor: page,
          })
          .eq("id", conn.id);
      }

      await logRuntime({
        organizationId,
        module: "general",
        action: "toth_sync_pedidos",
        status: "error",
        errorMessage: message,
        payloadSnapshot: { ...stats, page, nao_publicado: naoPublicado },
      });

      return json(
        {
          error: message,
          endpoint_indisponivel: naoPublicado,
          ...(naoPublicado
            ? {
                hint: "O ERP ainda não publicou /pedidos. O fornecedor aguarda a GON Informática liberar o redirecionamento — não é credencial nem rede.",
              }
            : {}),
          stats,
        },
        cors,
      );
    }

    if (dryRun) {
      return json(
        {
          dry_run: true,
          escreveu: false,
          stop_reason: stopReason,
          has_next: hasNext,
          paginas_lidas: stats.pages,
          pedidos_lidos: stats.rows,
          itens_lidos: stats.items,
          sem_numero: stats.failed,
          amostra,
          erros: errors,
        },
        cors,
      );
    }

    await admin
      .from("toth_connections")
      .update({
        // Parou no teto com mais adiante → guarda a página. Acabou a volta →
        // zera, porque pedido muda de situação (NORMAL vira FATURADO) e
        // revisitar é o comportamento desejado.
        pedidos_cursor: stopReason === "max_pages" && hasNext !== false ? page : 1,
        last_pedidos_sync_at: new Date().toISOString(),
        ...(errors.length > 0 ? { last_error: errors[0] } : {}),
      })
      .eq("id", conn.id);

    await logRuntime({
      organizationId,
      module: "general",
      action: "toth_sync_pedidos",
      status: "success",
      payloadSnapshot: { ...stats, stop_reason: stopReason, has_next: hasNext },
    });

    return json(
      {
        success: true,
        stop_reason: stopReason,
        // Silêncio sobre "faltou página" lê-se como "cobriu tudo".
        incompleto: stopReason === "max_pages" && hasNext !== false,
        has_next: hasNext,
        stats,
        // Pedido de cliente que não está na carteira é o sintoma de rodar fora de
        // ordem: clientes primeiro, pedidos depois.
        ...(stats.clientNotSynced > 0
          ? {
              hint: `${stats.clientNotSynced} pedido(s) de cliente fora da carteira. Rode toth-sync-clientes antes — ou confira se o recorte de marcas/empresa está deixando esses clientes de fora.`,
            }
          : {}),
        errors,
      },
      cors,
    );
  }),
);
