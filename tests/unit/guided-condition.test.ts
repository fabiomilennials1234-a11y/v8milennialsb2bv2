import { describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { evaluateGuidedCondition } from '../../supabase/functions/_shared/guided-condition';

// Only the database transport is substituted. RLS is verified separately
// against PostgreSQL; these tests exercise the public evaluation contract.
function databaseLead(name: string | null) {
  return createClient('https://db.example.test', 'test-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async () => new Response(JSON.stringify({
      id: 'lead-1', organization_id: 'org-1', name,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }) },
  });
}

describe('guided condition — public evaluation', () => {
  it('rejects an equality missing its comparison value instead of deciding No', async () => {
    expect(await evaluateGuidedCondition(databaseLead('José'), {
      organizationId: 'org-1', leadId: 'lead-1',
      condition: { version: 1, id: 'rule-1', field: 'lead.name', operator: 'equals', value: '' },
    })).toEqual({ status: 'error', code: 'invalid_configuration' });
  });
  it('rejects an unknown authorization mode instead of reading with the supplied client', async () => {
    expect(await evaluateGuidedCondition(databaseLead('José'), {
      organizationId: 'org-1', leadId: 'lead-1',
      // Simulate an invalid runtime payload across the public service boundary.
      authorization: { kind: 'organization_typo', workflowId: 'workflow-1' } as never,
      condition: { version: 1, id: 'rule-1', field: 'lead.name', operator: 'equals', value: 'JOSE' },
    })).toEqual({ status: 'error', code: 'access_denied' });
  });
  it('does not classify an unavailable database column as a temporary outage', async () => {
    const invalidSchema = createClient('https://db.example.test', 'test-anon-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async () => new Response(JSON.stringify({ code: '42703', message: 'private schema detail' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      }) },
    });
    expect(await evaluateGuidedCondition(invalidSchema, {
      organizationId: 'org-1', leadId: 'lead-1',
      condition: { version: 1, id: 'rule-1', field: 'lead.name', operator: 'equals', value: 'JOSE' },
    })).toEqual({ status: 'error', code: 'source_unavailable' });
  });
  it('does not retry denied access or expose a boolean or actual value', async () => {
    const denied = createClient('https://db.example.test', 'test-anon-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async () => new Response(JSON.stringify({ code: '42501', message: 'permission denied' }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      }) },
    });
    expect(await evaluateGuidedCondition(denied, {
      organizationId: 'org-1', leadId: 'lead-1',
      condition: { version: 1, id: 'rule-1', field: 'lead.name', operator: 'equals', value: 'JOSE' },
    })).toEqual({ status: 'error', code: 'access_denied' });
  });
  it('rejects unsupported configuration instead of evaluating it as a name equality', async () => {
    const result = await evaluateGuidedCondition(databaseLead('José'), {
      organizationId: 'org-1', leadId: 'lead-1',
      condition: { version: 1, id: 'rule-1', field: 'lead.password', operator: 'equals', value: 'JOSE' },
    });
    expect(result).toEqual({ status: 'error', code: 'invalid_configuration' });
  });
  it('reports missing name as empty without requiring a comparison value', async () => {
    const result = await evaluateGuidedCondition(databaseLead(null), {
      organizationId: 'org-1', leadId: 'lead-1',
      condition: { version: 1, id: 'rule-1', field: 'lead.name', operator: 'is_empty' },
    });
    expect(result).toEqual({
      status: 'evaluated', matched: true,
      rules: [{ id: 'rule-1', status: 'evaluated', matched: true, actual: null }],
    });
  });
  it('explains an accent-insensitive name match without changing the original', async () => {
    const result = await evaluateGuidedCondition(databaseLead('José'), {
      organizationId: 'org-1', leadId: 'lead-1',
      condition: { version: 1, id: 'rule-1', field: 'lead.name', operator: 'equals', value: 'JOSE' },
    });
    expect(result).toEqual({
      status: 'evaluated', matched: true,
      rules: [{ id: 'rule-1', status: 'evaluated', matched: true, actual: 'José' }],
    });
  });
});
