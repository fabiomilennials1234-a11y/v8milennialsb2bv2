/**
 * Slice 3 — agenda: cálculo puro de slots livres + decisão de agendamento (Copilot v2)
 *
 * O handler check_agenda_availability resolve a agenda via Google freeBusy (I/O);
 * este módulo é a decisão PURA: a partir dos intervalos ocupados + janela desejada,
 * computa os horários livres (ISO) que vão pra introspection.slots; e decide se um
 * datetime proposto é agendável. Fail-CLOSED: fora dos livres / no passado -> bloqueia.
 */
import { describe, it, expect } from 'vitest';
import { computeFreeSlots, decideScheduleSlot } from '../../../supabase/functions/_shared/copilot-v2/agenda.ts';

const NOW = new Date('2026-06-10T09:00:00-03:00');

describe('computeFreeSlots', () => {
  it('retorna os slots de 60min livres na janela, excluindo os ocupados', () => {
    const slots = computeFreeSlots({
      busy: [{ start: '2026-06-10T10:00:00-03:00', end: '2026-06-10T11:00:00-03:00' }],
      window: { start: '2026-06-10T09:00:00-03:00', end: '2026-06-10T12:00:00-03:00' },
      slotMinutes: 60,
      now: NOW,
    });
    expect(slots).toEqual([
      '2026-06-10T09:00:00.000-03:00',
      '2026-06-10T11:00:00.000-03:00',
    ]);
  });

  it('nunca propõe um slot no passado (fail-safe)', () => {
    const slots = computeFreeSlots({
      busy: [],
      window: { start: '2026-06-10T08:00:00-03:00', end: '2026-06-10T11:00:00-03:00' },
      slotMinutes: 60,
      now: NOW, // 09:00 — o slot das 08:00 é passado
    });
    expect(slots).not.toContain('2026-06-10T08:00:00.000-03:00');
    expect(slots[0]).toBe('2026-06-10T09:00:00.000-03:00');
  });

  it('janela inválida (end <= start) → lista vazia (nunca lança)', () => {
    expect(computeFreeSlots({ busy: [], window: { start: 'x', end: 'y' }, slotMinutes: 60, now: NOW })).toEqual([]);
  });
});

describe('decideScheduleSlot — fail-CLOSED', () => {
  const freeSlots = ['2026-06-10T11:00:00.000-03:00', '2026-06-10T14:00:00.000-03:00'];
  it('permite um datetime exatamente igual a um slot livre', () => {
    expect(decideScheduleSlot({ datetime: '2026-06-10T11:00:00.000-03:00', freeSlots, now: NOW }))
      .toEqual({ ok: true, reason: null });
  });
  it('bloqueia datetime que não está nos slots livres', () => {
    expect(decideScheduleSlot({ datetime: '2026-06-10T15:00:00.000-03:00', freeSlots, now: NOW }))
      .toEqual({ ok: false, reason: 'slot_not_available' });
  });
  it('bloqueia datetime no passado', () => {
    expect(decideScheduleSlot({ datetime: '2026-06-10T08:00:00.000-03:00', freeSlots, now: NOW }))
      .toEqual({ ok: false, reason: 'slot_in_past' });
  });
  it('bloqueia datetime malformado', () => {
    expect(decideScheduleSlot({ datetime: 'amanhã de tarde', freeSlots, now: NOW }))
      .toEqual({ ok: false, reason: 'invalid_datetime' });
  });
});
