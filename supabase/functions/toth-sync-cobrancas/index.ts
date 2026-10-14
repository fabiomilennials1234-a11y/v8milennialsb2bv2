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
 * 🔴 **Título pago SOME da resposta** — o Toth não o devolve com saldo 0. Por
 * isso, depois de cada lote bem-sucedido, `reconcileMissingTitulos` fecha como
 * `pago` o título aberto daqueles clientes que deixou de vir (Chamado
 * 065e4890). Com janela, só fecha o que vence DENTRO dela — o que vence fora
 * pode faltar por estar fora; com `full`, fecha todo ausente.
 *
 * Body opcional:
 *   - `{ data_inicio, data_fim }` em `aaaa-mm-dd` — sobrepõe a janela padrão
 *     (reconcilia só com as duas datas: com uma, o recorte do ERP é incerto);
 *   - `{ full: true }` — desliga a janela e varre tudo (reconciliação completa,
 *     a única que alcança título vencido antes da janela). Tem cursor próprio
 *     (`cobrancas_full_cursor`): repita até ele voltar a NULL;
 *   - `{ full: true, daily: true }` — o que o cron da madrugada manda: igual a
 *     `full`, mas sai sem tocar no ERP se a volta completa já fechou nas
 *     últimas 20h (`last_cobrancas_full_sweep_at`).
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { logRuntime } from "../_shared/logger.ts";
import { timingSafeCompare } from "../_shared/auth.ts";
import { resolveAdminOrg } from "../_shared/erp/erp-admin-auth.ts";
import {
  TothClient,
  TothAuthError,
  TothRequestError,
  TothUnavailableError,
} from "../_shared/erp/toth-client.ts";
import { loadTothCredentials, tothUrlPolicy } from "../_shared/erp/toth-credentials.ts";
import {
  buildCobrancaWindow,
  chunkCnpjs,
  extractRows,
  formatTothDate,
  mapTothCobrancaToCanonical,
  shiftIsoDate,
  TothMappingError,
} from "../_shared/erp/toth-mappers.ts";
import { TOTH_PROVIDER_ID } from "../_shared/erp/toth-provider.ts";
import type { CanonicalTitulo } from "../_shared/erp/types.ts";
import {
  supabaseTituloReconcileStore,
  supabaseTituloStore,
} from "../_shared/erp/sync/titulo-store.ts";
import { upsertCanonicalTitulo } from "../_shared/erp/sync/upsert-titulo.ts";
import {
  RECONCILE_GUARD_MAX_RATIO,
  RECONCILE_GUARD_MIN_COUNT,
  reconcileMissingTitulos,
  tothBatchEvidence,
  type ReconcileWindow,
} from "../_shared/erp/sync/reconcile-titulos.ts";
import {
  dailyFullSweepDue,
  endOfRunCursorPatch,
  sweepCursor,
  type SweepMode,
} from "../_shared/erp/sync/full-sweep.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

/**
 * Teto de clientes consultados por execução.
 *
 * Medido em 21/08 com 600: a execução inteira levou **12 segundos** (12 lotes
 * de 50 CNPJs, com 400ms de pausa entre eles). Nesse ritmo, cobrir os 12.613
 * clientes da Café Jurerê exigiria 21 execuções — a cada 2 horas, mais de um
 * dia e meio até a primeira volta fechar.
 *
 * 3.000 são ~60 lotes, na casa de 60-70s: folga confortável para os 150s do
 * gateway, e a volta completa cai para 5 execuções. O que limita aqui é a
 * paciência do servidor do cliente, não o nosso tempo de CPU — por isso a pausa
 * entre lotes continua.
 */
const MAX_CLIENTS_PER_RUN = 3000;
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
      .select(
        "id, erp_sync_mode, status, cobrancas_cursor, cobrancas_full_cursor, last_cobrancas_full_sweep_at",
      )
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (!conn || conn.status !== "connected") {
      return json({ error: "Nenhuma conexão ativa com o ERP Toth" }, cors);
    }
    if (conn.erp_sync_mode === "off") {
      return json({ skipped: true, reason: "sync_mode_off" }, cors);
    }

    const body = await req.clone().json().catch(() => ({}));
    // `full` tem cursor próprio (ver `_shared/erp/sync/full-sweep.ts`): janela e
    // varredura completa não avançam o cursor uma da outra.
    const mode: SweepMode = body.full === true ? "full" : "window";

    // `daily`: a varredura completa da madrugada. O cron dispara várias vezes
    // por noite porque a volta precisa de várias execuções; depois que ela
    // fecha, as de sobra saem aqui, antes de tocar no ERP.
    if (
      mode === "full" &&
      body.daily === true &&
      !dailyFullSweepDue(
        {
          fullCursor: (conn.cobrancas_full_cursor as string | null) ?? null,
          lastSweepAt: (conn.last_cobrancas_full_sweep_at as string | null) ?? null,
        },
        new Date(),
      )
    ) {
      return json(
        {
          success: true,
          skipped: true,
          reason: "daily_full_sweep_done",
          last_full_sweep_at: conn.last_cobrancas_full_sweep_at,
        },
        cors,
      );
    }

    const creds = await loadTothCredentials(admin, organizationId);
    if (!creds) {
      return json({ error: "Credenciais do ERP indisponíveis. Reconecte a integração." }, cors);
    }

    // Alvos: clientes da carteira já casados com o Toth e com CNPJ, a partir do
    // cursor.
    //
    // 🔴 Ordena por `id`, não por `updated_at`. A ordenação anterior por
    // `updated_at` não servia de cursor porque a própria sincronização mexe na
    // linha: os mesmos primeiros 600 clientes eram varridos a cada execução e a
    // carga nunca passava deles — 600 de 12.609, indefinidamente. `id` é
    // estável, então `> cursor` avança de verdade.
    const cursor = sweepCursor(mode, conn);

    /**
     * Busca os alvos em páginas de 1.000.
     *
     * 🔴 `.limit(3000)` NÃO devolve 3.000: o PostgREST corta em 1.000 linhas por
     * resposta, em silêncio. E o corte era pior que perder linhas — o cursor só
     * avança quando o lote vem CHEIO (`length === teto`), então 1.000 ≠ 3.000
     * fazia a função concluir "a volta terminou", zerar o cursor e varrer
     * eternamente os mesmos 1.000 primeiros clientes. Exatamente o defeito que o
     * cursor existe para consertar, reintroduzido ao subir o teto de 600 para
     * 3.000 — e invisível, porque `truncated: false` parecia boa notícia.
     *
     * Paginar mantém o teto como teto de verdade, e `length === teto` volta a
     * significar "tem mais adiante".
     */
    const PAGE = 1000;
    const clients: Array<{ id: string; cnpj: string | null }> = [];
    let pageCursor = cursor;
    let clientsErr: { message: string } | null = null;

    while (clients.length < MAX_CLIENTS_PER_RUN) {
      const faltam = Math.min(PAGE, MAX_CLIENTS_PER_RUN - clients.length);
      let query = admin
        .from("upsell_clients")
        .select("id, cnpj")
        .eq("organization_id", organizationId)
        .eq("external_source", TOTH_PROVIDER_ID)
        .not("cnpj", "is", null)
        .order("id", { ascending: true })
        .limit(faltam);

      if (pageCursor) query = query.gt("id", pageCursor);

      const { data, error } = await query;
      if (error) {
        clientsErr = error;
        break;
      }
      const rows = (data ?? []) as Array<{ id: string; cnpj: string | null }>;
      if (rows.length === 0) break;

      clients.push(...rows);
      pageCursor = rows[rows.length - 1].id;
      // Página curta = acabaram os clientes, não acabou a página.
      if (rows.length < faltam) break;
    }

    if (clientsErr) {
      return json({ error: `Erro ao listar clientes: ${clientsErr.message}` }, cors);
    }
    if (clients.length === 0) {
      // Fim da volta com cursor adiantado: zera e devolve, para que o próximo
      // clique (ou o cron) recomece do início em vez de ficar preso no fim.
      if (cursor) {
        const nowIso = new Date().toISOString();
        await admin
          .from("toth_connections")
          .update({ ...endOfRunCursorPatch(mode, null, nowIso), last_cobrancas_sync_at: nowIso })
          .eq("id", conn.id);
        return json({ success: true, mode, ciclo_completo: true, stats: null }, cors);
      }
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

    // Janela LIGADA por padrão desde 18/08, quando o fornecedor esclareceu a
    // semântica: casa a parcela emitida OU que vence OU que teve alteração no
    // período. É um OU entre três datas, e é isso que a torna segura — pagamento
    // conta como alteração, então título que muda entra; e `vence no período` é
    // o que captura a virada aberto → atrasado.
    //
    // Overrides: `{ data_inicio, data_fim }` em aaaa-mm-dd, ou `{ full: true }`
    // para varrer sem janela (reconciliação completa, mais cara).
    const window: Record<string, string> = {};
    // A mesma janela em ISO, para a reconciliação comparar com `vencimento`.
    // null = não reconcilia (janela com uma data só: o recorte do ERP é incerto).
    let reconcileWindow: ReconcileWindow | null = "full";
    if (mode === "window") {
      const custom: Record<string, string> = {};
      const customIso: Record<string, string> = {};
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
        customIso[param] = raw.trim();
      }
      if (Object.keys(custom).length > 0) {
        Object.assign(window, custom);
        reconcileWindow =
          customIso.dataInicio && customIso.dataFim
            ? { from: customIso.dataInicio, to: customIso.dataFim }
            : null;
      } else {
        Object.assign(
          window,
          buildCobrancaWindow(todayIso, {
            backDays: WINDOW_BACK_DAYS,
            forwardDays: WINDOW_FORWARD_DAYS,
          }),
        );
        reconcileWindow = {
          from: shiftIsoDate(todayIso, -WINDOW_BACK_DAYS),
          to: shiftIsoDate(todayIso, WINDOW_FORWARD_DAYS),
        };
      }
    }

    const batches = chunkCnpjs(
      clients.map((c) => String(c.cnpj ?? "")),
      CNPJ_BATCH_SIZE,
    );
    // Lote → clientes, pela mesma normalização de `chunkCnpjs`. Um CNPJ pode
    // ter mais de um cliente casado; todos entram na reconciliação do lote.
    const clientIdsByCnpj = new Map<string, string[]>();
    for (const c of clients) {
      const cnpj = String(c.cnpj ?? "").replace(/\D/g, "");
      if (!cnpj) continue;
      const ids = clientIdsByCnpj.get(cnpj);
      if (ids) ids.push(c.id);
      else clientIdsByCnpj.set(cnpj, [c.id]);
    }
    const reconcileStore = supabaseTituloReconcileStore(admin);

    const stats = {
      clients: 0,
      batches: 0,
      titulos: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      batchesFailed: 0,
      /** Títulos ausentes da resposta fechados como `pago`. */
      reconciled: 0,
      /** Lotes em que a trava recusou fechar (resposta suspeita). */
      reconcileRefused: 0,
      /** Lotes cuja resposta não provava ausência (erro, forma, linha sem id). */
      reconcileSkipped: 0,
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
        // ERP fora do ar (banco dele caiu): aborta SEM marcar `expired` — é
        // transitório, e o próximo cron tenta de novo do mesmo cursor. Seguir
        // para o próximo lote só repetiria o login num servidor que está fora.
        if (err instanceof TothUnavailableError) {
          await admin
            .from("toth_connections")
            .update({ last_error: err.message })
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

      // Ids que o ERP devolveu neste lote — a reconciliação fecha o que faltar.
      // Upsert que falha não tira o id daqui: o título veio, só não gravou.
      const returnedIds: string[] = [];
      let unmapped = 0;

      for (const cobranca of extractRows(payload)) {
        stats.titulos++;
        let canonical: CanonicalTitulo;
        try {
          canonical = mapTothCobrancaToCanonical(cobranca, todayIso);
        } catch (err) {
          stats.failed++;
          unmapped++;
          if (err instanceof TothMappingError && errors.length < 3) errors.push(err.message);
          continue;
        }
        returnedIds.push(canonical.externalId);
        try {
          const result = await upsertCanonicalTitulo(store, {
            organizationId,
            source: TOTH_PROVIDER_ID,
            titulo: canonical,
          });
          if (result.action === "created") stats.created++;
          else if (result.action === "updated") stats.updated++;
          else stats.skipped++;
        } catch {
          stats.failed++;
        }
      }

      if (reconcileWindow) {
        try {
          const outcome = await reconcileMissingTitulos(reconcileStore, {
            organizationId,
            source: TOTH_PROVIDER_ID,
            clientIds: batch.flatMap((cnpj) => clientIdsByCnpj.get(cnpj) ?? []),
            evidence: tothBatchEvidence(payload, { externalIds: returnedIds, unmapped }),
            window: reconcileWindow,
          });
          if (outcome.action === "reconciled") {
            stats.reconciled += outcome.closed;
          } else if (outcome.action === "refused") {
            stats.reconcileRefused++;
            if (errors.length < 3) {
              errors.push(
                `Reconciliação recusada num lote: fecharia ${outcome.wouldClose} de ${outcome.open} ` +
                  `títulos abertos (trava: mais de ${RECONCILE_GUARD_MAX_RATIO * 100}% e de ` +
                  `${RECONCILE_GUARD_MIN_COUNT}). Nada foi fechado — confira a resposta do ERP.`,
              );
            }
          } else if (outcome.reason !== "no_clients") {
            stats.reconcileSkipped++;
          }
        } catch (err) {
          // Falha ao reconciliar não desfaz o upsert do lote nem para os outros.
          stats.reconcileSkipped++;
          if (errors.length < 3) errors.push(err instanceof Error ? err.message : String(err));
        }
      }

      await sleep(BATCH_DELAY_MS);
    }

    // 🔴 NÃO limpa `last_error` quando dá certo.
    //
    // As duas funções de sync compartilham o campo, e o botão "Sincronizar
    // agora" roda clientes → cobranças em sequência. Como cobranças terminava
    // depois e gravava null, ela apagava o diagnóstico do sync de clientes: em
    // 20/08 a carga falhou em 12.500 registros e o erro sumiu quatro segundos
    // depois, obrigando a caçar a causa no log do Postgres.
    const nowIso = new Date().toISOString();
    await admin
      .from("toth_connections")
      .update({
        // Lote cheio → há mais adiante, guarda onde parou. Lote curto → a volta
        // terminou, zera para o próximo ciclo reprocessar tudo (título muda de
        // status com o tempo, então revisitar é o comportamento desejado). Só o
        // cursor do próprio modo.
        ...endOfRunCursorPatch(
          mode,
          clients.length === MAX_CLIENTS_PER_RUN ? clients[clients.length - 1].id : null,
          nowIso,
        ),
        last_cobrancas_sync_at: nowIso,
        ...(errors.length > 0 ? { last_error: errors[0] } : {}),
      })
      .eq("id", conn.id);

    await logRuntime({
      organizationId,
      module: "general",
      action: "toth_sync_cobrancas",
      status: "success",
      payloadSnapshot: { ...stats, mode, truncated: clients.length === MAX_CLIENTS_PER_RUN },
    });

    return json(
      {
        success: true,
        mode,
        stats,
        // Silêncio sobre truncamento lê-se como "cobriu tudo". Diga quando não cobriu.
        truncated: clients.length === MAX_CLIENTS_PER_RUN,
        errors,
      },
      cors,
    );
  }),
);
