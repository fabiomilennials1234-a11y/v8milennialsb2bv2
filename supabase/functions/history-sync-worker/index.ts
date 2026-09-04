// deno-lint-ignore-file no-explicit-any
/**
 * history-sync-worker v2 — processes history_sync_jobs with time-budgeted loops.
 *
 * Triggered by pg_cron every minute. Auth via x-cron-secret.
 *
 * v2 improvements:
 *  1. Multi-chunk per tick — loops within TIME_BUDGET_MS (50s)
 *  2. Parallel chat fetch — PARALLEL_CHATS concurrent requests
 *  3. Real progress — total_chats, chats_completed, current_chat_index
 *  4. (Auto-sync handled in whatsapp-webhook)
 *  5. Incremental scope — fetches only msgs newer than latest synced
 *  6. Skip already-synced chats — skips chats with recent messages
 *  7. Per-chat error tracking — chat_errors JSONB column
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withErrorBoundary } from "../_shared/error-boundary.ts";
import { withSecurityHeaders } from "../_shared/security-headers.ts";
import { logRuntime } from "../_shared/logger.ts";
import { getWhatsAppProvider } from "../_shared/whatsapp-client.ts";
import { timingSafeCompare } from "../_shared/auth.ts";
import { isGroupJid, isLidJid, resolveHistoryChatJid } from "../_shared/whatsapp-jid.ts";

import "../_shared/whatsapp-providers/evolution-provider.ts";
import "../_shared/whatsapp-providers/uazapi-provider.ts";
import {
  GUARD_DEFAULTS,
  type GuardConfig,
  insideFullWindow,
  parseGuardConfig,
  reachedChatCap,
  reachedGlobalCap,
} from "./guards.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

const HISTORY_TYPE_MAP: Record<string, string> = {
  stickerMessage: "sticker", StickerMessage: "sticker",
  imageMessage: "image", ImageMessage: "image",
  videoMessage: "video", VideoMessage: "video",
  audioMessage: "audio", AudioMessage: "audio",
  documentMessage: "document", DocumentMessage: "document",
  pttMessage: "ptt", PttMessage: "ptt",
  conversation: "text", Conversation: "text",
  extendedTextMessage: "text", ExtendedTextMessage: "text",
  ptv: "video", PtvMessage: "video",
  gif: "video", motion_video: "video", motion_photo: "image",
  "1p_sticker": "sticker", user_created_sticker: "sticker", avatar_sticker: "sticker",
  vcard: "contact", contact_array: "contact",
  contactMessage: "contact", ContactMessage: "contact",
  contactsArrayMessage: "contact", ContactsArrayMessage: "contact",
  locationMessage: "location", LocationMessage: "location",
  liveLocationMessage: "location", livelocation: "location",
  reactionMessage: "reaction", ReactionMessage: "reaction",
  pollCreationMessage: "poll", PollCreationMessage: "poll",
  collection: "interactive", list: "interactive",
  url: "text", error: "text",
};

function normalizeHistorySyncType(
  rawType: string | null,
  mediaType: string | null,
  mimetype: string | null,
  hasText: boolean,
  hasMedia: boolean,
): string {
  if (rawType) {
    const mapped = HISTORY_TYPE_MAP[rawType];
    if (mapped) return mapped;
    if (rawType === "media" && mediaType) {
      return HISTORY_TYPE_MAP[mediaType] ?? mediaType;
    }
    if (["text", "image", "video", "audio", "document", "ptt", "sticker",
         "location", "contact", "reaction", "poll", "system"].includes(rawType)) {
      return rawType;
    }
  }
  if (hasText) return "text";
  if (hasMedia) return mediaType ?? mimetype?.split("/")[0] ?? "document";
  return "unknown";
}

const CHUNK_SIZE = 100;
const MAX_JOBS_PER_RUN = 20;
const JOB_STALE_MINUTES = 10;
const TIME_BUDGET_MS = 50_000;
const PARALLEL_CHATS = 2;
const SKIP_RECENT_THRESHOLD_MS = 3_600_000; // 1h

// --- Guard-rails (incidente 2026-08-06) -----------------------------------
// Duas importações de uma única org escreveram ~500 msgs/min e esgotaram o pool
// de conexões do Postgres; o sistema inteiro ficou 42 minutos sem gravar
// mensagem. O backfill nunca perguntava se o banco aguentava.
//
// As regras de decisão (tetos, janela, leitura da config) vivem em `guards.ts`,
// onde são testadas sem banco nem provedor — ver `guards.test.ts`.

// Reavaliar a pressão a cada chunk custaria uma ida ao banco por lote de 100
// mensagens. 5s é curto o bastante para reagir dentro do mesmo tick (que dura
// 50s) e longo o bastante para o custo desaparecer.
const PRESSURE_TTL_MS = 5_000;

// Estados que o operador define e que o worker não pode desfazer escrevendo
// progresso por cima. Sem isto, cancelar um job durante um tick não tem efeito:
// o worker termina o lote e grava "running" de volta.
const OPERATOR_TERMINAL_STATES = ["cancelled", "paused"];

/**
 * Cliente Supabase deste worker.
 *
 * Os helpers deste arquivo declaravam `ReturnType<typeof createClient>`, que sem
 * argumentos de tipo resolve o schema para `never` — e aí todo `.update({...})`
 * vira "argumento não atribuível a never". Eram 10 erros de tipo antes desta
 * mudança, todos do mesmo molde. Um alias explícito resolve na raiz.
 *
 * O `any` no schema é deliberado: as edge functions não consomem
 * `integrations/supabase/types.ts` (que é gerado para o front), então não há
 * tipo de schema real a oferecer aqui.
 */
type Db = SupabaseClient<any, any, any>;

type HistorySyncJob = {
  id: string;
  organization_id: string;
  instance_id: string;
  chat_jid: string | null;
  scope: "default" | "full" | "chat" | "incremental";
  max_days: number;
  max_messages_per_chat: number;
  max_chats: number;
  cursor: string | null;
  status: string;
  total_fetched: number;
  total_chats: number | null;
  chats_completed: number | null;
  chats_skipped: number | null;
  chat_errors: Record<string, string> | null;
};

type MultiChatCursor = {
  chats: string[];
  chatIdx: number;
  perChat: Record<string, string | null>; // jid → offset cursor (null = not started)
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: withSecurityHeaders({ "Content-Type": "application/json" }),
  });
}

function withinCutoff(ts: number, maxDays: number): boolean {
  if (maxDays <= 0) return true;
  const cutoff = Date.now() - maxDays * 86_400_000;
  return ts * 1000 >= cutoff;
}

function parseMultiCursor(raw: string | null): MultiChatCursor | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw);
    if (Array.isArray(obj.chats)) {
      // Migrate v1 cursor (no perChat) to v2
      if (!obj.perChat) {
        const perChat: Record<string, string | null> = {};
        for (let i = obj.chatIdx ?? 0; i < obj.chats.length; i++) {
          perChat[obj.chats[i]] = i === (obj.chatIdx ?? 0) ? (obj.msgCursor ?? null) : null;
        }
        return { chats: obj.chats, chatIdx: obj.chatIdx ?? 0, perChat };
      }
      return obj as MultiChatCursor;
    }
  } catch { /* not JSON */ }
  return null;
}

async function getLatestSyncedTimestamp(
  supabase: Db,
  instanceId: string,
  remoteJid: string
): Promise<number | null> {
  const { data } = await supabase
    .from("whatsapp_messages")
    .select("timestamp")
    .eq("instance_id", instanceId)
    .eq("remote_jid", remoteJid)
    .order("timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.timestamp) return null;
  return new Date(data.timestamp).getTime() / 1000; // seconds
}

// ---------------------------------------------------------------------------
// Upsert messages
// ---------------------------------------------------------------------------

async function upsertMessages(
  supabase: Db,
  job: HistorySyncJob,
  messages: unknown[],
  maxDays: number,
  latestSyncedTs?: number | null,
): Promise<{ fetched: number; hitExisting: boolean }> {
  let fetched = 0;
  let firstError: string | null = null;
  let hitExisting = false;
  // Descartes contados, não silenciosos: uma conversa que some do backfill tem
  // de aparecer em algum lugar — senão volta como "sumiu histórico" meses
  // depois, sem rastro de quem tirou.
  let skippedLid = 0;
  let skippedNoJid = 0;

  for (const raw of messages) {
    const msg = raw as Record<string, any>;
    const messageId = msg.id ?? msg.messageid ?? msg.key?.id ?? msg._id;
    if (!messageId) continue;

    let tsRaw = Number(msg.timestamp ?? msg.messageTimestamp ?? msg.t ?? 0);
    if (tsRaw > 1e12) tsRaw = Math.floor(tsRaw / 1000);
    const tsSeconds = tsRaw;
    if (tsSeconds && !withinCutoff(tsSeconds, maxDays)) continue;

    // Incremental: stop at already-synced messages
    if (latestSyncedTs && tsSeconds && tsSeconds <= latestSyncedTs) {
      hitExisting = true;
      continue;
    }

    const fromMe = msg.fromMe === true || msg.fromme === true || msg.wa_fromMe === true;

    // Grupo fica de fora (como sempre ficou) e LID sem número correspondente é
    // descartado: gravá-lo cria no inbox um "contato" chamado
    // `210028246085780`, que não casa com lead nenhum e duplica a conversa que
    // já existe pelo número real. Ver `_shared/whatsapp-jid.ts`.
    const resolution = resolveHistoryChatJid(msg);
    if (resolution.kind === "group") continue;
    if (resolution.kind === "missing") {
      skippedNoJid += 1;
      continue;
    }
    if (resolution.kind === "unresolved_lid") {
      skippedLid += 1;
      continue;
    }
    const remoteJid = resolution.jid;
    const phoneNumber = remoteJid.split("@")[0] || "unknown";

    const { error: upsertErr } = await supabase.from("whatsapp_messages").upsert(
      {
        organization_id: job.organization_id,
        instance_id: job.instance_id,
        message_id: String(messageId),
        remote_jid: remoteJid || "unknown",
        phone_number: phoneNumber,
        direction: fromMe ? "outgoing" : "incoming",
        message_type: normalizeHistorySyncType(
          msg.type ?? msg.wa_type ?? null,
          msg.mediaType ?? null,
          msg.mimetype ?? null,
          !!(msg.text || msg.body || msg.caption),
          !!(msg.mediaUrl || msg.media_url),
        ),
        content: msg.text ?? msg.body ?? msg.caption ?? null,
        media_url: msg.mediaUrl ?? msg.media_url ?? null,
        push_name: msg.pushName ?? msg.wa_pushName ?? null,
        status: fromMe ? "sent" : "received",
        timestamp: tsSeconds
          ? new Date(tsSeconds * 1000).toISOString()
          : new Date().toISOString(),
        raw_payload: msg as Record<string, unknown>,
        received_via: "history_sync",
      },
      { onConflict: "message_id,instance_id", ignoreDuplicates: true }
    );
    if (upsertErr) {
      if (!firstError) {
        firstError = upsertErr.message;
        console.error("[upsertMessages] first upsert error:", upsertErr.message);
      }
    } else {
      fetched += 1;
    }
  }
  if (firstError) {
    await supabase.from("history_sync_jobs").update({
      error: `upsert: ${firstError} (${fetched}/${messages.length} ok)`,
    }).eq("id", job.id);
  }
  if (skippedLid > 0 || skippedNoJid > 0) {
    await logRuntime({
      module: "whatsapp",
      action: "history_sync_skipped_messages",
      status: "skipped",
      organizationId: job.organization_id,
      payloadSnapshot: {
        job_id: job.id,
        instance_id: job.instance_id,
        skipped_unresolved_lid: skippedLid,
        skipped_without_jid: skippedNoJid,
        upserted: fetched,
        batch_size: messages.length,
      },
    });
  }
  return { fetched, hitExisting };
}

// ---------------------------------------------------------------------------
// Guard-rails — freio de pressão, cota por org, janela noturna
// ---------------------------------------------------------------------------

async function loadGuardConfig(supabase: Db): Promise<GuardConfig> {
  // Em `cron_config` e não como constante compilada porque, no meio de um
  // incidente, apertar o freio não pode depender de deploy de edge function.
  const { data, error } = await supabase
    .from("cron_config")
    .select("key, value")
    .in("key", [
      "history_sync_max_pressure_pct",
      "history_sync_max_rows_per_min",
      "history_sync_full_window_start",
      "history_sync_full_window_end",
    ]);

  // Falha ao ler a config cai nos defaults, que são conservadores — nunca no
  // "sem limite".
  if (error) return GUARD_DEFAULTS;
  return parseGuardConfig(data as Array<{ key: string; value: string | null }>);
}

/**
 * Pressão do pool, com cache curto para não consultar a cada chunk.
 *
 * Falha ao medir devolve `null`, e quem chama trata `null` como "pode seguir".
 * A escolha é deliberada: se o medidor quebrar, o backfill continua funcionando
 * — degradado para o comportamento antigo, mas funcionando. O oposto (parar
 * tudo quando o medidor falha) transformaria um defeito de telemetria em
 * paralisação de produto.
 */
function makePressureGate(supabase: Db) {
  let cached: { pct: number; at: number } | null = null;

  return async function pressurePct(): Promise<number | null> {
    if (cached && Date.now() - cached.at < PRESSURE_TTL_MS) return cached.pct;

    const { data, error } = await supabase.rpc("db_connection_pressure");
    if (error || !data || typeof (data as any).pct !== "number") return null;

    cached = { pct: (data as any).pct, at: Date.now() };
    return cached.pct;
  };
}

/** Soma linhas ao balde do minuto da org e devolve o total. `null` = não medido. */
async function consumeWriteBudget(
  supabase: Db,
  organizationId: string,
  rows: number,
): Promise<number | null> {
  const { data, error } = await supabase.rpc("history_sync_consume_budget", {
    p_organization_id: organizationId,
    p_rows: rows,
  });
  if (error || typeof data !== "number") return null;
  return data;
}

/**
 * O job ainda pode rodar, ou o operador interveio?
 *
 * Relido do banco a cada lote. É o que faz o botão de cancelar valer alguma
 * coisa no meio de um tick de 50 segundos.
 */
async function stillRunnable(
  supabase: Db,
  jobId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("history_sync_jobs")
    .select("status")
    .eq("id", jobId)
    .maybeSingle();

  // Erro de leitura não interrompe: seria dar ao banco instável o poder de
  // abortar jobs válidos. A pressão já cobre esse cenário.
  if (error || !data) return true;
  return !OPERATOR_TERMINAL_STATES.includes((data as any).status);
}

/**
 * Decide se o próximo lote pode sair.
 *
 * Devolve o motivo da recusa (para registro) ou `null` para seguir. Recusar não
 * é falha: o job volta para `queued` e retoma no tick seguinte, de onde parou.
 */
async function batchAllowed(
  supabase: Db,
  job: HistorySyncJob,
  cfg: GuardConfig,
  pressurePct: () => Promise<number | null>,
): Promise<string | null> {
  if (!(await stillRunnable(supabase, job.id))) return "cancelado ou pausado pelo operador";

  const pct = await pressurePct();
  if (pct !== null && pct >= cfg.maxPressurePct) {
    return `pressao do banco em ${pct}% (teto ${cfg.maxPressurePct}%)`;
  }

  // p_rows = 0 consulta sem consumir: o consumo real é lançado depois do upsert,
  // com a contagem verdadeira.
  const spent = await consumeWriteBudget(supabase, job.organization_id, 0);
  if (spent !== null && spent >= cfg.maxRowsPerMin) {
    return `cota da org esgotada neste minuto (${spent}/${cfg.maxRowsPerMin} linhas)`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Job management helpers
// ---------------------------------------------------------------------------

async function failJob(
  supabase: Db,
  jobId: string,
  error: string
) {
  await supabase.from("history_sync_jobs").update({
    status: "failed",
    error,
    completed_at: new Date().toISOString(),
  }).eq("id", jobId);
}

async function updateJobProgress(
  supabase: Db,
  jobId: string,
  updates: Record<string, unknown>
) {
  // `not in (cancelled, paused)` é o que impede a corrida clássica: o operador
  // cancela enquanto o tick está no ar, e o worker — que já tinha lido o job —
  // grava "running" por cima ao terminar o lote, ressuscitando o que foi
  // abortado. Com o filtro, essa escrita simplesmente não encontra a linha.
  await supabase
    .from("history_sync_jobs")
    .update(updates)
    .eq("id", jobId)
    .not("status", "in", `(${OPERATOR_TERMINAL_STATES.join(",")})`);
}

// ---------------------------------------------------------------------------
// Single-chat processing (scope=chat) — time-budgeted loop
// ---------------------------------------------------------------------------

async function processSingleChat(
  supabase: Db,
  job: HistorySyncJob,
  provider: any,
  chatJid: string,
  cursor: string | null,
  maxDays: number,
  cfg: GuardConfig,
  pressurePct: () => Promise<number | null>,
): Promise<{ fetched: number; done: boolean; error?: string }> {
  const startTime = Date.now();
  let currentCursor = cursor;
  let totalFetched = job.total_fetched;
  let totalThisTick = 0;
  // Escopo `chat` percorre uma conversa só, então o total do job É o total do
  // chat — aqui as duas contagens coincidem legitimamente.
  let fetchedThisChat = 0;

  while (Date.now() - startTime < TIME_BUDGET_MS) {
    const blocked = await batchAllowed(supabase, job, cfg, pressurePct);
    if (blocked) {
      await yieldJob(supabase, job, {
        cursor: currentCursor,
        total_fetched: totalFetched,
      }, blocked);
      return { fetched: totalThisTick, done: false };
    }

    let chunkResult;
    try {
      chunkResult = await provider.historySync({
        chat_jid: chatJid,
        limit: CHUNK_SIZE,
        cursor: currentCursor ?? undefined,
      });
    } catch (e) {
      await failJob(supabase, job.id, `historySync call: ${(e as Error).message}`);
      return { fetched: totalThisTick, done: true, error: "historySync fetch failed" };
    }

    const { fetched } = await upsertMessages(supabase, job, chunkResult.messages ?? [], maxDays);
    totalFetched += fetched;
    totalThisTick += fetched;
    fetchedThisChat += fetched;
    await consumeWriteBudget(supabase, job.organization_id, fetched);

    const nextCursor = chunkResult.nextCursor ?? null;
    const done = !nextCursor
      || reachedChatCap(job.scope, fetchedThisChat, job.max_messages_per_chat);

    await updateJobProgress(supabase, job.id, {
      cursor: done ? null : nextCursor,
      total_fetched: totalFetched,
      status: done ? "completed" : "running",
      completed_at: done ? new Date().toISOString() : null,
    });

    if (done) return { fetched: totalThisTick, done: true };
    currentCursor = nextCursor;
  }

  // Budget exhausted — re-queue for next tick
  await updateJobProgress(supabase, job.id, { status: "queued" });
  return { fetched: totalThisTick, done: false };
}

/**
 * Devolve o job à fila preservando o ponto exato onde parou.
 *
 * Ceder a vez não é falhar: o progresso fica gravado, o motivo fica registrado
 * em `error` para quem for olhar depois, e o próximo tick retoma daqui.
 */
async function yieldJob(
  supabase: Db,
  job: HistorySyncJob,
  progress: Record<string, unknown>,
  reason: string,
) {
  await logRuntime({
    module: "whatsapp",
    action: "history_sync_yield",
    status: "success",
    payloadSnapshot: {
      job_id: job.id,
      organization_id: job.organization_id,
      scope: job.scope,
      reason,
    },
  });

  // Cancelado/pausado pelo operador: não tocar no status, só no progresso — e o
  // filtro de updateJobProgress já barra qualquer escrita nesse caso.
  if (reason.startsWith("cancelado")) return;

  await updateJobProgress(supabase, job.id, {
    ...progress,
    status: "queued",
    error: `aguardando: ${reason}`,
  });
}

// ---------------------------------------------------------------------------
// Fetch one chunk for a single chat (used by parallel processing)
// ---------------------------------------------------------------------------

async function fetchChatChunk(
  provider: any,
  chatJid: string,
  cursor: string | null,
): Promise<{ messages: unknown[]; nextCursor: string | null; error?: string }> {
  try {
    const result = await provider.historySync({
      chat_jid: chatJid,
      limit: CHUNK_SIZE,
      cursor: cursor ?? undefined,
    });
    return {
      messages: result.messages ?? [],
      nextCursor: result.nextCursor ?? null,
    };
  } catch (e) {
    return { messages: [], nextCursor: null, error: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Multi-chat processing (default/full/incremental) — time-budgeted + parallel
// ---------------------------------------------------------------------------

async function processMultiChat(
  supabase: Db,
  job: HistorySyncJob,
  provider: any,
  mc: MultiChatCursor,
  maxDays: number,
  cfg: GuardConfig,
  pressurePct: () => Promise<number | null>,
): Promise<{ fetched: number; done: boolean; error?: string }> {
  const startTime = Date.now();
  let totalFetched = job.total_fetched;
  let totalThisTick = 0;
  let chatsCompleted = job.chats_completed ?? 0;
  let chatsSkipped = job.chats_skipped ?? 0;
  const chatErrors: Record<string, string> = (job.chat_errors as Record<string, string>) ?? {};
  const isIncremental = job.scope === "incremental";
  // Quanto cada conversa já rendeu NESTE tick. O cursor persistido guarda o
  // offset no provedor, não a contagem — e é a contagem que o teto por conversa
  // precisa enxergar.
  const fetchedPerChat: Record<string, number> = {};

  while (Date.now() - startTime < TIME_BUDGET_MS) {
    // Este é o laço que causou o incidente de 2026-08-06: buscava lote após lote
    // sem nunca perguntar se o banco aguentava.
    const blocked = await batchAllowed(supabase, job, cfg, pressurePct);
    if (blocked) {
      await yieldJob(supabase, job, {
        cursor: JSON.stringify(mc),
        total_fetched: totalFetched,
        current_chat_index: mc.chatIdx,
        chats_completed: chatsCompleted,
        chats_skipped: chatsSkipped,
        chat_errors: chatErrors,
      }, blocked);
      return { fetched: totalThisTick, done: false };
    }

    // Collect next batch of chats to process
    const batch: Array<{ jid: string; cursor: string | null }> = [];
    for (let i = mc.chatIdx; i < mc.chats.length && batch.length < PARALLEL_CHATS; i++) {
      const jid = mc.chats[i];
      if (!(jid in mc.perChat)) continue; // already completed/removed
      batch.push({ jid, cursor: mc.perChat[jid] });
    }

    if (batch.length === 0) break; // all done

    // Skip-already-synced check (#6) + incremental latest-ts lookup (#5)
    const activeBatch: Array<{ jid: string; cursor: string | null; latestSyncedTs: number | null }> = [];
    for (const item of batch) {
      // Only check skip on first fetch for this chat (cursor is null = not started)
      if (item.cursor === null && !isIncremental) {
        const latestTs = await getLatestSyncedTimestamp(supabase, job.instance_id, item.jid);
        if (latestTs) {
          const ageMs = Date.now() - latestTs * 1000;
          if (ageMs < SKIP_RECENT_THRESHOLD_MS) {
            // Chat has recent messages — skip
            delete mc.perChat[item.jid];
            chatsSkipped += 1;
            chatsCompleted += 1;
            mc.chatIdx = Math.max(mc.chatIdx, mc.chats.indexOf(item.jid) + 1);
            continue;
          }
        }
        activeBatch.push({ ...item, latestSyncedTs: null });
      } else if (item.cursor === null && isIncremental) {
        const latestTs = await getLatestSyncedTimestamp(supabase, job.instance_id, item.jid);
        if (latestTs) {
          const ageMs = Date.now() - latestTs * 1000;
          if (ageMs < SKIP_RECENT_THRESHOLD_MS) {
            delete mc.perChat[item.jid];
            chatsSkipped += 1;
            chatsCompleted += 1;
            mc.chatIdx = Math.max(mc.chatIdx, mc.chats.indexOf(item.jid) + 1);
            continue;
          }
        }
        activeBatch.push({ ...item, latestSyncedTs: latestTs });
      } else {
        activeBatch.push({ ...item, latestSyncedTs: null });
      }
    }

    if (activeBatch.length === 0) {
      // All batch chats were skipped — advance chatIdx and continue loop
      advanceChatIdx(mc);
      continue;
    }

    // Parallel fetch
    const results = await Promise.allSettled(
      activeBatch.map(item => fetchChatChunk(provider, item.jid, item.cursor))
    );

    // Process results
    for (let i = 0; i < activeBatch.length; i++) {
      const item = activeBatch[i];
      const result = results[i];

      if (result.status === "rejected" || (result.status === "fulfilled" && result.value.error)) {
        const errMsg = result.status === "rejected"
          ? String(result.reason)
          : result.value.error!;
        chatErrors[item.jid] = errMsg.slice(0, 200);
        delete mc.perChat[item.jid];
        chatsSkipped += 1;
        chatsCompleted += 1;
        continue;
      }

      const chunk = result.value;
      const { fetched, hitExisting } = await upsertMessages(
        supabase, job, chunk.messages, maxDays,
        isIncremental ? item.latestSyncedTs : undefined,
      );
      totalFetched += fetched;
      totalThisTick += fetched;
      fetchedPerChat[item.jid] = (fetchedPerChat[item.jid] ?? 0) + fetched;
      await consumeWriteBudget(supabase, job.organization_id, fetched);

      // O teto por conversa não era aplicado neste caminho — era ele que deixava
      // o cursor de um único chat chegar a offset 2300 com `max_messages_per_chat`
      // declarado em 500.
      const chatDone = !chunk.nextCursor
        || hitExisting
        || reachedChatCap(job.scope, fetchedPerChat[item.jid], job.max_messages_per_chat);
      if (chatDone) {
        delete mc.perChat[item.jid];
        chatsCompleted += 1;
      } else {
        mc.perChat[item.jid] = chunk.nextCursor;
      }
    }

    // Advance chatIdx past completed chats
    advanceChatIdx(mc);

    // Teto global — o único que vale também para `scope=full`.
    const allDone = Object.keys(mc.perChat).length === 0
      || reachedGlobalCap(totalFetched, job.max_messages_per_chat, job.max_chats);

    // Persist progress after each batch
    await updateJobProgress(supabase, job.id, {
      cursor: allDone ? null : JSON.stringify(mc),
      total_fetched: totalFetched,
      current_chat_index: mc.chatIdx,
      chats_completed: chatsCompleted,
      chats_skipped: chatsSkipped,
      chat_errors: chatErrors,
      status: allDone ? "completed" : "running",
      completed_at: allDone ? new Date().toISOString() : null,
    });

    if (allDone) return { fetched: totalThisTick, done: true };
  }

  // Budget exhausted or all done
  const allDone = Object.keys(mc.perChat).length === 0;
  if (!allDone) {
    await updateJobProgress(supabase, job.id, {
      cursor: JSON.stringify(mc),
      total_fetched: totalFetched,
      current_chat_index: mc.chatIdx,
      chats_completed: chatsCompleted,
      chats_skipped: chatsSkipped,
      chat_errors: chatErrors,
      status: "queued",
    });
  }

  return { fetched: totalThisTick, done: allDone };
}

function advanceChatIdx(mc: MultiChatCursor) {
  while (mc.chatIdx < mc.chats.length && !(mc.chats[mc.chatIdx] in mc.perChat)) {
    mc.chatIdx += 1;
  }
}

// ---------------------------------------------------------------------------
// Main job processor
// ---------------------------------------------------------------------------

async function processJob(
  supabase: Db,
  job: HistorySyncJob,
  cfg: GuardConfig,
  pressurePct: () => Promise<number | null>,
): Promise<{ fetched: number; done: boolean; error?: string }> {
  const { error: claimErr } = await supabase
    .from("history_sync_jobs")
    .update({
      status: "running",
      started_at: job.status === "queued" ? new Date().toISOString() : undefined,
    })
    .eq("id", job.id)
    .eq("status", job.status);

  if (claimErr) return { fetched: 0, done: false, error: `claim failed: ${claimErr.message}` };

  const { data: instance } = await supabase
    .from("whatsapp_instances")
    .select("*")
    .eq("id", job.instance_id)
    .maybeSingle();
  if (!instance) {
    await failJob(supabase, job.id, "instance not found");
    return { fetched: 0, done: true, error: "instance not found" };
  }

  let provider;
  try {
    provider = await getWhatsAppProvider(instance as any, supabase);
  } catch (e) {
    await failJob(supabase, job.id, `provider init: ${(e as Error).message}`);
    return { fetched: 0, done: true, error: "provider init failed" };
  }

  if (!provider.historySync) {
    await failJob(supabase, job.id, `${provider.provider} does not support historySync`);
    return { fetched: 0, done: true, error: "historySync unavailable" };
  }

  const maxDays = (job.scope === "full" || job.scope === "incremental") ? 0 : job.max_days;

  // --- scope=chat: single chat, time-budgeted loop ---
  // Sincronizar uma conversa identificada por LID recriaria exatamente o
  // contato-código que este worker deixou de gravar. Falha explícita, com o
  // motivo visível para quem apertou o botão.
  if (job.scope === "chat" && isLidJid(job.chat_jid)) {
    const msg = "chat_jid é um LID (@lid), não um telefone — sincronize pela conversa do número";
    await failJob(supabase, job.id, msg);
    return { fetched: 0, done: true, error: msg };
  }

  if (job.scope === "chat" && job.chat_jid) {
    return processSingleChat(
      supabase, job, provider, job.chat_jid, job.cursor, maxDays, cfg, pressurePct,
    );
  }

  // --- scope=default/full/incremental: multi-chat with parallel fetch ---
  let mc = parseMultiCursor(job.cursor);

  if (!mc) {
    if (!provider.listChats) {
      await failJob(supabase, job.id, `${provider.provider} does not support listChats`);
      return { fetched: 0, done: true, error: "listChats unavailable" };
    }
    let chatList: Array<{ id: string }>;
    try {
      chatList = await provider.listChats();
    } catch (e) {
      await failJob(supabase, job.id, `listChats: ${(e as Error).message}`);
      return { fetched: 0, done: true, error: "listChats failed" };
    }
    const individualJids = chatList
      .map(c => c.id)
      .filter(id => id && id.includes("@") && !isGroupJid(id));
    // A Uazapi V2 lista conversas por LID quando o número do outro lado não é
    // exposto à conta. Puxar o histórico por essa chave grava um contato que é
    // um código, não um telefone — ver `_shared/whatsapp-jid.ts`.
    const lidJids = individualJids.filter(isLidJid);
    const jids = individualJids
      .filter(id => !isLidJid(id))
      .slice(0, job.max_chats);
    if (lidJids.length > 0) {
      await logRuntime({
        module: "whatsapp",
        action: "history_sync_skipped_lid_chats",
        status: "skipped",
        organizationId: job.organization_id,
        payloadSnapshot: {
          job_id: job.id,
          instance_id: job.instance_id,
          skipped: lidJids.length,
          total_chats: chatList.length,
          sample: lidJids.slice(0, 5),
        },
      });
    }
    if (jids.length === 0) {
      const msg = chatList.length > 0
        ? `0 valid JIDs from ${chatList.length} chats (${lidJids.length} @lid, no individual @s.whatsapp.net JIDs found)`
        : "no chats found";
      await failJob(supabase, job.id, msg);
      return { fetched: 0, done: true, error: msg };
    }

    const perChat: Record<string, string | null> = {};
    for (const jid of jids) perChat[jid] = null;

    mc = { chats: jids, chatIdx: 0, perChat };

    // Persist total_chats for progress tracking
    await updateJobProgress(supabase, job.id, {
      total_chats: jids.length,
      current_chat_index: 0,
      cursor: JSON.stringify(mc),
    });
  }

  return processMultiChat(supabase, job, provider, mc, maxDays, cfg, pressurePct);
}

// ---------------------------------------------------------------------------
// Stale job reset
// ---------------------------------------------------------------------------

/**
 * Reanima jobs que ficaram presos em `running` — tick que morreu no meio,
 * instância que caiu.
 *
 * O filtro `status = 'running'` é o que mantém `paused` e `cancelled` fora do
 * alcance deste reaper: estado posto pelo operador não é job preso. Antes de
 * `cancelled` existir, a única forma de abortar era escrever a mensagem em
 * `error` e deixar o job em `running` — e este reaper o devolvia para a fila
 * dez minutos depois, indefinidamente.
 */
async function resetStaleJobs(supabase: Db): Promise<number> {
  const threshold = new Date(Date.now() - JOB_STALE_MINUTES * 60_000).toISOString();
  const { data } = await supabase
    .from("history_sync_jobs")
    .update({ status: "queued" })
    .eq("status", "running")
    .lt("updated_at", threshold)
    .select("id");
  return data?.length ?? 0;
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------

Deno.serve(
  withErrorBoundary("history-sync-worker", async (req: Request) => {
    const providedSecret = req.headers.get("x-cron-secret");
    if (!CRON_SECRET || !providedSecret || !timingSafeCompare(providedSecret, CRON_SECRET)) {
      return jsonResponse(401, { error: "unauthorized" });
    }

    // O cast reconcilia duas leituras do mesmo tipo: `createClient(...)` resolve
    // os genéricos para o schema "public", enquanto `ReturnType<typeof createClient>`
    // — a assinatura que todos os helpers deste arquivo usam — resolve para os
    // defaults do pacote. São o mesmo cliente em tempo de execução; sem o cast o
    // arquivo acumula um erro de tipo por helper chamado.
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    }) as unknown as Db;

    const cfg = await loadGuardConfig(supabase);
    const pressurePct = makePressureGate(supabase);

    const staleReset = await resetStaleJobs(supabase);

    const { data: jobs, error } = await supabase
      .from("history_sync_jobs")
      .select("*")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(MAX_JOBS_PER_RUN);

    if (error) {
      await logRuntime({
        module: "whatsapp",
        action: "fetch_queue",
        status: "error",
        errorMessage: error.message,
      });
      return jsonResponse(500, { error: "failed to fetch queue" });
    }

    // `scope=full` puxa o histórico inteiro de até 100 conversas — dezenas de
    // milhares de linhas. É manutenção, e manutenção não disputa banco com o
    // horário comercial. Fora da janela o job fica na fila, intocado.
    const inWindow = insideFullWindow(cfg, new Date());
    const eligible: HistorySyncJob[] = [];
    let deferredFull = 0;
    for (const j of (jobs ?? []) as HistorySyncJob[]) {
      if (j.scope === "full" && !inWindow) { deferredFull += 1; continue; }
      eligible.push(j);
    }

    const perInstance = new Map<string, HistorySyncJob>();
    for (const j of eligible) {
      if (!perInstance.has(j.instance_id)) perInstance.set(j.instance_id, j);
    }

    // Se o banco já está sob pressão quando o tick começa, nem vale abrir
    // provedor e listar conversas — cede a vez inteira.
    const openingPressure = await pressurePct();
    if (openingPressure !== null && openingPressure >= cfg.maxPressurePct) {
      await logRuntime({
        module: "whatsapp",
        action: "history_sync_tick_skipped",
        status: "success",
        payloadSnapshot: {
          pressure_pct: openingPressure,
          threshold_pct: cfg.maxPressurePct,
          jobs_waiting: perInstance.size,
        },
      });
      return jsonResponse(200, {
        ok: true,
        skipped: "db_pressure",
        pressure_pct: openingPressure,
        jobs_waiting: perInstance.size,
      });
    }

    const results: Array<{ id: string; fetched: number; done: boolean; error?: string }> = [];
    for (const job of perInstance.values()) {
      const res = await processJob(supabase, job, cfg, pressurePct);
      results.push({ id: job.id, ...res });
    }

    await logRuntime({
      module: "whatsapp",
      action: "run",
      status: "success",
      payloadSnapshot: {
        jobs_processed: results.length,
        stale_reset: staleReset,
        deferred_full: deferredFull,
        pressure_pct: openingPressure,
        total_fetched: results.reduce((a, r) => a + r.fetched, 0),
      },
    });

    return jsonResponse(200, {
      ok: true,
      jobs_processed: results.length,
      stale_reset: staleReset,
      deferred_full: deferredFull,
      pressure_pct: openingPressure,
      results,
    });
  })
);
