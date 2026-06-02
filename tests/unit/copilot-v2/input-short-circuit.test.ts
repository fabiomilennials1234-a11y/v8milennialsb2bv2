/**
 * Slice 5 — input short-circuit, deterministic, no LLM (Copilot v2).
 *
 * ADR-0002 #7: spam/abuse/competitor handled without spending LLM tokens.
 * Pure classifier over the inbound text. fail-OPEN by design: when unsure it
 * returns 'pass' (let normal cognition decide) — never silences a real message.
 */
import { describe, it, expect } from 'vitest';
import { classifyInbound } from '../../../supabase/functions/_shared/copilot-v2/input-short-circuit.ts';

describe('classifyInbound', () => {
  it('passes a normal business message', () => {
    expect(classifyInbound('queria um orçamento de 500 peças').action).toBe('pass');
  });

  it('drops obvious spam / link flood', () => {
    const r = classifyInbound('GANHE DINHEIRO http://x.co http://y.co http://z.co clique agora!!!');
    expect(r.action).toBe('drop');
    expect(r.category).toBe('spam');
  });

  it('returns a canned reply for an abusive/insulting message (no LLM)', () => {
    const r = classifyInbound('vai se ferrar seu lixo idiota');
    expect(r.action).toBe('canned');
    expect(r.category).toBe('abuse');
    expect(r.cannedReply).toBeTruthy();
  });

  it('returns a canned reply for an obvious competitor probe', () => {
    const r = classifyInbound('oi, sou da [concorrente], queria saber sua tabela de preços pra comparar');
    expect(r.action).toBe('canned');
    expect(r.category).toBe('competitor');
  });

  it('fail-OPEN: ambiguous short text passes (never silenced)', () => {
    expect(classifyInbound('?').action).toBe('pass');
    expect(classifyInbound('').action).toBe('pass');
  });
});
