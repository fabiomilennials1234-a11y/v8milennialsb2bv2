/**
 * humanize-batch — per-recipient message variation for MASS sends (anti-ban
 * Onda 0 QW6). Kills the byte-identical fan-out: N recipients of the same
 * template each get their own humanizeMessage() rewrite.
 *
 * Contract (chat-safety):
 *  - FAIL-OPEN, always: humanizeMessage already returns the original on any
 *    error/timeout; this wrapper additionally catches and keeps the original.
 *    A humanizer outage can never block or drop a send.
 *  - TIME-BOXED: a small worker pool plus a global wall-clock budget, so a big
 *    batch (N LLM calls) can't blow the edge function's runtime. Recipients
 *    beyond the budget keep their original text — degraded variation, never a
 *    degraded send.
 *  - The returned array is the FROZEN variant set: it is what ships in the
 *    /sender payload, so what each recipient got is exactly what Uazapi
 *    persisted for that message (pollable per recipient).
 */

import { humanizeMessage } from "./message-humanizer.ts";

export const HUMANIZE_POOL_SIZE = 5;
export const HUMANIZE_BUDGET_MS = 60_000;

export interface HumanizableItem {
  text?: string;
  caption?: string;
  /** Uazapi item type — for "image" the RENDERED content is the caption. */
  type?: string;
  file?: string;
  [key: string]: unknown;
}

export interface HumanizeBatchOptions {
  poolSize?: number;
  budgetMs?: number;
  /** Injected for tests. Defaults to the OpenRouter-backed humanizeMessage. */
  humanize?: (text: string) => Promise<string>;
  /** Injected clock for deterministic budget tests. */
  now?: () => number;
}

/**
 * Rewrite each item's message content (`text`, falling back to `caption` for
 * media items) with its own humanized variant. Order and every other field are
 * preserved; items whose rewrite fails, is empty, or lands past the budget
 * keep the original.
 */
export async function humanizeBatch<T extends HumanizableItem>(
  items: T[],
  opts: HumanizeBatchOptions = {},
): Promise<T[]> {
  const poolSize = Math.max(1, opts.poolSize ?? HUMANIZE_POOL_SIZE);
  const budgetMs = opts.budgetMs ?? HUMANIZE_BUDGET_MS;
  const humanize = opts.humanize ?? humanizeMessage;
  const now = opts.now ?? Date.now;

  const out = items.slice();
  const start = now();
  let next = 0;

  async function worker(): Promise<void> {
    while (next < out.length) {
      const i = next++;
      const item = out[i];
      // Media items render the CAPTION (Uazapi media shape) — their `text`
      // field is dead weight (mass-send stamps template_text on every item),
      // so rewriting it would ship the byte-identical caption untouched.
      const isMedia = item.type === "image" || typeof item.file === "string";
      const hasText = typeof item.text === "string" && item.text.trim().length > 0;
      const hasCaption = typeof item.caption === "string" && item.caption.trim().length > 0;
      const field: "text" | "caption" | null = isMedia
        ? hasCaption
          ? "caption"
          : hasText
            ? "text"
            : null
        : hasText
          ? "text"
          : hasCaption
            ? "caption"
            : null;
      if (!field) continue;
      // Budget spent → remaining items keep the original template (fail-open).
      if (now() - start >= budgetMs) return;
      try {
        const variant = await humanize(item[field] as string);
        if (typeof variant === "string" && variant.trim().length > 0) {
          out[i] = { ...item, [field]: variant } as T;
        }
      } catch {
        // fail-open: keep the original text; never block the batch
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(poolSize, out.length) }, () => worker()),
  );
  return out;
}
