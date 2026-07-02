import { describe, it, expect } from 'vitest';
import { reduceQueueItem, MAX_ATTEMPTS, isClaimable } from '../../../supabase/functions/_shared/copilot/queue-policy';

const NOW = new Date('2026-06-24T12:00:00.000Z');
const LEASE = 120;

describe('queue-policy — reduceQueueItem', () => {
  it('entrega bem-sucedida → status done + processed_at', () => {
    const next = reduceQueueItem(
      { status: 'processing', attempts: 1 },
      { kind: 'delivered' },
      NOW,
    );
    expect(next.status).toBe('done');
    expect(next.processed_at).toBe(NOW.toISOString());
  });

  it('erro transiente abaixo do limite → volta a pending, attempts+1, agenda retry com backoff', () => {
    const next = reduceQueueItem(
      { status: 'processing', attempts: 1 },
      { kind: 'transient_error', error: 'uazapi 503' },
      NOW,
    );
    expect(next.status).toBe('pending');
    expect(next.attempts).toBe(2);
    expect(next.last_error).toBe('uazapi 503');
    // backoff cresce com a tentativa; next_attempt_at no futuro
    expect(new Date(next.next_attempt_at!).getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('erro transiente atingindo o limite → falha terminal (sem reagendar)', () => {
    const next = reduceQueueItem(
      { status: 'processing', attempts: MAX_ATTEMPTS - 1 },
      { kind: 'transient_error', error: 'uazapi 503' },
      NOW,
    );
    expect(next.status).toBe('failed');
    expect(next.attempts).toBe(MAX_ATTEMPTS);
    expect(next.last_error).toBe('uazapi 503');
    expect(next.next_attempt_at).toBeUndefined();
    expect(next.processed_at).toBe(NOW.toISOString());
  });

  it('gate bloqueado (IA off / humano assumiu) → done, sem retry', () => {
    const next = reduceQueueItem(
      { status: 'processing', attempts: 1 },
      { kind: 'gate_blocked', source: 'human_pause' },
      NOW,
    );
    expect(next.status).toBe('done');
    expect(next.processed_at).toBe(NOW.toISOString());
    expect(next.next_attempt_at).toBeUndefined();
  });
});

describe('queue-policy — isClaimable', () => {
  it('pending sem next_attempt_at → claimable', () => {
    expect(isClaimable(
      { status: 'pending', attempts: 0, next_attempt_at: null, claimed_at: null },
      NOW, LEASE,
    )).toBe(true);
  });
});

describe('queue-policy — isClaimable backoff', () => {
  it('pending com next_attempt_at no futuro → NÃO claimable', () => {
    const future = new Date(NOW.getTime() + 60_000).toISOString();
    expect(isClaimable(
      { status: 'pending', attempts: 2, next_attempt_at: future, claimed_at: null },
      NOW, LEASE,
    )).toBe(false);
  });
  it('pending com next_attempt_at no passado → claimable', () => {
    const past = new Date(NOW.getTime() - 1_000).toISOString();
    expect(isClaimable(
      { status: 'pending', attempts: 2, next_attempt_at: past, claimed_at: null },
      NOW, LEASE,
    )).toBe(true);
  });
});

describe('queue-policy — isClaimable reclaim de processing preso', () => {
  it('processing além do lease (worker morreu) → reclaimable', () => {
    const oldClaim = new Date(NOW.getTime() - (LEASE + 10) * 1000).toISOString();
    expect(isClaimable(
      { status: 'processing', attempts: 1, next_attempt_at: null, claimed_at: oldClaim },
      NOW, LEASE,
    )).toBe(true);
  });
  it('processing dentro do lease (worker ativo) → NÃO reclaimable', () => {
    const recentClaim = new Date(NOW.getTime() - 5_000).toISOString();
    expect(isClaimable(
      { status: 'processing', attempts: 1, next_attempt_at: null, claimed_at: recentClaim },
      NOW, LEASE,
    )).toBe(false);
  });
  it('done nunca é claimable', () => {
    expect(isClaimable(
      { status: 'done', attempts: 1, next_attempt_at: null, claimed_at: null },
      NOW, LEASE,
    )).toBe(false);
  });
});
