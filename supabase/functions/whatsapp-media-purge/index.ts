// deno-lint-ignore-file no-explicit-any
/**
 * whatsapp-media-purge — limpeza retroativa do bucket `media`.
 *
 * Contexto (medido em prod, 2026-08-10): o bucket chegou a 100 GB, dos quais
 * 41 GB não têm consumidor nenhum no produto:
 *   - 40 GB de mídia de mensagem de GRUPO (149.518 arquivos). Grupo não gera
 *     lead, não alimenta copilot nem pipeline — o webhook já o descarta de todo
 *     fluxo downstream. Baixávamos por um default que ninguém nunca desligou.
 *   - 1,4 GB de órfãos (5.434 arquivos): objeto no bucket sem nenhuma mensagem
 *     apontando para ele.
 *
 * DELEÇÃO É IRREVERSÍVEL. Por isso:
 *   - `dryRun` é o DEFAULT. Só apaga com `{"dryRun": false}` explícito no body.
 *   - A lista de candidatos vem de `list_purgeable_media` (SQL, service_role),
 *     nunca de critério montado aqui. Mídia de conversa individual não entra.
 *   - Trabalha em lotes pequenos e para no `maxBatches`, para caber no tempo da
 *     função e permitir acompanhar o encolhimento entre execuções.
 *   - Remove primeiro do Storage e só então a linha de metadados: `DELETE FROM
 *     storage.objects` sozinho não libera byte nenhum — apaga o ponteiro e
 *     deixa o arquivo no S3, invisível e ainda cobrado. Por isso a remoção
 *     passa pela Storage API.
 *
 * Uso:
 *   dry-run:  {"category": "groups"}
 *   valendo:  {"category": "groups", "dryRun": false, "maxBatches": 20}
 *
 * Auth: x-cron-secret ou service_role. Não tem cron — é operação manual,
 * disparada sob supervisão.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";

// 500 é o teto que claim_purge_batch aceita. Storage.remove engole a lista
// inteira numa chamada, então lote maior = menos ida-e-volta para drenar as
// ~150k linhas da fila.
const BATCH_SIZE = 500;
const DEFAULT_MAX_BATCHES = 10;
// 'dedup' exige que o reapontamento das mensagens (media_dedup_plan) tenha
// rodado ANTES: os objetos desta categoria ainda existem e só são descartáveis
// porque um keeper de conteúdo idêntico assumiu as referências.
const VALID_CATEGORIES = new Set(["orphans", "groups", "dedup"]);

type PurgeCandidate = { object_name: string; size_bytes: number | null };

Deno.serve(
  withErrorBoundary("whatsapp-media-purge", async (req: Request): Promise<Response> => {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

    const corsHeaders = getCorsHeaders(req.headers.get("origin"));
    const headers = withSecurityHeaders({ ...corsHeaders, "Content-Type": "application/json" });

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
    }

    const cronSecret = req.headers.get("x-cron-secret");
    const authHeader = req.headers.get("authorization") ?? "";
    const isAuthorized =
      (!!CRON_SECRET && cronSecret === CRON_SECRET) ||
      (!!SUPABASE_SERVICE_ROLE_KEY && authHeader.includes(SUPABASE_SERVICE_ROLE_KEY));

    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }

    const body = await req.json().catch(() => ({} as any));
    const category = String(body?.category ?? "");
    // Ausência de `dryRun` significa dry-run. Só o literal `false` apaga: um
    // body malformado ou um campo esquecido não pode virar deleção.
    const dryRun = body?.dryRun !== false;
    const maxBatches = Math.min(Math.max(Number(body?.maxBatches ?? DEFAULT_MAX_BATCHES), 1), 100);

    if (!VALID_CATEGORIES.has(category)) {
      return new Response(
        JSON.stringify({ error: "category deve ser 'orphans' ou 'groups'" }),
        { status: 400, headers },
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let batches = 0;
    let inspected = 0;
    let removed = 0;
    let bytesFreed = 0;
    let failures = 0;
    const sample: string[] = [];

    while (batches < maxBatches) {
      const { data, error } = await supabase.rpc("claim_purge_batch", {
        p_category: category,
        p_limit: BATCH_SIZE,
      });

      if (error) {
        await logRuntime({
          module: "webhook",
          action: "media_purge_select_error",
          status: "error",
          errorMessage: error.message,
        });
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
      }

      const rows = (data ?? []) as PurgeCandidate[];
      if (rows.length === 0) break;

      batches += 1;
      inspected += rows.length;
      const names = rows.map((r) => r.object_name);
      const batchBytes = rows.reduce((acc, r) => acc + (Number(r.size_bytes) || 0), 0);

      if (sample.length < 5) sample.push(...names.slice(0, 5 - sample.length));

      if (dryRun) {
        // Nada é apagado, então nada sai da fila e o próximo claim devolveria a
        // mesma página. Uma volta basta para provar o formato do lote; o total
        // real sai da própria media_purge_queue via SQL.
        bytesFreed += batchBytes;
        break;
      }

      const { data: removedData, error: rmErr } = await supabase.storage.from("media").remove(names);

      if (rmErr) {
        failures += names.length;
        await logRuntime({
          module: "webhook",
          action: "media_purge_remove_error",
          status: "error",
          errorMessage: rmErr.message,
          payloadSnapshot: { category, batch_size: names.length },
        });
        // Sem paginação por offset: o próximo select devolve os mesmos nomes se
        // a remoção falhou. Parar evita laço infinito no mesmo lote quebrado.
        break;
      }

      const actuallyRemoved = (removedData ?? []).length;
      removed += actuallyRemoved;
      bytesFreed += batchBytes;

      // Carimbar SEMPRE o lote inteiro, não só o que o Storage confirmou:
      // `remove` é silencioso com chave inexistente, e uma chave que não existe
      // mais é exatamente o estado desejado. Marcar só os confirmados deixaria
      // os fantasmas na fila para sempre, e o loop os reentregaria a cada volta
      // sem nunca progredir.
      const { error: markErr } = await supabase.rpc("mark_purged", { p_names: names });
      if (markErr) {
        await logRuntime({
          module: "webhook",
          action: "media_purge_mark_error",
          status: "error",
          errorMessage: markErr.message,
          payloadSnapshot: { category, batch_size: names.length },
        });
        // Sem o carimbo o próximo claim devolve o mesmo lote: laço infinito.
        break;
      }

      if (actuallyRemoved < names.length) {
        await logRuntime({
          module: "webhook",
          action: "media_purge_partial_batch",
          status: "success",
          payloadSnapshot: {
            category,
            pedidos: names.length,
            confirmados_pelo_storage: actuallyRemoved,
          },
        });
      }
    }

    await logRuntime({
      module: "webhook",
      action: "media_purge_run",
      status: "success",
      payloadSnapshot: {
        category,
        dry_run: dryRun,
        batches,
        inspected,
        removed,
        mb_freed: Math.round(bytesFreed / 1048576),
        failures,
      },
    });

    return new Response(
      JSON.stringify({
        category,
        dryRun,
        batches,
        inspected,
        removed,
        mb_freed: Math.round(bytesFreed / 1048576),
        failures,
        sample,
        hint: dryRun
          ? "Nada foi apagado. Para executar: {\"category\":\"" + category +
            "\",\"dryRun\":false,\"maxBatches\":20}"
          : undefined,
      }),
      { status: 200, headers },
    );
  }),
);
