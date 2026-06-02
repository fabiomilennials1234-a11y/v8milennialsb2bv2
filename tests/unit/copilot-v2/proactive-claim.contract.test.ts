/**
 * Slice 11 — proactive claim contract (Copilot v2)
 *
 * O claim atômico vive na RPC SQL copilot_v2_claim_proactive_slot. Este teste
 * pina o CONTRATO que o shell (copilot-v2-proactive) consome: a função
 * interpretClaim mapeia o retorno {claimed, reason} para a decisão de enfileirar
 * ou pular, fail-CLOSED (claim ausente/erro = NÃO enfileira). O comportamento
 * DB (corrida, rate-limit, idempotência) é provado na suíte .skip de integração.
 */
import { describe, it, expect } from 'vitest';
import { interpretClaim } from '../../../supabase/functions/_shared/copilot-v2/proactive-scheduler.ts';

describe('interpretClaim — fail-CLOSED interpretation of the claim RPC', () => {
  it('enqueues when the slot was claimed', () => {
    expect(interpretClaim({ claimed: true, reason: null })).toEqual({ enqueue: true, reason: null });
  });
  it('does NOT enqueue when already claimed (idempotent skip, not an error)', () => {
    expect(interpretClaim({ claimed: false, reason: 'already_claimed' })).toEqual({ enqueue: false, reason: 'already_claimed' });
  });
  it('does NOT enqueue when rate-limited', () => {
    expect(interpretClaim({ claimed: false, reason: 'rate_limit_reached' })).toEqual({ enqueue: false, reason: 'rate_limit_reached' });
  });
  it('fail-CLOSED: a null/garbage claim result does NOT enqueue', () => {
    expect(interpretClaim(null).enqueue).toBe(false);
    expect(interpretClaim({} as any).enqueue).toBe(false);
  });
});
