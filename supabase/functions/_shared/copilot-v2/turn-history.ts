/**
 * turn-history — Copilot v2 turn assembly with conversation history (Slice 12).
 *
 * Pure builder for the `messages` array passed to runTurn. It prepends the
 * recent shared-transcript history (most-recent `maxTurns`, blanks dropped) and
 * appends the current inbound as the final user turn.
 *
 * Eval-safety invariant: when `history` is empty — which is exactly how the
 * eval-runner and simulator build ResolvedContext — the result is
 * `[{ role: 'user', content: current }]`, byte-identical to the legacy
 * single-message turn. So injecting history in production does NOT shift the
 * W13/W12 eval/red-team goldens (no forced re-bless).
 */

import type { Msg } from './cognition-loop.ts';

export interface HistoryEntry {
  role: 'user' | 'assistant';
  content: string;
}

/** Mirrors v1's HISTORY_KEEP_RECENT — recent turns injected per cognition turn. */
export const DEFAULT_HISTORY_TURNS = 20;

export function buildTurnMessages(
  history: HistoryEntry[],
  current: string,
  maxTurns: number = DEFAULT_HISTORY_TURNS,
): Msg[] {
  const cleaned = (history ?? []).filter(
    (m) => typeof m.content === 'string' && m.content.trim().length > 0,
  );
  const recent = maxTurns > 0 ? cleaned.slice(-maxTurns) : [];
  const msgs: Msg[] = recent.map((m) => ({ role: m.role, content: m.content }));
  msgs.push({ role: 'user', content: current });
  return msgs;
}

/** A whatsapp_messages row (the engine-agnostic raw transcript the webhook writes). */
export interface WhatsappRow {
  direction?: string | null;
  content?: string | null;
}

/**
 * Maps whatsapp_messages rows → history entries. This is the shared-transcript
 * source v2 reads for continuity: the webhook persists every inbound (and
 * Uazapi echoes every outbound) here regardless of engine, so it stays complete
 * across the v1→v2 cutover without v2 writing anything. `incoming` is the lead
 * (user); everything else is the agent side (assistant). Blank content dropped.
 */
export function whatsappRowsToHistory(rows: WhatsappRow[]): HistoryEntry[] {
  return (rows ?? [])
    .filter((r) => typeof r.content === 'string' && r.content!.trim() !== '')
    .map((r) => ({
      role: r.direction === 'incoming' ? 'user' : 'assistant',
      content: (r.content as string),
    }));
}

/**
 * Drops the just-arrived inbound from the tail of the loaded history: the
 * webhook persists the current message to whatsapp_messages BEFORE it reaches
 * the worker, so it would otherwise appear both as history and as the appended
 * current turn. Removes at most one trailing user entry equal to `current`.
 */
export function dropTrailingCurrent(history: HistoryEntry[], current: string): HistoryEntry[] {
  const h = [...(history ?? [])];
  const last = h[h.length - 1];
  if (last && last.role === 'user' && last.content.trim() === current.trim()) h.pop();
  return h;
}
