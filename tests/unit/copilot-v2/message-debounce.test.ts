/**
 * Slice 1 — message debounce / fragment coalescing (Copilot v2)
 *
 * WhatsApp leads often send a thought as several quick fragments ("oi", "tudo
 * bem?", "queria um orçamento"). v1 fired one LLM turn per fragment — noisy and
 * a cost/loop hazard. v2 coalesces fragments of the same burst into one turn.
 */

import { describe, it, expect } from 'vitest';
import {
  coalesceFragments,
  type InboundFragment,
} from '../../../supabase/functions/_shared/copilot-v2/message-debounce.ts';

const base = new Date('2026-05-31T12:00:00.000Z').getTime();
const frag = (content: string, msOffset: number): InboundFragment => ({
  content,
  timestamp: new Date(base + msOffset).toISOString(),
});

describe('coalesceFragments', () => {
  it('joins fragments of the same burst into a single message', () => {
    const result = coalesceFragments(
      [frag('oi', 0), frag('tudo bem?', 40), frag('queria um orçamento', 80)],
      2000,
    );
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('oi tudo bem? queria um orçamento');
    expect(result[0].fragmentCount).toBe(3);
  });

  it('splits into separate messages when the gap exceeds the debounce window', () => {
    const result = coalesceFragments(
      [frag('primeira pergunta', 0), frag('segunda, minutos depois', 10_000)],
      2000,
    );
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe('primeira pergunta');
    expect(result[1].content).toBe('segunda, minutos depois');
  });

  it('returns a single message for a single fragment', () => {
    const result = coalesceFragments([frag('só uma', 0)], 2000);
    expect(result).toHaveLength(1);
    expect(result[0].fragmentCount).toBe(1);
  });

  it('returns empty for no fragments', () => {
    expect(coalesceFragments([], 2000)).toEqual([]);
  });

  it('ignores blank fragments when joining', () => {
    const result = coalesceFragments([frag('oi', 0), frag('   ', 30), frag('beleza', 60)], 2000);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('oi beleza');
  });

  it('drops a burst made entirely of blank fragments (never emits an empty turn)', () => {
    const result = coalesceFragments([frag('   ', 0), frag('', 30), frag('\n', 60)], 2000);
    expect(result).toEqual([]);
  });

  it('preserves chronological order even if input is unsorted', () => {
    const result = coalesceFragments([frag('b', 60), frag('a', 0), frag('c', 120)], 2000);
    expect(result[0].content).toBe('a b c');
  });
});
