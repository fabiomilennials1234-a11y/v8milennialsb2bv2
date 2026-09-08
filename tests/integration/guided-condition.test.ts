import '../helpers/deno-mock';
import { executeWorkflow } from '../../supabase/functions/_shared/workflow-executor';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { evaluateGuidedCondition } from '../../supabase/functions/_shared/guided-condition';

// Explicit preview opt-in: never inherit another suite's production credentials.
describe.skipIf(!process.env.GUIDED_PREVIEW_REF)('guided condition — real Auth and RLS', () => {
  let service: SupabaseClient;
  let token: string;
  let userId: string;
  const orgA = crypto.randomUUID();
  const orgB = crypto.randomUUID();
  const leadA = crypto.randomUUID();
  const leadB = crypto.randomUUID();
  const adminMemberId = crypto.randomUUID();

  beforeAll(async () => {
    const ref = process.env.GUIDED_PREVIEW_REF!;
    if (['jsjsmuncfkbsbzqzqhfq', 'bcfadphgsibjzivtbjvc'].includes(ref)
      || process.env.SUPABASE_URL !== `https://${ref}.supabase.co`) throw new Error('Refusing non-preview test target');
    const auth = { persistSession: false, autoRefreshToken: false };
    service = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { ...auth, storageKey: `guided-service-${orgA}` } });
    const password = `${crypto.randomUUID()}!Aa1`;
    const email = `guided-${crypto.randomUUID()}@example.test`;
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw created.error;
    userId = created.data.user.id;
    const organizations = await service.from('organizations').insert([
      { id: orgA, name: 'Guided test A', slug: `guided-${orgA}` },
      { id: orgB, name: 'Guided test B', slug: `guided-${orgB}` },
    ]);
    if (organizations.error) throw organizations.error;
    const quotas = await service.from('org_quotas').upsert([
      { organization_id: orgA, resource_key: 'max_users', plan_base: 2 },
      { organization_id: orgB, resource_key: 'max_users', plan_base: 2 },
      { organization_id: orgA, resource_key: 'max_leads', plan_base: 20 },
      { organization_id: orgB, resource_key: 'max_leads', plan_base: 20 },
    ], { onConflict: 'organization_id,resource_key' });
    if (quotas.error) throw quotas.error;
    const member = await service.from('team_members').insert({
      id: adminMemberId, user_id: userId, organization_id: orgA, name: 'Guided tester', role: 'admin', is_active: true,
    });
    if (member.error) throw member.error;
    const leads = await service.from('leads').insert([
      { id: leadA, organization_id: orgA, name: 'José', pre_sale_responsible_id: adminMemberId },
      { id: leadB, organization_id: orgB, name: 'Dado protegido' },
    ]);
    if (leads.error) throw leads.error;
    const caller = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, { auth: { ...auth, storageKey: `guided-admin-${orgA}` } });
    const signedIn = await caller.auth.signInWithPassword({ email, password });
    if (signedIn.error) throw signedIn.error;
    token = signedIn.data.session!.access_token;
  }, 60000);

  afterAll(async () => {
    if (service) {
      const failures: unknown[] = [];
      // Existing stage-deletion triggers enqueue an org-owned job. Remove
      // stages while the org still exists (canonical migration's QA order).
      try {
        const cleared = await service.from('organizations').update({ default_pipeline_id: null }).in('id', [orgA, orgB]);
        if (cleared.error) throw cleared.error;
        for (const table of ['workflows', 'follow_ups', 'leads', 'pipeline_stages', 'followup_reclassify_queue', 'pipelines']) {
          const removed = await service.from(table).delete().in('organization_id', [orgA, orgB]);
          if (removed.error) throw removed.error;
        }
        const removed = await service.from('organizations').delete().in('id', [orgA, orgB]);
        if (removed.error) throw removed.error;
      } catch (error) { failures.push(error); }
      if (userId) {
        const removed = await service.auth.admin.deleteUser(userId);
        if (removed.error) failures.push(removed.error);
      }
      if (failures.length) throw new AggregateError(failures, 'Preview fixture cleanup failed');
    }
  }, 60000);

  it('publishes a saved condition through the authenticated HTTP boundary', async () => {
    const workflowId = crypto.randomUUID();
    const caller = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const definition = { nodes: [
      { id: 't', type: 'trigger', data: { triggerType: 'lead_created', config: {} } },
      { id: 'c', type: 'condition', data: { guidedCondition: { version: 1, id: 'r', field: 'lead.name', operator: 'equals', value: 'José' } } },
      { id: 'y', type: 'end', data: {} }, { id: 'n', type: 'end', data: {} },
    ], edges: [{ id: 'tc', source: 't', target: 'c' },
      { id: 'cy', source: 'c', target: 'y', sourceHandle: 'yes' }, { id: 'cn', source: 'c', target: 'n', sourceHandle: 'no' }] };
    const created = await caller.rpc('create_guided_workflow_draft_with_settings', {
      p_workflow_id: workflowId, p_organization_id: orgA, p_definition: definition, p_settings: { name: 'HTTP publication' },
    });
    expect(created.error).toBeNull();
    const approved = await caller.rpc('set_workflow_data_grant', {
      p_workflow_id: workflowId, p_fields: ['lead.name'], p_expected_revision: 0,
    });
    expect(approved.error).toBeNull();
    const response = await fetch(`${process.env.SUPABASE_URL}/functions/v1/publish-guided-workflow`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: process.env.SUPABASE_ANON_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: orgA, workflowId, expectedRevision: 1 }),
      signal: AbortSignal.timeout(15000),
    });
    expect(response.status).toBe(200);
    const publication = await response.json();
    expect(publication).toMatchObject({ status: 'published', version_number: 1 });
    const selected = await caller.from('workflow_guided_publications').select('version_id').eq('workflow_id', workflowId).single();
    expect(selected.error).toBeNull();
    expect(selected.data?.version_id).toBe(publication.version_id);
    const version = await caller.from('workflow_guided_versions').select('definition, published_by').eq('id', publication.version_id).single();
    expect(version.error).toBeNull();
    expect(version.data).toEqual({ definition, published_by: userId });
    const invalidDefinition = { ...definition, nodes: definition.nodes.map(node => node.id === 'y'
      ? { ...node, type: 'unknown_action' } : node) };
    const saved = await caller.rpc('save_guided_workflow_draft_with_settings', {
      p_workflow_id: workflowId, p_definition: invalidDefinition, p_expected_revision: 1,
      p_settings: { name: 'Invalid revision' },
    });
    expect(saved.error).toBeNull();
    const rejected = await fetch(`${process.env.SUPABASE_URL}/functions/v1/publish-guided-workflow`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: process.env.SUPABASE_ANON_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: orgA, workflowId, expectedRevision: 2 }),
      signal: AbortSignal.timeout(15000),
    });
    expect(rejected.status).toBe(422);
    expect(await rejected.json()).toMatchObject({ code: 'invalid_configuration',
      issues: expect.arrayContaining([expect.objectContaining({ code: 'unknown_node_type', nodeId: 'y' })]) });
    const unchanged = await caller.from('workflow_guided_publications').select('version_id').eq('workflow_id', workflowId).single();
    expect(unchanged.error).toBeNull();
    expect(unchanged.data?.version_id).toBe(publication.version_id);
    const audioDefinition = { ...definition, nodes: definition.nodes.map(node => node.id === 'y'
      ? { ...node, type: 'action', data: { actionType: 'send_whatsapp_audio' } } : node) };
    const incompleteAudio = await caller.rpc('save_guided_workflow_draft_with_settings', {
      p_workflow_id: workflowId, p_definition: audioDefinition, p_expected_revision: 2,
      p_settings: { name: 'Audio draft' },
    });
    expect(incompleteAudio.error).toBeNull();
    const audioResponse = await fetch(`${process.env.SUPABASE_URL}/functions/v1/publish-guided-workflow`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: process.env.SUPABASE_ANON_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: orgA, workflowId, expectedRevision: 3 }),
      signal: AbortSignal.timeout(15000),
    });
    expect(audioResponse.status).toBe(422);
    expect(await audioResponse.json()).toMatchObject({ code: 'invalid_configuration',
      issues: expect.arrayContaining([expect.objectContaining({ code: 'incomplete_action', nodeId: 'y' })]) });
    const afterAudio = await caller.from('workflow_guided_publications').select('version_id').eq('workflow_id', workflowId).single();
    expect(afterAudio.error).toBeNull();
    expect(afterAudio.data?.version_id).toBe(publication.version_id);
  }, 60000);

  it('resumes old rules with current data after publication without repeating its completed action', async () => {
    const workflowId = crypto.randomUUID();
    const executionId = crypto.randomUUID();
    const title = `Once ${workflowId}`;
    const caller = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const definition = { nodes: [
      { id: 't', type: 'trigger', data: { triggerType: 'lead_created', config: {} } },
      { id: 'action', type: 'action', data: { actionType: 'create_followup', followupTitle: title } },
      { id: 'wait', type: 'delay', data: { amount: 2, unit: 'hours' } },
      { id: 'c', type: 'condition', data: { guidedCondition: { version: 1, id: 'r', field: 'lead.name', operator: 'equals', value: 'José' } } },
      { id: 'yes', type: 'end', data: {} }, { id: 'no', type: 'end', data: {} },
    ], edges: [{ id: 'ta', source: 't', target: 'action' }, { id: 'aw', source: 'action', target: 'wait' },
      { id: 'wc', source: 'wait', target: 'c' }, { id: 'cy', source: 'c', target: 'yes', sourceHandle: 'yes' },
      { id: 'cn', source: 'c', target: 'no', sourceHandle: 'no' }] };
    const settings = { name: title };
    expect((await caller.rpc('create_guided_workflow_draft_with_settings', {
      p_workflow_id: workflowId, p_organization_id: orgA, p_definition: definition, p_settings: settings,
    })).error).toBeNull();
    expect((await caller.rpc('set_workflow_data_grant', { p_workflow_id: workflowId, p_fields: ['lead.name'], p_expected_revision: 0 })).error).toBeNull();
    const args = { p_workflow_id: workflowId, p_organization_id: orgA, p_actor_id: userId,
      p_expected_revision: 1, p_definition: definition, p_settings: settings, p_required_fields: ['lead.name'] };
    const first = await service.rpc('finalize_guided_workflow_publication', args);
    expect(first.error).toBeNull();
    expect((await service.from('workflow_executions').insert({ id: executionId, workflow_id: workflowId,
      organization_id: orgA, lead_id: leadA, status: 'waiting', next_run_at: '2099-01-01T00:00:00Z' })).error).toBeNull();
    const executionParams = { supabase: service, executionId, workflowId, organizationId: orgA, leadId: leadA,
      guidedVersionId: first.data.version_id, definition: { nodes: [], edges: [] }, loopLimit: 20, context: {} };
    expect(await executeWorkflow(executionParams)).toMatchObject({ success: true, status: 'paused' });
    const paused = await service.from('workflow_executions').select('current_node_id, loop_counters, context, guided_version_id').eq('id', executionId).single();
    expect(paused.error).toBeNull();
    expect(paused.data?.current_node_id).toBe('c');
    const nextDefinition = { ...definition, nodes: definition.nodes.map(node => node.id === 'c'
      ? { ...node, data: { guidedCondition: { version: 1, id: 'r', field: 'lead.name', operator: 'equals', value: 'Mariana' } } } : node) };
    expect((await caller.rpc('save_guided_workflow_draft_with_settings', { p_workflow_id: workflowId,
      p_definition: nextDefinition, p_settings: settings, p_expected_revision: 1 })).error).toBeNull();
    expect((await service.rpc('finalize_guided_workflow_publication', { ...args, p_expected_revision: 2, p_definition: nextDefinition })).error).toBeNull();
    expect((await service.from('leads').update({ name: 'Mariana' }).eq('organization_id', orgA).eq('id', leadA)).error).toBeNull();
    let restoreError: unknown;
    try {
      const resumed = await executeWorkflow({ ...executionParams, currentNodeId: paused.data!.current_node_id,
        loopCounters: paused.data!.loop_counters, context: paused.data!.context, definition: nextDefinition });
      expect(resumed).toMatchObject({ success: true, status: 'completed' });
      const tasks = await service.from('follow_ups').select('id').eq('organization_id', orgA).eq('lead_id', leadA).eq('title', title);
      expect(tasks.error).toBeNull();
      expect(tasks.data).toHaveLength(1);
      const steps = await service.from('workflow_execution_steps').select('node_id').eq('execution_id', executionId);
      expect(steps.error).toBeNull();
      expect(steps.data?.map(step => step.node_id).sort()).toEqual(['action', 'c', 'no', 't', 'wait']);
    } finally {
      restoreError = (await service.from('leads').update({ name: 'José' }).eq('organization_id', orgA).eq('id', leadA)).error;
    }
    expect(restoreError).toBeNull();
  }, 60000);

  it('lets an organization administrator explicitly approve and revoke lead-name access for one workflow', async () => {
    const workflowId = crypto.randomUUID();
    const created = await service.from('workflows').insert({ id: workflowId, organization_id: orgA,
      name: 'Grant test', trigger_type: 'manual', created_by: userId });
    if (created.error) throw created.error;
    const caller = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const approved = await caller.rpc('set_workflow_data_grant', {
      p_workflow_id: workflowId, p_fields: ['lead.name'], p_expected_revision: 0,
    });
    expect(approved.error).toBeNull();
    expect(approved.data).toMatchObject({ workflow_id: workflowId, organization_id: orgA,
      fields: ['lead.name'], resource_scope: 'organization_leads', revision: 1 });
    const stale = await caller.rpc('set_workflow_data_grant', {
      p_workflow_id: workflowId, p_fields: [], p_expected_revision: 0,
    }).abortSignal(AbortSignal.timeout(8000));
    expect(stale.error?.code).toBe('PT409');
    const unsupported = await caller.rpc('set_workflow_data_grant', {
      p_workflow_id: workflowId, p_fields: ['lead.name', 'lead.email'], p_expected_revision: 1,
    });
    expect(unsupported.error?.code).toBe('22023');
    const readable = await caller.from('workflow_data_grants').select('fields, revision')
      .eq('organization_id', orgA).eq('workflow_id', workflowId).single();
    expect(readable.error).toBeNull();
    expect(readable.data).toEqual({ fields: ['lead.name'], revision: 1 });
    const revoked = await caller.rpc('set_workflow_data_grant', {
      p_workflow_id: workflowId, p_fields: [], p_expected_revision: 1,
    });
    expect(revoked.error).toBeNull();
    expect(revoked.data).toMatchObject({ workflow_id: workflowId, fields: [], revision: 2 });
    const foreignWorkflow = crypto.randomUUID();
    const foreignCreated = await service.from('workflows').insert({ id: foreignWorkflow, organization_id: orgB,
      name: 'Other organization', trigger_type: 'manual' });
    if (foreignCreated.error) throw foreignCreated.error;
    const foreignApproval = await caller.rpc('set_workflow_data_grant', {
      p_workflow_id: foreignWorkflow, p_fields: ['lead.name'], p_expected_revision: 0,
    });
    expect(foreignApproval.error?.code).toBe('42501');
    const forged = await caller.from('workflow_data_grants').insert({ workflow_id: foreignWorkflow,
      organization_id: orgB, fields: ['lead.name'], revision: 1 });
    expect(forged.error?.code).toBe('42501');
  }, 60000);

  it('evaluates organizational data only while the workflow has a current explicit grant', async () => {
    const workflowId = crypto.randomUUID();
    const workflow = await service.from('workflows').insert({ id: workflowId, organization_id: orgA,
      name: 'Organizational evaluation', trigger_type: 'manual', created_by: userId });
    if (workflow.error) throw workflow.error;
    const request = {
      organizationId: orgA, leadId: leadA,
      authorization: { kind: 'organization' as const, workflowId },
      condition: { version: 1, id: 'rule-1', field: 'lead.name', operator: 'equals', value: 'JOSE' },
    };
    expect(await evaluateGuidedCondition(service, request)).toEqual({ status: 'error', code: 'access_denied' });
    const administrator = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const approved = await administrator.rpc('set_workflow_data_grant', {
      p_workflow_id: workflowId, p_fields: ['lead.name'], p_expected_revision: 0,
    });
    expect(approved.error).toBeNull();
    expect(await evaluateGuidedCondition(service, request)).toEqual({ status: 'evaluated', matched: true,
      rules: [{ id: 'rule-1', status: 'evaluated', matched: true, actual: 'José' }] });
    expect(await evaluateGuidedCondition(administrator, request)).toEqual({ status: 'error', code: 'access_denied' });
    expect(await evaluateGuidedCondition(service, { ...request, leadId: leadB }))
      .toEqual({ status: 'error', code: 'context_unavailable' });
    expect(await evaluateGuidedCondition(service, { ...request, organizationId: orgB, leadId: leadB }))
      .toEqual({ status: 'error', code: 'access_denied' });
    const revoked = await administrator.rpc('set_workflow_data_grant', {
      p_workflow_id: workflowId, p_fields: [], p_expected_revision: 1,
    });
    expect(revoked.error).toBeNull();
    expect(await evaluateGuidedCondition(service, request)).toEqual({ status: 'error', code: 'access_denied' });
  }, 60000);

  it('creates a new guided workflow inactive with a separate incomplete draft and no implicit data grant', async () => {
    const workflowId = crypto.randomUUID();
    const administrator = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: `guided-create-${workflowId}` },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const definition = { nodes: [{ id: 'condition-1', type: 'condition', data: { guidedCondition: {} } }], edges: [] };
    const created = await administrator.rpc('create_guided_workflow_draft', {
      p_workflow_id: workflowId, p_organization_id: orgA, p_name: 'New guided draft', p_definition: definition,
    });
    expect(created.error).toBeNull();
    expect(created.data).toEqual({ workflow_id: workflowId, revision: 1 });
    const workflow = await administrator.from('workflows').select('name, is_active, definition, created_by')
      .eq('organization_id', orgA).eq('id', workflowId).single();
    expect(workflow.error).toBeNull();
    expect(workflow.data).toEqual({ name: 'New guided draft', is_active: false,
      definition: { nodes: [], edges: [] }, created_by: userId });
    const draft = await administrator.from('workflow_guided_drafts').select('definition, revision')
      .eq('organization_id', orgA).eq('workflow_id', workflowId).single();
    expect(draft.error).toBeNull();
    expect(draft.data).toEqual({ definition, revision: 1 });
    const grants = await administrator.from('workflow_data_grants').select('fields')
      .eq('organization_id', orgA).eq('workflow_id', workflowId);
    expect(grants.error).toBeNull();
    expect(grants.data).toEqual([]);
    const duplicate = await administrator.rpc('create_guided_workflow_draft', {
      p_workflow_id: workflowId, p_organization_id: orgA, p_name: 'Duplicate', p_definition: {},
    });
    expect(duplicate.error?.code).toBe('23505');
    const unchanged = await administrator.from('workflow_guided_drafts').select('definition, revision')
      .eq('organization_id', orgA).eq('workflow_id', workflowId).single();
    expect(unchanged.data).toEqual({ definition, revision: 1 });
    const rejectedId = crypto.randomUUID();
    const foreign = await administrator.rpc('create_guided_workflow_draft', {
      p_workflow_id: rejectedId, p_organization_id: orgB, p_name: 'Foreign creation', p_definition: {},
    });
    expect(foreign.error?.code).toBe('42501');
    const invalid = await administrator.rpc('create_guided_workflow_draft', {
      p_workflow_id: rejectedId, p_organization_id: orgA, p_name: 'Invalid draft', p_definition: [],
    });
    expect(invalid.error?.code).toBe('22023');
    const absent = await administrator.from('workflows').select('id')
      .eq('organization_id', orgA).eq('id', rejectedId);
    expect(absent.error).toBeNull();
    expect(absent.data).toEqual([]);
  }, 60000);

  it('creates initial draft settings atomically with its rules', async () => {
    const workflowId = crypto.randomUUID();
    const administrator = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: `guided-initial-settings-${workflowId}` },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const settings = { name: 'Initial settings', re_enrollment_enabled: true, re_enrollment_cooldown_days: 9 };
    const created = await administrator.rpc('create_guided_workflow_draft_with_settings', {
      p_workflow_id: workflowId, p_organization_id: orgA, p_definition: { nodes: [], edges: [] }, p_settings: settings,
    });
    expect(created.error).toBeNull();
    expect(created.data).toEqual({ workflow_id: workflowId, revision: 1 });
    const draft = await administrator.from('workflow_guided_drafts').select('definition, settings, revision')
      .eq('organization_id', orgA).eq('workflow_id', workflowId).single();
    expect(draft.error).toBeNull();
    expect(draft.data).toEqual({ definition: { nodes: [], edges: [] }, settings, revision: 1 });
    const live = await administrator.from('workflows').select('is_active, re_enrollment_enabled')
      .eq('organization_id', orgA).eq('id', workflowId).single();
    expect(live.data).toEqual({ is_active: false, re_enrollment_enabled: false });
  }, 60000);

  it('saves draft settings and rules under one revision without changing live enrollment or name', async () => {
    const workflowId = crypto.randomUUID();
    const administrator = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: `guided-settings-${workflowId}` },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const definition = { nodes: [], edges: [] };
    const created = await administrator.rpc('create_guided_workflow_draft', {
      p_workflow_id: workflowId, p_organization_id: orgA, p_name: 'Live name', p_definition: definition,
    });
    expect(created.error).toBeNull();
    const settings = { name: 'Draft name', enrollment_criteria: { enabled: true, match_all: false, conditions: [] },
      re_enrollment_enabled: true, re_enrollment_cooldown_days: 7, re_enrollment_max_times: 4 };
    const saved = await administrator.rpc('save_guided_workflow_draft_with_settings', {
      p_workflow_id: workflowId, p_definition: definition, p_expected_revision: 1, p_settings: settings,
    });
    expect(saved.error).toBeNull();
    expect(saved.data).toEqual({ workflow_id: workflowId, revision: 2 });
    const draft = await administrator.from('workflow_guided_drafts').select('definition, settings, revision')
      .eq('organization_id', orgA).eq('workflow_id', workflowId).single();
    expect(draft.error).toBeNull();
    expect(draft.data).toEqual({ definition, settings, revision: 2 });
    const live = await administrator.from('workflows').select('name, re_enrollment_enabled, re_enrollment_cooldown_days')
      .eq('organization_id', orgA).eq('id', workflowId).single();
    expect(live.data).toEqual({ name: 'Live name', re_enrollment_enabled: false, re_enrollment_cooldown_days: 30 });
    const stale = await administrator.rpc('save_guided_workflow_draft_with_settings', {
      p_workflow_id: workflowId, p_definition: {}, p_expected_revision: 1, p_settings: { name: 'Stale overwrite' },
    });
    expect(stale.error?.code).toBe('PT409');
    const unchanged = await administrator.from('workflow_guided_drafts').select('definition, settings, revision')
      .eq('organization_id', orgA).eq('workflow_id', workflowId).single();
    expect(unchanged.data).toEqual({ definition, settings, revision: 2 });
    const invalid = await administrator.rpc('save_guided_workflow_draft_with_settings', {
      p_workflow_id: workflowId, p_definition: {}, p_expected_revision: 2, p_settings: [],
    });
    expect(invalid.error?.code).toBe('22023');
    const foreignId = crypto.randomUUID();
    const foreignCreation = await administrator.rpc('create_guided_workflow_draft_with_settings', {
      p_workflow_id: foreignId, p_organization_id: orgB, p_definition: {}, p_settings: { name: 'Unauthorized settings' },
    });
    expect(foreignCreation.error?.code).toBe('42501');
    const fixture = await service.from('workflows').insert({ id: foreignId, organization_id: orgB, name: 'Protected settings', trigger_type: 'manual' });
    if (fixture.error) throw fixture.error;
    const foreignSave = await administrator.rpc('save_guided_workflow_draft_with_settings', {
      p_workflow_id: foreignId, p_definition: {}, p_expected_revision: 0, p_settings: { name: 'Unauthorized update' },
    });
    expect(foreignSave.error?.code).toBe('42501');
    const preserved = await administrator.from('workflow_guided_drafts').select('definition, settings, revision')
      .eq('organization_id', orgA).eq('workflow_id', workflowId).single();
    expect(preserved.data).toEqual({ definition, settings, revision: 2 });
  }, 60000);

  it('publishes immutable versions atomically and preserves the active version after stale or unauthorized attempts', async () => {
    const workflowId = crypto.randomUUID();
    const administrator = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: `guided-publish-${workflowId}` },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const definition = { nodes: [
      { id: 't', type: 'trigger', data: { triggerType: 'lead_created', config: {} } },
      { id: 'c', type: 'condition', data: { guidedCondition: { version: 1, id: 'r', field: 'lead.name', operator: 'equals', value: 'José' } } },
      { id: 'y', type: 'end', data: {} }, { id: 'n', type: 'end', data: {} },
    ], edges: [{ id: 'tc', source: 't', target: 'c' },
      { id: 'cy', source: 'c', target: 'y', sourceHandle: 'yes' }, { id: 'cn', source: 'c', target: 'n', sourceHandle: 'no' }] };
    const settings = { name: 'Published first' };
    const created = await administrator.rpc('create_guided_workflow_draft_with_settings', {
      p_workflow_id: workflowId, p_organization_id: orgA, p_definition: definition, p_settings: settings,
    });
    expect(created.error).toBeNull();
    const args = { p_workflow_id: workflowId, p_organization_id: orgA, p_actor_id: userId,
      p_expected_revision: 1, p_definition: definition, p_settings: settings, p_required_fields: ['lead.name'] };
    const unapproved = await service.rpc('finalize_guided_workflow_publication', args);
    expect(unapproved.error?.code).toBe('42501');
    expect((await administrator.rpc('set_workflow_data_grant', {
      p_workflow_id: workflowId, p_fields: ['lead.name'], p_expected_revision: 0,
    })).error).toBeNull();
    expect((await administrator.rpc('finalize_guided_workflow_publication', args)).error?.code).toBe('42501');
    const first = await service.rpc('finalize_guided_workflow_publication', args);
    expect(first.error).toBeNull();
    expect(first.data).toMatchObject({ version_id: expect.any(String), version_number: 1 });
    const executionId = crypto.randomUUID();
    const enqueued = await service.from('workflow_executions').insert({ id: executionId, workflow_id: workflowId,
      organization_id: orgA, lead_id: leadA, status: 'waiting', next_run_at: '2099-01-01T00:00:00Z' })
      .select('guided_version_id').single();
    expect(enqueued.error).toBeNull();
    expect(enqueued.data?.guided_version_id).toBe(first.data.version_id);
    const secondSettings = { name: 'Published second' };
    expect((await administrator.rpc('save_guided_workflow_draft_with_settings', {
      p_workflow_id: workflowId, p_definition: definition, p_settings: secondSettings, p_expected_revision: 1,
    })).error).toBeNull();
    const second = await service.rpc('finalize_guided_workflow_publication', { ...args, p_expected_revision: 2, p_settings: secondSettings });
    expect(second.error).toBeNull();
    expect(second.data).toMatchObject({ version_number: 2 });
    const later = await service.from('workflow_executions').insert({ workflow_id: workflowId, organization_id: orgA,
      lead_id: leadA, status: 'waiting', next_run_at: '2099-01-01T00:00:00Z', guided_version_id: first.data.version_id }).select('guided_version_id').single();
    expect(later.error).toBeNull();
    expect(later.data?.guided_version_id).toBe(second.data.version_id);
    const originalExecution = await service.from('workflow_executions').select('guided_version_id').eq('id', executionId).single();
    expect(originalExecution.error).toBeNull();
    expect(originalExecution.data?.guided_version_id).toBe(first.data.version_id);
    const repin = await service.from('workflow_executions').update({ guided_version_id: second.data.version_id }).eq('id', executionId);
    expect(repin.error?.code).toBe('42501');
    const foreignEnqueue = await service.from('workflow_executions').insert({ workflow_id: workflowId, organization_id: orgB,
      lead_id: leadB, status: 'waiting', next_run_at: '2099-01-01T00:00:00Z' });
    expect(foreignEnqueue.error?.code).toBe('42501');
    expect((await service.from('leads').update({ name: 'Mariana' }).eq('id', leadA).eq('organization_id', orgA)).error).toBeNull();
    let restoreError: unknown;
    try {
      const executed = await executeWorkflow({ supabase: service, executionId, workflowId, organizationId: orgA,
        leadId: leadA, guidedVersionId: first.data.version_id, definition: { nodes: [], edges: [] }, loopLimit: 20, context: {} });
      expect(executed).toMatchObject({ success: true, status: 'completed' });
      const steps = await service.from('workflow_execution_steps').select('node_id').eq('execution_id', executionId);
      expect(steps.error).toBeNull();
      expect(steps.data?.map(step => step.node_id).sort()).toEqual(['c', 'n', 't']);
    } finally {
      const restored = await service.from('leads').update({ name: 'José' }).eq('id', leadA).eq('organization_id', orgA);
      restoreError = restored.error;
    }
    expect(restoreError).toBeNull();
    expect(second.data.version_id).not.toBe(first.data.version_id);
    const original = await administrator.from('workflow_guided_versions').select('definition, settings, source_revision')
      .eq('organization_id', orgA).eq('workflow_id', workflowId).eq('id', first.data.version_id).single();
    expect(original.error).toBeNull();
    expect(original.data).toEqual({ definition, settings, source_revision: 1 });
    for (const client of [administrator, service]) {
      expect((await client.from('workflow_guided_versions').update({ settings: {} })
        .eq('organization_id', orgA).eq('id', first.data.version_id)).error?.code).toBe('42501');
    }
    expect((await service.rpc('finalize_guided_workflow_publication', args)).error?.code).toBe('PT409');
    expect((await administrator.rpc('set_workflow_data_grant', {
      p_workflow_id: workflowId, p_fields: [], p_expected_revision: 1,
    })).error).toBeNull();
    expect((await service.rpc('finalize_guided_workflow_publication', { ...args, p_expected_revision: 2, p_settings: secondSettings })).error?.code).toBe('42501');
    const active = await administrator.from('workflow_guided_publications').select('version_id')
      .eq('organization_id', orgA).eq('workflow_id', workflowId).single();
    expect(active.error).toBeNull();
    expect(active.data).toEqual({ version_id: second.data.version_id });
  }, 60000);

  it('saves an incomplete guided draft without rewriting the existing workflow definition', async () => {
    const workflowId = crypto.randomUUID();
    const existingDefinition = { nodes: [{ id: 'trigger-1', type: 'trigger', data: { triggerType: 'lead_created' } }], edges: [] };
    const created = await service.from('workflows').insert({ id: workflowId, organization_id: orgA,
      name: 'Separate guided draft', trigger_type: 'lead_created', definition: existingDefinition, created_by: userId });
    if (created.error) throw created.error;
    const administrator = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const incomplete = { nodes: [{ id: 'condition-1', type: 'condition', data: { guidedCondition: {} } }], edges: [] };
    const saved = await administrator.rpc('save_guided_workflow_draft', {
      p_workflow_id: workflowId, p_definition: incomplete, p_expected_revision: 0,
    });
    expect(saved.error).toBeNull();
    expect(saved.data).toMatchObject({ workflow_id: workflowId, revision: 1 });
    const draft = await administrator.from('workflow_guided_drafts').select('definition, revision')
      .eq('organization_id', orgA).eq('workflow_id', workflowId).single();
    expect(draft.error).toBeNull();
    expect(draft.data).toEqual({ definition: incomplete, revision: 1 });
    const unchanged = await administrator.from('workflows').select('definition')
      .eq('organization_id', orgA).eq('id', workflowId).single();
    expect(unchanged.error).toBeNull();
    expect(unchanged.data?.definition).toEqual(existingDefinition);
    const concurrentDefinitions = [{ ...incomplete, label: 'Primeira edição' }, { ...incomplete, label: 'Segunda edição' }];
    const concurrent = await Promise.all(concurrentDefinitions.map(definition => administrator.rpc('save_guided_workflow_draft', {
      p_workflow_id: workflowId, p_definition: definition, p_expected_revision: 1,
    })));
    expect(concurrent.filter(response => response.error === null)).toHaveLength(1);
    expect(concurrent.filter(response => response.error?.code === 'PT409')).toHaveLength(1);
    const winner = concurrent.findIndex(response => response.error === null);
    const latest = await administrator.from('workflow_guided_drafts').select('definition, revision')
      .eq('organization_id', orgA).eq('workflow_id', workflowId).single();
    expect(latest.error).toBeNull();
    expect(latest.data).toEqual({ definition: concurrentDefinitions[winner], revision: 2 });
  }, 60000);

  it('denies a foreign organization administrator draft reads, RPC writes and forged inserts', async () => {
    const workflowId = crypto.randomUUID();
    const created = await service.from('workflows').insert({ id: workflowId, organization_id: orgB,
      name: 'Protected foreign draft', trigger_type: 'manual' });
    if (created.error) throw created.error;
    const administrator = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: `guided-foreign-${workflowId}` },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const temporaryMemberId = crypto.randomUUID();
    const membership = await service.from('team_members').insert({ id: temporaryMemberId,
      user_id: userId, organization_id: orgB, name: 'Draft fixture administrator', role: 'admin', is_active: true });
    if (membership.error) throw membership.error;
    let cleanupError: unknown = null;
    try {
      const seeded = await administrator.rpc('save_guided_workflow_draft', {
        p_workflow_id: workflowId, p_definition: { nodes: [], edges: [], label: 'Protected draft B' }, p_expected_revision: 0,
      });
      expect(seeded.error).toBeNull();
      const visible = await administrator.from('workflow_guided_drafts').select('revision')
        .eq('workflow_id', workflowId).single();
      expect(visible.data).toEqual({ revision: 1 });
    } finally {
      const removed = await service.from('team_members').delete().eq('id', temporaryMemberId);
      cleanupError = removed.error;
    }
    expect(cleanupError).toBeNull();
    const denied = await administrator.rpc('save_guided_workflow_draft', {
      p_workflow_id: workflowId, p_definition: { nodes: [], edges: [] }, p_expected_revision: 1,
    });
    expect(denied.error?.code).toBe('42501');
    const read = await administrator.from('workflow_guided_drafts').select('definition, revision')
      .eq('organization_id', orgB).eq('workflow_id', workflowId);
    expect(read.error).toBeNull();
    expect(read.data).toEqual([]);
    const forged = await administrator.from('workflow_guided_drafts').insert({
      workflow_id: workflowId, organization_id: orgA, definition: { nodes: [], edges: [] }, revision: 1,
    });
    expect(forged.error?.code).toBe('42501');
  }, 60000);

  it('allows full master administration but denies outbound-only and inactive master privileges', async () => {
    const workflowId = crypto.randomUUID();
    const password = `${crypto.randomUUID()}!Aa1`;
    const email = `guided-master-${crypto.randomUUID()}@example.test`;
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw created.error;
    try {
      const workflow = await service.from('workflows').insert({ id: workflowId, organization_id: orgB,
        name: 'Master administration', trigger_type: 'manual' });
      if (workflow.error) throw workflow.error;
      const master = await service.from('master_users').insert({ user_id: created.data.user.id,
        is_active: true, permissions: { all: true } });
      if (master.error) throw master.error;
      const caller = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false, storageKey: `guided-master-${workflowId}` },
      });
      const signedIn = await caller.auth.signInWithPassword({ email, password });
      if (signedIn.error) throw signedIn.error;
      const approved = await caller.rpc('set_workflow_data_grant', {
        p_workflow_id: workflowId, p_fields: ['lead.name'], p_expected_revision: 0,
      });
      expect(approved.error).toBeNull();
      const saved = await caller.rpc('save_guided_workflow_draft', {
        p_workflow_id: workflowId, p_definition: { nodes: [], edges: [] }, p_expected_revision: 0,
      });
      expect(saved.error).toBeNull();
      for (const table of ['workflow_data_grants', 'workflow_guided_drafts']) {
        const readable = await caller.from(table).select('revision').eq('workflow_id', workflowId).single();
        expect(readable.error).toBeNull();
        expect(readable.data).toEqual({ revision: 1 });
      }
      for (const state of [
        { is_active: true, permissions: { outbound_only: true } },
        { is_active: true, permissions: { all: 'true' } },
        { is_active: false, permissions: { all: true } },
      ]) {
        const changed = await service.from('master_users').update(state).eq('user_id', created.data.user.id);
        if (changed.error) throw changed.error;
        expect((await caller.rpc('set_workflow_data_grant', {
          p_workflow_id: workflowId, p_fields: [], p_expected_revision: 1,
        })).error?.code).toBe('42501');
        expect((await caller.rpc('save_guided_workflow_draft', {
          p_workflow_id: workflowId, p_definition: {}, p_expected_revision: 1,
        })).error?.code).toBe('42501');
        for (const table of ['workflow_data_grants', 'workflow_guided_drafts']) {
          const hidden = await caller.from(table).select('revision').eq('workflow_id', workflowId);
          expect(hidden.error).toBeNull();
          expect(hidden.data).toEqual([]);
        }
      }
    } finally {
      await service.from('master_users').delete().eq('user_id', created.data.user.id).throwOnError();
      await service.auth.admin.deleteUser(created.data.user.id);
    }
  }, 60000);

  it('evaluates an accessible lead but cannot infer another organization through manipulated IDs', async () => {
    const evaluate = async (organizationId: string, leadId: string) => {
      const response = await fetch(`${process.env.SUPABASE_URL}/functions/v1/test-guided-condition`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: process.env.SUPABASE_ANON_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId, leadId,
          condition: { version: 1, id: 'rule-1', field: 'lead.name', operator: 'equals', value: 'JOSE' } }),
      });
      return { status: response.status, body: await response.json() };
    };
    expect(await evaluate(orgA, leadA)).toEqual({ status: 200, body: {
      status: 'evaluated', matched: true,
      rules: [{ id: 'rule-1', status: 'evaluated', matched: true, actual: 'José' }],
    } });
    expect(await evaluate(orgA, leadB)).toEqual({ status: 422, body: { status: 'error', code: 'context_unavailable' } });
    expect(await evaluate(orgB, leadB)).toEqual({ status: 403, body: { status: 'error', code: 'access_denied' } });
  }, 60000);

  it('honors explicit responsible-only access within the same organization', async () => {
    const workflowId = crypto.randomUUID();
    const password = `${crypto.randomUUID()}!Aa1`;
    const email = `guided-member-${crypto.randomUUID()}@example.test`;
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw created.error;
    const failures: unknown[] = [];
    try {
      const memberId = crypto.randomUUID();
      const ownLead = crypto.randomUUID();
      const member = await service.from('team_members').insert({ id: memberId, user_id: created.data.user.id,
        // Current canonical storage key for the domain role “Membro”.
        organization_id: orgA, name: 'Responsible tester', role: 'member', is_active: true });
      if (member.error) throw member.error;
      // The live catalog grants broad lead visibility by default. State the
      // restrictive premise explicitly, as the repository's RLS seed does.
      const permissions = await service.from('member_feature_permissions').insert(
        ['leads.view_all', 'leads.view_unassigned', 'leads.view_subordinates'].map(feature_key => ({
          team_member_id: memberId, organization_id: orgA, feature_key, enabled: false,
        })),
      );
      if (permissions.error) throw permissions.error;
      const lead = await service.from('leads').insert({ id: ownLead, organization_id: orgA, name: 'Ana', pre_sale_responsible_id: memberId });
      if (lead.error) throw lead.error;
      const caller = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false, storageKey: `guided-member-${memberId}` },
      });
      const login = await caller.auth.signInWithPassword({ email, password });
      if (login.error) throw login.error;
      const workflow = await service.from('workflows').insert({ id: workflowId, organization_id: orgA,
        name: 'Member-created workflow', trigger_type: 'manual', created_by: created.data.user.id });
      if (workflow.error) throw workflow.error;
      const forbiddenGrant = await caller.rpc('set_workflow_data_grant', {
        p_workflow_id: workflowId, p_fields: ['lead.name'], p_expected_revision: 0,
      });
      expect(forbiddenGrant.error?.code).toBe('42501');
      const administrator = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const approval = await administrator.rpc('set_workflow_data_grant', {
        p_workflow_id: workflowId, p_fields: ['lead.name'], p_expected_revision: 0,
      });
      expect(approval.error).toBeNull();
      const draft = await administrator.rpc('save_guided_workflow_draft', {
        p_workflow_id: workflowId, p_definition: { nodes: [], edges: [] }, p_expected_revision: 0,
      });
      expect(draft.error).toBeNull();
      const deniedDraft = await caller.rpc('save_guided_workflow_draft', {
        p_workflow_id: workflowId, p_definition: { nodes: [], edges: [] }, p_expected_revision: 1,
      });
      expect(deniedDraft.error?.code).toBe('42501');
      const deniedSettings = await caller.rpc('save_guided_workflow_draft_with_settings', {
        p_workflow_id: workflowId, p_definition: {}, p_expected_revision: 1, p_settings: { name: 'Member write' },
      });
      expect(deniedSettings.error?.code).toBe('42501');
      const deniedCreation = await caller.rpc('create_guided_workflow_draft_with_settings', {
        p_workflow_id: crypto.randomUUID(), p_organization_id: orgA, p_definition: {}, p_settings: { name: 'Member creation' },
      });
      expect(deniedCreation.error?.code).toBe('42501');
      const hiddenDraft = await caller.from('workflow_guided_drafts').select('definition')
        .eq('organization_id', orgA).eq('workflow_id', workflowId);
      expect(hiddenDraft.error).toBeNull();
      expect(hiddenDraft.data).toEqual([]);
      const organizationalRequest = {
        organizationId: orgA, leadId: leadA, authorization: { kind: 'organization' as const, workflowId },
        condition: { version: 1, id: 'rule-1', field: 'lead.name', operator: 'equals', value: 'JOSE' },
      };
      expect(await evaluateGuidedCondition(service, organizationalRequest)).toMatchObject({ status: 'evaluated', matched: true });
      const hiddenGrant = await caller.from('workflow_data_grants').select('fields')
        .eq('organization_id', orgA).eq('workflow_id', workflowId);
      expect(hiddenGrant.error).toBeNull();
      expect(hiddenGrant.data).toEqual([]);
      const evaluate = async (leadId: string) => {
        const response = await fetch(`${process.env.SUPABASE_URL}/functions/v1/test-guided-condition`, {
          method: 'POST', headers: { Authorization: `Bearer ${login.data.session!.access_token}`,
            apikey: process.env.SUPABASE_ANON_KEY!, 'Content-Type': 'application/json' },
          body: JSON.stringify({ organizationId: orgA, leadId,
            condition: { version: 1, id: 'rule-1', field: 'lead.name', operator: 'equals', value: 'ANA' } }),
        });
        return response.json();
      };
      expect(await evaluate(ownLead)).toEqual({ status: 'evaluated', matched: true,
        rules: [{ id: 'rule-1', status: 'evaluated', matched: true, actual: 'Ana' }] });
      expect(await evaluate(leadA)).toEqual({ status: 'error', code: 'context_unavailable' });
      const revoked = await service.from('team_members').update({ is_active: false })
        .eq('organization_id', orgA).eq('id', memberId);
      if (revoked.error) throw revoked.error;
      expect(await evaluate(ownLead)).toEqual({ status: 'error', code: 'access_denied' });
      const survivingApproval = await administrator.from('workflow_data_grants').select('fields, revision')
        .eq('organization_id', orgA).eq('workflow_id', workflowId).single();
      expect(survivingApproval.error).toBeNull();
      expect(survivingApproval.data).toEqual({ fields: ['lead.name'], revision: 1 });
      expect(await evaluateGuidedCondition(service, organizationalRequest)).toMatchObject({ status: 'evaluated', matched: true });
    } catch (error) { failures.push(error); }
    // Existing workflows.created_by restricts auth-user deletion. Remove this
    // synthetic workflow before removing its creator, even after a failed test.
    const removedWorkflow = await service.from('workflows').delete().eq('organization_id', orgA).eq('id', workflowId);
    if (removedWorkflow.error) failures.push(removedWorkflow.error);
    const deleted = await service.auth.admin.deleteUser(created.data.user.id);
    if (deleted.error) failures.push(deleted.error);
    if (failures.length) throw new AggregateError(failures, 'Responsible-only evaluation or cleanup failed');
  }, 60000);
});
