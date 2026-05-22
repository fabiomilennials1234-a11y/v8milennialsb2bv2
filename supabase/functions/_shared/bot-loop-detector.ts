/**
 * bot-loop-detector — detecta loop bot-to-bot via padrão de mensagens.
 *
 * Origem: investigação Bertin 2026-05-08/09. Phone 5515935004596 (bot
 * imobiliário externo) trocou 3000+ msgs com o Copilot Bia em 9h13min sem
 * que nada parasse.
 *
 * Pipeline:
 *   detectLoop  →  fetches messages from `whatsapp_messages`  →  pure
 *   evaluator (`evaluateLoopSignal`) decides pause.
 *
 * Caller (agent-engine, whatsapp-webhook) é quem aplica side-effects (update
 * conversation, log).
 */

export interface LoopMessage {
  content_hash: string;
  direction: "incoming" | "outgoing";
  timestamp: string;
}

export type LoopReason =
  | "identical_outgoing_burst"
  | "inbound_outbound_pingpong"
  | "mixed";

export interface LoopSignal {
  shouldPause: boolean;
  reason: LoopReason;
  evidence: {
    count: number;
    windowSeconds: number;
    contentHashes: string[];
  };
}

export interface EvaluateArgs {
  messages: LoopMessage[];
  now: Date;
  burstWindowSeconds?: number; // default 60
}

const DEFAULT_BURST_WINDOW_SECONDS = 60;
const IDENTICAL_BURST_THRESHOLD = 3;

/**
 * Pure evaluator. No I/O. Caller hands in a window of messages already
 * scoped to (org, phone, lookback).
 */
export function evaluateLoopSignal(args: EvaluateArgs): LoopSignal | null {
  const burstWindow = args.burstWindowSeconds ?? DEFAULT_BURST_WINDOW_SECONDS;
  const nowMs = args.now.getTime();
  const cutoffMs = nowMs - burstWindow * 1000;

  const recentOutgoing = args.messages.filter(
    (m) => m.direction === "outgoing" && new Date(m.timestamp).getTime() >= cutoffMs,
  );

  // Identical outgoing burst: same content_hash repeated >= threshold within window
  const byHash = new Map<string, number>();
  for (const m of recentOutgoing) {
    byHash.set(m.content_hash, (byHash.get(m.content_hash) ?? 0) + 1);
  }
  for (const [hash, count] of byHash) {
    if (count >= IDENTICAL_BURST_THRESHOLD) {
      return {
        shouldPause: true,
        reason: "identical_outgoing_burst",
        evidence: {
          count,
          windowSeconds: burstWindow,
          contentHashes: [hash],
        },
      };
    }
  }

  return null;
}

export interface DetectLoopArgs {
  supabase: any;
  orgId: string;
  phone: string;
  lookbackSeconds?: number; // default 120
  now?: Date;
  burstWindowSeconds?: number;
}

/**
 * Async wrapper — pulls recent `whatsapp_messages` rows for (org, phone)
 * within `lookbackSeconds`, normalizes content into a stable hash, and
 * forwards to the pure evaluator.
 *
 * Hash computed in-memory (not a stored column) to avoid schema migration
 * on the hot `whatsapp_messages` table. Reuses send-dedup's normalization.
 */
export async function detectLoop(args: DetectLoopArgs): Promise<LoopSignal | null> {
  const { hashContent } = await import("./send-dedup.ts");

  const now = args.now ?? new Date();
  const lookback = args.lookbackSeconds ?? 120;
  const cutoff = new Date(now.getTime() - lookback * 1000).toISOString();

  const { data, error } = await args.supabase
    .from("whatsapp_messages")
    .select("content, direction, timestamp, content_hash")
    .eq("organization_id", args.orgId)
    .eq("phone_number", args.phone)
    .gte("timestamp", cutoff)
    .order("timestamp", { ascending: true });

  if (error) {
    throw new Error(`bot-loop-detector query failed: ${error.message ?? error}`);
  }

  const raw = (data ?? []) as Array<{
    content_hash?: string | null;
    content?: string | null;
    direction: "incoming" | "outgoing";
    timestamp: string;
  }>;

  const messages: LoopMessage[] = await Promise.all(
    raw.map(async (r) => ({
      content_hash: r.content_hash ?? (r.content ? await hashContent(r.content) : ""),
      direction: r.direction,
      timestamp: r.timestamp,
    })),
  );

  return evaluateLoopSignal({
    messages,
    now,
    burstWindowSeconds: args.burstWindowSeconds,
  });
}
