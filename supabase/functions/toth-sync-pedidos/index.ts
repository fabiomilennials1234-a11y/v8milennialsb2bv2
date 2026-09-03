/**
 * toth-sync-pedidos
 *
 * Puxa pedidos de venda → `upsell_orders` + `erp_order_items`. É o momento
 * **vendido** do ADR-0020, o que faltava entre o **quem** (clientes) e o
 * **recebido** (cobranças).
 *
 * 🔴 **O endpoint mudou de servidor, não de caminho.** A versão anterior desta
 * função chamava `GET /pedidos` no `/toth/services` e tratava o 404 como "a GON
 * ainda não liberou o redirecionamento". Estava errado: o fornecedor publicou
 * pedidos num serviço **separado** — `http://host:3000/flow/crm` — com login
 * próprio (`client_id`/`client_secret`), token em `Authorization: Bearer` e
 * leitura por **POST com corpo JSON**. Nenhum ajuste no caminho antigo faria
 * aquele 404 virar 200.
 *
 * Diferenças que moldam este arquivo:
 *
 *  1. **A janela é obrigatória.** O corpo leva `dataInicial` e `dataFinal`, e
 *     não existe "traga tudo". Quem decide o intervalo é
 *     `resolvePedidosWindow`, a partir da configuração da org.
 *  2. **É paginada de verdade** — `{data, page, hasNext}`. O cursor vive em
 *     `toth_connections.pedidos_cursor` e atravessa execuções.
 *  3. **O cliente vem pelo DOCUMENTO** (`numeroinscricao`), não pelo
 *     `codigoCliente`. A resolução por CNPJ em `upsertCanonicalOrder` é o único
 *     caminho — sem ela, todo pedido cairia em `client_not_synced`.
 *  4. **Situação importa.** `NORMAL` é pedido emitido e não faturado; só
 *     `FATURADO` entra como receita aprovada.
 *
 * ⚠️ **Nunca rodou contra o serviço real.** Medido em 28/08 da máquina do CTO:
 * a porta 3000 do host aceita a conexão TCP e fecha sem devolver byte nenhum de
 * HTTP, em qualquer caminho e método, enquanto a 8080 responde 200. O contrato
 * abaixo vem das capturas do Postman do fornecedor. Antes de ligar a
 * capacidade: `{"dry_run": true}` contra o serviço no ar.
 *
 * Auth dual: `x-cron-secret` (org no corpo) ou `Authorization` (org do JWT).
 *
 * Body opcional:
 *   - `{ dry_run: true }` — lê, mapeia e relata SEM escrever;
 *   - `{ page: N }` — começa nesta página, ignorando o cursor;
 *   - `{ max_pages: N }` — teto desta execução;
 *   - `{ data_inicial, data_final }` — sobrepõem a janela configurada;
 *   - `{ numero_inscricao: ["..."] }` — restringe a estes documentos;
 *   - `{ cnpj_da_carteira: true }` — usa os documentos da carteira da org.
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { logRuntime } from "../_shared/logger.ts";
import { timingSafeCompare } from "../_shared/auth.ts";
import { resolveAdminOrg } from "../_shared/erp/erp-admin-auth.ts";
import { TothAuthError, TothRequestError } from "../_shared/erp/toth-client.ts";
import { TothFlowClient } from "../_shared/erp/toth-flow-client.ts";
import { loadTothFlowCredentials, tothUrlPolicy } from "../_shared/erp/toth-credentials.ts";
import {
  extractHasNext,
  extractRows,
  mapTothPedidoToCanonical,
  TothMappingError,
} from "../_shared/erp/toth-mappers.ts";
import {
  buildPedidosBody,
  resolvePedidosWindow,
  type PedidosWindow,
} from "../_shared/erp/toth-pedidos-window.ts";
import {
  mesclarFatias,
  numeroDoPedido,
} from "../_shared/erp/toth-pedidos-montagem.ts";
import { TOTH_PROVIDER_ID } from "../_shared/erp/toth-provider.ts";
import { supabaseOrderStore } from "../_shared/erp/sync/order-store.ts";
import { upsertCanonicalOrder } from "../_shared/erp/sync/upsert-order.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

/**
 * Páginas por execução.
 *
 * Era 20 enquanto o tamanho da página fosse desconhecido. **Agora é conhecido**
 * (medido 01/09): a página traz 25 itens, o que dá 9 a 13 pedidos, e a chamada
 * volta em ~50 ms. Com `PAGE_DELAY_MS`, cada página custa ~450 ms — 60 páginas
 * são ~27 s, folgados dentro do teto de 150 s do gateway que já matou o sync de
 * clientes uma vez.
 *
 * 60 páginas ≈ 600 pedidos por volta. A janela padrão de 90 dias tem ~1.900
 * pedidos (medição: ~21/dia), então fecha em 3 ou 4 execuções em vez de 10.
 * Com `hasNext` verdadeiro ao fim, o cursor guarda onde parou; nada se perde
 * por parar cedo.
 */
const MAX_PAGES_PER_RUN = 60;
/** Pausa entre páginas: o alvo é o servidor de UMA empresa, não uma nuvem. */
const PAGE_DELAY_MS = 400;

/**
 * Teto de documentos enviados em `numeroInscricao`.
 *
 * A carteira da Café Jurerê tem mais de 12 mil clientes e ninguém documentou o
 * limite de corpo do serviço. Mandar a lista inteira é a forma mais provável de
 * arrancar um 413 ou um timeout do servidor do cliente — e o filtro por
 * documento é uma restrição, não uma necessidade: sem ele o serviço devolve
 * todos os pedidos da janela, que é o que a sincronização quer.
 */
const MAX_DOCUMENTOS = 200;

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

/**
 * Documentos da carteira, para o modo `cnpj_da_carteira`.
 *
 * Existe porque não sabemos se `numeroInscricao` é obrigatório. A captura do
 * fornecedor manda a lista; outra captura do mesmo endpoint devolve um
 * documento fora dessa lista, o que sugere que o filtro é opcional. Enquanto
 * ninguém exercita o serviço, o modo fica atrás de um flag — e o padrão é NÃO
 * filtrar, porque filtro que ninguém pediu vira "não houve vendas".
 */
async function documentosDaCarteira(
  admin: SupabaseClient,
  organizationId: string,
): Promise<{ docs: string[]; truncado: boolean }> {
  const { data } = await admin
    .from("upsell_clients")
    .select("cnpj")
    .eq("organization_id", organizationId)
    .not("cnpj", "is", null)
    // Sem ordenação estável a amostra muda a cada chamada e o resultado deixa
    // de ser comparável entre execuções.
    .order("updated_at", { ascending: false })
    // Pede UM a mais que o teto só para saber se sobrou — `length === limite`
    // não distingue "acabou exatamente aqui" de "tem mais e eu não vi".
    .limit(MAX_DOCUMENTOS + 1);

  const linhas = data ?? [];
  const truncado = linhas.length > MAX_DOCUMENTOS;
  const docs = linhas
    .slice(0, MAX_DOCUMENTOS)
    .map((r) => String((r as { cnpj?: unknown }).cnpj ?? "").replace(/\D/g, ""))
    .filter((d) => d.length > 0);
  return { docs: [...new Set(docs)], truncado };
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
      // Uma linha só, sem concatenar: `"a" + "b"` alarga para `string` e o
      // supabase-js perde a inferência do select, devolvendo `GenericStringError`
      // no lugar da linha. O erro aparece como "Property 'id' does not exist",
      // que não aponta para a causa.
      .select("id, erp_sync_mode, status, pedidos_cursor, flow_base_url, pedidos_janela_dias, pedidos_data_inicial")
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (!conn || conn.status !== "connected") {
      return json({ error: "Nenhuma conexão ativa com o ERP Toth" }, cors);
    }
    if (conn.erp_sync_mode === "off") {
      return json({ skipped: true, reason: "sync_mode_off" }, cors);
    }

    // Serviço de pedidos NÃO configurado é o estado normal das outras orgs — a
    // resposta precisa dizer o que preencher, não parecer uma falha de rede.
    const creds = await loadTothFlowCredentials(admin, organizationId);
    if (!creds) {
      return json(
        {
          error: conn.flow_base_url
            ? "Credenciais do serviço de pedidos indisponíveis. Reconecte informando client_id e client_secret."
            : "O serviço de pedidos não está configurado nesta organização. Informe o endereço do Flow (ex.: http://host:3000/flow/crm) e o par client_id/client_secret na tela do ERP.",
          nao_configurado: !conn.flow_base_url,
        },
        cors,
      );
    }

    const body = await req.clone().json().catch(() => ({}));
    const dryRun = body.dry_run === true;

    const window: PedidosWindow = resolvePedidosWindow({
      janelaDias: conn.pedidos_janela_dias as number | null,
      dataInicialConfigurada: conn.pedidos_data_inicial as string | null,
      dataInicial: typeof body.data_inicial === "string" ? body.data_inicial : null,
      dataFinal: typeof body.data_final === "string" ? body.data_final : null,
    });

    let documentos: string[] = [];
    /**
     * O filtro cobriu a carteira inteira, ou parou no teto?
     *
     * A carteira da Café Jurerê tem mais de 12 mil clientes e o teto é 200.
     * Cortar em silêncio faria a resposta parecer "não há mais pedidos" quando
     * o que houve foi "não perguntei pelo resto" — e o número que a pessoa vê
     * (`pedidos_lidos`) seria lido como cobertura total.
     */
    let documentosTruncados = false;
    if (Array.isArray(body.numero_inscricao)) {
      const pedidos = body.numero_inscricao
        .map((d: unknown) => String(d).replace(/\D/g, ""))
        .filter((d: string) => d.length > 0);
      documentosTruncados = pedidos.length > MAX_DOCUMENTOS;
      documentos = pedidos.slice(0, MAX_DOCUMENTOS);
    } else if (body.cnpj_da_carteira === true) {
      const carteira = await documentosDaCarteira(admin, organizationId);
      documentos = carteira.docs;
      documentosTruncados = carteira.truncado;
    }

    const maxPages =
      typeof body.max_pages === "number" && body.max_pages > 0
        ? Math.min(Math.floor(body.max_pages), MAX_PAGES_PER_RUN)
        : MAX_PAGES_PER_RUN;

    const client = new TothFlowClient(
      { baseUrl: creds.baseUrl, clientId: creds.clientId, clientSecret: creds.clientSecret },
      { urlPolicy: tothUrlPolicy(creds) },
    );
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
      /**
       * Pedidos sem valor. `upsell_orders` tem `CHECK (sale_value > 0)`, então
       * eles são pulados — 11 em 554 na medição de jun–ago, quase todos
       * CANCELADO. Contar em vez de engolir: zero silencioso vira "sumiu".
       */
      zeroValue: 0,
      /** Pedido retido por poder continuar na próxima página. Ver `emMontagem`. */
      retidos: 0,
    };
    const errors: string[] = [];
    const amostra: Array<Record<string, unknown>> = [];
    let stopReason = "max_pages";
    let hasNext: boolean | null = null;

    /**
     * 🔴 A página do Flow é de 25 **ITENS**, não de 25 pedidos — e por isso um
     * pedido é PARTIDO na fronteira entre páginas.
     *
     * Medido em 01/09 contra o serviço real: em TODAS as fronteiras testadas
     * (1×2, 2×3, 3×4, 4×5) exatamente um `numeropedido` aparece nas duas
     * páginas, com os itens repartidos e o `valortotalliquido` **repetido
     * inteiro** em cada fatia. O pedido 24243 vem com 6 itens na página 2 e 8
     * na página 3; o total, 32.031, vem nas duas. Contando os itens de cada
     * página: sempre 25, com 9 a 13 pedidos — a variação que denuncia o
     * agrupamento.
     *
     * Isso é fatal para `replaceOrderItems`, que APAGA os itens do pedido antes
     * de inserir a fatia nova: a segunda passagem deixaria 8 de 14 itens, com
     * `line_no` reiniciado em 1 — sem erro, sem log, com cara de íntegro. A
     * receita não sofre (o upsert é idempotente em `external_id` e o total
     * repete igual), mas a composição do pedido fica errada em cerca de um
     * pedido a cada dez.
     *
     * Solução: montar o pedido por número ao longo da volta e **segurar o
     * último pedido de cada página** até a página seguinte dizer se ele
     * continua. O que ficar retido ao fim da execução NÃO é gravado — o cursor
     * volta para a página em que ele começou, e a próxima volta o remonta
     * inteiro. Custo: uma página relida por execução.
     */
    const emMontagem = new Map<string, Record<string, unknown>>();
    const paginaDeEntrada = new Map<string, number>();

    /** Retomar daqui não perde nada: é a página de entrada do que está pela metade. */
    const paginaDeRetomada = () => {
      let menor: number | null = null;
      for (const numero of emMontagem.keys()) {
        const p = paginaDeEntrada.get(numero);
        if (p !== undefined && (menor === null || p < menor)) menor = p;
      }
      return menor ?? page;
    };

    const processar = async (row: Record<string, unknown>) => {
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
          return;
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
          if (result.reason === "zero_value") stats.zeroValue++;
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
    };

    try {
      for (let i = 0; i < maxPages; i++) {
        const payload = await client.postEnvelope(
          "pedidos",
          buildPedidosBody({ window, page, numeroInscricao: documentos }),
        );
        const rows = extractRows(payload);
        hasNext = extractHasNext(payload);
        stats.pages++;

        if (rows.length === 0) {
          stopReason = "empty_page";
          break;
        }

        for (const row of rows) {
          const numero = numeroDoPedido(row);
          if (numero === null) {
            // Sem número não dá para montar nem deduplicar — o mapeador é quem
            // sabe reclamar disso, e a contagem de falha sai de lá.
            await processar(row);
            continue;
          }
          if (!emMontagem.has(numero)) paginaDeEntrada.set(numero, page);
          emMontagem.set(numero, mesclarFatias(emMontagem.get(numero), row));
        }

        // O último pedido da página é o único que pode continuar na próxima.
        // Com `hasNext` falso não há próxima, então ninguém fica retido.
        const ultimo = numeroDoPedido(rows[rows.length - 1]);
        const retido = hasNext === false ? null : ultimo;

        for (const [numero, completo] of [...emMontagem]) {
          if (numero === retido) continue;
          emMontagem.delete(numero);
          paginaDeEntrada.delete(numero);
          await processar(completo);
        }

        // `hasNext: false` é o fim declarado pelo serviço. `null` é silêncio —
        // e aí quem encerra é a página vazia da volta seguinte. Tratar silêncio
        // como fim traria só a primeira página, sem ninguém notar.
        if (hasNext === false) {
          stopReason = "last_page";
          break;
        }

        stats.retidos = emMontagem.size;
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

      // Transporte mudo é a falha MEDIDA hoje (porta 3000 aceita e fecha), e é
      // diferente de credencial errada. Separar as duas evita a caça ao erro
      // que já custou dias nesta integração.
      const semResposta = err instanceof TothRequestError && err.status === null;

      if (!dryRun) {
        await admin
          .from("toth_connections")
          .update({
            last_error: message,
            ...(err instanceof TothAuthError ? { status: "expired" } : {}),
            // Cursor congela onde o que está pela metade COMEÇOU, não onde a
            // falha aconteceu: retomar da página do erro deixaria o pedido
            // retido com só a cauda dele.
            pedidos_cursor: paginaDeRetomada(),
          })
          .eq("id", conn.id);
      }

      await logRuntime({
        organizationId,
        module: "general",
        action: "toth_sync_pedidos",
        status: "error",
        errorMessage: message,
        payloadSnapshot: { ...stats, page, janela: window, sem_resposta: semResposta },
      });

      return json(
        {
          error: message,
          servico_mudo: semResposta,
          ...(semResposta
            ? {
                hint: "O host aceita a conexão e fecha sem responder — é publicação de porta, não credencial. Medido em 28/08: a 3000 fecha muda de fora da rede e a 8080 responde. Confirme com a GON Informática.",
              }
            : {}),
          janela: window,
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
          janela: window,
          documentos_filtrados: documentos.length,
          documentos_truncados: documentosTruncados,
          stop_reason: stopReason,
          has_next: hasNext,
          paginas_lidas: stats.pages,
          pedidos_lidos: stats.rows,
          itens_lidos: stats.items,
          sem_numero: stats.failed,
          // Pedido cortado na fronteira e segurado para a próxima volta. Zero
          // aqui com `has_next: true` é sinal de que a montagem não está agindo.
          retidos: emMontagem.size,
          valor_zero: stats.zeroValue,
          amostra,
          erros: errors,
        },
        cors,
      );
    }

    /**
     * Recalcula a cadência de compra dos clientes.
     *
     * **Org inteira, e de propósito.** Dá para argumentar que só os clientes
     * tocados nesta volta mudaram — mas a janela RELÊ o passado: um pedido
     * `NORMAL` vira `FATURADO` dias depois, e só então entra na conta. O
     * conjunto que "mudou" não é o conjunto que apareceu nas páginas de hoje.
     * Errar isso deixaria a média velha em quem acabou de faturar, e média
     * velha é pior que média ausente — ela parece atualizada.
     *
     * Custo: uma sentença SQL sobre ~12 mil linhas agregando `upsell_orders`.
     * Nada trafega para o isolate, que é justamente onde a memória acabou uma
     * vez nesta integração.
     */
    let cadenciaRecalculada = 0;
    if (stats.created + stats.updated > 0) {
      const { data: recalc, error: recalcErr } = await admin.rpc(
        "recompute_erp_order_cadence",
        { p_organization_id: organizationId, p_client_ids: null },
      );
      if (recalcErr) {
        // Não derruba a execução: os pedidos já estão gravados e a cadência é
        // derivada — a próxima volta recalcula. Falha aqui não pode perder pedido.
        if (errors.length < 3) errors.push(`recompute_erp_order_cadence: ${recalcErr.message}`);
      } else {
        cadenciaRecalculada = typeof recalc === "number" ? recalc : 0;
      }
    }

    await admin
      .from("toth_connections")
      .update({
        // Parou no teto com mais adiante → guarda a página em que o pedido
        // retido COMEÇOU, não a última lida: ele não foi gravado, e retomar
        // depois dele o deixaria pela metade para sempre. Acabou a volta →
        // zera, porque pedido muda de situação (NORMAL vira FATURADO) e
        // revisitar é o comportamento desejado.
        pedidos_cursor: stopReason === "max_pages" && hasNext !== false ? paginaDeRetomada() : 1,
        last_pedidos_sync_at: new Date().toISOString(),
        ...(errors.length > 0 ? { last_error: errors[0] } : {}),
      })
      .eq("id", conn.id);

    await logRuntime({
      organizationId,
      module: "general",
      action: "toth_sync_pedidos",
      status: "success",
      payloadSnapshot: {
        ...stats,
        stop_reason: stopReason,
        has_next: hasNext,
        janela: window,
        cadencia_recalculada: cadenciaRecalculada,
      },
    });

    return json(
      {
        success: true,
        janela: window,
        documentos_filtrados: documentos.length,
        documentos_truncados: documentosTruncados,
        stop_reason: stopReason,
        // Silêncio sobre "faltou página" lê-se como "cobriu tudo".
        incompleto: stopReason === "max_pages" && hasNext !== false,
        has_next: hasNext,
        stats,
        cadencia_recalculada: cadenciaRecalculada,
        // Pedido de cliente que não está na carteira é o sintoma de rodar fora de
        // ordem: clientes primeiro, pedidos depois.
        ...(documentosTruncados
          ? {
              aviso: `O filtro por documento parou em ${MAX_DOCUMENTOS} CNPJs — há mais na carteira. Esta execução NÃO cobriu todos os clientes.`,
            }
          : {}),
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
