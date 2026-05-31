/**
 * Slice 1 — dedup-lock key + window (Copilot v2, pure layer)
 *
 * Regression — "dedup race": two identical inbound messages arriving in
 * parallel must collapse to one turn. The atomic reservation is a SQL RPC
 * (INSERT ON CONFLICT DO NOTHING RETURNING) — tested in integration. This pure
 * layer defines the canonical dedup KEY (so equivalent content maps to the same
 * lock row) and the per-source window. Content is normalized before hashing so
 * cosmetic differences (case, whitespace) don't defeat dedup.
 */

import { describe, it, expect } from 'vitest';
import {
  buildDedupKey,
  dedupWindowSeconds,
  normalizeForDedup,
} from '../../../supabase/functions/_shared/copilot-v2/dedup-lock.ts';

describe('normalizeForDedup', () => {
  it('lowercases, trims and collapses whitespace', () => {
    expect(normalizeForDedup('  Olá   MUNDO  ')).toBe('olá mundo');
  });
  it('returns empty string for blank', () => {
    expect(normalizeForDedup('   ')).toBe('');
  });
});

describe('buildDedupKey', () => {
  const argsA = { orgId: 'org-1', phone: '11987654321', content: 'quero um orçamento', source: 'inbound' as const };

  it('is stable for identical input', () => {
    expect(buildDedupKey(argsA)).toBe(buildDedupKey({ ...argsA }));
  });

  it('ignores cosmetic content differences (case/whitespace)', () => {
    const argsB = { ...argsA, content: '  QUERO  um   Orçamento ' };
    expect(buildDedupKey(argsB)).toBe(buildDedupKey(argsA));
  });

  it('differs when content differs', () => {
    expect(buildDedupKey({ ...argsA, content: 'outra coisa' })).not.toBe(buildDedupKey(argsA));
  });

  it('differs across organizations even with identical phone+content (multi-tenant isolation)', () => {
    expect(buildDedupKey({ ...argsA, orgId: 'org-2' })).not.toBe(buildDedupKey(argsA));
  });

  it('differs across phones', () => {
    expect(buildDedupKey({ ...argsA, phone: '11999990000' })).not.toBe(buildDedupKey(argsA));
  });
});

describe('dedupWindowSeconds', () => {
  it('returns a positive window per source', () => {
    expect(dedupWindowSeconds('inbound')).toBeGreaterThan(0);
    expect(dedupWindowSeconds('outbound')).toBeGreaterThan(0);
  });
});
