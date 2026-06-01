/**
 * loop-detector — Copilot v2.
 *
 * Pure evaluator over a window of recent messages (scoped to org+phone by the
 * caller) + a fail-CLOSED gate decision. Catches two loop shapes:
 *
 *   1. identical_outgoing_burst — same outgoing content repeated ≥3× in a short
 *      window (mirrors the v1 evaluator).
 *   2. inbound_outbound_pingpong — rapid strict alternation in/out/in/out…,
 *      regardless of content. This is the branch the v1 type declared but never
 *      implemented (bot-loop-detector.ts returned null), and the actual shape of
 *      the Bertin bot↔bot incident.
 *
 * The gate is fail-CLOSED: if the loop check errored, the turn is blocked. We
 * never let a broken check send into a possible loop.
 */

export interface LoopMessage {
  content_hash: string;
  direction: "incoming" | "outgoing";
  timestamp: string;
}

export type LoopReason =
  | "identical_outgoing_burst"
  | "inbound_outbound_pingpong";

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
  /** Window for the identical-outgoing-burst check. Default 60s. */
  burstWindowSeconds?: number;
  /** Max gap between two consecutive pingpong messages. Default 30s. */
  pingpongMaxGapSeconds?: number;
  /** Window for considering pingpong messages. Default 120s. */
  pingpongWindowSeconds?: number;
}

const DEFAULT_BURST_WINDOW_SECONDS = 60;
const IDENTICAL_BURST_THRESHOLD = 3;
const DEFAULT_PINGPONG_MAX_GAP_SECONDS = 30;
const DEFAULT_PINGPONG_WINDOW_SECONDS = 120;
const PINGPONG_MIN_ALTERNATIONS = 6; // 3 in/out pairs

/**
 * Pure evaluator. No I/O. Burst is checked first (cheaper + more specific),
 * then pingpong.
 */
export function evaluateLoopSignal(args: EvaluateArgs): LoopSignal | null {
  const burst = detectIdenticalBurst(args);
  if (burst) return burst;
  return detectPingpong(args);
}

function detectIdenticalBurst(args: EvaluateArgs): LoopSignal | null {
  const burstWindow = args.burstWindowSeconds ?? DEFAULT_BURST_WINDOW_SECONDS;
  const cutoffMs = args.now.getTime() - burstWindow * 1000;

  const recentOutgoing = args.messages.filter(
    (m) => m.direction === "outgoing" && new Date(m.timestamp).getTime() >= cutoffMs,
  );

  const byHash = new Map<string, number>();
  for (const m of recentOutgoing) {
    byHash.set(m.content_hash, (byHash.get(m.content_hash) ?? 0) + 1);
  }
  for (const [hash, count] of byHash) {
    if (count >= IDENTICAL_BURST_THRESHOLD) {
      return {
        shouldPause: true,
        reason: "identical_outgoing_burst",
        evidence: { count, windowSeconds: burstWindow, contentHashes: [hash] },
      };
    }
  }
  return null;
}

function detectPingpong(args: EvaluateArgs): LoopSignal | null {
  const windowSeconds = args.pingpongWindowSeconds ?? DEFAULT_PINGPONG_WINDOW_SECONDS;
  const maxGapMs = (args.pingpongMaxGapSeconds ?? DEFAULT_PINGPONG_MAX_GAP_SECONDS) * 1000;
  const cutoffMs = args.now.getTime() - windowSeconds * 1000;

  // Chronological, within window.
  const msgs = args.messages
    .filter((m) => new Date(m.timestamp).getTime() >= cutoffMs)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Longest tail run of strictly-alternating directions with small gaps.
  let runLength = msgs.length ? 1 : 0;
  for (let i = msgs.length - 1; i > 0; i--) {
    const cur = msgs[i];
    const prev = msgs[i - 1];
    const gap = new Date(cur.timestamp).getTime() - new Date(prev.timestamp).getTime();
    if (cur.direction !== prev.direction && gap <= maxGapMs) {
      runLength++;
    } else {
      break;
    }
  }

  if (runLength >= PINGPONG_MIN_ALTERNATIONS) {
    return {
      shouldPause: true,
      reason: "inbound_outbound_pingpong",
      evidence: {
        count: runLength,
        windowSeconds,
        contentHashes: msgs.slice(-runLength).map((m) => m.content_hash),
      },
    };
  }
  return null;
}

export interface LoopGateInput {
  signal: LoopSignal | null;
  /** True if the loop check (DB query / evaluation) threw. */
  checkErrored: boolean;
}

export interface LoopGateDecision {
  block: boolean;
  reason: "loop_check_failed" | "bot_loop_detected" | null;
}

/**
 * Fail-CLOSED gate. A failed check blocks the turn; a fired signal blocks the
 * turn; otherwise the turn proceeds.
 */
export function decideLoopGate(input: LoopGateInput): LoopGateDecision {
  if (input.checkErrored) return { block: true, reason: "loop_check_failed" };
  if (input.signal?.shouldPause) return { block: true, reason: "bot_loop_detected" };
  return { block: false, reason: null };
}
