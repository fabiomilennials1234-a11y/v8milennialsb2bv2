// deno-lint-ignore-file no-explicit-any
/**
 * history-sync-worker — processes history_sync_jobs in chunks.
 *
 * Triggered by pg_cron every minute. Auth via x-cron-secret.
 * Claims 1 queued job per instance, calls provider.historySync in chunks
 * of 100 messages, UPSERTs into whatsapp_messages with the existing
 * idempotent contract (message_id, instance_id), advances cursor.
 *
 * Rate limit: max 100 msg/min per instance (enforced by chunk_size + 1-run-per-minute cron).
 * Scope defaults: 30 days, 500 msg/chat, 100 chats/instance.
 * Full sync (scope="full") bypasses the day/chat caps but still respects
 * msg/chat cap unless user explicitly overrides max_messages_per_chat.
 * Per-chat sync (scope="chat") requires chat_jid set.
 *
 * Provider-agnostic: Evolution falls back to historySync? throwing
 * NotSupportedError — job fails gracefully with error recorded.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withSentry } from "../_shared/sentry.ts";
import { logRuntime } from "../_shared/logger.ts";
import { getWhatsAppProvider } from "../_shared/whatsapp-client.ts";

// Force bundler to include provider modules (used via dynamic import in whatsapp-client)
import "../_shared/whatsapp-providers/evolution-provider.ts";
import "../_shared/whatsapp-providers/uazapi-provider.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

const CHUNK_SIZE = 100;
const MAX_JOBS_PER_RUN = 20;
const JOB_STALE_MINUTES = 5;

type HistorySyncJob = {
  id: string;
  organization_id: string;
  instance_id: string;
  chat_jid: string | null;
  scope: "default" | "full" | "chat";
  max_days: number;
  max_messages_per_chat: number;
  max_chats: number;
  cursor: string | null;
  status: string;
  total_fetched: number;
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function withinCutoff(ts: number, maxDays: number): boolean {
  if (maxDays <= 0) return true; // full scope disables cutoff
  const cutoff = Date.now() - maxDays * 86_400_000;
  return ts * 1000 >= cutoff;
}

async function processJob(
  supabase: ReturnType<typeof createClient>,
  job: HistorySyncJob
): Promise<{ fetched: number; done: boolean; error?: string }> {
  // Claim
  const { error: claimErr } = await supabase
    .from("history_sync_jobs")
    .update({
      status: "running",
      started_at: job.status === "queued" ? new Date().toISOString() : undefined,
    })
    .eq("id", job.id)
    .eq("status", job.status);

  if (claimErr) return { fetched: 0, done: false, error: `claim failed: ${claimErr.message}` };

  // Resolve instance + provider
  const { data: instance } = await supabase
    .from("whatsapp_instances")
    .select("*")
    .eq("id", job.instance_id)
    .maybeSingle();
  if (!instance) {
    await supabase.from("history_sync_jobs").update({
      status: "failed",
      error: "instance not found",
      completed_at: new Date().toISOString(),
    }).eq("id", job.id);
    return { fetched: 0, done: true, error: "instance not found" };
  }

  let provider;
  try {
    provider = await getWhatsAppProvider(instance as any, supabase);
  } catch (e) {
    await supabase.from("history_sync_jobs").update({
      status: "failed",
      error: `provider init: ${(e as Error).message}`,
      completed_at: new Date().toISOString(),
    }).eq("id", job.id);
    return { fetched: 0, done: true, error: "provider init failed" };
  }

  if (!provider.historySync) {
    await supabase.from("history_sync_jobs").update({
      status: "failed",
      error: `${provider.provider} does not support historySync`,
      completed_at: new Date().toISOString(),
    }).eq("id", job.id);
    return { fetched: 0, done: true, error: "historySync unavailable" };
  }

  // Fetch chunk
  let chunkResult;
  try {
    chunkResult = await provider.historySync({
      chat_jid: job.scope === "chat" ? job.chat_jid ?? undefined : undefined,
      limit: CHUNK_SIZE,
      cursor: job.cursor ?? undefined,
    });
  } catch (e) {
    await supabase.from("history_sync_jobs").update({
      status: "failed",
      error: `historySync call: ${(e as Error).message}`,
      completed_at: new Date().toISOString(),
    }).eq("id", job.id);
    return { fetched: 0, done: true, error: "historySync fetch failed" };
  }

  const messages = chunkResult.messages ?? [];
  let fetched = 0;

  const maxDays = job.scope === "full" ? 0 : job.max_days;

  for (const raw of messages) {
    const msg = raw as Record<string, any>;
    const messageId = msg.id ?? msg.messageid ?? msg.key?.id;
    if (!messageId) continue;

    const tsSeconds = Number(msg.timestamp ?? msg.messageTimestamp ?? 0);
    if (tsSeconds && !withinCutoff(tsSeconds, maxDays)) continue;

    const fromMe = msg.fromMe === true || msg.fromme === true;
    const remoteJid = msg.chatid ?? msg.remoteJid ?? msg.from ?? msg.to ?? "";
    const phoneNumber = String(remoteJid).split("@")[0] ?? null;

    await supabase.from("whatsapp_messages").upsert(
      {
        organization_id: job.organization_id,
        instance_id: job.instance_id,
        message_id: messageId,
        remote_jid: remoteJid,
        phone_number: phoneNumber,
        direction: fromMe ? "outgoing" : "incoming",
        message_type: msg.type ?? (msg.text ? "text" : "unknown"),
        content: msg.text ?? msg.caption ?? null,
        media_url: msg.mediaUrl ?? null,
        push_name: msg.pushName ?? null,
        status: fromMe ? "sent" : "received",
        timestamp: tsSeconds
          ? new Date(tsSeconds * 1000).toISOString()
          : new Date().toISOString(),
        raw_payload: msg as Record<string, unknown>,
      },
      { onConflict: "message_id,instance_id", ignoreDuplicates: true }
    );
    fetched += 1;
  }

  const totalFetched = job.total_fetched + fetched;
  const nextCursor = chunkResult.nextCursor ?? null;
  const reachedMsgCap =
    job.scope !== "full" &&
    totalFetched >= job.max_messages_per_chat * job.max_chats;

  const done = !nextCursor || reachedMsgCap;

  await supabase
    .from("history_sync_jobs")
    .update({
      cursor: done ? null : nextCursor,
      total_fetched: totalFetched,
      status: done ? "completed" : "queued",
      completed_at: done ? new Date().toISOString() : null,
    })
    .eq("id", job.id);

  return { fetched, done };
}

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

Deno.serve(
  withSentry("history-sync-worker", async (req: Request) => {
    // Auth — cron only
    const providedSecret = req.headers.get("x-cron-secret");
    if (!CRON_SECRET || providedSecret !== CRON_SECRET) {
      return jsonResponse(401, { error: "unauthorized" });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const staleReset = await resetStaleJobs(supabase);

    // Claim up to MAX_JOBS_PER_RUN queued jobs, one per instance
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

    // Dedup by instance — only 1 job per instance per run
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
