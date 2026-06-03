/**
 * outbound-delivery — W4 delivery realism (Copilot v2), PURE layer.
 *
 * Splits one agent reply into natural WhatsApp chunks and plans a human latency
 * per chunk. Zero-dep, deterministic, no wall-clock and no I/O: this module only
 * COMPUTES the plan — the worker executes the sleeps + typing presence.
 *
 * Hard guarantee (SPEC L181): a chunk boundary is NEVER placed inside a protected
 * token (price / number / link / e-mail / spec-measurement / inline code / fenced
 * code block). Boundaries exist only at paragraph (\n\n) or sentence ([.!?] + ws)
 * breaks, and any candidate that straddles a protected span is dropped — so a
 * protected token always survives whole inside a single chunk. When no safe
 * boundary fits the size target, the segment is emitted whole rather than cut
 * (fail-safe = atomic).
 */

import type { Archetype } from './model-selector.ts';

export interface DeliveryProfile {
  /** Soft target: pack segments up to this many chars per chunk. */
  maxChars: number;
  /** Chunks shorter than this are merged into a neighbour. */
  minChars: number;
  /** First-reply latency factor: ms per char of the INBOUND message (read time). */
  readMsPerChar: number;
  /** Typing factor: ms per char of the chunk about to be sent. */
  typeMsPerChar: number;
  /** Hard floor for the FIRST reply delay (SPEC: never < 1000). */
  floorMs: number;
  /** Per-delay ceiling. */
  capMs: number;
  /** Minimum gap before any non-first chunk. */
  minGapMs: number;
}

export interface ProtectedSpan {
  start: number;
  end: number;
}

export interface DeliveryPlan {
  chunks: string[];
  delays: number[];
}

// Per-archetype delivery realism. Architecture (like model-selector), not a
// wizard knob: each archetype has a coherent cadence. All floors honour the
// SPEC ≥1s minimum first-reply latency.
const DELIVERY_PROFILES: Record<Archetype, DeliveryProfile> = {
  // Fast qualifier (gemini-flash): short, punchy WhatsApp bursts.
  qualificador: {
    maxChars: 260,
    minChars: 30,
    readMsPerChar: 12,
    typeMsPerChar: 28,
    floorMs: 1200,
    capMs: 8000,
    minGapMs: 700,
  },
  // Closer (sonnet): slightly longer chunks so pricing/terms read coherently,
  // a touch more deliberate.
  vendedor: {
    maxChars: 360,
    minChars: 40,
    readMsPerChar: 14,
    typeMsPerChar: 26,
    floorMs: 1500,
    capMs: 9000,
    minGapMs: 800,
  },
  // Win-back: warm, moderate cadence.
  carteira: {
    maxChars: 280,
    minChars: 30,
    readMsPerChar: 13,
    typeMsPerChar: 27,
    floorMs: 1300,
    capMs: 8000,
    minGapMs: 700,
  },
};

/** Delivery profile for an archetype; falls back to the qualifier profile. */
export function deliveryProfileFor(archetype: Archetype): DeliveryProfile {
  return DELIVERY_PROFILES[archetype] ?? DELIVERY_PROFILES.qualificador;
}

// Spans that must never be straddled by a chunk boundary. Code spans/blocks can
// legitimately contain ". " or blank lines; prices/numbers/urls/specs carry no
// whitespace (boundaries can't fall inside them) but are guarded anyway as
// belt-and-suspenders against future boundary-rule changes.
const PROTECTED_PATTERNS: RegExp[] = [
  /```[\s\S]*?```/g, // fenced code block
  /`[^`]*`/g, // inline code
  /https?:\/\/\S+/gi, // url
  /www\.\S+/gi, // bare www url
  /[^\s@]+@[^\s@]+\.[^\s@]+/g, // e-mail
  /R\$\s?\d[\d.,]*/gi, // price
  /\d[\d.,]*\d|\d/g, // number (decimals / thousands kept whole)
  /\S*\d\S*[-/×]\S*|\S*[-/×]\S*\d\S*/g, // spec / measurement token (e.g. X-200/5mm)
];

/** All protected spans in `text`, unsorted, possibly overlapping. */
export function protectedSpans(text: string): ProtectedSpan[] {
  const spans: ProtectedSpan[] = [];
  for (const pattern of PROTECTED_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      if (m[0].length === 0) {
        pattern.lastIndex++;
        continue;
      }
      spans.push({ start: m.index, end: m.index + m[0].length });
    }
  }
  return spans;
}

/** True when cutting at index `p` would fall strictly inside a protected span. */
function insideSpan(p: number, spans: ProtectedSpan[]): boolean {
  return spans.some((s) => p > s.start && p < s.end);
}

/** Candidate boundary positions (start index of the next chunk), in order. */
function safeSplitPoints(text: string, spans: ProtectedSpan[]): number[] {
  const points = new Set<number>();

  for (const m of text.matchAll(/\n{2,}/g)) {
    points.add(m.index! + m[0].length); // start of next paragraph
  }
  // Sentence end: [.!?] (+ optional closing quote/bracket) followed by whitespace.
  for (const m of text.matchAll(/[.!?]+[)\]"'”’]*\s+/g)) {
    points.add(m.index! + m[0].length);
  }

  return [...points]
    .filter((p) => p > 0 && p < text.length && !insideSpan(p, spans))
    .sort((a, b) => a - b);
}

/**
 * Split a reply into ordered WhatsApp chunks. Never cuts a protected token;
 * fail-safe to a single chunk for atomic / short / empty input.
 */
export function splitReply(text: string, profile: DeliveryProfile): string[] {
  if (text.trim() === '') return [];

  const spans = protectedSpans(text);
  const points = safeSplitPoints(text, spans);

  // Minimal safe units (one sentence / paragraph each).
  const segments: string[] = [];
  let prev = 0;
  for (const p of points) {
    segments.push(text.slice(prev, p));
    prev = p;
  }
  segments.push(text.slice(prev));

  // Greedily pack segments up to maxChars; an oversized segment stands alone.
  const packed: string[] = [];
  let cur = '';
  for (const seg of segments) {
    if (cur === '') {
      cur = seg;
    } else if ((cur + seg).trim().length <= profile.maxChars) {
      cur += seg;
    } else {
      packed.push(cur);
      cur = seg;
    }
  }
  if (cur !== '') packed.push(cur);

  const trimmed = packed.map((c) => c.trim()).filter((c) => c.length > 0);
  return mergeTiny(trimmed, profile);
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi);

/**
 * Per-chunk delay (ms) BEFORE sending each chunk, simulating a human.
 *
 * - First chunk: read time (∝ inbound length) + typing time (∝ chunk length),
 *   floored at `floorMs` (SPEC: a reply NEVER arrives in < 1s) and capped.
 * - Later chunks: typing time only, floored at `minGapMs`, capped at `capMs`.
 *
 * Pure + deterministic: no wall-clock, no randomness — the worker sleeps these.
 */
export function planDelays(
  chunks: string[],
  inboundLen: number,
  profile: DeliveryProfile,
): number[] {
  return chunks.map((chunk, i) => {
    if (i === 0) {
      const raw = profile.readMsPerChar * inboundLen + profile.typeMsPerChar * chunk.length;
      return clamp(raw, profile.floorMs, profile.capMs);
    }
    return clamp(profile.typeMsPerChar * chunk.length, profile.minGapMs, profile.capMs);
  });
}

/**
 * Build the full delivery plan for a reply: natural chunks + per-chunk human
 * latency. Single entry point for the worker.
 */
export function buildDeliveryPlan(
  reply: string,
  inboundLen: number,
  profile: DeliveryProfile,
): DeliveryPlan {
  const chunks = splitReply(reply, profile);
  return { chunks, delays: planDelays(chunks, inboundLen, profile) };
}

/**
 * Fold chunks shorter than `minChars` into a neighbour so no orphan fragment is
 * sent. Merging only joins text (never cuts), so protected tokens stay intact.
 */
function mergeTiny(chunks: string[], profile: DeliveryProfile): string[] {
  if (chunks.length <= 1) return chunks;

  const out: string[] = [];
  for (const c of chunks) {
    if (out.length > 0 && out[out.length - 1].length < profile.minChars) {
      out[out.length - 1] = `${out[out.length - 1]} ${c}`.trim();
    } else {
      out.push(c);
    }
  }
  // A tiny trailing chunk has no following neighbour — fold it back.
  if (out.length > 1 && out[out.length - 1].length < profile.minChars) {
    const last = out.pop()!;
    out[out.length - 1] = `${out[out.length - 1]} ${last}`.trim();
  }
  return out;
}
