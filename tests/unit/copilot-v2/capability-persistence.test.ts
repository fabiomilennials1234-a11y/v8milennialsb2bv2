/**
 * Slice 8 — capability persistence ⇄ gate (Copilot v2). Kills v1 audit #52
 * (capabilities loaded but never gated). This locks the contract across two
 * modules: what the wizard serializes into slots.capabilities is exactly what the
 * fail-CLOSED resolver from Slice 1-H reads. A flag the operator did not toggle
 * resolves OFF; only an explicit `true` enables a write tool.
 */

import { describe, it, expect } from 'vitest';
import { validateConfig, splitForPersistence } from '../../../supabase/functions/_shared/copilot-v2/config-schema.ts';
import { resolveAgentCapabilities, ALL_WRITE_CAPABILITIES } from '../../../supabase/functions/_shared/copilot-v2/capability-gate.ts';

describe('wizard capabilities → persisted slots → gate resolver', () => {
  it('toggled flags resolve ON, every other flag resolves OFF (fail-closed)', () => {
    const { value } = validateConfig('qualificador', {
      capabilities: { can_move_stage: true, can_send_media: true },
    });
    const { slots } = splitForPersistence(value!);
    const resolved = resolveAgentCapabilities(slots);

    expect(resolved.can_move_stage).toBe(true);
    expect(resolved.can_send_media).toBe(true);
    for (const flag of ALL_WRITE_CAPABILITIES) {
      if (flag !== 'can_move_stage' && flag !== 'can_send_media') {
        expect(resolved[flag]).toBe(false);
      }
    }
  });

  it('an explicit false resolves OFF', () => {
    const { value } = validateConfig('vendedor', { capabilities: { can_move_stage: true, can_transfer: false } });
    const { slots } = splitForPersistence(value!);
    expect(resolveAgentCapabilities(slots).can_transfer).toBe(false);
  });

  it('a config with no capabilities at all resolves every flag OFF', () => {
    const { value } = validateConfig('carteira', {});
    const { slots } = splitForPersistence(value!);
    const resolved = resolveAgentCapabilities(slots);
    for (const flag of ALL_WRITE_CAPABILITIES) expect(resolved[flag]).toBe(false);
  });

  it('round-trips all 7 flags losslessly through persistence', () => {
    const intent: Record<string, boolean> = {
      can_move_stage: true, can_schedule_meeting: true, can_set_tier: true,
      can_fill_field: true, can_send_media: true, can_transfer: true, can_handoff: true,
    };
    const { value } = validateConfig('qualificador', { capabilities: intent });
    const { slots } = splitForPersistence(value!);
    const resolved = resolveAgentCapabilities(slots);
    for (const flag of ALL_WRITE_CAPABILITIES) expect(resolved[flag]).toBe(intent[flag]);
  });
});
