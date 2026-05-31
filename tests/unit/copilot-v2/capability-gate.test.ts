/**
 * Slice 2/5 — capability-gate + tool-call budget (Copilot v2)
 *
 * Regression — ADR-0002 instability fix #1: in v1 the can_* capabilities were
 * loaded but NEVER gated actions at runtime (the LLM could call SCHEDULE_MEETING
 * with can_schedule_meeting=false). And there was no tool-call budget (the
 * multi-step loop was unbounded → token burn / loops).
 *
 * Enforcement is server-side and fail-CLOSED: an unknown tool is blocked, and a
 * write whose capability is off is blocked + logged. The LLM is never trusted to
 * respect a flag.
 */

import { describe, it, expect } from 'vitest';
import {
  decideCapabilityGate,
  decideToolCallBudget,
  TOOL_CALL_BUDGET,
} from '../../../supabase/functions/_shared/copilot-v2/capability-gate.ts';

describe('decideCapabilityGate', () => {
  const allOn = {
    can_move_stage: true, can_schedule_meeting: true, can_set_tier: true,
    can_fill_field: true, can_send_media: true, can_transfer: true, can_handoff: true,
  };

  it('allows a read/introspect tool regardless of capabilities', () => {
    expect(decideCapabilityGate({ tool: 'get_lead_360', capabilities: {} }).allowed).toBe(true);
    expect(decideCapabilityGate({ tool: 'list_pipeline_stages', capabilities: {} }).allowed).toBe(true);
  });

  it('allows a write tool when its capability is on', () => {
    expect(decideCapabilityGate({ tool: 'move_lead_stage', capabilities: allOn }).allowed).toBe(true);
  });

  it('blocks a write tool when its capability is off (LLM cannot override)', () => {
    const gate = decideCapabilityGate({ tool: 'schedule_meeting', capabilities: { ...allOn, can_schedule_meeting: false } });
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe('capability_off');
  });

  it('blocks a write tool when the capability flag is missing (fail-closed)', () => {
    const gate = decideCapabilityGate({ tool: 'send_media', capabilities: {} });
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe('capability_off');
  });

  it('blocks an unknown tool (fail-closed)', () => {
    const gate = decideCapabilityGate({ tool: 'drop_database', capabilities: allOn });
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe('unknown_tool');
  });
});

describe('decideToolCallBudget', () => {
  it('allows calls below the budget', () => {
    expect(decideToolCallBudget({ callsThisTurn: 0 }).allowed).toBe(true);
    expect(decideToolCallBudget({ callsThisTurn: TOOL_CALL_BUDGET - 1 }).allowed).toBe(true);
  });

  it('blocks at the budget ceiling (cuts the loop, returns to the lead)', () => {
    const gate = decideToolCallBudget({ callsThisTurn: TOOL_CALL_BUDGET });
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe('budget_exceeded');
  });

  it('honors a custom budget', () => {
    expect(decideToolCallBudget({ callsThisTurn: 2, max: 2 }).allowed).toBe(false);
  });
});
