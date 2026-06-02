/**
 * Slice 3 — tool-registry contract (Copilot v2)
 *
 * Single source of truth for the agent's tools: the schemas the LLM sees + the
 * read/write kind, the gating capability, and the introspect target arg. This
 * test LOCKS front↔back alignment — the exact class of bug that plagued v1
 * (tool registry drift). Every registry tool must be known to the capability-
 * gate (no "unknown_tool"), every write tool must have a real capability, and
 * read tools must be ungated.
 */

import { describe, it, expect } from 'vitest';
import {
  TOOL_REGISTRY,
  TOOL_SCHEMAS,
  writeTargetOf,
} from '../../../supabase/functions/_shared/copilot-v2/tool-registry.ts';
import { decideCapabilityGate, isReadTool } from '../../../supabase/functions/_shared/copilot-v2/capability-gate.ts';

describe('tool-registry — front↔back alignment', () => {
  it('exposes a schema (name + description + parameters) for every registered tool', () => {
    expect(TOOL_SCHEMAS.length).toBe(TOOL_REGISTRY.length);
    for (const s of TOOL_SCHEMAS) {
      expect(s.name).toBeTruthy();
      expect(s.description).toBeTruthy();
      expect(s.parameters).toBeTruthy();
    }
  });

  it('no registered tool is unknown to the capability-gate', () => {
    const allCapsOn: Record<string, boolean> = {};
    for (const t of TOOL_REGISTRY) if (t.capability) allCapsOn[t.capability] = true;
    for (const t of TOOL_REGISTRY) {
      const gate = decideCapabilityGate({ tool: t.name, capabilities: allCapsOn });
      expect(gate.reason).not.toBe('unknown_tool');
    }
  });

  it('read tools are ungated; write tools carry a capability', () => {
    for (const t of TOOL_REGISTRY) {
      if (t.kind === 'read') {
        expect(isReadTool(t.name)).toBe(true);
        expect(t.capability).toBeUndefined();
      } else {
        expect(isReadTool(t.name)).toBe(false);
        expect(t.capability).toBeTruthy();
        // a write tool blocked exactly by its own capability when off
        expect(decideCapabilityGate({ tool: t.name, capabilities: {} }).reason).toBe('capability_off');
      }
    }
  });

  it('covers the full ADR tool set (7 read + 7 write)', () => {
    expect(TOOL_REGISTRY.filter((t) => t.kind === 'read').map((t) => t.name).sort()).toEqual(
      ['check_agenda_availability', 'get_contact_status', 'get_conversation_history', 'get_lead_360', 'list_custom_fields', 'list_pipeline_stages', 'search_knowledge'],
    );
    expect(TOOL_REGISTRY.filter((t) => t.kind === 'write').map((t) => t.name).sort()).toEqual(
      ['fill_lead_field', 'handoff_to_vendedor', 'move_lead_stage', 'schedule_meeting', 'send_media', 'set_qualification_tier', 'transfer_to_human'],
    );
  });
});

describe('writeTargetOf', () => {
  it('extracts the introspect target for structural writes', () => {
    expect(writeTargetOf('move_lead_stage', { stage: 'abordado' })).toBe('abordado');
    expect(writeTargetOf('fill_lead_field', { field: 'cnpj' })).toBe('cnpj');
  });
  it('returns null for tools without a structural target', () => {
    expect(writeTargetOf('transfer_to_human', { reason: 'x' })).toBeNull();
    expect(writeTargetOf('get_lead_360', {})).toBeNull();
  });

  it('extrai o datetime de schedule_meeting (introspect target de agenda)', () => {
    expect(writeTargetOf('schedule_meeting', { datetime: '2026-06-10T14:00:00-03:00' }))
      .toBe('2026-06-10T14:00:00-03:00');
  });
});
