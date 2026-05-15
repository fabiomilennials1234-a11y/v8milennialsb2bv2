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

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withSentry } from "../_shared/sentry.ts";
import { logRuntime } from "../_shared/logger.ts";
import { getWhatsAppProvider } from "../_shared/whatsapp-client.ts";

import "../_shared/whatsapp-providers/evolution-provider.ts";
import "../_shared/whatsapp-providers/uazapi-provider.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

const CHUNK_SIZE = 100;
const MAX_JOBS_PER_RUN = 20;
const JOB_STALE_MINUTES = 10;
const TIME_BUDGET_MS = 50_000;
const PARALLEL_CHATS = 2;
const SKIP_RECENT_THRESHOLD_MS = 3_600_000; // 1h

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
    headers: { "Content-Type": "application/json" },
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
  supabase: ReturnType<typeof createClient>,
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
  supabase: ReturnType<typeof createClient>,
  job: HistorySyncJob,
  messages: unknown[],
  maxDays: number,
  latestSyncedTs?: number | null,
): Promise<{ fetched: number; hitExisting: boolean }> {
  let fetched = 0;
  let firstError: string | null = null;
  let hitExisting = false;

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
    const remoteJid = msg.chatid ?? msg.chatId ?? msg.remoteJid ?? msg.from ?? msg.to ?? msg.jid ?? "";

    if (String(remoteJid).endsWith("@g.us")) continue;
    const phoneNumber = String(remoteJid).split("@")[0] || "unknown";

    const { error: upsertErr } = await supabase.from("whatsapp_messages").upsert(
      {
        organization_id: job.organization_id,
        instance_id: job.instance_id,
        message_id: String(messageId),
        remote_jid: remoteJid || "unknown",
        phone_number: phoneNumber,
        direction: fromMe ? "outgoing" : "incoming",
        message_type: msg.type ?? msg.wa_type ?? (msg.text ? "text" : "unknown"),
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
  return { fetched, hitExisting };
}

// ---------------------------------------------------------------------------
// Job management helpers
// ---------------------------------------------------------------------------

async function failJob(
  supabase: ReturnType<typeof createClient>,
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
  supabase: ReturnType<typeof createClient>,
  jobId: string,
  updates: Record<string, unknown>
) {
  await supabase.from("history_sync_jobs").update(updates).eq("id", jobId);
}

// ---------------------------------------------------------------------------
// Single-chat processing (scope=chat) — time-budgeted loop
// ---------------------------------------------------------------------------

async function processSingleChat(
  supabase: ReturnType<typeof createClient>,
  job: HistorySyncJob,
  provider: any,
  chatJid: string,
  cursor: string | null,
  maxDays: number
): Promise<{ fetched: number; done: boolean; error?: string }> {
  const startTime = Date.now();
  let currentCursor = cursor;
  let totalFetched = job.total_fetched;
  let totalThisTick = 0;

  while (Date.now() - startTime < TIME_BUDGET_MS) {
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
    const nextCursor = chunkResult.nextCursor ?? null;
    const reachedMsgCap = job.scope !== "full" && totalFetched >= job.max_messages_per_chat;
    const done = !nextCursor || reachedMsgCap;

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
  supabase: ReturnType<typeof createClient>,
  job: HistorySyncJob,
  provider: any,
  mc: MultiChatCursor,
  maxDays: number
): Promise<{ fetched: number; done: boolean; error?: string }> {
  const startTime = Date.now();
  let totalFetched = job.total_fetched;
  let totalThisTick = 0;
  let chatsCompleted = job.chats_completed ?? 0;
  let chatsSkipped = job.chats_skipped ?? 0;
  const chatErrors: Record<string, string> = (job.chat_errors as Record<string, string>) ?? {};
  const isIncremental = job.scope === "incremental";

  while (Date.now() - startTime < TIME_BUDGET_MS) {
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

      // Decide: chat done or continue
      const chatDone = !chunk.nextCursor || hitExisting;
      if (chatDone) {
        delete mc.perChat[item.jid];
        chatsCompleted += 1;
      } else {
        mc.perChat[item.jid] = chunk.nextCursor;
      }
    }

    // Advance chatIdx past completed chats
    advanceChatIdx(mc);

    // Check global cap
    const reachedCap = totalFetched >= job.max_messages_per_chat * job.max_chats;
    const allDone = Object.keys(mc.perChat).length === 0 || reachedCap;

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
  supabase: ReturnType<typeof createClient>,
  job: HistorySyncJob
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
  if (job.scope === "chat" && job.chat_jid) {
    return processSingleChat(supabase, job, provider, job.chat_jid, job.cursor, maxDays);
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
    const jids = chatList
      .map(c => c.id)
      .filter(id => id && id.includes("@") && !id.endsWith("@g.us"))
      .slice(0, job.max_chats);
    if (jids.length === 0) {
      const msg = chatList.length > 0
        ? `0 valid JIDs from ${chatList.length} chats (no individual @s.whatsapp.net JIDs found)`
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

  return processMultiChat(supabase, job, provider, mc, maxDays);
}

// ---------------------------------------------------------------------------
// Stale job reset
// ---------------------------------------------------------------------------

async function resetStaleJobs(supabase: ReturnType<typeof createClient>): Promise<number> {
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
  withSentry("history-sync-worker", async (req: Request) => {
    const providedSecret = req.headers.get("x-cron-secret");
    if (!CRON_SECRET || providedSecret !== CRON_SECRET) {
      return jsonResponse(401, { error: "unauthorized" });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const staleReset = await resetStaleJobs(supabase);

    const { data: jobs, error } = await supabase
      .from("history_sync_jobs")
      .select("*")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(MAX_JOBS_PER_RUN);

    if (error) {
      await logRuntime({
        module: "history-sync-worker",
        action: "fetch_queue",
        status: "error",
        errorMessage: error.message,
      });
      return jsonResponse(500, { error: "failed to fetch queue" });
    }

    const perInstance = new Map<string, HistorySyncJob>();
    for (const j of (jobs ?? []) as HistorySyncJob[]) {
      if (!perInstance.has(j.instance_id)) perInstance.set(j.instance_id, j);
    }

    const results: Array<{ id: string; fetched: number; done: boolean; error?: string }> = [];
    for (const job of perInstance.values()) {
      const res = await processJob(supabase, job);
      results.push({ id: job.id, ...res });
    }

    await logRuntime({
      module: "history-sync-worker",
      action: "run",
      status: "success",
      payloadSnapshot: {
        jobs_processed: results.length,
        stale_reset: staleReset,
        total_fetched: results.reduce((a, r) => a + r.fetched, 0),
      },
    });

    return jsonResponse(200, {
      ok: true,
      jobs_processed: results.length,
      stale_reset: staleReset,
      results,
    });
  })
);
