/**
 * Slice 11 — proactive scheduler: business-hours gate (Copilot v2)
 *
 * O proativo INICIA conversa; jamais fora do horário comercial da org
 * (ADR #11). Decisão pura, fail-CLOSED: janela ausente/malformada bloqueia.
 * 'now' é injetado — sem Date.now() interno, testável sem relógio real.
 */
import { describe, it, expect } from 'vitest';
import {
  decideBusinessHoursGate,
  type BusinessHoursWindow,
} from '../../../supabase/functions/_shared/copilot-v2/proactive-scheduler.ts';

const win: BusinessHoursWindow = { days: [1, 2, 3, 4, 5], start: '08:00', end: '18:00', tz: 'America/Sao_Paulo' };
// Segunda-feira 14:00 BRT == 17:00 UTC
const insideUtc = new Date('2026-06-01T17:00:00.000Z');
// Segunda-feira 03:00 BRT == 06:00 UTC
const beforeUtc = new Date('2026-06-01T06:00:00.000Z');
// Domingo 14:00 BRT == 17:00 UTC
const sundayUtc = new Date('2026-05-31T17:00:00.000Z');

describe('decideBusinessHoursGate — fail-CLOSED', () => {
  it('allows inside the window on a business day', () => {
    expect(decideBusinessHoursGate({ window: win, now: insideUtc }))
      .toEqual({ allowed: true, reason: null });
  });

  it('blocks before opening hour', () => {
    expect(decideBusinessHoursGate({ window: win, now: beforeUtc }))
      .toEqual({ allowed: false, reason: 'outside_business_hours' });
  });

  it('blocks on a non-business day (Sunday)', () => {
    expect(decideBusinessHoursGate({ window: win, now: sundayUtc }))
      .toEqual({ allowed: false, reason: 'outside_business_hours' });
  });

  it('fail-CLOSED: a missing window blocks (never fires before config)', () => {
    expect(decideBusinessHoursGate({ window: null, now: insideUtc }))
      .toEqual({ allowed: false, reason: 'no_business_hours_window' });
  });

  it('fail-CLOSED: a malformed window blocks (does not throw)', () => {
    const bad = { days: [1], start: '99:99', end: 'x', tz: 'America/Sao_Paulo' } as BusinessHoursWindow;
    expect(() => decideBusinessHoursGate({ window: bad, now: insideUtc })).not.toThrow();
    expect(decideBusinessHoursGate({ window: bad, now: insideUtc }).allowed).toBe(false);
  });
});
