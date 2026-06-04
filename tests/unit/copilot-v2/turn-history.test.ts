/**
 * Slice 12 — turn message assembly with conversation history (W2-lite).
 *
 * Today the v2 turn sees only the current inbound. The cutover injects recent
 * shared-transcript history into every turn. The critical invariant: with NO
 * history (eval/sim build ResolvedContext with history=[]), the assembled
 * messages are byte-identical to the legacy single-message turn — so the
 * W13/W12 eval + red-team goldens stay intact (no re-bless).
 */

import { describe, it, expect } from 'vitest';
import {
  buildTurnMessages,
  whatsappRowsToHistory,
  dropTrailingCurrent,
} from '../../../supabase/functions/_shared/copilot-v2/turn-history.ts';

describe('buildTurnMessages', () => {
  it('with empty history is byte-identical to the legacy single-message turn (eval-safe)', () => {
    expect(buildTurnMessages([], 'oi, quero saber o preço')).toEqual([
      { role: 'user', content: 'oi, quero saber o preço' },
    ]);
  });

  it('prepends prior history in order and appends the current inbound last as user', () => {
    const history = [
      { role: 'user' as const, content: 'bom dia' },
      { role: 'assistant' as const, content: 'Bom dia! Como posso ajudar?' },
    ];
    expect(buildTurnMessages(history, 'quero um orçamento')).toEqual([
      { role: 'user', content: 'bom dia' },
      { role: 'assistant', content: 'Bom dia! Como posso ajudar?' },
      { role: 'user', content: 'quero um orçamento' },
    ]);
  });

  it('keeps only the most recent maxTurns history messages', () => {
    const history = [
      { role: 'user' as const, content: 'm1' },
      { role: 'assistant' as const, content: 'm2' },
      { role: 'user' as const, content: 'm3' },
      { role: 'assistant' as const, content: 'm4' },
    ];
    expect(buildTurnMessages(history, 'now', 2)).toEqual([
      { role: 'user', content: 'm3' },
      { role: 'assistant', content: 'm4' },
      { role: 'user', content: 'now' },
    ]);
  });

  it('drops blank/whitespace-only history entries (mirrors v1 transcript filtering)', () => {
    const history = [
      { role: 'user' as const, content: '   ' },
      { role: 'assistant' as const, content: '' },
      { role: 'user' as const, content: 'real message' },
    ];
    expect(buildTurnMessages(history, 'now')).toEqual([
      { role: 'user', content: 'real message' },
      { role: 'user', content: 'now' },
    ]);
  });
});

describe('whatsappRowsToHistory', () => {
  it('maps the engine-agnostic whatsapp_messages rows to history (incoming→user, outgoing→assistant) and drops blanks', () => {
    const rows = [
      { direction: 'incoming', content: 'oi' },
      { direction: 'outgoing', content: 'Olá! Como posso ajudar?' },
      { direction: 'incoming', content: '   ' },
      { direction: 'incoming', content: null },
    ];
    expect(whatsappRowsToHistory(rows)).toEqual([
      { role: 'user', content: 'oi' },
      { role: 'assistant', content: 'Olá! Como posso ajudar?' },
    ]);
  });
});

describe('dropTrailingCurrent', () => {
  it('drops the just-arrived inbound from the tail (the webhook already persisted it to whatsapp_messages)', () => {
    const h = [
      { role: 'user' as const, content: 'oi' },
      { role: 'assistant' as const, content: 'Olá' },
      { role: 'user' as const, content: 'quero preço' },
    ];
    expect(dropTrailingCurrent(h, 'quero preço')).toEqual([
      { role: 'user', content: 'oi' },
      { role: 'assistant', content: 'Olá' },
    ]);
  });

  it('leaves history intact when the tail is not the current message', () => {
    const h = [{ role: 'user' as const, content: 'oi' }];
    expect(dropTrailingCurrent(h, 'quero preço')).toEqual([{ role: 'user', content: 'oi' }]);
  });
});
