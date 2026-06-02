/**
 * Slice 5 — output LLM-as-judge gate, fail-CLOSED + amostragem (Copilot v2).
 *
 * ADR-0002 #7: um modelo barato veta preço/promessa/credencial/tom não
 * autorizado ANTES do envio. O gate é puro e fail-CLOSED: um judge que errou
 * bloqueia o envio (nunca libera uma resposta não verificada). A amostragem
 * por custo é pura e determinística (rng injetado).
 */
import { describe, it, expect } from 'vitest';
import {
  decideOutputJudge,
  shouldSampleJudge,
  type JudgeVerdict,
} from '../../../supabase/functions/_shared/copilot-v2/output-judge.ts';

describe('decideOutputJudge — fail-CLOSED', () => {
  it('allows a clean reply', () => {
    const v: JudgeVerdict = { violation: false, category: null };
    expect(decideOutputJudge({ verdict: v, checkErrored: false }))
      .toEqual({ block: false, reason: null });
  });

  it('blocks a reply the judge flagged (forbidden promise/price/credential/tone)', () => {
    const v: JudgeVerdict = { violation: true, category: 'forbidden_promise' };
    expect(decideOutputJudge({ verdict: v, checkErrored: false }))
      .toEqual({ block: true, reason: 'output_judge:forbidden_promise' });
  });

  it('fail-CLOSED: a judge error blocks the send (never ships unverified)', () => {
    expect(decideOutputJudge({ verdict: null, checkErrored: true }))
      .toEqual({ block: true, reason: 'output_judge_check_failed' });
  });

  it('fail-CLOSED: a null verdict with no error is treated as a failed check', () => {
    expect(decideOutputJudge({ verdict: null, checkErrored: false }))
      .toEqual({ block: true, reason: 'output_judge_check_failed' });
  });
});

describe('shouldSampleJudge — cost sampling (deterministic)', () => {
  it('always samples at rate 1.0 (conservative default)', () => {
    expect(shouldSampleJudge({ rng: () => 0.99, rate: 1.0 })).toBe(true);
  });
  it('never samples at rate 0', () => {
    expect(shouldSampleJudge({ rng: () => 0.0, rate: 0 })).toBe(false);
  });
  it('samples when rng < rate', () => {
    expect(shouldSampleJudge({ rng: () => 0.4, rate: 0.5 })).toBe(true);
    expect(shouldSampleJudge({ rng: () => 0.6, rate: 0.5 })).toBe(false);
  });
});
