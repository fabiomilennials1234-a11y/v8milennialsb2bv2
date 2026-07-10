/**
 * tinyerp-pull-orders
 *
 * Puxa pedidos do TinyERP → upsell_orders (carteira). Camada 2 do ERP sync.
 * Modelo: cliente DERIVADO do pedido (nome pessoa) — casa/cria upsell_client
 * por nome normalizado (+ CNPJ do pedido.obter), carteira continua person-based.
 *
 * Fluxo:
 *  1. pedidos.pesquisa.php {dataInicial, dataFinal, pagina} — lista leve.
 *  2. Filtra por situacao (exclui Cancelado/Aberto por default).
 *  3. Dedup por tiny_order_id (idempotente).
 *  4. pedido.obter.php {id} — cliente (cpf_cnpj) + itens (1 call/pedido, rate-limited).
 *  5. Match/cria upsell_client; insere upsell_order APPROVED + client_purchase_items.
 *     O trigger da Camada 1 recomputa métrica do cliente na hora.
 *
 * Escala: Tiny pode ter dezenas de milhares de pedidos. Worker é LIMITADO por
 * execução (max_pages/max_obter) e RESUMÍVEL (retorna next_page). Cron reentra.
 *
 * dry_run=true — conta + amostra real de pedido.obter (cliente+itens), SEM escrever.
 * Auth: x-cron-secret. Body: { organization_id, dry_run?, months_back?, start_page?, max_pages?, max_obter?, rate_ms? }.
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { timingSafeCompare } from "../_shared/auth.ts";
import { getOrgTinyToken, callTinyApi, type TinyApiResponse } from "../_shared/tinyerp-utils.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

// situações Tiny consideradas venda efetiva (exclui Cancelado/Aberto/Draft)
const SALE_SITUACOES = new Set(["atendido", "faturado", "enviado", "entregue", "pronto para envio"]);

function normalizeDoc(v?: string | null): string | null {
  if (!v) return null;
  const d = v.replace(/\D/g, "");
  return d.length > 0 ? d : null;
}
function normalizeName(v?: string | null): string {
  return (v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}
function maskName(name?: string): string {
  const n = (name ?? "").trim();
  if (!n) return "(vazio)";
  return n.length <= 4 ? `${n[0] ?? ""}***` : `${n.slice(0, 4)}***`;
}
// Tiny data "dd/mm/yyyy" → ISO (meio-dia UTC p/ evitar drift de fuso). Fallback: agora.
function parseTinyDate(d?: string): string {
  if (d && /^\d{2}\/\d{2}\/\d{4}$/.test(d)) {
    const [dd, mm, yyyy] = d.split("/");
    return `${yyyy}-${mm}-${dd}T12:00:00Z`;
  }
  return new Date().toISOString();
}
function ddmmyyyy(date: Date): string {
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${date.getUTCFullYear()}`;
}

interface TinyPedidoListItem {
  id?: string;
  numero?: string;
  data_pedido?: string;
  nome?: string;
  valor?: number | string;
  situacao?: string;
}
interface TinyItem {
  descricao?: string;
  quantidade?: number | string;
  valor_unitario?: number | string;
  unidade?: string;
}

async function matchOrCreateClient(
  supabase: SupabaseClient,
  orgId: string,
  nome: string,
  cnpj: string | null,
  phone: string | null,
  email: string | null,
  now: string,
): Promise<{ id: string; created: boolean }> {
  const nameNorm = normalizeName(nome);

  // Enriquece cliente casado com dado do ERP sem sobrescrever o que já existe.
  async function enrich(row: { id: string; cnpj?: string | null; phone?: string | null; email?: string | null }) {
    const patch: Record<string, unknown> = { external_source: "tiny", tiny_synced_at: now };
    if (!row.cnpj && cnpj) patch.cnpj = cnpj;
    if (!row.phone && phone) patch.phone = phone;
    if (!row.email && email) patch.email = email;
    await supabase.from("upsell_clients").update(patch).eq("id", row.id);
  }

  // 1. por CNPJ
  if (cnpj) {
    const { data } = await supabase
      .from("upsell_clients").select("id, cnpj, phone, email").eq("organization_id", orgId).eq("cnpj", cnpj)
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (data) { await enrich(data); return { id: data.id, created: false }; }
  }
  // 2. por nome exato normalizado
  if (nameNorm) {
    const { data } = await supabase
      .from("upsell_clients").select("id, name, cnpj, phone, email").eq("organization_id", orgId)
      .ilike("name", nome).limit(3);
    const exact = (data ?? []).filter((r: { name?: string }) => normalizeName(r.name) === nameNorm);
    if (exact.length === 1) { await enrich(exact[0]); return { id: exact[0].id, created: false }; }
  }
  // 3. cria
  const { data: created, error } = await supabase
    .from("upsell_clients").insert({
      organization_id: orgId,
      name: nome.trim() || "Cliente ERP",
      cnpj,
      phone,
      email,
      external_source: "tiny",
      tiny_synced_at: now,
      is_active: true,
    }).select("id").single();
  if (error) throw error;
  return { id: created.id, created: true };
}

Deno.serve(
  withErrorBoundary("tinyerp-pull-orders", async (req: Request): Promise<Response> => {
    const headers = withSecurityHeaders({
      ...getCorsHeaders(req.headers.get("origin")),
      "Content-Type": "application/json",
    });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });

    const cronSecret = req.headers.get("x-cron-secret");
    if (!CRON_SECRET || !cronSecret || !timingSafeCompare(cronSecret, CRON_SECRET)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }

    let body: {
      organization_id?: string; dry_run?: boolean; months_back?: number;
      start_page?: number; max_pages?: number; max_obter?: number; rate_ms?: number;
    };
    try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "invalid json" }), { status: 400, headers }); }

    const orgId = body.organization_id;
    const dryRun = body.dry_run === true;
    const monthsBack = Math.max(1, Math.min(body.months_back ?? 12, 120));
    const maxPages = Math.max(1, Math.min(body.max_pages ?? 5, 50));
    const maxObter = Math.max(1, Math.min(body.max_obter ?? 120, 500));
    const rateMs = Math.max(0, Math.min(body.rate_ms ?? 350, 3000));
    if (!orgId) return new Response(JSON.stringify({ error: "organization_id required" }), { status: 400, headers });

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    const { data: conn } = await supabase
      .from("tinyerp_connections").select("id, status, order_pull_cursor").eq("organization_id", orgId).eq("status", "connected").maybeSingle();
    if (!conn) return new Response(JSON.stringify({ ok: false, reason: "not_connected" }), { status: 200, headers });

    // Cursor: cron reentra sem estado próprio. body.start_page sobrepõe (rodada manual).
    const cursor: number | null = (conn as { order_pull_cursor?: number | null }).order_pull_cursor ?? null;
    const useCursor = body.start_page == null;
    if (useCursor && cursor === 0) {
      return new Response(JSON.stringify({ ok: true, done: true, reason: "backfill_complete" }), { status: 200, headers });
    }
    const startPage = Math.max(1, body.start_page ?? cursor ?? 1);

    const tokenData = await getOrgTinyToken(supabase, orgId);
    if (!tokenData) return new Response(JSON.stringify({ ok: false, reason: "no_token" }), { status: 200, headers });

    const now = new Date();
    const dataInicial = ddmmyyyy(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, now.getUTCDate())));
    const dataFinal = ddmmyyyy(now);
    const nowIso = now.toISOString();

    // DEBUG probe: escaneia N páginas de pedidos.pesquisa (sem obter/escrita, com
    // delay anti-rate-limit) e reporta por página. Diagnóstico de paginação.
    const probePages = (body as { probe_pages?: number }).probe_pages;
    if (probePages && probePages > 0) {
      const report: Array<Record<string, unknown>> = [];
      for (let pg = startPage; pg < startPage + Math.min(probePages, 25); pg++) {
        await new Promise((r) => setTimeout(r, 400));
        const r: TinyApiResponse = await callTinyApi(tokenData.token, "pedidos.pesquisa.php", { dataInicial, dataFinal, pagina: pg });
        const peds = (r.retorno.pedidos as Array<{ pedido: TinyPedidoListItem }> | undefined) ?? [];
        report.push({
          page: pg, count: peds.length,
          total_pages: r.retorno.numero_paginas ?? null,
          proc: r.retorno.status_processamento,
          status: r.retorno.status,
          erros: r.retorno.erros ?? null,
          first_date: peds[0]?.pedido?.data_pedido,
          last_date: peds[peds.length - 1]?.pedido?.data_pedido,
        });
        if (peds.length === 0) break;
      }
      return new Response(JSON.stringify({ ok: true, dataInicial, dataFinal, probe: report }), { status: 200, headers });
    }

    const stats = {
      pages_scanned: 0, pedidos_seen: 0, skipped_situacao: 0, skipped_dup: 0,
      obter_calls: 0, orders_created: 0, clients_created: 0, failed: 0,
      next_page: null as number | null, total_pages: null as number | null,
    };
    const sample: Array<Record<string, unknown>> = [];

    try {
      let page = startPage;
      let obterBudget = maxObter;
      // numero_paginas SÓ é confiável em página com dados. Resposta rate-limited vem
      // vazia E sem numero_paginas (=0). Guardamos o último total conhecido pra
      // distinguir FIM real (page > total) de rate-limit (page <= total → retoma).
      let lastKnownTotal = 0;

      for (let i = 0; i < maxPages; i++, page++) {
        // Delay antes de CADA pesquisa (inclui a 1ª). Sem isso o Tiny rejeita a
        // chamada imediata (volta vazia) e a paginação parava. Empírico: probe com
        // delay pega 100/página; sem delay volta vazio.
        await new Promise((r) => setTimeout(r, 500));
        const resp: TinyApiResponse = await callTinyApi(tokenData.token, "pedidos.pesquisa.php", {
          dataInicial, dataFinal, pagina: page,
        });
        const pedidos = (resp.retorno.pedidos as Array<{ pedido: TinyPedidoListItem }> | undefined) ?? [];
        const tp = Number(resp.retorno.numero_paginas ?? 0);
        if (tp > 0) lastKnownTotal = tp;
        stats.total_pages = lastKnownTotal;
        if (pedidos.length === 0) {
          // Vazio: conclui SÓ se sabemos o total e já passamos dele. Senão (inclui
          // rate-limit sem numero_paginas) → retoma ESTA página (cursor fica aqui).
          stats.next_page = (lastKnownTotal > 0 && page > lastKnownTotal) ? null : page;
          break;
        }
        stats.pages_scanned++;

        for (const row of pedidos) {
          const p = row.pedido ?? {};
          stats.pedidos_seen++;
          const situ = normalizeName(p.situacao);
          if (!SALE_SITUACOES.has(situ)) { stats.skipped_situacao++; continue; }
          const tinyId = p.id ? String(p.id) : null;
          if (!tinyId) { stats.skipped_situacao++; continue; }

          // dedup
          const { data: existing } = await supabase
            .from("upsell_orders").select("id").eq("organization_id", orgId).eq("tiny_order_id", tinyId).maybeSingle();
          if (existing) { stats.skipped_dup++; continue; }

          if (obterBudget <= 0) { stats.next_page = page; break; } // orçamento de obter esgotado nesta rodada

          // pedido.obter → cliente + itens
          if (rateMs > 0) await new Promise((r) => setTimeout(r, rateMs));
          const det: TinyApiResponse = await callTinyApi(tokenData.token, "pedido.obter.php", { id: tinyId });
          stats.obter_calls++; obterBudget--;
          const ped = (det.retorno.pedido as Record<string, any> | undefined) ?? {};
          const cli = (ped.cliente as Record<string, any> | undefined) ?? {};
          const nome = String(cli.nome ?? p.nome ?? "").trim();
          const cnpj = normalizeDoc(cli.cpf_cnpj);
          const itens = (ped.itens as Array<{ item: TinyItem }> | undefined) ?? [];
          const total = Number(ped.total_pedido ?? ped.valor ?? p.valor ?? 0);
          const soldAt = parseTinyDate(ped.data_pedido ?? p.data_pedido);

          if (sample.length < 3) {
            sample.push({
              tiny_id: tinyId, numero: p.numero, situacao: p.situacao,
              cliente_nome: maskName(nome), cliente_has_cnpj: !!cnpj,
              total, itens_count: itens.length,
              cli_keys: Object.keys(cli), item_sample: itens[0]?.item ? Object.keys(itens[0].item) : [],
            });
          }

          if (dryRun) continue;
          if (!nome || total <= 0) { stats.skipped_situacao++; continue; }

          try {
            const client = await matchOrCreateClient(
              supabase, orgId, nome, cnpj,
              cli.fone || cli.celular || null, cli.email || null, nowIso,
            );
            const clientId = client.id;
            if (client.created) stats.clients_created++;

            const productName = itens.length === 1
              ? (itens[0].item?.descricao ?? `Pedido ERP #${p.numero ?? tinyId}`)
              : `Pedido ERP #${p.numero ?? tinyId} (${itens.length} itens)`;

            const { data: order, error: orderErr } = await supabase
              .from("upsell_orders").insert({
                organization_id: orgId,
                client_id: clientId,
                product_name: productName,
                product_type: "unitario",
                sale_value: total,
                source: "erp",
                origin: "upsell",
                approval_status: "approved",
                approved_at: nowIso,
                sold_at: soldAt,
                tiny_order_id: tinyId,
                notes: `tiny:${tinyId}`,
              }).select("id").single();
            if (orderErr) {
              // corrida de dedup (unique index) → trata como dup
              if (String(orderErr.code) === "23505") { stats.skipped_dup++; continue; }
              throw orderErr;
            }
            stats.orders_created++;

            if (itens.length > 0) {
              await supabase.from("client_purchase_items").insert(
                itens.map((it) => ({
                  order_id: order.id,
                  product_name: it.item?.descricao ?? "Item",
                  quantity: Number(it.item?.quantidade ?? 1),
                  unit_price: Number(it.item?.valor_unitario ?? 0),
                  unit: it.item?.unidade ?? "un",
                })),
              );
            }
          } catch (e) {
            stats.failed++;
            console.error(`[pull-orders] falha pedido ${tinyId}:`, e instanceof Error ? e.message : e);
          }
        }

        if (stats.next_page === page) break; // orçamento esgotado no meio da página
        // Avança sempre +1. Fim = página vazia (checado no topo do loop). NÃO confiar
        // em numero_paginas: o Tiny às vezes devolve 0/ausente → cursor ia pra 0 cedo.
        stats.next_page = page + 1;
      }

      if (!dryRun) {
        const patch: Record<string, unknown> = { last_order_pull_at: nowIso };
        // Avança cursor só quando rodando pelo cron (sem start_page explícito).
        // next_page null = fim → 0 (concluído, idle nas próximas rodadas).
        if (useCursor) patch.order_pull_cursor = stats.next_page ?? 0;
        await supabase.from("tinyerp_connections").update(patch).eq("id", conn.id);
      }

      return new Response(
        JSON.stringify({ ok: true, dry_run: dryRun, dataInicial, dataFinal, stats, sample }),
        { status: 200, headers },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[pull-orders] erro:", msg);
      return new Response(JSON.stringify({ ok: false, error: msg, stats, sample }), { status: 200, headers });
    }
  }),
);
