import { describe, it, expect } from 'vitest';
import { webcrypto } from 'node:crypto';

// The helper uses Web Crypto (crypto.subtle.digest / crypto.getRandomValues).
// jsdom's global `crypto` may lack `subtle`; inject Node's real webcrypto so the
// SHA-256 assertions below exercise the real algorithm (not a stubbed digest).
if (!globalThis.crypto?.subtle) {
  (globalThis as unknown as { crypto: Crypto }).crypto = webcrypto as unknown as Crypto;
}

import {
  PWD_RE,
  RESET_TOKEN_TTL_MS,
  generateRawToken,
  hashRawToken,
  isResetTokenUsable,
  isStrongPassword,
  isValidEmail,
  resetTokenExpiryFromNow,
  sha256Hex,
} from '../../supabase/functions/_shared/password-reset';

describe('sha256Hex / hashRawToken', () => {
  it('matches the known SHA-256 vector for "abc"', async () => {
    // FIPS 180-2 test vector.
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('is deterministic — same input, same hash', async () => {
    const a = await sha256Hex('torque-reset-token');
    const b = await sha256Hex('torque-reset-token');
    expect(a).toBe(b);
  });

  it('is sensitive — different input, different hash', async () => {
    expect(await sha256Hex('token-a')).not.toBe(await sha256Hex('token-b'));
  });

  it('produces 64 lowercase hex chars', async () => {
    const h = await hashRawToken('whatever');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('generateRawToken', () => {
  it('returns 64 hex chars (32 random bytes)', () => {
    expect(generateRawToken()).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is unique across calls (high entropy)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(generateRawToken());
    expect(seen.size).toBe(1000);
  });
});

describe('isValidEmail', () => {
  it.each(['user@example.com', 'a.b+c@torquecrm.com.br', 'x@y.io'])(
    'accepts %s',
    (email) => expect(isValidEmail(email)).toBe(true),
  );

  it.each(['', '   ', 'no-at', 'a@b', 'a@@b.com', 'spaces in@x.com', 'a@b.'])(
    'rejects %s',
    (email) => expect(isValidEmail(email)).toBe(false),
  );

  it('rejects non-string input', () => {
    expect(isValidEmail(undefined as unknown as string)).toBe(false);
    expect(isValidEmail(null as unknown as string)).toBe(false);
  });
});

describe('isStrongPassword / PWD_RE', () => {
  it('accepts a 12+ char password with all classes', () => {
    expect(isStrongPassword('Abcdef1!ghij')).toBe(true);
    expect(PWD_RE.test('Abcdef1!ghij')).toBe(true);
  });

  it.each([
    ['too short', 'Ab1!efgh'],
    ['no uppercase', 'abcdef1!ghij'],
    ['no lowercase', 'ABCDEF1!GHIJ'],
    ['no digit', 'Abcdefgh!ijk'],
    ['no special', 'Abcdef1ghijk'],
  ])('rejects %s', (_label, pw) => {
    expect(isStrongPassword(pw)).toBe(false);
  });

  it('stays byte-identical to the frontend policy source', () => {
    // Guards against drift between this regex and src/lib/password-validation.ts.
    expect(PWD_RE.source).toBe(
      "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[!@#$%^&*()_+\\-=\\[\\]{}|;:',.<>?]).{12,}$",
    );
  });
});

describe('resetTokenExpiryFromNow', () => {
  it('is exactly 1h after the given now', () => {
    const now = Date.parse('2026-07-06T12:00:00.000Z');
    expect(resetTokenExpiryFromNow(now)).toBe('2026-07-06T13:00:00.000Z');
    expect(RESET_TOKEN_TTL_MS).toBe(3_600_000);
  });
});

describe('isResetTokenUsable (pure expiry/single-use decision)', () => {
  const now = Date.parse('2026-07-06T12:00:00.000Z');

  it('usable when unused and not expired', () => {
    expect(isResetTokenUsable({ used_at: null, expires_at: '2026-07-06T12:30:00.000Z' }, now)).toBe(true);
  });

  it('NOT usable when already used', () => {
    expect(
      isResetTokenUsable({ used_at: '2026-07-06T11:59:00.000Z', expires_at: '2026-07-06T12:30:00.000Z' }, now),
    ).toBe(false);
  });

  it('NOT usable when expired', () => {
    expect(isResetTokenUsable({ used_at: null, expires_at: '2026-07-06T11:00:00.000Z' }, now)).toBe(false);
  });

  it('NOT usable exactly at expiry (strict >)', () => {
    expect(isResetTokenUsable({ used_at: null, expires_at: '2026-07-06T12:00:00.000Z' }, now)).toBe(false);
  });

  it('NOT usable when expires_at is unparseable', () => {
    expect(isResetTokenUsable({ used_at: null, expires_at: 'not-a-date' }, now)).toBe(false);
  });
});
