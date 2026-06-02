/**
 * Slice 5 — HITL approval gate (Copilot v2). ADR-0002 #7.
 *
 * Per-org toggle, default OFF. When ON and a critical action targets a
 * high-value lead, the turn requires human approval before acting. Pure +
 * fail-CLOSED: ON + unknown criticality → requires approval (never auto-acts).
 */
import { describe, it, expect } from 'vitest';
import {
  decideHitlGate,
  CRITICAL_TOOLS,
  HIGH_VALUE_TIERS,
} from '../../../supabase/functions/_shared/copilot-v2/hitl-gate.ts';

describe('decideHitlGate', () => {
  it('passes when HITL is OFF (default org posture)', () => {
    expect(decideHitlGate({ enabled: false, toolNames: ['transfer_to_human'], leadTier: 'diamante' }))
      .toEqual({ requiresApproval: false, reason: null });
  });

  it('requires approval: HITL ON + critical tool + high-value lead', () => {
    const d = decideHitlGate({ enabled: true, toolNames: ['schedule_meeting'], leadTier: 'ouro' });
    expect(d.requiresApproval).toBe(true);
    expect(d.reason).toBe('hitl_approval_required');
  });

  it('passes when HITL ON but no critical tool was proposed', () => {
    expect(decideHitlGate({ enabled: true, toolNames: ['get_lead_360'], leadTier: 'diamante' }))
      .toEqual({ requiresApproval: false, reason: null });
  });

  it('passes when HITL ON + critical tool but lead is low value', () => {
    expect(decideHitlGate({ enabled: true, toolNames: ['send_media'], leadTier: 'bronze' }))
      .toEqual({ requiresApproval: false, reason: null });
  });

  it('fail-CLOSED: HITL ON + critical tool + unknown tier → requires approval', () => {
    expect(decideHitlGate({ enabled: true, toolNames: ['transfer_to_human'], leadTier: null }).requiresApproval)
      .toBe(true);
  });

  it('exposes the configurable critical set + high-value tiers', () => {
    expect(CRITICAL_TOOLS.has('transfer_to_human')).toBe(true);
    expect(HIGH_VALUE_TIERS.has('diamante')).toBe(true);
  });
});
