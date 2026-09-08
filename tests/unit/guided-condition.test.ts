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

it('evaluates mixed All/Any groups and marks dispensable rules as not evaluated', async () => {
  const result = await evaluateGuidedCondition(databaseLead('José'), {
    organizationId: 'org-1', leadId: 'lead-1', condition: {
      version: 1, id: 'root', kind: 'group', match: 'all', children: [
        { version: 1, id: 'names', kind: 'group', match: 'any', children: [
          { version: 1, id: 'jose', field: 'lead.name', operator: 'equals', value: 'JOSE' },
          { version: 1, id: 'maria', field: 'lead.name', operator: 'equals', value: 'Maria' },
        ] },
        { version: 1, id: 'empty', field: 'lead.name', operator: 'is_empty' },
      ],
    },
  });
  expect(result).toEqual({ status: 'evaluated', matched: false,
    rules: [{ id: 'jose', status: 'evaluated', matched: true, actual: 'José' },
      { id: 'maria', status: 'not_evaluated' }, { id: 'empty', status: 'evaluated', matched: false, actual: 'José' }],
    groups: [{ id: 'root', status: 'evaluated', matched: false }, { id: 'names', status: 'evaluated', matched: true }],
  });
});

it('validates an invalid rule in a dispensable branch before reading lead data', async () => {
  let reads = 0;
  const database = createClient('https://db.example.test', 'test-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async () => {
      reads++;
      return new Response(JSON.stringify({ id: 'lead-1', name: 'José' }), { headers: { 'Content-Type': 'application/json' } });
    } },
  });
  expect(await evaluateGuidedCondition(database, { organizationId: 'org-1', leadId: 'lead-1', condition: {
    version: 1, kind: 'group', id: 'root', match: 'any', children: [
      { version: 1, id: 'yes', field: 'lead.name', operator: 'equals', value: 'José' },
      { version: 1, id: 'invalid', field: 'lead.password', operator: 'equals', value: 'secret' },
    ],
  } })).toEqual({ status: 'error', code: 'invalid_configuration' });
  expect(reads).toBe(0);
});

it.each([3, 4])('limits nested groups including the root: %s levels', async (levels) => {
  let condition: unknown = { version: 1, id: 'rule', field: 'lead.name', operator: 'equals', value: 'José' };
  for (let level = levels; level >= 1; level--) {
    condition = { version: 1, id: `group-${level}`, kind: 'group', match: 'all', children: [condition] };
  }
  const result = await evaluateGuidedCondition(databaseLead('José'), { organizationId: 'org-1', leadId: 'lead-1', condition });
  expect(result).toMatchObject(levels === 3 ? { status: 'evaluated', matched: true } : { status: 'error', code: 'invalid_configuration' });
});

it('rejects a leaf carrying group children before reading personal data', async () => {
  let reads = 0;
  const caller = createClient('https://db.example.test', 'test-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async () => {
      reads++;
      return new Response(JSON.stringify({ id: 'lead-1', name: 'José' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } },
  });
  expect(await evaluateGuidedCondition(caller, {
    organizationId: 'org-1', leadId: 'lead-1',
    condition: { version: 1, id: 'ambiguous', field: 'lead.name', operator: 'equals', value: 'José', children: [] },
  })).toEqual({ status: 'error', code: 'invalid_configuration' });
  expect(reads).toBe(0);
});

it('compares company and name independently within one group using only requested fields', async () => {
  const caller = createClient('https://db.example.test', 'test-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async input => {
      const selected = new URL(String(input)).searchParams.get('select')?.replaceAll(' ', '').split(',');
      expect(selected?.sort()).toEqual(['company', 'id', 'name', 'organization_id']);
      return new Response(JSON.stringify({ id: 'lead-1', organization_id: 'org-1', name: 'José', company: 'Fábrica Aurora' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    } },
  });
  expect(await evaluateGuidedCondition(caller, {
    organizationId: 'org-1', leadId: 'lead-1', condition: { version: 1, id: 'g', kind: 'group', match: 'all', children: [
      { version: 1, id: 'name', field: 'lead.name', operator: 'equals', value: 'JOSE' },
      { version: 1, id: 'company', field: 'lead.company', operator: 'equals', value: 'FABRICA AURORA' },
    ] },
  })).toEqual({ status: 'evaluated', matched: true, groups: [{ id: 'g', status: 'evaluated', matched: true }], rules: [
    { id: 'name', status: 'evaluated', matched: true, actual: 'José' },
    { id: 'company', status: 'evaluated', matched: true, actual: 'Fábrica Aurora' },
  ] });
});

it.each([
  ['contains', 'José da Silva', 'DA SIL', true], ['contains', 'José', 'Ana', false],
  ['not_contains', 'José', 'Ana', true], ['not_contains', 'José', 'JOSE', false],
  ['starts_with', 'José da Silva', 'JOSE', true], ['starts_with', 'José da Silva', 'Silva', false],
  ['ends_with', 'José da Silva', 'SILVA', true], ['ends_with', 'José da Silva', 'José', false],
  ['not_equals', 'José', 'Maria', true], ['not_equals', 'José', 'JOSE', false],
  ['not_equals', null, 'José', false], ['not_contains', '', 'José', false],
])('evaluates text operator %s on %s without treating missing text as a negative match', async (operator, actual, value, matched) => {
  expect(await evaluateGuidedCondition(databaseLead(actual as string | null), {
    organizationId: 'org-1', leadId: 'lead-1', condition: { version: 1, id: 'text', field: 'lead.name', operator, value },
  })).toEqual({ status: 'evaluated', matched, rules: [{ id: 'text', status: 'evaluated', matched, actual }] });
});

it('compares email and phone as separate text fields without rewriting their stored values', async () => {
  const caller = createClient('https://db.example.test', 'test-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async input => {
      expect(new URL(String(input)).searchParams.get('select')?.replaceAll(' ', '').split(',').sort()).toEqual(['email', 'id', 'organization_id', 'phone']);
      return new Response(JSON.stringify({ id: 'lead-1', organization_id: 'org-1', email: 'Comercial@Aurora.example', phone: '5511999990000' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    } },
  });
  expect(await evaluateGuidedCondition(caller, {
    organizationId: 'org-1', leadId: 'lead-1', condition: { version: 1, id: 'g', kind: 'group', match: 'all', children: [
      { version: 1, id: 'email', field: 'lead.email', operator: 'ends_with', value: '@AURORA.EXAMPLE' },
      { version: 1, id: 'phone', field: 'lead.phone', operator: 'starts_with', value: '5511' },
    ] },
  })).toEqual({ status: 'evaluated', matched: true, groups: [{ id: 'g', status: 'evaluated', matched: true }], rules: [
    { id: 'email', status: 'evaluated', matched: true, actual: 'Comercial@Aurora.example' },
    { id: 'phone', status: 'evaluated', matched: true, actual: '5511999990000' },
  ] });
});

it.each([
  { score: 0, operator: 'equals', value: 0, matched: true },
  { score: 0, operator: 'is_empty', matched: false },
  { score: null, operator: 'is_empty', matched: true },
  { score: null, operator: 'not_equals', value: 0, matched: false },
  { score: 80, operator: 'greater_than', value: 70, matched: true },
  { score: 70, operator: 'greater_than', value: 70, matched: false },
  { score: 70, operator: 'greater_than_or_equal', value: 70, matched: true },
  { score: 69, operator: 'greater_than_or_equal', value: 70, matched: false },
  { score: 69, operator: 'less_than', value: 70, matched: true },
  { score: 70, operator: 'less_than', value: 70, matched: false },
  { score: 70, operator: 'less_than_or_equal', value: 70, matched: true },
  { score: 71, operator: 'less_than_or_equal', value: 70, matched: false },
  { score: null, operator: 'less_than_or_equal', value: 70, matched: false },
])('compares qualification score without treating zero as absence: $operator / $score', async ({ score, operator, value, matched }) => {
  const database = createClient('https://db.example.test', 'test-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async () => new Response(JSON.stringify({ id: 'lead-1', organization_id: 'org-1', qualification_score: score }), {
      headers: { 'Content-Type': 'application/json' },
    }) },
  });
  expect(await evaluateGuidedCondition(database, {
    organizationId: 'org-1', leadId: 'lead-1', condition: {
      version: 1, id: 'score', field: 'lead.qualification_score', operator, ...(operator === 'is_empty' ? {} : { value }),
    },
  })).toEqual({ status: 'evaluated', matched, rules: [{ id: 'score', status: 'evaluated', matched, actual: score }] });
});

it.each(['', '0', false, 'not-a-score'])('rejects invalid numeric source %j instead of concluding No or empty', async score => {
  const database = createClient('https://db.example.test', 'test-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async () => new Response(JSON.stringify({ id: 'lead-1', organization_id: 'org-1', qualification_score: score }), {
      headers: { 'Content-Type': 'application/json' },
    }) },
  });
  expect(await evaluateGuidedCondition(database, { organizationId: 'org-1', leadId: 'lead-1', condition: {
    version: 1, id: 'score', field: 'lead.qualification_score', operator: 'is_empty',
  } })).toEqual({ status: 'error', code: 'source_unavailable' });
});

it.each(['utm_campaign', 'utm_source', 'utm_medium', 'utm_content', 'utm_term'])('compares %s as text without requiring it to exist in a suggestion page', async field => {
  const database = createClient('https://db.example.test', 'test-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async () => new Response(JSON.stringify({ id: 'lead-1', organization_id: 'org-1', [field]: '[VERÃO] B2B.' }), {
      headers: { 'Content-Type': 'application/json' },
    }) },
  });
  expect(await evaluateGuidedCondition(database, { organizationId: 'org-1', leadId: 'lead-1', condition: {
    version: 1, id: 'campaign', field: `lead.${field}`, operator: 'equals', value: '[verao] b2b.',
  } })).toEqual({ status: 'evaluated', matched: true, rules: [{ id: 'campaign', status: 'evaluated', matched: true, actual: '[VERÃO] B2B.' }] });
});
