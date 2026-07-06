/**
 * Self-hosted password reset — DB security surface (migration
 * 20270107000000_password_reset_tokens.sql).
 *
 * Runs in CI `integration-tests` (local Supabase + seed + migrations). Covers the
 * invariants the edge functions depend on:
 *   - claim_password_reset_token is atomic single-use, honors expiry, and returns
 *     NULL for invalid/expired/used/nonexistent tokens (the happy path is
 *     "mint → claim returns the user_id", which is exactly what reset-password does
 *     before swapping the password via the admin API);
 *   - check_auth_rate_limit increments per (ip,endpoint) and blocks past the max;
 *   - both tables are RLS deny-all (no anon/authenticated access).
 *
 * NOT covered here (deploy-time / HTTP canary, mirrors crm-mcp §8.7): the full
 * forgot-password → email → reset-password round-trip incl. the Resend send, the
 * admin-API password swap, and the anti-enumeration identical-response — those need
 * the functions served + RESEND_API_KEY, so they are validated post-deploy, not in
 * this DB-only suite. The password-policy + anti-enumeration message logic is unit
 * tested in tests/unit/password-reset.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { clearClients, createServiceClient, getOrgBMember } from './rls-helpers';

const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex');
const freshToken = () => randomBytes(32).toString('hex');

describe('password reset: claim RPC + rate limit + RLS deny-all', () => {
  const svc = createServiceClient();
  let userId: string;
  const insertedTokenIds: string[] = [];
  const rateLimitKeys: Array<{ ip: string; endpoint: string }> = [];

  async function mintToken(opts: { expiresAt?: string; usedAt?: string | null } = {}) {
    const raw = freshToken();
    const hash = sha256hex(raw);
    const { data, error } = await svc
      .from('password_reset_tokens')
      .insert({
        user_id: userId,
        token_hash: hash,
        expires_at: opts.expiresAt ?? new Date(Date.now() + 3_600_000).toISOString(),
        used_at: opts.usedAt ?? null,
      })
      .select('id')
      .single();
    if (error) throw new Error(`mint token: ${error.message}`);
    insertedTokenIds.push(data.id);
    return { raw, hash, id: data.id };
  }

  beforeAll(async () => {
    const memberb = await getOrgBMember();
    const { data: u } = await memberb.auth.getUser();
    userId = u.user!.id;
  });

  afterAll(async () => {
    if (insertedTokenIds.length) {
      await svc.from('password_reset_tokens').delete().in('id', insertedTokenIds);
    }
    for (const k of rateLimitKeys) {
      await svc.from('auth_rate_limits').delete().eq('ip', k.ip).eq('endpoint', k.endpoint);
    }
    await clearClients();
  });

  it('claim: valid token → user_id; second claim → NULL (atomic single-use)', async () => {
    const { hash } = await mintToken();

    const { data: first, error: e1 } = await svc.rpc('claim_password_reset_token', {
      p_token_hash: hash,
    });
    expect(e1).toBeNull();
    expect(first).toBe(userId);

    const { data: second } = await svc.rpc('claim_password_reset_token', { p_token_hash: hash });
    expect(second).toBeNull(); // already consumed
  });

  it('claim: expired token → NULL', async () => {
    const { hash } = await mintToken({ expiresAt: new Date(Date.now() - 60_000).toISOString() });
    const { data } = await svc.rpc('claim_password_reset_token', { p_token_hash: hash });
    expect(data).toBeNull();
  });

  it('claim: already-used token → NULL', async () => {
    const { hash } = await mintToken({ usedAt: new Date(Date.now() - 60_000).toISOString() });
    const { data } = await svc.rpc('claim_password_reset_token', { p_token_hash: hash });
    expect(data).toBeNull();
  });

  it('claim: nonexistent hash → NULL (no oracle)', async () => {
    const { data } = await svc.rpc('claim_password_reset_token', {
      p_token_hash: sha256hex('never-minted'),
    });
    expect(data).toBeNull();
  });

  it('raw token is never stored — only its SHA-256 hash', async () => {
    const { raw, hash, id } = await mintToken();
    const { data } = await svc
      .from('password_reset_tokens')
      .select('token_hash')
      .eq('id', id)
      .single();
    expect(data!.token_hash).toBe(hash);
    expect(data!.token_hash).not.toBe(raw);
    expect(data!.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rate limit: allows up to p_max, blocks the next, isolates by ip', async () => {
    const ip = `203.0.113.${Math.floor(Math.random() * 254) + 1}`;
    const endpoint = 'forgot-password';
    rateLimitKeys.push({ ip, endpoint });

    // 3-request window for a compact test.
    for (let i = 0; i < 3; i++) {
      const { data } = await svc.rpc('check_auth_rate_limit', {
        p_ip: ip,
        p_endpoint: endpoint,
        p_max: 3,
        p_window: '15 minutes',
      });
      expect(data).toBe(true);
    }
    const { data: blocked } = await svc.rpc('check_auth_rate_limit', {
      p_ip: ip,
      p_endpoint: endpoint,
      p_max: 3,
      p_window: '15 minutes',
    });
    expect(blocked).toBe(false);

    // A different IP has its own bucket.
    const ip2 = `198.51.100.${Math.floor(Math.random() * 254) + 1}`;
    rateLimitKeys.push({ ip: ip2, endpoint });
    const { data: other } = await svc.rpc('check_auth_rate_limit', {
      p_ip: ip2,
      p_endpoint: endpoint,
      p_max: 3,
      p_window: '15 minutes',
    });
    expect(other).toBe(true);
  });

  it('RLS deny-all: authenticated user cannot read password_reset_tokens', async () => {
    await mintToken(); // ensure at least one row exists
    const memberb = await getOrgBMember();
    const { data } = await memberb.from('password_reset_tokens').select('id');
    // No policy + no grant → either a permission error (data null) or zero rows.
    expect((data ?? []).length).toBe(0);
  });

  it('RLS deny-all: authenticated user cannot read auth_rate_limits', async () => {
    const memberb = await getOrgBMember();
    const { data } = await memberb.from('auth_rate_limits').select('id');
    expect((data ?? []).length).toBe(0);
  });
});
