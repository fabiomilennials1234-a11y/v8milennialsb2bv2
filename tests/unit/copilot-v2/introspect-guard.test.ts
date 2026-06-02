/**
 * Slice 3 — write-after-introspect guard (Copilot v2)
 *
 * ADR-0002 decision #6: every write tool is preceded by an introspection read
 * that pulls the LIVE system structure, and the write target must exist in that
 * introspection. This structurally kills the orphaned-stage / orphaned-field bug
 * class (the LLM moving a lead to a stage that doesn't exist, etc).
 *
 * Fail-CLOSED: a write with no introspection performed is blocked.
 */

import { describe, it, expect } from 'vitest';
import { assertWriteTarget } from '../../../supabase/functions/_shared/copilot-v2/introspect-guard.ts';
import { writeTargetOf } from '../../../supabase/functions/_shared/copilot-v2/tool-registry.ts';

describe('assertWriteTarget — move_lead_stage', () => {
  const introspected = { stages: ['novo_lead', 'abordado', 'respondeu'], fields: [], slots: [] };

  it('allows a move to a stage present in the introspection', () => {
    const r = assertWriteTarget({ tool: 'move_lead_stage', target: 'abordado', introspected });
    expect(r.ok).toBe(true);
  });

  it('blocks a move to a stage absent from the introspection (orphaned stage)', () => {
    const r = assertWriteTarget({ tool: 'move_lead_stage', target: 'fechado', introspected });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('orphaned_target');
  });

  it('blocks when no introspection was performed (fail-closed)', () => {
    const r = assertWriteTarget({ tool: 'move_lead_stage', target: 'abordado', introspected: null });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('missing_introspect');
  });
});

describe('assertWriteTarget — fill_lead_field', () => {
  const introspected = { stages: [], fields: ['cnpj', 'faturamento_mensal'], slots: [] };

  it('allows filling a field present in the introspection', () => {
    expect(assertWriteTarget({ tool: 'fill_lead_field', target: 'cnpj', introspected }).ok).toBe(true);
  });

  it('blocks filling a field absent from the introspection (orphaned field)', () => {
    const r = assertWriteTarget({ tool: 'fill_lead_field', target: 'inexistente', introspected });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('orphaned_target');
  });
});

describe('assertWriteTarget — tools without a structural target', () => {
  it('allows transfer_to_human (no introspectable target) once introspection exists', () => {
    const r = assertWriteTarget({ tool: 'transfer_to_human', target: null, introspected: { stages: [], fields: [], slots: [] } });
    expect(r.ok).toBe(true);
  });
});

describe('assertWriteTarget — schedule_meeting (write-after-introspect de agenda)', () => {
  const introspected = { stages: ['abordado'], fields: ['cnpj'], slots: ['2026-06-10T14:00:00-03:00'] };

  it('permite agendar num horário que check_agenda_availability introspectou como livre', () => {
    expect(assertWriteTarget({ tool: 'schedule_meeting', target: '2026-06-10T14:00:00-03:00', introspected }))
      .toEqual({ ok: true, reason: null });
  });

  it('BLOQUEIA (orphaned_target) agendar num horário que nunca foi introspectado', () => {
    expect(assertWriteTarget({ tool: 'schedule_meeting', target: '2026-06-10T18:00:00-03:00', introspected }))
      .toEqual({ ok: false, reason: 'orphaned_target' });
  });

  it('fail-CLOSED: schedule_meeting sem introspecção alguma → missing_introspect', () => {
    expect(assertWriteTarget({ tool: 'schedule_meeting', target: '2026-06-10T14:00:00-03:00', introspected: null }))
      .toEqual({ ok: false, reason: 'missing_introspect' });
  });
});
