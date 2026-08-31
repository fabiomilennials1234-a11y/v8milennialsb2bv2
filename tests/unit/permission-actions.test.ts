/**
 * Tests for the canonical permission-actions module.
 *
 * Verifies:
 *   1. ACTION_TO_FEATURE map completeness (15 actions)
 *   2. resolvePermission pure function cascade
 *   3. CI hash validation — client copy matches canonical
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { resolve } from 'path';
import {
  ACTION_TO_FEATURE,
  resolvePermission,
  type AppAction,
  type ResolveContext,
} from '../../src/shared/permission-actions';

describe('permission-actions — ACTION_TO_FEATURE', () => {
  it('has exactly 18 actions', () => {
    expect(Object.keys(ACTION_TO_FEATURE)).toHaveLength(18);
  });

  it('maps every AppAction to a feature key', () => {
    const actions: AppAction[] = [
      'import_leads', 'create_lead', 'delete_lead', 'export_leads',
      'view_lead', 'move_pipe_record', 'trigger_campaign',
      'create_campaign', 'edit_campaign', 'delete_campaign',
      'edit_workflow', 'create_workflow', 'send_message',
      'manage_team', 'manage_copilot',
      'reassign_lead', 'remove_lead_from_pipe',
      'view_org_metrics',
    ];

    for (const action of actions) {
      expect(ACTION_TO_FEATURE[action]).toBeTruthy();
    }
  });

  it('every feature key follows module.action pattern', () => {
    for (const [, featureKey] of Object.entries(ACTION_TO_FEATURE)) {
      expect(featureKey).toMatch(/^[a-z]+\.[a-z_]+$/);
    }
  });
});

describe('permission-actions — resolvePermission', () => {
  const masterCtx: ResolveContext = {
    isMaster: true,
    role: null,
    featurePermissions: {},
  };

  const adminCtx: ResolveContext = {
    isMaster: false,
    role: 'admin',
    featurePermissions: {},
  };

  const memberWithPermission: ResolveContext = {
    isMaster: false,
    role: 'member',
    featurePermissions: { 'leads.delete': true },
  };

  const memberWithoutPermission: ResolveContext = {
    isMaster: false,
    role: 'member',
    featurePermissions: { 'leads.delete': false },
  };

  const memberEmptyPermissions: ResolveContext = {
    isMaster: false,
    role: 'member',
    featurePermissions: {},
  };

  it('master is always allowed', () => {
    const result = resolvePermission('delete_lead', masterCtx);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('master');
  });

  it('admin is always allowed', () => {
    const result = resolvePermission('delete_lead', adminCtx);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('admin');
  });

  it('member with feature enabled is allowed', () => {
    const result = resolvePermission('delete_lead', memberWithPermission);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('feature:leads.delete');
  });

  it('member with feature disabled is denied', () => {
    const result = resolvePermission('delete_lead', memberWithoutPermission);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('denied:leads.delete');
  });

  it('member with no permissions is denied (fail-closed)', () => {
    const result = resolvePermission('delete_lead', memberEmptyPermissions);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('denied:leads.delete');
  });

  it('master trumps everything even with role=member', () => {
    const ctx: ResolveContext = {
      isMaster: true,
      role: 'member',
      featurePermissions: { 'leads.delete': false },
    };
    const result = resolvePermission('delete_lead', ctx);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('master');
  });

  it('works for all 15 actions with admin context', () => {
    for (const action of Object.keys(ACTION_TO_FEATURE) as AppAction[]) {
      const result = resolvePermission(action, adminCtx);
      expect(result.allowed).toBe(true);
    }
  });
});

describe('permission-actions — CI hash validation', () => {
  it('client copy is identical to canonical server file', () => {
    const root = resolve(__dirname, '../..');
    const canonical = readFileSync(
      resolve(root, 'supabase/functions/_shared/permission-actions.ts'),
      'utf-8',
    );
    const clientCopy = readFileSync(
      resolve(root, 'src/shared/permission-actions.ts'),
      'utf-8',
    );

    const hashA = createHash('sha256').update(canonical).digest('hex');
    const hashB = createHash('sha256').update(clientCopy).digest('hex');

    expect(hashA).toBe(hashB);
  });
});
