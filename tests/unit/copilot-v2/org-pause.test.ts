/**
 * W10 — Org-level pause / kill-switch (Copilot v2)
 *
 * The kill-switch sits OVER the phone-keyed human-pause: it pauses the whole
 * org (no phone) with a typed reason (takeover/loop/teto/baixa_confianca).
 * decideOrgPauseGate mirrors decideHumanPauseGate (pure, fail-CLOSED: unknown
 * or unparseable → block). The border/worker call BOTH gates and union them —
 * blocked if EITHER blocks; the org reason wins the banner (governance-wide
 * pause is the more important thing to show).
 */

import { describe, it, expect } from 'vitest';
import {
  decideOrgPauseGate,
  unionPause,
  ORG_PAUSE_REASONS,
  type OrgPauseReason,
} from '../../../supabase/functions/_shared/copilot-v2/org-pause.ts';

const NOW = new Date('2026-06-03T12:00:00.000Z');
const future = new Date(NOW.getTime() + 60_000).toISOString();
const past = new Date(NOW.getTime() - 60_000).toISOString();

describe('decideOrgPauseGate', () => {
  it('no org-pause row → not blocked', () => {
    expect(decideOrgPauseGate({ record: null, checkErrored: false, now: NOW })).toEqual({
      blocked: false, reason: null,
    });
  });

  it('paused_until in the future → blocked, org_pause_active', () => {
    expect(decideOrgPauseGate({ record: { paused_until: future }, checkErrored: false, now: NOW })).toEqual({
      blocked: true, reason: 'org_pause_active',
    });
  });

  it('paused_until in the past → not blocked', () => {
    expect(decideOrgPauseGate({ record: { paused_until: past }, checkErrored: false, now: NOW }).blocked).toBe(false);
  });

  it('check errored → fail-CLOSED block', () => {
    expect(decideOrgPauseGate({ record: null, checkErrored: true, now: NOW })).toEqual({
      blocked: true, reason: 'org_pause_check_failed',
    });
  });

  it('unparseable paused_until → fail-CLOSED block', () => {
    expect(decideOrgPauseGate({ record: { paused_until: 'not-a-date' }, checkErrored: false, now: NOW })).toEqual({
      blocked: true, reason: 'org_pause_check_failed',
    });
  });

  it('is deterministic', () => {
    const inp = { record: { paused_until: future }, checkErrored: false, now: NOW };
    expect(decideOrgPauseGate(inp)).toEqual(decideOrgPauseGate(inp));
  });
});

describe('ORG_PAUSE_REASONS', () => {
  it('is exactly the 4 governance reasons', () => {
    expect([...ORG_PAUSE_REASONS].sort()).toEqual(
      (['baixa_confianca', 'loop', 'takeover', 'teto'] as OrgPauseReason[]).sort(),
    );
  });
});

describe('unionPause', () => {
  it('neither blocked → not blocked', () => {
    expect(unionPause({ blocked: false, reason: null }, { blocked: false, reason: null })).toEqual({
      blocked: false, reason: null,
    });
  });

  it('phone blocked only → blocked with phone reason', () => {
    expect(unionPause({ blocked: true, reason: 'human_pause_active' }, { blocked: false, reason: null })).toEqual({
      blocked: true, reason: 'human_pause_active',
    });
  });

  it('org blocked only → blocked with org reason', () => {
    expect(unionPause({ blocked: false, reason: null }, { blocked: true, reason: 'org_pause_active' })).toEqual({
      blocked: true, reason: 'org_pause_active',
    });
  });

  it('both blocked → org reason wins (governance-wide pause shown)', () => {
    expect(unionPause({ blocked: true, reason: 'human_pause_active' }, { blocked: true, reason: 'org_pause_active' })).toEqual({
      blocked: true, reason: 'org_pause_active',
    });
  });
});
