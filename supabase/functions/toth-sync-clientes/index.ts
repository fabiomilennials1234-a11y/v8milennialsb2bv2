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
import {
  extractRows,
  mapTothClienteToCanonical,
  TothMappingError,
  tothClienteEmpresas,
  tothClienteMatchesEmpresa,
} from "../_shared/erp/toth-mappers.ts";
import { TOTH_PROVIDER_ID } from "../_shared/erp/toth-provider.ts";
import { supabaseClientStore } from "../_shared/erp/sync/client-store.ts";
import { cachedClientStore } from "../_shared/erp/sync/cached-client-store.ts";
import { deferredEnrichStore } from "../_shared/erp/sync/deferred-enrich-store.ts";
import { bulkCreateClients } from "../_shared/erp/sync/bulk-create-clients.ts";
import { upsertCanonicalClient, type ErpSyncMode } from "../_shared/erp/sync/upsert-client.ts";
import { loadOwnerMap } from "../_shared/erp/sync/owner-map.ts";
import type { CanonicalClient } from "../_shared/erp/types.ts";
import { normalizePhoneForSearch } from "../_shared/lead-service.ts";
import {
  previewAction,
  summarize,
  phonesAtRisk,
  sampleForReview,
  type PreviewedClient,
} from "../_shared/erp/toth-dry-run.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

const PAGE_SIZE = 100;
const MAX_PAGES_PER_RUN = 20;

/**
 * Enriquecimentos por execução, e de quanto em quanto a fila é esvaziada.
 *
 * 🔴 Acumular a fila inteira derrubou o worker com `WORKER_RESOURCE_LIMIT`
 * (546) — não é o teto de tempo, é memória: 12.613 registros do ERP mais a
 * carteira pré-carregada mais 11.179 patches vivos ao mesmo tempo.
 *
 * O teto por execução NÃO precisa de cursor. A varredura lê a base inteira toda
 * vez, e `upsertCanonicalClient` pula quem já está igual (`no_changes`) — então
 * a execução seguinte atravessa de graça o que a anterior gravou e ataca o
 * resto. A retomada é consequência da idempotência, não de estado guardado.
 */
const MAX_ENRICH_PER_RUN = 3000;
const ENRICH_FLUSH_EVERY = 500;
/** Pausa entre páginas: o alvo é o servidor de UM cliente, não uma nuvem. */
const PAGE_DELAY_MS = 300;

const json = (body: unknown, headers: Record<string, string>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Telefones por consulta — o filtro `in` do PostgREST vai na query string. */
const PHONE_LOOKUP_BATCH = 100;

/**
 * Quantas conversas órfãs seriam adotadas se estes leads fossem criados.
 *
 * É o número que decide se o piloto pode rodar: `tg_leads_adopt_orphan_messages`
 * pendura toda mensagem sem dono cujo telefone bata. Aqui é só `count`, com
 * `head: true` — nenhuma linha de mensagem trafega, só o número.
 */
async function countOrphanAdoption(
  admin: SupabaseClient,
  organizationId: string,
  phones: string[],
): Promise<{ mensagens: number; conversas: number }> {
  if (phones.length === 0) return { mensagens: 0, conversas: 0 };

  let mensagens = 0;
  let conversas = 0;

  for (let i = 0; i < phones.length; i += PHONE_LOOKUP_BATCH) {
    const batch = phones.slice(i, i + PHONE_LOOKUP_BATCH);

    const { count: msgCount } = await admin
      .from("whatsapp_messages")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .is("lead_id", null)
      .in("normalized_phone", batch);
    mensagens += msgCount ?? 0;

    const { count: convCount } = await admin
      .from("whatsapp_conversation_summary")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .is("lead_id", null)
      .in("normalized_phone", batch);
    conversas += convCount ?? 0;
  }

  return { mensagens, conversas };
}

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
      // Literal única: o supabase-js infere as colunas a partir do TEXTO do
      // select. Concatenar com `+` produz `string` genérico e o retorno degrada
      // para `GenericStringError`, quebrando o acesso a todo campo.
      .select("id, erp_sync_mode, clientes_cursor, status, clientes_dias_compras, clientes_marcas, clientes_somente_com_compra, clientes_empresa, clientes_incluir_sem_empresa")
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
    // Carteira pré-carregada: o store direto faria duas consultas por cliente do
    // ERP, sequenciais. Numa carga inicial isso são dezenas de milhares de idas
    // ao banco, e foi parte do "CPU Time exceeded" de 20/08.
    const cached = await cachedClientStore(
      admin,
      organizationId,
      TOTH_PROVIDER_ID,
      supabaseClientStore(admin, TOTH_PROVIDER_ID),
    );

    /**
     * De-para de representante, carregado uma vez.
     *
     * 🔴 **Mapa vazio não escreve nada.** 216 representantes distintos no ERP da
     * Café Jurerê contra 8 team members na org, com nomes ambíguos, grafias
     * divergentes e seis "representantes" que são canais e não pessoas — não há
     * correspondência a descobrir, há decisão humana a registrar. Enquanto
     * `erp_owner_map` estiver vazia, `responsible_id` não é tocado em cliente
     * nenhum, e a sincronização se comporta exatamente como antes.
     *
     * O cuidado é deliberado: dono de lead é o que a regra de visibilidade do
     * Torque lê. Atribuir 11 mil donos por engano não dá erro — dá gente que
     * deixou de enxergar a própria carteira.
     */
    const ownerMap = await loadOwnerMap(admin, organizationId, TOTH_PROVIDER_ID);

    // Enriquecimento vai para uma fila e é escrito em paralelo no fim.
    //
    // Enquanto os enriquecimentos eram poucos, escrever um a um no laço não
    // incomodava. Deixou de ser pouco quando a carteira ganhou as colunas de
    // ERP: elas nascem NULL, então TODO cliente já existente muda de fato —
    // 11.179 UPDATEs sequenciais na Café Jurerê, e sequencial nesse volume é o
    // mesmo HTTP 504 de 20/08.
    const deferred = deferredEnrichStore(cached);
    const store = deferred.store;

    // ── Modo prévia ─────────────────────────────────────────────────────────
    // `dry_run` lê, mapeia e RELATA sem escrever. `max_clients` limita o piloto.
    // Sem os dois, a primeira execução numa org de cliente é irreversível na
    // prática: dá para apagar depois, mas já terá criado lead e adotado conversa.
    const body = await req.clone().json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    const paginated = body.paginated === true;

    // Filtros repassados ao ERP (`cnpj`, `diasCompras`, `marcas` — a lista que o
    // fornecedor documentou). Existe porque `/clientes` SEM filtro devolveu
    // HTTP 500 no ERP real, e todos os exemplos que ele mandou levavam filtro.
    // Repassar em vez de cravar no código permite descobrir a combinação que o
    // servidor aceita sem um redeploy por tentativa.
    const filtros: Record<string, string> = {};

    // A janela de "cliente ativo" vem da CONEXÃO, não do corpo: é decisão de
    // negócio da organização e precisa valer igual no botão e no cron. Sem ela,
    // a carga traz a base inteira — 12.632 registros na Café Jurerê, quase todos
    // histórico, o que enche a carteira de nome sem relevância comercial.
    const diasCompras = conn.clientes_dias_compras as number | null;
    if (typeof diasCompras === "number" && diasCompras > 0) {
      filtros.diasCompras = String(diasCompras);
    }

    /**
     * 🔑 `marcas` é a chave que LIGA a janela de dias.
     *
     * Medido contra o ERP real em 25/08: `diasCompras=60` sozinho devolve 12.633
     * linhas — a base inteira. Acompanhado de `marcas=1,2,3,4,5,6`, devolve 550.
     * A janela nunca esteve quebrada; faltava dizer de quais marcas.
     *
     * O ganho não é só de recorte: a resposta cai de 21 MB para menos de 1 MB, e
     * é a mesma leitura que antes gastava um minuto de CPU do worker.
     */
    const marcas = (conn.clientes_marcas as string | null)?.trim();
    if (marcas) filtros.marcas = marcas;

    // Override pontual, para diagnóstico. Allowlist estrita: parâmetro inventado
    // já provocou HTTP 500 uma vez.
    if (body.filtros && typeof body.filtros === "object") {
      for (const [k, v] of Object.entries(body.filtros as Record<string, unknown>)) {
        if (!["cnpj", "diasCompras", "marcas"].includes(k)) continue;
        if (typeof v === "string" || typeof v === "number") filtros[k] = String(v);
      }
    }
    const maxClients =
      typeof body.max_clients === "number" && body.max_clients > 0
        ? Math.floor(body.max_clients)
        : null;

    /**
     * Empresa do grupo a sincronizar.
     *
     * `GET /clientes` devolve as QUATRO empresas do grupo juntas — CAFE JURERE,
     * CAMIPLACE, COSTA ESMERALDA e ALIMENTA MAIS — e não aceita filtro por
     * empresa. Sem separar aqui, a carteira de uma organização recebe cliente
     * que é de outra empresa: na Café Jurerê são 667 registros de terceiros.
     *
     * Vem da CONEXÃO para valer igual no botão e no cron. O corpo só sobrescreve
     * para diagnóstico.
     */
    const empresaFiltro =
      typeof body.empresa === "string" && body.empresa.trim()
        ? body.empresa.trim()
        : ((conn.clientes_empresa as string | null) ?? null);
    const incluirSemEmpresa =
      typeof body.incluir_sem_empresa === "boolean"
        ? body.incluir_sem_empresa
        : conn.clientes_incluir_sem_empresa === true;

    /** Só quem tem data de último pedido faturado. Ver o uso, no laço. */
    const somenteComCompra =
      typeof body.somente_com_compra === "boolean"
        ? body.somente_com_compra
        : conn.clientes_somente_com_compra === true;

    const maxEnrich =
      typeof body.max_enrich === "number" && body.max_enrich > 0
        ? Math.floor(body.max_enrich)
        : MAX_ENRICH_PER_RUN;

    const seenIds = new Set<string>();
    const stats = { pages: 0, rows: 0, created: 0, enriched: 0, skipped: 0, failed: 0 };
    /** Quantos o filtro de empresa deixou de fora, e de quem eram. */
    const foraDoFiltro = { total: 0, sem_empresa: 0, por_empresa: {} as Record<string, number> };
    /**
     * Clientes sem `dataEmissaoUltimoPedidoFaturado`. Contados mesmo quando
     * entram: é o número que revela quanto da carteira nunca faturou, e ele
     * muda a leitura de qualquer média de recência.
     */
    const semUltimaCompra = { recebidos: 0, descartados: 0 };
    const mappingErrors: string[] = [];
    const previews: PreviewedClient[] = [];
    const mappedClients: CanonicalClient[] = [];
    /** Fila da criação em lote — ver bulk-create-clients.ts. */
    const toCreate: CanonicalClient[] = [];
    let page = conn.clientes_cursor ?? 1;
    let stopReason = "max_pages";

    /** Esvazia a fila de enriquecimento e contabiliza o que falhou. */
    const flushEnrich = async () => {
      const flushed = await deferred.flush();
      stats.failed += flushed.failed;
      stats.enriched -= flushed.failed;
      for (const e of flushed.errors) {
        if (mappingErrors.length < 3) mappingErrors.push(e);
      }
    };

    try {
      for (let i = 0; i < MAX_PAGES_PER_RUN; i++) {
        // 🔴 Sem parâmetro de paginação por padrão. `page`/`limit` eram invenção
        // nossa: a lista que o fornecedor documentou para `/clientes` é `token`,
        // `cnpj`, `diasCompras` e `marcas`. Mandar parâmetro que o endpoint não
        // conhece provocou HTTP 500 no ERP real (19/08), e "sem paginação" é a
        // hipótese que os exemplos dele sustentam — a resposta vem inteira.
        //
        // `paginated: true` no corpo reativa, para quando o fornecedor
        // confirmar os nomes (está em análise com a equipe dele).
        const payload = await client.get("clientes", {
          ...filtros,
          ...(paginated ? { page: String(page), limit: String(PAGE_SIZE) } : {}),
        });
        const rows = extractRows(payload);
        stats.pages++;

        if (rows.length === 0) {
          stopReason = "empty_page";
          break;
        }

        let newInThisPage = 0;
        /**
         * Filtrados nesta página. Conta separado porque o guard de "a API
         * ignorou a paginação" olha para `newInThisPage === 0` — e uma página
         * legítima cujos clientes são todos de outra empresa do grupo também
         * zera aquele contador. Sem esta distinção, o filtro de empresa
         * encerraria a varredura no meio, alegando repetição que não houve.
         */
        let filteredInThisPage = 0;

        for (const row of rows) {
          stats.rows++;

          // Filtro de empresa ANTES de mapear: quem não é da empresa não vira
          // cliente, não conta como visto e não gasta trabalho de mapeamento.
          if (!tothClienteMatchesEmpresa(row, empresaFiltro, incluirSemEmpresa)) {
            filteredInThisPage++;
            foraDoFiltro.total++;
            const empresas = tothClienteEmpresas(row);
            if (empresas.length === 0) {
              foraDoFiltro.sem_empresa++;
            } else {
              for (const e of empresas) {
                foraDoFiltro.por_empresa[e] = (foraDoFiltro.por_empresa[e] ?? 0) + 1;
              }
            }
            continue;
          }

          let canonical;
          try {
            canonical = mapTothClienteToCanonical(row, { empresa: empresaFiltro });
          } catch (err) {
            stats.failed++;
            if (err instanceof TothMappingError && mappingErrors.length < 3) {
              mappingErrors.push(err.message);
            }
            continue;
          }

          /**
           * Recorte estrito: só quem já faturou alguma coisa.
           *
           * Desligado por padrão, e é decisão de negócio ligar. Dentro da janela
           * do ERP existe quem pediu e ainda não faturou — 131 dos 550 na
           * medição de 25/08 —, e esses são carteira legítima. Quem liga isto
           * está dizendo "carteira é quem já comprou", que é uma definição
           * defensável, não a padrão.
           */
          if (somenteComCompra && !canonical.lastOrderAt) {
            semUltimaCompra.descartados++;
            filteredInThisPage++;
            continue;
          }
          if (!canonical.lastOrderAt) semUltimaCompra.recebidos++;

          if (seenIds.has(canonical.externalId)) continue;
          seenIds.add(canonical.externalId);
          newInThisPage++;

          if (dryRun) {
            // Só LEITURA: as duas buscas do store são SELECT. A decisão espelha
            // `upsertCanonicalClient` em vez de chamá-lo — chamar escreveria.
            const byExternalId = await store.findByExternalId(
              organizationId,
              canonical.externalId,
            );
            const byCnpj =
              !byExternalId && canonical.cnpj
                ? await store.findByCnpj(organizationId, canonical.cnpj)
                : null;

            const { action, reason } = previewAction({
              client: canonical,
              syncMode,
              matchedByExternalId: !!byExternalId,
              matchedByCnpj: !!byCnpj,
            });

            previews.push({
              externalId: canonical.externalId,
              action,
              reason,
              normalizedPhone: normalizePhoneForSearch(canonical.phone),
            });
            mappedClients.push(canonical);
          } else {
            // Casados enriquecem AGORA, um a um: são poucos, e a regra de qual
            // campo pode ser sobrescrito não vale duplicar. Novos vão para a
            // fila do lote — criar é o que era caro (dois INSERT por registro,
            // 25.216 idas ao banco numa carga inicial).
            const byExternalId = await store.findByExternalId(
              organizationId,
              canonical.externalId,
            );
            const byCnpj =
              !byExternalId && canonical.cnpj
                ? await store.findByCnpj(organizationId, canonical.cnpj)
                : null;

            if (byExternalId || byCnpj) {
              const result = await upsertCanonicalClient(store, {
                organizationId,
                source: TOTH_PROVIDER_ID,
                client: canonical,
                syncMode,
                ownerMap,
              });
              if (result.action === "enriched") {
                stats.enriched++;
                // Esvazia de tempos em tempos: é o que segura a memória do
                // worker. Guardar tudo para o fim foi o que causou o 546.
                if (deferred.pending() >= ENRICH_FLUSH_EVERY) {
                  await flushEnrich();
                }
                if (stats.enriched >= maxEnrich) {
                  stopReason = "max_enrich";
                  break;
                }
              } else {
                stats.skipped++;
              }
            } else if (syncMode === "canonical") {
              toCreate.push(canonical);
            } else {
              stats.skipped++;
            }
          }

          if (maxClients !== null && seenIds.size >= maxClients) {
            stopReason = "max_clients";
            break;
          }
        }

        if (stopReason === "max_clients" || stopReason === "max_enrich") break;

        // Sem paginação, a resposta é a base inteira: pedir de novo traria o
        // mesmo bloco. O guard de "nenhum id novo" abaixo pegaria, mas só depois
        // de gastar uma requisição à toa contra o servidor de uma empresa só.
        if (!paginated) {
          stopReason = "single_page";
          break;
        }

        // A API ignorou a paginação e repetiu o bloco anterior.
        if (newInThisPage === 0 && filteredInThisPage === 0) {
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

    // ── Prévia: relata e sai. NÃO grava cursor nem last_sync ────────────────
    // Um ensaio não pode mover o cursor: se movesse, a execução real começaria
    // da página seguinte e puraria clientes em silêncio.
    if (dryRun) {
      const totals = summarize(mappedClients, previews);
      const phones = phonesAtRisk(previews);
      const orphans = await countOrphanAdoption(admin, organizationId, phones);

      await logRuntime({
        organizationId,
        module: "general",
        action: "toth_sync_clientes_dry_run",
        status: "success",
        // Sem amostra aqui: o log não é lugar de dado de cliente.
        payloadSnapshot: {
          ...totals,
          ...orphans,
          stop_reason: stopReason,
          empresa: empresaFiltro,
          fora_do_filtro: foraDoFiltro.total,
        },
      });

      return json(
        {
          dry_run: true,
          escreveu: false,
          modo: syncMode,
          janela_dias_compras: filtros.diasCompras ? Number(filtros.diasCompras) : null,
          marcas: filtros.marcas ?? null,
          // A janela só vale acompanhada de marcas — sem elas o ERP devolve a
          // base inteira. Dizer isso aqui evita que alguém leia "janela: 60" e
          // conclua que o recorte aconteceu.
          janela_inerte: !!filtros.diasCompras && !filtros.marcas,
          somente_com_compra: somenteComCompra,
          sem_ultima_compra: semUltimaCompra,
          empresa: empresaFiltro,
          incluir_sem_empresa: incluirSemEmpresa,
          fora_do_filtro_de_empresa: foraDoFiltro,
          stop_reason: stopReason,
          paginas_lidas: stats.pages,
          linhas_recebidas: stats.rows,
          sem_identificador: stats.failed,
          totais: totals,
          adocao_de_conversas: {
            ...orphans,
            telefones_que_casariam: phones.length,
            explicacao:
              "Ao criar o lead, o trigger tg_leads_adopt_orphan_messages vincula as mensagens sem dono cujo telefone bate. Não envia nada — é vínculo de dado, e é reversível.",
          },
          amostra: sampleForReview(mappedClients, previews),
          erros_de_mapeamento: mappingErrors,
        },
        cors,
      );
    }

    // Resto da fila — o laço já esvaziou a cada ENRICH_FLUSH_EVERY.
    if (deferred.pending() > 0) await flushEnrich();

    // ── Criação em lote ─────────────────────────────────────────────────────
    // Fora do laço de propósito: um statement com 500 leads e outro com 500
    // clientes, em vez de dois por registro. É o que faz a carga inicial caber
    // numa execução.
    if (toCreate.length > 0) {
      // Telefones já pertencentes a leads da org. `idx_leads_org_phone_unique` é
      // UNIQUE em (org, normalized_phone), e o ERP tem clientes distintos com o
      // mesmo número — sem esta carga prévia, a duplicata só apareceria como
      // erro de lote, derrubando 500 registros de uma vez.
      const usedPhones = new Set<string>();
      for (let from = 0; ; from += 1000) {
        const { data } = await admin
          .from("leads")
          .select("normalized_phone")
          .eq("organization_id", organizationId)
          .not("normalized_phone", "is", null)
          .range(from, from + 999);
        const rows = data ?? [];
        for (const r of rows) {
          if (r.normalized_phone) usedPhones.add(r.normalized_phone as string);
        }
        if (rows.length < 1000) break;
      }

      const bulk = await bulkCreateClients(admin, {
        organizationId,
        source: TOTH_PROVIDER_ID,
        clients: toCreate,
        usedPhones,
        normalizePhone: normalizePhoneForSearch,
        ownerMap,
      });
      stats.created = bulk.created;
      stats.failed += bulk.failed;
      for (const e of bulk.errors) {
        if (mappingErrors.length < 3) mappingErrors.push(e);
      }
    }

    /**
     * Desce o dono do cliente para o lead ligado.
     *
     * Só faz sentido rodar se houver mapa: sem ele nenhum `responsible_id` foi
     * escrito, e a chamada seria uma varredura em 12 mil linhas para não mudar
     * nada. A função em si já é idempotente e só escreve o que difere.
     */
    let leadsComDonoNovo = 0;
    if (ownerMap.size > 0) {
      const { data: propagados, error: propErr } = await admin.rpc(
        "propagate_erp_owner_to_leads",
        { p_organization_id: organizationId },
      );
      if (propErr) {
        // Não derruba a sincronização: os clientes já estão gravados, e o dono
        // do lead é derivado — a próxima volta desce de novo.
        if (mappingErrors.length < 3) {
          mappingErrors.push(`propagate_erp_owner_to_leads: ${propErr.message}`);
        }
      } else {
        leadsComDonoNovo = typeof propagados === "number" ? propagados : 0;
      }
    }

    /**
     * Aplica a lei de classificação Lead · Cliente · Indefinido.
     *
     * Roda em TODA sincronização, não uma vez — foi o pedido explícito. A
     * função é idempotente (só escreve o que difere) e respeita
     * `classificacao_manual`, então quem foi movido à mão pelos três pontos não
     * volta atrás na madrugada seguinte.
     *
     * Chamada sem condição de nossa parte: quem decide se roda é a própria
     * função, lendo `classificar_leads_por_situacao` e `clientes_situacoes` da
     * conexão. Duplicar esse gate aqui criaria duas verdades sobre quando a lei
     * vale — e a do TypeScript envelheceria primeiro.
     */
    let classificacao = { cliente: 0, indefinido: 0, lead: 0 };
    const { data: classData, error: classErr } = await admin.rpc(
      "apply_erp_lead_classification",
      { p_organization_id: organizationId },
    );
    if (classErr) {
      // Não derruba: os clientes já estão gravados e a gaveta é derivada — a
      // próxima volta reclassifica.
      if (mappingErrors.length < 3) {
        mappingErrors.push(`apply_erp_lead_classification: ${classErr.message}`);
      }
    } else if (Array.isArray(classData) && classData.length > 0) {
      const linha = classData[0] as Record<string, unknown>;
      classificacao = {
        cliente: Number(linha.virou_cliente ?? 0),
        indefinido: Number(linha.virou_indefinido ?? 0),
        lead: Number(linha.virou_lead ?? 0),
      };
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
      payloadSnapshot: {
        ...stats,
        stop_reason: stopReason,
        mapping_errors: mappingErrors.length,
        empresa: empresaFiltro,
        fora_do_filtro: foraDoFiltro.total,
        marcas: filtros.marcas ?? null,
        janela_dias_compras: filtros.diasCompras ? Number(filtros.diasCompras) : null,
        sem_ultima_compra: semUltimaCompra,
        representantes_mapeados: ownerMap.size,
        leads_com_dono_novo: leadsComDonoNovo,
        classificacao,
      },
    });

    return json(
      {
        success: true,
        stop_reason: stopReason,
        stats,
        // Zero nos três com a lei ligada é sinal de que `clientes_situacoes`
        // ainda está NULL — a lei não roda sem o conjunto confirmado.
        classificacao,
        // Bateu o teto por execução: falta gente. A próxima execução atravessa
        // de graça o que já está igual e continua daqui. Dizer isso evita ler
        // um número parcial como se fosse o total.
        incompleto: stopReason === "max_enrich",
        empresa: empresaFiltro,
        fora_do_filtro_de_empresa: foraDoFiltro,
        marcas: filtros.marcas ?? null,
        janela_dias_compras: filtros.diasCompras ? Number(filtros.diasCompras) : null,
        janela_inerte: !!filtros.diasCompras && !filtros.marcas,
        sem_ultima_compra: semUltimaCompra,
        mapping_errors: mappingErrors,
      },
      cors,
    );
  }),
);
