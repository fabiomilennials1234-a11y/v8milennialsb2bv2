/**
 * Slice 1-H #52 — capability gate reads REAL per-agent flags, fail-CLOSED.
 *
 * The worker's capsFor() returned all 7 write caps true for any active agent,
 * fully opening the server-side gate that exists to stop the LLM. Caps now come
 * from copilot_v2_config.slots.capabilities; unset = none enabled (fail-closed).
 */
import { describe, it, expect } from 'vitest';
import {
  resolveAgentCapabilities,
  decideCapabilityGate,
  ALL_WRITE_CAPABILITIES,
} from '../../../supabase/functions/_shared/copilot-v2/capability-gate.ts';

describe('resolveAgentCapabilities — fail-CLOSED', () => {
  it('disables EVERY write capability when slots are unset', () => {
    const caps = resolveAgentCapabilities(null);
    for (const flag of ALL_WRITE_CAPABILITIES) expect(caps[flag]).toBe(false);
    expect(decideCapabilityGate({ tool: 'move_lead_stage', capabilities: caps }))
      .toEqual({ allowed: false, reason: 'capability_off' });
  });

  it('enables only the flags explicitly set true', () => {
    const caps = resolveAgentCapabilities({ capabilities: { can_move_stage: true, can_send_media: false } });
    expect(caps.can_move_stage).toBe(true);
    expect(caps.can_send_media).toBe(false);
    expect(caps.can_handoff).toBe(false); // unset → off
    expect(decideCapabilityGate({ tool: 'move_lead_stage', capabilities: caps }))
      .toEqual({ allowed: true, reason: null });
    expect(decideCapabilityGate({ tool: 'send_media', capabilities: caps }))
      .toEqual({ allowed: false, reason: 'capability_off' });
  });

  it('treats a truthy-but-not-true value as OFF (no coercion, fail-closed)', () => {
    const caps = resolveAgentCapabilities({ capabilities: { can_transfer: 'yes', can_set_tier: 1 } as any });
    expect(caps.can_transfer).toBe(false);
    expect(caps.can_set_tier).toBe(false);
  });

  it('handles a non-object slot without throwing', () => {
    expect(() => resolveAgentCapabilities('garbage' as any)).not.toThrow();
    const caps = resolveAgentCapabilities('garbage' as any);
    for (const flag of ALL_WRITE_CAPABILITIES) expect(caps[flag]).toBe(false);
  });
});
