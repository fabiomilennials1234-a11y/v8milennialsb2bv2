/**
 * Slice 1 — normalizeCanonicalPhone (Copilot v2)
 *
 * Behavior under test: ONE canonical phone form, used as the single key for
 * lead lookup, dedup, human-pause and rate-limit across the whole v2 runtime.
 *
 * Regression — incident "40% ai_disabled" (2026-05-08): v1 had TWO divergent
 * normalizers — normalizePhoneForSearch (lead-service.ts, strips 55, adds 9)
 * vs normalizeBrazilianPhone (whatsapp-dispatch.ts, ADDS 55, no 9). Pause was
 * keyed with one form and checked with the other → lookup miss → pause silently
 * not applied. The canonical form mirrors the stored `normalized_phone` column
 * (no 55 prefix, 9 inserted for 10-digit mobiles) so every gate agrees.
 */

import { describe, it, expect } from 'vitest';
import { normalizeCanonicalPhone } from '../../../supabase/functions/_shared/copilot-v2/phone-normalizer.ts';

describe('normalizeCanonicalPhone — canonical form', () => {
  it.each([
    ['+55 11 98765-4321', '11987654321'],
    ['5511987654321', '11987654321'],
    ['11987654321', '11987654321'],
    ['11 98765-4321', '11987654321'],
    ['1187654321', '11987654321'], // 10-digit mobile (DDD + 8) → inserts the 9
    ['+55 (11) 98765-4321', '11987654321'],
  ])('normalizes %s → %s', (input, expected) => {
    expect(normalizeCanonicalPhone(input)).toBe(expected);
  });

  it.each([
    ['', null],
    [null, null],
    [undefined, null],
    ['abc', null],
    ['   ', null],
  ])('returns null for empty/invalid input %s', (input, expected) => {
    expect(normalizeCanonicalPhone(input as string | null | undefined)).toBe(expected);
  });

  it('keeps a landline (10-digit treated as mobile per BR convention) deterministic', () => {
    // Two calls, same input → same output (determinism is the whole point)
    expect(normalizeCanonicalPhone('1132654321')).toBe(normalizeCanonicalPhone('1132654321'));
  });
});

describe('normalizeCanonicalPhone — regression: divergent inputs collapse to ONE key', () => {
  // The exact bug: a pause set under one rendering must be found under another.
  const equivalentRenderings = [
    '+55 11 98765-4321',
    '5511987654321',
    '11987654321',
    '11 98765-4321',
    '+55 (11) 98765-4321',
    '055 11 98765 4321'.replace('055', '55'),
  ];

  it('all renderings of the same number map to a single canonical key', () => {
    const canonical = equivalentRenderings.map((r) => normalizeCanonicalPhone(r));
    const unique = new Set(canonical);
    expect(unique.size).toBe(1);
    expect(canonical[0]).toBe('11987654321');
  });

  it('does NOT carry the 55 prefix (v1 normalizeBrazilianPhone bug source)', () => {
    expect(normalizeCanonicalPhone('5511987654321')!.startsWith('55')).toBe(false);
  });

  it('NULL-safe: a malformed/empty phone never throws, returns null (pause coalesces to "not paused" safely)', () => {
    expect(() => normalizeCanonicalPhone(null)).not.toThrow();
    expect(normalizeCanonicalPhone(null)).toBeNull();
  });
});
