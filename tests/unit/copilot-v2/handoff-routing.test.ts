/**
 * Slice 5 — role-aware handoff routing, pure (Copilot v2).
 *
 * Destination = the lead's owner, role-aware: responsible_id → closer_id/sdr_id
 * → sale/pre_sale → active org team. Never returns an empty set (a notification
 * that reaches no one is the v1 #7/#9 bug). The whatsapp phone is opt-in
 * (team_members.phone may be null — in-app still fires).
 */
import { describe, it, expect } from 'vitest';
import { resolveHandoffTargets, type LeadOwners, type Member } from '../../../supabase/functions/_shared/copilot-v2/handoff-routing.ts';

const members: Member[] = [
  { id: 'm-resp', user_id: 'u-resp', phone: '11900000001', is_active: true, role: 'membro' },
  { id: 'm-closer', user_id: 'u-closer', phone: '11900000002', is_active: true, role: 'membro' },
  { id: 'm-sdr', user_id: 'u-sdr', phone: null, is_active: true, role: 'membro' }, // opt-in phone null
  { id: 'm-admin', user_id: 'u-admin', phone: '11900000009', is_active: true, role: 'admin' },
];

describe('resolveHandoffTargets', () => {
  it('routes to responsible_id first', () => {
    const lead: LeadOwners = { responsible_id: 'm-resp', closer_id: 'm-closer', sdr_id: 'm-sdr' };
    const r = resolveHandoffTargets({ lead, members, activeTeam: members });
    expect(r.targets.map((t) => t.userId)).toEqual(['u-resp']);
    expect(r.fallbackUsed).toBe(null);
  });

  it('falls back to closer_id when responsible is unset', () => {
    const lead: LeadOwners = { responsible_id: null, closer_id: 'm-closer', sdr_id: 'm-sdr' };
    const r = resolveHandoffTargets({ lead, members, activeTeam: members });
    expect(r.targets.map((t) => t.userId)).toEqual(['u-closer']);
  });

  it('falls back to sdr_id (in-app fires even with phone null)', () => {
    const lead: LeadOwners = { responsible_id: null, closer_id: null, sdr_id: 'm-sdr' };
    const r = resolveHandoffTargets({ lead, members, activeTeam: members });
    expect(r.targets[0].userId).toBe('u-sdr');
    expect(r.targets[0].phone).toBe(null);
  });

  it('falls back to the active org team when the lead has no owner', () => {
    const lead: LeadOwners = { responsible_id: null, closer_id: null, sdr_id: null };
    const r = resolveHandoffTargets({ lead, members, activeTeam: members });
    expect(r.fallbackUsed).toBe('org_active_team');
    expect(r.targets.length).toBeGreaterThan(0); // never empty
  });

  it('ignores an owner that is no longer an active member', () => {
    const lead: LeadOwners = { responsible_id: 'm-ghost', closer_id: 'm-closer', sdr_id: null };
    const r = resolveHandoffTargets({ lead, members, activeTeam: members });
    expect(r.targets.map((t) => t.userId)).toEqual(['u-closer']);
  });
});
