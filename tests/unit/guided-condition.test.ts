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
  it('rejects a condition exceeding the explicit data-scope budget before reading', async () => {
    const children = Array.from({ length: 257 }, (_, index) => ({
      version: 1, id: `custom-${index}`, field: 'lead.custom', fieldId: crypto.randomUUID(), fieldType: 'text', operator: 'is_empty',
    }));
    expect(await evaluateGuidedCondition(databaseLead('José'), {
      organizationId: 'org-1', leadId: 'lead-1',
      condition: { version: 1, id: 'all', kind: 'group', match: 'all', children },
    })).toEqual({ status: 'error', code: 'invalid_configuration' });
  });
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


it('compares a selected origin identity using its current code and explains its current name', async () => {
  const originId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const database = createClient('https://db.example.test', 'test-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async input => {
      const url = String(input);
      return new Response(JSON.stringify(url.includes('/rpc/test_guided_condition_origins')
        ? [{ actual_origin: 'referral', origins: [{ id: originId, name: 'Parceiros', slug: 'referral' }] }]
        : { id: 'lead-1', organization_id: 'org-1' }), { headers: { 'Content-Type': 'application/json' } });
    } },
  });
  expect(await evaluateGuidedCondition(database, {
    organizationId: 'org-1', leadId: 'lead-1',
    condition: { version: 1, id: 'origin', field: 'lead.origin', operator: 'equals', originId: originId.toUpperCase() },
  })).toEqual({ status: 'evaluated', matched: true,
    rules: [{ id: 'origin', status: 'evaluated', matched: true, actual: 'referral',
      reference: { id: originId, name: 'Parceiros' } }],
  });
});


it('evaluates authorized origin and company from the same protected data response', async () => {
  const originId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const database = createClient('https://db.example.test', 'test-service-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async input => {
      if (!String(input).includes('/rpc/read_guided_condition_data')) throw new Error('Organizational data must use the authorized reader');
      return new Response(JSON.stringify({ id: 'lead-1', organization_id: 'org-1', field_values: {
        company: 'Fábrica Aurora', origin: { actual_origin: 'referral', origins: [{ id: originId, name: 'Parceiros', slug: 'referral' }] },
      } }), { headers: { 'Content-Type': 'application/json' } });
    } },
  });
  expect(await evaluateGuidedCondition(database, {
    organizationId: 'org-1', leadId: 'lead-1', authorization: { kind: 'organization', workflowId: 'workflow-1' },
    condition: { version: 1, id: 'all', kind: 'group', match: 'all', children: [
      { version: 1, id: 'origin', field: 'lead.origin', operator: 'equals', originId },
      { version: 1, id: 'company', field: 'lead.company', operator: 'equals', value: 'FABRICA AURORA' },
    ] },
  })).toEqual({ status: 'evaluated', matched: true,
    groups: [{ id: 'all', status: 'evaluated', matched: true }],
    rules: [{ id: 'origin', status: 'evaluated', matched: true, actual: 'referral', reference: { id: originId, name: 'Parceiros' } },
      { id: 'company', status: 'evaluated', matched: true, actual: 'Fábrica Aurora' }],
  });
});


it('compares canonical sales and presales member identities independently', async () => {
  const preSaleId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', saleId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const database = createClient('https://db.example.test', 'test-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async input => new Response(JSON.stringify(String(input).includes('/rpc/test_guided_condition_responsibles')
      ? [{ field_values: { pre_sale_responsible_id: preSaleId, sale_responsible_id: saleId }, members: [
        { id: preSaleId, name: 'Ana' }, { id: saleId, name: 'Marina' },
      ] }] : { id: 'lead-1', organization_id: 'org-1' }), { headers: { 'Content-Type': 'application/json' } }) },
  });
  expect(await evaluateGuidedCondition(database, {
    organizationId: 'org-1', leadId: 'lead-1', condition: { version: 1, id: 'both', kind: 'group', match: 'all', children: [
      { version: 1, id: 'presales', field: 'lead.pre_sale_responsible_id', operator: 'equals', memberId: preSaleId.toUpperCase() },
      { version: 1, id: 'sales', field: 'lead.sale_responsible_id', operator: 'not_equals', memberId: preSaleId },
    ] },
  })).toEqual({ status: 'evaluated', matched: true, groups: [{ id: 'both', status: 'evaluated', matched: true }], rules: [
    { id: 'presales', status: 'evaluated', matched: true, actual: preSaleId, reference: { id: preSaleId, name: 'Ana' } },
    { id: 'sales', status: 'evaluated', matched: true, actual: saleId, reference: { id: preSaleId, name: 'Ana' } },
  ] });
});


it('denies organizational responsible evaluation when its current grant is revoked', async () => {
  const database = createClient('https://db.example.test', 'test-service-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async () => new Response(JSON.stringify({ code: '42501', message: 'access_denied' }), { status: 403, headers: { 'Content-Type': 'application/json' } }) },
  });
  expect(await evaluateGuidedCondition(database, {
    organizationId: 'org-1', leadId: 'lead-1', authorization: { kind: 'organization', workflowId: 'workflow-1' },
    condition: { version: 1, id: 'responsible', field: 'lead.sale_responsible_id', operator: 'is_empty' },
  })).toEqual({ status: 'error', code: 'access_denied' });
});


it.each([
  { field: 'lead.name', column: 'name', actual: 'José', matched: true },
  { field: 'lead.name', column: 'name', actual: '', matched: false },
  { field: 'lead.name', column: 'name', actual: null, matched: false },
  { field: 'lead.qualification_score', column: 'qualification_score', actual: 0, matched: true },
  { field: 'lead.qualification_score', column: 'qualification_score', actual: null, matched: false },
])('checks filled $field for $actual without a comparison value', async ({ field, column, actual, matched }) => {
  const database = createClient('https://db.example.test', 'test-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async () => new Response(JSON.stringify({ id: 'lead-1', organization_id: 'org-1', [column]: actual }), { headers: { 'Content-Type': 'application/json' } }) },
  });
  expect(await evaluateGuidedCondition(database, { organizationId: 'org-1', leadId: 'lead-1',
    condition: { version: 1, id: 'filled', field, operator: 'is_not_empty' },
  })).toEqual({ status: 'evaluated', matched, rules: [{ id: 'filled', status: 'evaluated', matched, actual }] });
});

it.each([
  { actual: 0, operator: 'equals', value: 0, matched: true },
  { actual: 0, operator: 'is_empty', matched: false },
  { actual: null, operator: 'is_empty', matched: true },
  { actual: null, operator: 'equals', value: 0, matched: false },
  { actual: 1250.5, operator: 'greater_than_or_equal', value: 1000, matched: true },
])('compares exact trigger-business value without converting absence to zero: $operator / $actual', async ({ actual, operator, value, matched }) => {
  const entryId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const pipelineId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  const database = createClient('https://db.example.test', 'test-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async input => new Response(JSON.stringify(String(input).includes('/rpc/test_guided_condition_trigger_business_data')
      ? { entry: { id: entryId, pipeline_id: pipelineId, stage_id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', value: actual, stage_elapsed_seconds: null },
        pipeline: { id: pipelineId, name: 'Comercial' }, stages: [] }
      : { id: 'lead-1', organization_id: 'org-1' }), { headers: { 'Content-Type': 'application/json' } }) },
  });
  expect(await evaluateGuidedCondition(database, {
    organizationId: 'org-1', leadId: 'lead-1', entryId,
    condition: { version: 1, id: 'value', field: 'business.trigger.value', operator,
      ...(operator === 'is_empty' ? {} : { value }) },
  })).toEqual({ status: 'evaluated', matched, rules: [{ id: 'value', status: 'evaluated', matched, actual,
    context: { entryId, pipeline: { id: pipelineId, name: 'Comercial' } } }] });
});

it('reads stage and value for one trigger entry through one atomic business RPC', async () => {
  const entryId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const pipelineId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  const stageId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  let businessReads = 0;
  const database = createClient('https://db.example.test', 'test-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      if (!String(input).includes('/rpc/test_guided_condition_trigger_business_data')) {
        return new Response(JSON.stringify({ id: 'lead-1', organization_id: 'org-1' }), { headers: { 'Content-Type': 'application/json' } });
      }
      businessReads++;
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ p_entry_id: entryId, p_fields: ['business.trigger.stage', 'business.trigger.value'] });
      expect(body.p_references).toEqual([{ pipelineId, stageId }]);
      return new Response(JSON.stringify({ entry: { id: entryId, pipeline_id: pipelineId, stage_id: stageId, value: 1250.5, stage_elapsed_seconds: null },
        pipeline: { id: pipelineId, name: 'Comercial' }, stages: [{ id: stageId, name: 'Negociação', pipeline_id: pipelineId }] }),
      { headers: { 'Content-Type': 'application/json' } });
    } },
  });
  expect(await evaluateGuidedCondition(database, {
    organizationId: 'org-1', leadId: 'lead-1', entryId,
    condition: { version: 1, id: 'all-business', kind: 'group', match: 'all', children: [
      { version: 1, id: 'stage', field: 'business.trigger.stage', operator: 'equals', pipelineId, stageId },
      { version: 1, id: 'value', field: 'business.trigger.value', operator: 'greater_than', value: 1000 },
    ] },
  })).toMatchObject({ status: 'evaluated', matched: true });
  expect(businessReads).toBe(1);
});

it('requires one candidate to satisfy every business-existence filter', async () => {
  const pipelineId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  const stageId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  let reads = 0;
  const database = createClient('https://db.example.test', 'test-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      if (!String(input).includes('/rpc/test_guided_condition_business_candidates')) return new Response(JSON.stringify({
        id: 'lead-1', organization_id: 'org-1',
      }), { headers: { 'Content-Type': 'application/json' } });
      reads++;
      expect(JSON.parse(String(init?.body))).toEqual({ p_organization_id: 'org-1', p_lead_id: 'lead-1',
        p_fields: ['business.exists.lifecycle', 'business.exists.stage', 'business.exists.value'],
        p_stage_references: [{ pipelineId, stageId }] });
      return new Response(JSON.stringify([
        { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', pipeline_id: pipelineId, pipeline_name: 'Comercial', stage_id: stageId, value: 100, outcome: 'open' },
        { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', pipeline_id: pipelineId, pipeline_name: 'Comercial', stage_id: crypto.randomUUID(), value: 5000, outcome: 'open' },
      ]), { headers: { 'Content-Type': 'application/json' } });
    } },
  });
  expect(await evaluateGuidedCondition(database, { organizationId: 'org-1', leadId: 'lead-1', condition: {
    version: 1, id: 'exists', kind: 'business_exists', lifecycle: 'open', match: 'all', children: [
      { version: 1, id: 'stage', field: 'business.stage', operator: 'equals', pipelineId, stageId },
      { version: 1, id: 'value', field: 'business.value', operator: 'greater_than', value: 1000 },
    ],
  } })).toEqual({ status: 'evaluated', matched: false,
    rules: [{ id: 'exists', status: 'evaluated', matched: false, actual: null }] });
  expect(reads).toBe(1);
});

it('returns No for a complete business-existence query with no candidate', async () => {
  const database = createClient('https://db.example.test', 'test-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async input => new Response(String(input).includes('/rpc/test_guided_condition_business_candidates') ? '[]'
      : JSON.stringify({ id: 'lead-1', organization_id: 'org-1' }), { headers: { 'Content-Type': 'application/json' } }) },
  });
  expect(await evaluateGuidedCondition(database, { organizationId: 'org-1', leadId: 'lead-1', condition: {
    version: 1, id: 'exists', kind: 'business_exists', lifecycle: 'all', match: 'all', children: [
      { version: 1, id: 'value', field: 'business.value', operator: 'is_empty' },
    ],
  } })).toEqual({ status: 'evaluated', matched: false,
    rules: [{ id: 'exists', status: 'evaluated', matched: false, actual: null }] });
});

it.each([
  ['equals', '2026-08-20', true],
  ['not_equals', '2026-08-19', true],
  ['before', '2026-08-21', true],
  ['on_or_before', '2026-08-20', true],
  ['after', '2026-08-19', true],
  ['on_or_after', '2026-08-20', true],
] as const)('compares the latest currently-won sale date with %s', async (operator, value, matched) => {
  const dealId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const database = createClient('https://db.example.test', 'test-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async input => new Response(JSON.stringify(String(input).includes('/rpc/test_guided_condition_last_won')
      ? [{ deal_id: dealId, title: 'Contrato anual', won_at: '2026-08-20T15:00:00Z', won_date: '2026-08-20' }]
      : { id: 'lead-1', organization_id: 'org-1' }), { headers: { 'Content-Type': 'application/json' } }) },
  });
  expect(await evaluateGuidedCondition(database, { organizationId: 'org-1', leadId: 'lead-1',
    condition: { version: 1, id: 'last-won', field: 'business.last_won_date', operator, value },
  })).toEqual({ status: 'evaluated', matched, rules: [{ id: 'last-won', status: 'evaluated', matched,
    actual: '2026-08-20', reference: { id: dealId, name: 'Contrato anual' } }] });
});

it.each([
  ['is_empty', true],
  ['is_not_empty', false],
] as const)('represents absence of a currently-won sale with %s', async (operator, matched) => {
  const database = createClient('https://db.example.test', 'test-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async input => new Response(String(input).includes('/rpc/test_guided_condition_last_won') ? '[]'
      : JSON.stringify({ id: 'lead-1', organization_id: 'org-1' }), { headers: { 'Content-Type': 'application/json' } }) },
  });
  expect(await evaluateGuidedCondition(database, { organizationId: 'org-1', leadId: 'lead-1',
    condition: { version: 1, id: 'last-won', field: 'business.last_won_date', operator },
  })).toEqual({ status: 'evaluated', matched, rules: [{ id: 'last-won', status: 'evaluated', matched, actual: null }] });
});

it.each([
  [{ deal_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', title: 'Venda', won_at: 'invalid', won_date: '2026-08-20' }],
  [{ deal_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', title: 'Venda', won_at: '2026-08-20T15:00:00Z', won_date: '2026-02-30' }],
  [{ deal_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', title: 'Venda', won_at: '2026-08-20T15:00:00Z', won_date: '2026-08-20' },
   { deal_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', title: 'Outra', won_at: '2026-08-19T15:00:00Z', won_date: '2026-08-19' }],
])('fails closed for malformed last-won source data', async rows => {
  const database = createClient('https://db.example.test', 'test-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async input => new Response(JSON.stringify(String(input).includes('/rpc/test_guided_condition_last_won')
      ? rows : { id: 'lead-1', organization_id: 'org-1' }), { headers: { 'Content-Type': 'application/json' } }) },
  });
  expect(await evaluateGuidedCondition(database, { organizationId: 'org-1', leadId: 'lead-1',
    condition: { version: 1, id: 'last-won', field: 'business.last_won_date', operator: 'equals', value: '2026-08-20' },
  })).toEqual({ status: 'error', code: 'source_unavailable' });
});

it.each([
  { operator: 'equals', value: 125, unit: 'minutes', matched: true },
  { operator: 'not_equals', value: 2, unit: 'hours', matched: true },
  { operator: 'greater_than', value: 2, unit: 'hours', matched: true },
  { operator: 'greater_than_or_equal', value: 125, unit: 'minutes', matched: true },
  { operator: 'less_than', value: 3, unit: 'hours', matched: true },
  { operator: 'less_than_or_equal', value: 125 / 60 / 24, unit: 'days', matched: true },
])('compares trusted elapsed stage seconds in explicit $unit with $operator', async ({ operator, value, unit, matched }) => {
  const entryId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const pipelineId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  const database = createClient('https://db.example.test', 'test-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async input => new Response(JSON.stringify(String(input).includes('/rpc/test_guided_condition_trigger_business_data')
      ? { entry: { id: entryId, pipeline_id: pipelineId, stage_id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', value: null, stage_elapsed_seconds: 7_500 },
        pipeline: { id: pipelineId, name: 'Comercial' }, stages: [] }
      : { id: 'lead-1', organization_id: 'org-1' }), { headers: { 'Content-Type': 'application/json' } }) },
  });
  expect(await evaluateGuidedCondition(database, {
    organizationId: 'org-1', leadId: 'lead-1', entryId,
    condition: { version: 1, id: 'elapsed', field: 'business.trigger.stage_elapsed', operator, value, unit },
  })).toEqual({ status: 'evaluated', matched, rules: [{ id: 'elapsed', status: 'evaluated', matched,
    actual: 7_500 / (unit === 'minutes' ? 60 : unit === 'hours' ? 3_600 : 86_400),
    context: { entryId, pipeline: { id: pipelineId, name: 'Comercial' } } }] });
});

it.each([null, -1])('rejects an unreliable exact-entry stage clock represented as %s', async stageElapsedSeconds => {
  const entryId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const pipelineId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  const database = createClient('https://db.example.test', 'test-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async input => new Response(JSON.stringify(String(input).includes('/rpc/test_guided_condition_trigger_business_data')
      ? { entry: { id: entryId, pipeline_id: pipelineId, stage_id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', value: null, stage_elapsed_seconds: stageElapsedSeconds },
        pipeline: { id: pipelineId, name: 'Comercial' }, stages: [] }
      : { id: 'lead-1', organization_id: 'org-1' }), { headers: { 'Content-Type': 'application/json' } }) },
  });
  expect(await evaluateGuidedCondition(database, { organizationId: 'org-1', leadId: 'lead-1', entryId,
    condition: { version: 1, id: 'elapsed', field: 'business.trigger.stage_elapsed', operator: 'greater_than', value: 1, unit: 'hours' },
  })).toEqual({ status: 'error', code: 'source_unavailable' });
});
