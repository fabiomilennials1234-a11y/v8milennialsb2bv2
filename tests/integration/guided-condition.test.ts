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
      { id: leadA, organization_id: orgA, name: 'José', company: 'Fábrica Aurora', segment: 'Distribuição', urgency: 'Alta prioridade', faturamento: 'r$100_mil_a_r$150_mil', utm_campaign: '[VERÃO] B2B.', utm_source: 'Google', utm_medium: 'Pesquisa', utm_content: 'Vídeo A', utm_term: 'Fábrica', email: 'comercial@aurora.example', phone: '5511999990000', pre_sale_responsible_id: adminMemberId },
      { id: leadB, organization_id: orgB, name: 'Dado protegido', segment: 'Segmento restrito', urgency: 'Urgência restrita', faturamento: '500', utm_campaign: 'Campanha restrita', utm_source: 'Fonte restrita', utm_medium: 'Meio restrito', utm_content: 'Conteúdo restrito', utm_term: 'Termo restrito' },
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

  it('evaluates a custom text field by UUID and current definition', async () => {
    const fieldId = crypto.randomUUID(), foreignId = crypto.randomUUID(), replacementId = crypto.randomUUID();
    const caller = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: `guided-custom-${fieldId}` },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    await service.from('lead_custom_fields').insert([
      { id: fieldId, organization_id: orgA, field_name: 'Especialidade', field_type: 'text' },
      { id: foreignId, organization_id: orgB, field_name: 'Especialidade', field_type: 'text' },
    ]).throwOnError();
    try {
      await service.from('lead_custom_field_values').insert({ lead_id: leadA, field_id: fieldId, value: 'Distribuição elétrica' }).throwOnError();
      const result = await evaluateGuidedCondition(caller, { organizationId: orgA, leadId: leadA,
        condition: { version: 1, id: 'custom-rule', field: 'lead.custom', fieldId, fieldType: 'text', operator: 'equals', value: 'DISTRIBUICAO ELETRICA' } });
      expect(result).toEqual({ status: 'evaluated', matched: true, rules: [{ id: 'custom-rule', status: 'evaluated', matched: true,
        actual: 'Distribuição elétrica', reference: { id: fieldId, name: 'Especialidade' } }] });
      const catalogue = await caller.from('lead_custom_fields').select('id, field_name, field_type')
        .eq('organization_id', orgA).eq('field_type', 'text').ilike('field_name', '%Especialidade%').order('field_name').order('id').limit(25);
      expect(catalogue.error).toBeNull();
      expect(catalogue.data).toContainEqual({ id: fieldId, field_name: 'Especialidade', field_type: 'text' });
      const foreignCatalogue = await caller.from('lead_custom_fields').select('id, field_name, field_type')
        .eq('organization_id', orgB).eq('field_type', 'text').limit(25);
      expect(foreignCatalogue.error).toBeNull();
      expect(foreignCatalogue.data).toEqual([]);
      const condition = { version: 1, id: 'custom-rule', field: 'lead.custom', fieldId, fieldType: 'text', operator: 'contains', value: 'eletrica' };
      const request = { organizationId: orgA, leadId: leadA, condition };
      await service.from('lead_custom_fields').update({ field_name: 'Especialidade atual' }).eq('id', fieldId).throwOnError();
      expect(await evaluateGuidedCondition(caller, request)).toMatchObject({ status: 'evaluated', matched: true,
        rules: [{ reference: { id: fieldId, name: 'Especialidade atual' } }] });
      expect(await evaluateGuidedCondition(caller, { ...request, leadId: leadB })).toEqual({ status: 'error', code: 'context_unavailable' });
      expect(await evaluateGuidedCondition(caller, { ...request, condition: { ...condition, fieldId: foreignId } })).toEqual({ status: 'error', code: 'reference_unavailable' });
      expect(await evaluateGuidedCondition(service, { ...request, authorization: { kind: 'organization', workflowId: crypto.randomUUID() } })).toEqual({ status: 'error', code: 'access_denied' });
      const args = { p_organization_id: orgA, p_lead_id: leadA, p_field_ids: [fieldId] };
      expect((await service.rpc('test_guided_condition_custom_fields', args)).error?.code).toBe('42501');
      const anonymous = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false, storageKey: `guided-custom-anon-${fieldId}` },
      });
      expect((await anonymous.rpc('test_guided_condition_custom_fields', args)).error?.code).toBe('42501');
      await service.from('lead_custom_fields').update({ field_type: 'number' }).eq('id', fieldId).throwOnError();
      expect(await evaluateGuidedCondition(caller, { ...request, condition: { version: 1, id: 'any', kind: 'group', match: 'any', children: [
        { version: 1, id: 'name', field: 'lead.name', operator: 'is_not_empty' }, condition,
      ] } })).toEqual({ status: 'error', code: 'reference_unavailable' });
      await service.from('lead_custom_fields').update({ field_type: 'text' }).eq('id', fieldId).throwOnError();
      await service.from('lead_custom_field_values').delete().eq('field_id', fieldId).throwOnError();
      expect(await evaluateGuidedCondition(caller, { ...request, condition: { ...condition, operator: 'is_empty' } })).toMatchObject({ status: 'evaluated', matched: true, rules: [{ actual: null }] });
      expect(await evaluateGuidedCondition(caller, { ...request, condition: { ...condition, operator: 'not_equals' } })).toMatchObject({ status: 'evaluated', matched: false });
      await service.from('lead_custom_field_values').insert({ lead_id: leadA, field_id: fieldId, value: 'Distribuição elétrica' }).throwOnError();
      const response = await fetch(`${process.env.SUPABASE_URL}/functions/v1/test-guided-condition`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: process.env.SUPABASE_ANON_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify(request), signal: AbortSignal.timeout(15000),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: 'evaluated', matched: true, rules: [{ reference: { id: fieldId, name: 'Especialidade atual' } }] });
      await service.from('lead_custom_fields').delete().eq('id', fieldId).throwOnError();
      await service.from('lead_custom_fields').insert({ id: replacementId, organization_id: orgA, field_name: 'Especialidade atual', field_type: 'text' }).throwOnError();
      expect(await evaluateGuidedCondition(caller, request)).toEqual({ status: 'error', code: 'reference_unavailable' });
    } finally {
      await service.from('lead_custom_fields').delete().in('id', [fieldId, foreignId, replacementId]).throwOnError();
    }
  });

  it('authorizes a custom definition independently for automatic evaluation', async () => {
    const workflowId = crypto.randomUUID(), fieldId = crypto.randomUUID(), otherId = crypto.randomUUID(), foreignId = crypto.randomUUID(), tagId = crypto.randomUUID();
    const caller = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: `custom-grant-${fieldId}` },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    await service.from('workflows').insert({ id: workflowId, organization_id: orgA, name: 'Custom approval', trigger_type: 'manual' }).throwOnError();
    await service.from('lead_custom_fields').insert([
      { id: fieldId, organization_id: orgA, field_name: 'Especialidade', field_type: 'text' },
      { id: otherId, organization_id: orgA, field_name: 'Preferência', field_type: 'text' },
      { id: foreignId, organization_id: orgB, field_name: 'Preferência', field_type: 'text' },
    ]).throwOnError();
    try {
      await service.from('lead_custom_field_values').insert({ field_id: fieldId, lead_id: leadA, value: 'Indústria' }).throwOnError();
      const request = { organizationId: orgA, leadId: leadA, authorization: { kind: 'organization' as const, workflowId },
        condition: { version: 1, id: 'custom-org', field: 'lead.custom', fieldId, fieldType: 'text', operator: 'equals', value: 'INDUSTRIA' } };
      expect(await evaluateGuidedCondition(service, request)).toEqual({ status: 'error', code: 'access_denied' });
      const approval = await caller.rpc('set_workflow_data_grant', { p_workflow_id: workflowId, p_fields: [`lead.custom:${fieldId}`], p_expected_revision: 0 });
      expect(approval.error).toBeNull();
      expect(await evaluateGuidedCondition(service, request)).toMatchObject({ status: 'evaluated', matched: true, rules: [{ actual: 'Indústria', reference: { id: fieldId, name: 'Especialidade' } }] });
      const scope = `lead.custom:${fieldId}`;
      const args = { p_workflow_id: workflowId, p_organization_id: orgA, p_lead_id: leadA,
        p_fields: [scope], p_tag_ids: [], p_origin_ids: [], p_member_ids: [] };
      const projection = await service.rpc('read_guided_condition_custom_data', args);
      expect(projection.error).toBeNull();
      expect(projection.data).toEqual([{ id: leadA, organization_id: orgA, field_values: {
        custom_fields: [{ id: fieldId, name: 'Especialidade', field_type: 'text', value: 'Indústria' }],
      } }]);
      expect((await caller.rpc('read_guided_condition_custom_data', args)).error?.code).toBe('42501');
      const anonymous = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false, storageKey: `custom-reader-anon-${fieldId}` },
      });
      expect((await anonymous.rpc('read_guided_condition_custom_data', args)).error?.code).toBe('42501');
      expect((await service.rpc('read_guided_condition_custom_data', { ...args, p_organization_id: orgB })).error?.code).toBe('42501');
      expect((await service.rpc('read_guided_condition_custom_data', { ...args, p_lead_id: leadB })).error?.code).toBe('PT404');
      expect((await service.rpc('read_guided_condition_custom_data', { ...args, p_fields: [scope, 'lead.name'] })).error?.code).toBe('42501');
      expect(await evaluateGuidedCondition(service, { ...request, condition: { ...request.condition, fieldId: otherId } })).toEqual({ status: 'error', code: 'access_denied' });
      expect((await caller.rpc('set_workflow_data_grant', { p_workflow_id: workflowId, p_fields: [scope, `lead.custom:${foreignId}`], p_expected_revision: 1 })).error?.code).toBe('PT422');
      expect((await caller.rpc('set_workflow_data_grant', { p_workflow_id: workflowId, p_fields: ['lead.custom:*'], p_expected_revision: 1 })).error?.code).toBe('22023');
      expect((await caller.rpc('set_workflow_data_grant', { p_workflow_id: workflowId, p_fields: Array(257).fill('lead.name'), p_expected_revision: 1 })).error?.code).toBe('22023');
      await service.from('tags').insert({ id: tagId, organization_id: orgA, name: 'Fabricante' }).throwOnError();
      await service.from('lead_tags').insert({ lead_id: leadA, tag_id: tagId }).throwOnError();
      const ordinary = ['lead.name', 'lead.tags', 'lead.origin', 'lead.pre_sale_responsible_id'];
      expect((await caller.rpc('set_workflow_data_grant', { p_workflow_id: workflowId, p_fields: [scope, ...ordinary], p_expected_revision: 1 })).error).toBeNull();
      const mixed = { ...request, condition: { version: 1, id: 'all', kind: 'group', match: 'all', children: [request.condition,
        { version: 1, id: 'name', field: 'lead.name', operator: 'equals', value: 'JOSE' },
        { version: 1, id: 'tag', field: 'lead.tags', operator: 'has_tag', tagId },
        { version: 1, id: 'origin', field: 'lead.origin', operator: 'is_empty' },
        { version: 1, id: 'responsible', field: 'lead.pre_sale_responsible_id', operator: 'is_not_empty' },
      ] } };
      expect(await evaluateGuidedCondition(service, mixed)).toMatchObject({ status: 'evaluated', matched: true,
        rules: [{ id: 'custom-org', matched: true }, { id: 'name', matched: true }, { id: 'tag', matched: true }, { id: 'origin', matched: true }, { id: 'responsible', matched: true }] });
      await service.from('lead_custom_fields').update({ field_type: 'number' }).eq('id', fieldId).throwOnError();
      expect(await evaluateGuidedCondition(service, request)).toEqual({ status: 'error', code: 'reference_unavailable' });
      await service.from('lead_custom_fields').update({ field_type: 'text' }).eq('id', fieldId).throwOnError();
      expect((await caller.rpc('set_workflow_data_grant', { p_workflow_id: workflowId, p_fields: ordinary, p_expected_revision: 2 })).error).toBeNull();
      expect(await evaluateGuidedCondition(service, request)).toEqual({ status: 'error', code: 'access_denied' });
      expect((await caller.rpc('set_workflow_data_grant', { p_workflow_id: workflowId, p_fields: [scope, ...ordinary], p_expected_revision: 3 })).error).toBeNull();
      await service.from('lead_custom_fields').delete().eq('id', fieldId).throwOnError();
      expect(await evaluateGuidedCondition(service, request)).toEqual({ status: 'error', code: 'reference_unavailable' });
      // Removing another scope must remain possible while a deleted field is retained.
      expect((await caller.rpc('set_workflow_data_grant', { p_workflow_id: workflowId, p_fields: [scope], p_expected_revision: 4 })).error).toBeNull();
      expect((await caller.rpc('set_workflow_data_grant', { p_workflow_id: workflowId, p_fields: [], p_expected_revision: 5 })).error).toBeNull();
      expect(await evaluateGuidedCondition(service, request)).toEqual({ status: 'error', code: 'access_denied' });
    } finally {
      await service.from('workflows').delete().eq('id', workflowId).throwOnError();
      await service.from('lead_custom_fields').delete().in('id', [fieldId, otherId, foreignId]).throwOnError();
      await service.from('lead_tags').delete().eq('tag_id', tagId).throwOnError();
      await service.from('tags').delete().eq('id', tagId).throwOnError();
    }
  });

  it('restarts stage time when the same business enters another funnel with the same stage key', async () => {
    const pipelineA = crypto.randomUUID(), pipelineB = crypto.randomUUID();
    const stageA = crypto.randomUUID(), stageB = crypto.randomUUID(), entryId = crypto.randomUUID();
    const caller = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: `stage-time-${entryId}` },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const originalTime = '2024-01-01T00:00:00+00:00';
    await service.from('pipelines').insert([
      { id: pipelineA, organization_id: orgA, name: 'Canal A', slug: `stage-a-${pipelineA}`, type: 'custom' },
      { id: pipelineB, organization_id: orgA, name: 'Canal B', slug: `stage-b-${pipelineB}`, type: 'custom' },
    ]).throwOnError();
    try {
      await service.from('pipeline_stages').insert([
        { id: stageA, organization_id: orgA, pipeline_id: pipelineA, stage_key: 'proposal', name: 'Proposta A', position: 0 },
        { id: stageB, organization_id: orgA, pipeline_id: pipelineB, stage_key: 'proposal', name: 'Proposta B', position: 0 },
      ]).throwOnError();
      await service.from('pipeline_entries').insert({ id: entryId, organization_id: orgA, lead_id: leadA,
        pipeline_id: pipelineA, stage_id: stageA, stage_key: 'proposal', stage_changed_at: originalTime }).throwOnError();
      const update = async (patch: Record<string, unknown>) => {
        const result = await caller.from('pipeline_entries').update(patch).eq('organization_id', orgA).eq('id', entryId)
          .select('id,pipeline_id,stage_id,stage_key,stage_changed_at').single();
        expect(result.error).toBeNull();
        return result.data!;
      };
      expect((await update({ notes: 'Nota comercial' })).stage_changed_at).toBe(originalTime);
      const moved = await update({ pipeline_id: pipelineB, stage_id: stageB });
      expect(moved).toMatchObject({ id: entryId, pipeline_id: pipelineB, stage_id: stageB, stage_key: 'proposal' });
      expect(moved.stage_changed_at).not.toBe(originalTime);
      expect((await update({ notes: 'Outra nota' })).stage_changed_at).toBe(moved.stage_changed_at);
      const returned = await update({ pipeline_id: pipelineA, stage_id: stageA });
      expect(returned).toMatchObject({ id: entryId, pipeline_id: pipelineA, stage_id: stageA });
      expect(Date.parse(returned.stage_changed_at)).toBeGreaterThan(Date.parse(moved.stage_changed_at));
    } finally {
      await service.from('pipeline_entries').delete().eq('id', entryId).throwOnError();
      await service.from('pipeline_stages').delete().in('id', [stageA, stageB]).throwOnError();
      await service.from('followup_reclassify_queue').delete().eq('organization_id', orgA).throwOnError();
      await service.from('pipelines').delete().in('id', [pipelineA, pipelineB]).throwOnError();
    }
  }, 60000);

  it('compares the current stage of the exact triggering business without substituting another card', async () => {
    const pipelineId = crypto.randomUUID(), otherPipelineId = crypto.randomUUID();
    const stageId = crypto.randomUUID(), otherStageId = crypto.randomUUID();
    const entryId = crypto.randomUUID(), otherEntryId = crypto.randomUUID();
    const caller = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: `trigger-business-${entryId}` },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const condition = { version: 1, id: 'stage', field: 'business.trigger.stage', operator: 'equals', pipelineId, stageId };
    await service.from('pipelines').insert([
      { id: pipelineId, organization_id: orgA, name: 'Comercial', slug: `commercial-${pipelineId}`, type: 'custom' },
      { id: otherPipelineId, organization_id: orgA, name: 'Renovação', slug: `renewal-${otherPipelineId}`, type: 'custom' },
    ]).throwOnError();
    try {
      await service.from('pipeline_stages').insert([
        { id: stageId, organization_id: orgA, pipeline_id: pipelineId, stage_key: 'proposal', name: 'Proposta', position: 0 },
        { id: otherStageId, organization_id: orgA, pipeline_id: otherPipelineId, stage_key: 'proposal', name: 'Proposta renovação', position: 0 },
      ]).throwOnError();
      await service.from('pipeline_entries').insert([
        { id: entryId, organization_id: orgA, lead_id: leadA, pipeline_id: pipelineId, stage_id: stageId, stage_key: 'proposal' },
        { id: otherEntryId, organization_id: orgA, lead_id: leadA, pipeline_id: otherPipelineId, stage_id: otherStageId, stage_key: 'proposal' },
      ]).throwOnError();
      const evaluate = (rule: unknown, selectedEntryId: string | null = entryId) => evaluateGuidedCondition(caller, {
        organizationId: orgA, leadId: leadA, entryId: selectedEntryId, condition: rule,
      });
      expect(await evaluate(condition)).toMatchObject({ status: 'evaluated', matched: true,
        rules: [{ actual: stageId, reference: { id: stageId, name: 'Proposta' }, context: { entryId, pipeline: { id: pipelineId, name: 'Comercial' } } }],
      });
      expect(await evaluate({ ...condition, operator: 'not_equals' })).toMatchObject({ status: 'evaluated', matched: false });
      expect(await evaluate({ ...condition, stageId: otherStageId, pipelineId: otherPipelineId })).toMatchObject({ status: 'evaluated', matched: false });
      expect(await evaluate({ ...condition, stageId: otherStageId })).toEqual({ status: 'error', code: 'reference_unavailable' });
      expect(await evaluate(condition, null)).toEqual({ status: 'error', code: 'context_unavailable' });
      expect(await evaluate(condition, otherEntryId)).toMatchObject({ status: 'evaluated', matched: false });
      await service.from('pipeline_entries').delete().eq('id', entryId).throwOnError();
      expect(await evaluate(condition)).toEqual({ status: 'error', code: 'context_unavailable' });
      expect(await evaluateGuidedCondition(caller, { organizationId: orgB, leadId: leadB, entryId: otherEntryId, condition }))
        .toEqual({ status: 'error', code: 'context_unavailable' });
      const response = await fetch(`${process.env.SUPABASE_URL}/functions/v1/test-guided-condition`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: process.env.SUPABASE_ANON_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgA, leadId: leadA, entryId: otherEntryId,
          condition: { ...condition, pipelineId: otherPipelineId, stageId: otherStageId } }), signal: AbortSignal.timeout(15000),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: 'evaluated', matched: true,
        rules: [{ actual: otherStageId, reference: { id: otherStageId, name: 'Proposta renovação' } }],
      });
    } finally {
      await service.from('pipeline_entries').delete().in('id', [entryId, otherEntryId]).throwOnError();
      await service.from('pipeline_stages').delete().in('id', [stageId, otherStageId]).throwOnError();
      await service.from('followup_reclassify_queue').delete().eq('organization_id', orgA).throwOnError();
      await service.from('pipelines').delete().in('id', [pipelineId, otherPipelineId]).throwOnError();
    }
  }, 60000);

  it('publishes and executes a trigger-business stage rule through its atomic organization grant', async () => {
    const workflowId = crypto.randomUUID(), pipelineId = crypto.randomUUID(), stageId = crypto.randomUUID();
    const entryId = crypto.randomUUID(), executionId = crypto.randomUUID();
    const caller = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: `business-publish-${workflowId}` },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const condition = { version: 1, id: 'stage', field: 'business.trigger.stage', operator: 'equals', pipelineId, stageId };
    const definition = { nodes: [
      { id: 't', type: 'trigger', data: { triggerType: 'pipeline_stage_changed', config: {} } },
      { id: 'c', type: 'condition', data: { guidedCondition: condition } },
      { id: 'yes', type: 'end', data: {} }, { id: 'no', type: 'end', data: {} },
    ], edges: [{ id: 'tc', source: 't', target: 'c' }, { id: 'cy', source: 'c', target: 'yes', sourceHandle: 'yes' },
      { id: 'cn', source: 'c', target: 'no', sourceHandle: 'no' }] };
    const settings = { name: 'Etapa do negócio do gatilho' };
    await service.from('pipelines').insert({ id: pipelineId, organization_id: orgA, name: 'Comercial', slug: `guided-${pipelineId}`, type: 'custom' }).throwOnError();
    try {
      await service.from('pipeline_stages').insert({ id: stageId, organization_id: orgA, pipeline_id: pipelineId,
        stage_key: 'proposal', name: 'Proposta', position: 0 }).throwOnError();
      await service.from('pipeline_entries').insert({ id: entryId, organization_id: orgA, lead_id: leadA,
        pipeline_id: pipelineId, stage_id: stageId, stage_key: 'proposal' }).throwOnError();
      expect((await caller.rpc('create_guided_workflow_draft_with_settings', { p_workflow_id: workflowId,
        p_organization_id: orgA, p_definition: definition, p_settings: settings })).error).toBeNull();
      expect((await caller.rpc('set_workflow_data_grant', { p_workflow_id: workflowId,
        p_fields: ['business.trigger.stage'], p_expected_revision: 0 })).error).toBeNull();
      const readArgs = { p_workflow_id: workflowId, p_organization_id: orgA, p_lead_id: leadA,
        p_entry_id: entryId, p_references: [{ pipelineId, stageId }] };
      expect((await caller.rpc('read_guided_condition_trigger_business_stage', readArgs)).error?.code).toBe('42501');
      const authorizedRead = await service.rpc('read_guided_condition_trigger_business_stage', readArgs);
      expect(authorizedRead.error).toBeNull();
      expect(authorizedRead.data).toMatchObject({
        entry: { id: entryId, pipeline_id: pipelineId, stage_id: stageId },
        pipelines: [{ id: pipelineId, name: 'Comercial' }], stages: [{ id: stageId, name: 'Proposta', pipeline_id: pipelineId }],
      });
      expect((await service.rpc('read_guided_condition_trigger_business_stage', { ...readArgs,
        p_references: [{ pipelineId, stageId: crypto.randomUUID() }] })).error?.code).toBe('PT422');
      const request = { organizationId: orgA, leadId: leadA, entryId, condition,
        authorization: { kind: 'organization' as const, workflowId } };
      expect(await evaluateGuidedCondition(service, request)).toMatchObject({ status: 'evaluated', matched: true,
        rules: [{ actual: stageId, reference: { id: stageId, name: 'Proposta' } }],
      });
      expect(await evaluateGuidedCondition(service, { ...request, entryId: null })).toEqual({ status: 'error', code: 'context_unavailable' });
      const finalized = await service.rpc('finalize_guided_workflow_publication', { p_workflow_id: workflowId,
        p_organization_id: orgA, p_actor_id: userId, p_expected_revision: 1, p_definition: definition,
        p_settings: settings, p_required_fields: ['business.trigger.stage'] });
      expect(finalized.error).toBeNull();
      expect((await service.from('workflow_executions').insert({ id: executionId, workflow_id: workflowId,
        organization_id: orgA, lead_id: leadA, pipeline_entry_id: entryId, status: 'waiting', next_run_at: '2099-01-01T00:00:00Z' })).error).toBeNull();
      expect(await executeWorkflow({ supabase: service, executionId, workflowId, organizationId: orgA, leadId: leadA,
        entryId, guidedVersionId: finalized.data.version_id, definition: { nodes: [], edges: [] }, loopLimit: 20, context: {} }))
        .toMatchObject({ success: true, status: 'completed' });
      const steps = await service.from('workflow_execution_steps').select('node_id').eq('execution_id', executionId);
      expect(steps.data?.map(step => step.node_id)).toContain('yes');
      const missingStage = crypto.randomUUID();
      const invalidDefinition = { ...definition, nodes: definition.nodes.map(node => node.id === 'c'
        ? { ...node, data: { guidedCondition: { ...condition, stageId: missingStage } } } : node) };
      expect((await caller.rpc('save_guided_workflow_draft_with_settings', { p_workflow_id: workflowId,
        p_expected_revision: 1, p_definition: invalidDefinition, p_settings: settings })).error).toBeNull();
      const rejected = await service.rpc('finalize_guided_workflow_publication', { p_workflow_id: workflowId,
        p_organization_id: orgA, p_actor_id: userId, p_expected_revision: 2, p_definition: invalidDefinition,
        p_settings: settings, p_required_fields: ['business.trigger.stage'] });
      expect(rejected.error?.code).toBe('PT422');
      expect(JSON.parse(rejected.error?.details || '{}')).toEqual({ nodeIds: ['c'] });
      const active = await caller.from('workflow_guided_publications').select('version_id').eq('workflow_id', workflowId).single();
      expect(active.data?.version_id).toBe(finalized.data.version_id);
      await service.from('pipeline_entries').delete().eq('id', entryId).throwOnError();
      expect(await evaluateGuidedCondition(service, request)).toEqual({ status: 'error', code: 'context_unavailable' });
      expect((await caller.rpc('set_workflow_data_grant', { p_workflow_id: workflowId,
        p_fields: [], p_expected_revision: 1 })).error).toBeNull();
      expect(await evaluateGuidedCondition(service, request)).toEqual({ status: 'error', code: 'access_denied' });
    } finally {
      await service.from('workflows').delete().eq('id', workflowId).throwOnError();
      await service.from('pipeline_entries').delete().eq('id', entryId).throwOnError();
      await service.from('pipeline_stages').delete().eq('id', stageId).throwOnError();
      await service.from('followup_reclassify_queue').delete().eq('organization_id', orgA).throwOnError();
      await service.from('pipelines').delete().eq('id', pipelineId).throwOnError();
    }
  }, 60000);

  it('reads value from the exact triggering business and keeps missing financial data empty', async () => {
    const pipelineId = crypto.randomUUID(), stageId = crypto.randomUUID(), dealId = crypto.randomUUID(), entryId = crypto.randomUUID();
    const workflowId = crypto.randomUUID(), executionId = crypto.randomUUID();
    const caller = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: `business-value-${entryId}` },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const valueRule = { version: 1, id: 'value', field: 'business.trigger.value', operator: 'greater_than', value: 1000 };
    const stageRule = { version: 1, id: 'stage', field: 'business.trigger.stage', operator: 'equals', pipelineId, stageId };
    await service.from('pipelines').insert({ id: pipelineId, organization_id: orgA, name: 'Comercial', slug: `value-${pipelineId}`, type: 'custom' }).throwOnError();
    try {
      await service.from('pipeline_stages').insert({ id: stageId, organization_id: orgA, pipeline_id: pipelineId,
        stage_key: 'proposal', name: 'Proposta', position: 0 }).throwOnError();
      await service.from('deals').insert({ id: dealId, organization_id: orgA, title: 'Contrato anual', value: 1250.5, source: 'api' }).throwOnError();
      await service.from('pipeline_entries').insert({ id: entryId, organization_id: orgA, lead_id: leadA, deal_id: dealId,
        pipeline_id: pipelineId, stage_id: stageId, stage_key: 'proposal' }).throwOnError();
      const evaluate = (condition: unknown) => evaluateGuidedCondition(caller, { organizationId: orgA, leadId: leadA, entryId, condition });
      expect(await evaluate(valueRule)).toMatchObject({ status: 'evaluated', matched: true,
        rules: [{ actual: 1250.5, context: { entryId, pipeline: { id: pipelineId, name: 'Comercial' } } }],
      });
      expect(await evaluate({ version: 1, id: 'both', kind: 'group', match: 'all', children: [stageRule, valueRule] }))
        .toMatchObject({ status: 'evaluated', matched: true, rules: [{ id: 'stage', actual: stageId }, { id: 'value', actual: 1250.5 }] });
      await service.from('deals').update({ value: 0 }).eq('id', dealId).throwOnError();
      expect(await evaluate({ ...valueRule, operator: 'equals', value: 0 })).toMatchObject({ status: 'evaluated', matched: true, rules: [{ actual: 0 }] });
      expect(await evaluate({ ...valueRule, operator: 'is_empty', value: undefined })).toMatchObject({ status: 'evaluated', matched: false });
      await service.from('pipeline_entries').update({ deal_id: null }).eq('id', entryId).throwOnError();
      expect(await evaluate({ ...valueRule, operator: 'is_empty', value: undefined })).toMatchObject({ status: 'evaluated', matched: true, rules: [{ actual: null }] });
      expect(await evaluate({ ...valueRule, operator: 'equals', value: 0 })).toMatchObject({ status: 'evaluated', matched: false, rules: [{ actual: null }] });
      await service.from('pipeline_entries').update({ deal_id: dealId }).eq('id', entryId).throwOnError();
      await service.from('deals').update({ deleted_at: new Date().toISOString() }).eq('id', dealId).throwOnError();
      expect(await evaluate({ ...valueRule, operator: 'is_empty', value: undefined })).toMatchObject({ status: 'evaluated', matched: true, rules: [{ actual: null }] });
      const response = await fetch(`${process.env.SUPABASE_URL}/functions/v1/test-guided-condition`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: process.env.SUPABASE_ANON_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgA, leadId: leadA, entryId,
          condition: { ...valueRule, operator: 'is_empty', value: undefined } }), signal: AbortSignal.timeout(15000),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: 'evaluated', matched: true, rules: [{ actual: null }] });
      await service.from('deals').update({ deleted_at: null, value: 1250.5 }).eq('id', dealId).throwOnError();
      const grouped = { version: 1, id: 'both', kind: 'group', match: 'all', children: [stageRule, valueRule] };
      const definition = { nodes: [
        { id: 't', type: 'trigger', data: { triggerType: 'pipeline_stage_changed', config: {} } },
        { id: 'c', type: 'condition', data: { guidedCondition: grouped } },
        { id: 'yes', type: 'end', data: {} }, { id: 'no', type: 'end', data: {} },
      ], edges: [{ id: 'tc', source: 't', target: 'c' }, { id: 'cy', source: 'c', target: 'yes', sourceHandle: 'yes' },
        { id: 'cn', source: 'c', target: 'no', sourceHandle: 'no' }] };
      const settings = { name: 'Etapa e valor do negócio do gatilho' };
      await caller.rpc('create_guided_workflow_draft_with_settings', { p_workflow_id: workflowId,
        p_organization_id: orgA, p_definition: definition, p_settings: settings }).throwOnError();
      await caller.rpc('set_workflow_data_grant', { p_workflow_id: workflowId,
        p_fields: ['business.trigger.stage'], p_expected_revision: 0 }).throwOnError();
      const automatic = { organizationId: orgA, leadId: leadA, entryId, condition: grouped,
        authorization: { kind: 'organization' as const, workflowId } };
      expect(await evaluateGuidedCondition(service, automatic)).toEqual({ status: 'error', code: 'access_denied' });
      await caller.rpc('set_workflow_data_grant', { p_workflow_id: workflowId,
        p_fields: ['business.trigger.stage', 'business.trigger.value'], p_expected_revision: 1 }).throwOnError();
      expect(await evaluateGuidedCondition(service, automatic)).toMatchObject({ status: 'evaluated', matched: true,
        rules: [{ id: 'stage', actual: stageId }, { id: 'value', actual: 1250.5 }],
      });
      const publishArgs = { p_workflow_id: workflowId, p_organization_id: orgA, p_actor_id: userId,
        p_expected_revision: 1, p_definition: definition, p_settings: settings,
        p_required_fields: ['business.trigger.stage', 'business.trigger.value'] };
      expect((await service.rpc('finalize_guided_workflow_publication', { ...publishArgs,
        p_required_fields: ['business.trigger.stage'] })).error?.code).toBe('42501');
      const finalized = await service.rpc('finalize_guided_workflow_publication', publishArgs);
      expect(finalized.error).toBeNull();
      await service.from('workflow_executions').insert({ id: executionId, workflow_id: workflowId, organization_id: orgA,
        lead_id: leadA, pipeline_entry_id: entryId, status: 'waiting', next_run_at: '2099-01-01T00:00:00Z' }).throwOnError();
      expect(await executeWorkflow({ supabase: service, executionId, workflowId, organizationId: orgA, leadId: leadA,
        entryId, guidedVersionId: finalized.data.version_id, definition: { nodes: [], edges: [] }, loopLimit: 20, context: {} }))
        .toMatchObject({ success: true, status: 'completed' });
      const steps = await service.from('workflow_execution_steps').select('node_id').eq('execution_id', executionId);
      expect(steps.data?.map(step => step.node_id)).toContain('yes');
      await caller.rpc('set_workflow_data_grant', { p_workflow_id: workflowId,
        p_fields: ['business.trigger.stage'], p_expected_revision: 2 }).throwOnError();
      expect(await evaluateGuidedCondition(service, automatic)).toEqual({ status: 'error', code: 'access_denied' });
    } finally {
      await service.from('workflows').delete().eq('id', workflowId).throwOnError();
      await service.from('pipeline_entries').delete().eq('id', entryId).throwOnError();
      await service.from('deals').delete().eq('id', dealId).throwOnError();
      await service.from('pipeline_stages').delete().eq('id', stageId).throwOnError();
      await service.from('followup_reclassify_queue').delete().eq('organization_id', orgA).throwOnError();
      await service.from('pipelines').delete().eq('id', pipelineId).throwOnError();
    }
  }, 60000);

  it('measures elapsed time from the exact entry stage clock without generic timestamp fallbacks', async () => {
    const pipelineId = crypto.randomUUID(), stageId = crypto.randomUUID(), entryId = crypto.randomUUID();
    const workflowId = crypto.randomUUID(), executionId = crypto.randomUUID();
    const caller = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: `business-elapsed-${entryId}` },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const condition = { version: 1, id: 'elapsed', field: 'business.trigger.stage_elapsed',
      operator: 'greater_than_or_equal', value: 2, unit: 'hours' };
    await service.from('pipelines').insert({ id: pipelineId, organization_id: orgA, name: 'Comercial', slug: `elapsed-${pipelineId}`, type: 'custom' }).throwOnError();
    try {
      await service.from('pipeline_stages').insert({ id: stageId, organization_id: orgA, pipeline_id: pipelineId,
        stage_key: 'proposal', name: 'Proposta', position: 0 }).throwOnError();
      await service.from('pipeline_entries').insert({ id: entryId, organization_id: orgA, lead_id: leadA,
        pipeline_id: pipelineId, stage_id: stageId, stage_key: 'proposal',
        stage_changed_at: new Date(Date.now() - 125 * 60_000).toISOString() }).throwOnError();
      const evaluate = (rule: unknown) => evaluateGuidedCondition(caller, { organizationId: orgA, leadId: leadA, entryId, condition: rule });
      const initial = await evaluate(condition);
      expect(initial).toMatchObject({ status: 'evaluated', matched: true,
        rules: [{ id: 'elapsed', matched: true, context: { entryId, pipeline: { id: pipelineId, name: 'Comercial' } } }],
      });
      expect(initial.status === 'evaluated' && initial.rules[0].actual).toBeGreaterThanOrEqual(125 / 60);
      expect(initial.status === 'evaluated' && initial.rules[0].actual).toBeLessThan(2.2);
      expect(await evaluate({ ...condition, value: 3 })).toMatchObject({ status: 'evaluated', matched: false });
      expect(await evaluate({ ...condition, value: 120, unit: 'minutes' })).toMatchObject({ status: 'evaluated', matched: true });
      expect(await evaluate({ ...condition, operator: 'less_than', value: 1, unit: 'days' })).toMatchObject({ status: 'evaluated', matched: true });
      expect(await evaluate({ ...condition, value: -1 })).toEqual({ status: 'error', code: 'invalid_configuration' });
      expect(await evaluate({ ...condition, unit: 'weeks' })).toEqual({ status: 'error', code: 'invalid_configuration' });

      await service.from('pipeline_entries').update({ stage_changed_at: null, updated_at: '2020-01-01T00:00:00Z' }).eq('id', entryId).throwOnError();
      expect(await evaluate(condition)).toEqual({ status: 'error', code: 'source_unavailable' });
      await service.from('pipeline_entries').update({ stage_changed_at: new Date(Date.now() + 60_000).toISOString() }).eq('id', entryId).throwOnError();
      expect(await evaluate(condition)).toEqual({ status: 'error', code: 'source_unavailable' });
      const reliableTime = new Date(Date.now() - 125 * 60_000).toISOString();
      await service.from('pipeline_entries').update({ stage_changed_at: reliableTime }).eq('id', entryId).throwOnError();
      await caller.from('pipeline_entries').update({ notes: 'Não reinicia relógio' }).eq('organization_id', orgA).eq('id', entryId).throwOnError();
      expect(Date.parse((await service.from('pipeline_entries').select('stage_changed_at').eq('id', entryId).single()).data?.stage_changed_at)).toBe(Date.parse(reliableTime));

      const response = await fetch(`${process.env.SUPABASE_URL}/functions/v1/test-guided-condition`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: process.env.SUPABASE_ANON_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgA, leadId: leadA, entryId, condition }), signal: AbortSignal.timeout(15000),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: 'evaluated', matched: true });

      const definition = { nodes: [
        { id: 't', type: 'trigger', data: { triggerType: 'pipeline_stage_changed', config: {} } },
        { id: 'c', type: 'condition', data: { guidedCondition: condition } },
        { id: 'yes', type: 'end', data: {} }, { id: 'no', type: 'end', data: {} },
      ], edges: [{ id: 'tc', source: 't', target: 'c' }, { id: 'cy', source: 'c', target: 'yes', sourceHandle: 'yes' },
        { id: 'cn', source: 'c', target: 'no', sourceHandle: 'no' }] };
      const settings = { name: 'Tempo na etapa do negócio do gatilho' };
      await caller.rpc('create_guided_workflow_draft_with_settings', { p_workflow_id: workflowId,
        p_organization_id: orgA, p_definition: definition, p_settings: settings }).throwOnError();
      await caller.rpc('set_workflow_data_grant', { p_workflow_id: workflowId,
        p_fields: ['business.trigger.stage_elapsed'], p_expected_revision: 0 }).throwOnError();
      const automatic = { organizationId: orgA, leadId: leadA, entryId, condition,
        authorization: { kind: 'organization' as const, workflowId } };
      expect(await evaluateGuidedCondition(service, automatic)).toMatchObject({ status: 'evaluated', matched: true });
      const invalidDefinition = { ...definition, nodes: definition.nodes.map(node => node.id === 'c'
        ? { ...node, data: { guidedCondition: { ...condition, unit: 'weeks' } } } : node) };
      await caller.rpc('save_guided_workflow_draft_with_settings', { p_workflow_id: workflowId,
        p_expected_revision: 1, p_definition: invalidDefinition, p_settings: settings }).throwOnError();
      const publishBase = { p_workflow_id: workflowId, p_organization_id: orgA, p_actor_id: userId,
        p_settings: settings, p_required_fields: ['business.trigger.stage_elapsed'] };
      expect((await service.rpc('finalize_guided_workflow_publication', { ...publishBase,
        p_expected_revision: 2, p_definition: invalidDefinition })).error?.code).toBe('22023');
      await caller.rpc('save_guided_workflow_draft_with_settings', { p_workflow_id: workflowId,
        p_expected_revision: 2, p_definition: definition, p_settings: settings }).throwOnError();
      const publishArgs = { ...publishBase, p_expected_revision: 3, p_definition: definition };
      const finalized = await service.rpc('finalize_guided_workflow_publication', publishArgs);
      expect(finalized.error).toBeNull();
      await service.from('workflow_executions').insert({ id: executionId, workflow_id: workflowId, organization_id: orgA,
        lead_id: leadA, pipeline_entry_id: entryId, status: 'waiting', next_run_at: '2099-01-01T00:00:00Z' }).throwOnError();
      expect(await executeWorkflow({ supabase: service, executionId, workflowId, organizationId: orgA, leadId: leadA,
        entryId, guidedVersionId: finalized.data.version_id, definition: { nodes: [], edges: [] }, loopLimit: 20, context: {} }))
        .toMatchObject({ success: true, status: 'completed' });
      expect((await service.from('workflow_execution_steps').select('node_id').eq('execution_id', executionId)).data?.map(step => step.node_id)).toContain('yes');
      await caller.rpc('set_workflow_data_grant', { p_workflow_id: workflowId, p_fields: [], p_expected_revision: 1 }).throwOnError();
      expect(await evaluateGuidedCondition(service, automatic)).toEqual({ status: 'error', code: 'access_denied' });
    } finally {
      await service.from('workflows').delete().eq('id', workflowId).throwOnError();
      await service.from('pipeline_entries').delete().eq('id', entryId).throwOnError();
      await service.from('pipeline_stages').delete().eq('id', stageId).throwOnError();
      await service.from('followup_reclassify_queue').delete().eq('organization_id', orgA).throwOnError();
      await service.from('pipelines').delete().eq('id', pipelineId).throwOnError();
    }
  }, 60000);

  it('requires one business to satisfy the whole existence group and applies the visible lifecycle filter', async () => {
    const pipelineId = crypto.randomUUID(), stageWanted = crypto.randomUUID(), stageOther = crypto.randomUUID();
    const entryStage = crypto.randomUUID(), entryValue = crypto.randomUUID(), entryWon = crypto.randomUUID();
    const dealStage = crypto.randomUUID(), dealValue = crypto.randomUUID(), dealWon = crypto.randomUUID();
    const workflowId = crypto.randomUUID(), executionId = crypto.randomUUID();
    const caller = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: `business-exists-${pipelineId}` },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const condition = { version: 1, id: 'exists', kind: 'business_exists', lifecycle: 'open', match: 'all', children: [
      { version: 1, id: 'stage', field: 'business.stage', operator: 'equals', pipelineId, stageId: stageWanted },
      { version: 1, id: 'value', field: 'business.value', operator: 'greater_than', value: 1000 },
    ] };
    await service.from('pipelines').insert({ id: pipelineId, organization_id: orgA, name: 'Comercial', slug: `exists-${pipelineId}`, type: 'custom' }).throwOnError();
    try {
      await service.from('pipeline_stages').insert([
        { id: stageWanted, organization_id: orgA, pipeline_id: pipelineId, stage_key: 'proposal', name: 'Proposta', position: 0 },
        { id: stageOther, organization_id: orgA, pipeline_id: pipelineId, stage_key: 'negotiation', name: 'Negociação', position: 1 },
      ]).throwOnError();
      await service.from('deals').insert([
        { id: dealStage, organization_id: orgA, title: 'Na etapa', value: 100, source: 'api', outcome: 'open' },
        { id: dealValue, organization_id: orgA, title: 'Com valor', value: 5000, source: 'api', outcome: 'open' },
        { id: dealWon, organization_id: orgA, title: 'Ganho', value: 1500, source: 'api', outcome: 'won' },
      ]).throwOnError();
      await service.from('pipeline_entries').insert([
        { id: entryStage, organization_id: orgA, lead_id: leadA, deal_id: dealStage, pipeline_id: pipelineId, stage_id: stageWanted, stage_key: 'proposal' },
        { id: entryValue, organization_id: orgA, lead_id: leadA, deal_id: dealValue, pipeline_id: pipelineId, stage_id: stageOther, stage_key: 'negotiation' },
      ]).throwOnError();
      const evaluate = (rule: unknown) => evaluateGuidedCondition(caller, { organizationId: orgA, leadId: leadA, condition: rule });
      expect(await evaluate(condition)).toMatchObject({ status: 'evaluated', matched: false });
      await service.from('deals').update({ value: 1500 }).eq('id', dealStage).throwOnError();
      expect(await evaluate(condition)).toMatchObject({ status: 'evaluated', matched: true });
      await service.from('pipeline_entries').delete().eq('id', entryStage).throwOnError();
      await service.from('pipeline_entries').insert({ id: entryWon, organization_id: orgA, lead_id: leadA, deal_id: dealWon,
        pipeline_id: pipelineId, stage_id: stageWanted, stage_key: 'proposal' }).throwOnError();
      expect(await evaluate(condition)).toMatchObject({ status: 'evaluated', matched: false });
      expect(await evaluate({ ...condition, lifecycle: 'won' })).toMatchObject({ status: 'evaluated', matched: true });
      expect(await evaluate({ ...condition, lifecycle: 'all' })).toMatchObject({ status: 'evaluated', matched: true });

      const directArgs = { p_organization_id: orgA, p_lead_id: leadA,
        p_fields: ['business.exists.lifecycle', 'business.exists.stage', 'business.exists.value'],
        p_stage_references: [{ pipelineId, stageId: stageWanted }] };
      const valueOnly = await caller.rpc('test_guided_condition_business_candidates', { ...directArgs,
        p_fields: ['business.exists.lifecycle', 'business.exists.value'], p_stage_references: [] });
      expect(valueOnly.error).toBeNull();
      expect(valueOnly.data).toHaveLength(2);
      expect(valueOnly.data.every((candidate: { pipeline_id: unknown; pipeline_name: unknown; stage_id: unknown }) =>
        candidate.pipeline_id === null && candidate.pipeline_name === null && candidate.stage_id === null)).toBe(true);
      expect((await service.rpc('test_guided_condition_business_candidates', directArgs)).error?.code).toBe('42501');
      const anonymous = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false, storageKey: `business-exists-anon-${pipelineId}` },
      });
      expect((await anonymous.rpc('test_guided_condition_business_candidates', directArgs)).error?.code).toBe('42501');
      expect(await evaluateGuidedCondition(caller, { organizationId: orgA, leadId: leadB, condition })).toEqual({ status: 'error', code: 'context_unavailable' });

      const wonCondition = { ...condition, lifecycle: 'won' as const };
      const definition = { nodes: [
        { id: 't', type: 'trigger', data: { triggerType: 'lead_created', config: {} } },
        { id: 'c', type: 'condition', data: { guidedCondition: wonCondition } },
        { id: 'yes', type: 'end', data: {} }, { id: 'no', type: 'end', data: {} },
      ], edges: [{ id: 'tc', source: 't', target: 'c' }, { id: 'cy', source: 'c', target: 'yes', sourceHandle: 'yes' },
        { id: 'cn', source: 'c', target: 'no', sourceHandle: 'no' }] };
      const settings = { name: 'Existe negócio ganho em proposta' };
      await caller.rpc('create_guided_workflow_draft_with_settings', { p_workflow_id: workflowId,
        p_organization_id: orgA, p_definition: definition, p_settings: settings }).throwOnError();
      await caller.rpc('set_workflow_data_grant', { p_workflow_id: workflowId,
        p_fields: ['business.exists.lifecycle', 'business.exists.stage'], p_expected_revision: 0 }).throwOnError();
      const automatic = { organizationId: orgA, leadId: leadA, condition: wonCondition,
        authorization: { kind: 'organization' as const, workflowId } };
      expect(await evaluateGuidedCondition(service, automatic)).toEqual({ status: 'error', code: 'access_denied' });
      const scopes = ['business.exists.lifecycle', 'business.exists.stage', 'business.exists.value'];
      await caller.rpc('set_workflow_data_grant', { p_workflow_id: workflowId, p_fields: scopes, p_expected_revision: 1 }).throwOnError();
      expect(await evaluateGuidedCondition(service, automatic)).toMatchObject({ status: 'evaluated', matched: true,
        rules: [{ id: 'exists', actual: entryWon, context: { entryId: entryWon } }] });
      const malformedDefinition = { ...definition, nodes: definition.nodes.map(node => node.id === 'c' ? { ...node, data: {
        guidedCondition: { ...wonCondition, children: [wonCondition.children[0], { ...wonCondition.children[1], value: '1000' }] },
      } } : node) };
      await caller.rpc('save_guided_workflow_draft_with_settings', { p_workflow_id: workflowId,
        p_expected_revision: 1, p_definition: malformedDefinition, p_settings: settings }).throwOnError();
      const publicationBase = { p_workflow_id: workflowId, p_organization_id: orgA, p_actor_id: userId,
        p_settings: settings, p_required_fields: scopes };
      expect((await service.rpc('finalize_guided_workflow_publication', { ...publicationBase,
        p_expected_revision: 2, p_definition: malformedDefinition })).error?.code).toBe('22023');
      const missingStageDefinition = { ...definition, nodes: definition.nodes.map(node => node.id === 'c' ? { ...node, data: {
        guidedCondition: { ...wonCondition, children: [{ ...wonCondition.children[0], stageId: crypto.randomUUID() }, wonCondition.children[1]] },
      } } : node) };
      await caller.rpc('save_guided_workflow_draft_with_settings', { p_workflow_id: workflowId,
        p_expected_revision: 2, p_definition: missingStageDefinition, p_settings: settings }).throwOnError();
      expect((await service.rpc('finalize_guided_workflow_publication', { ...publicationBase,
        p_expected_revision: 3, p_definition: missingStageDefinition })).error?.code).toBe('PT422');
      await caller.rpc('save_guided_workflow_draft_with_settings', { p_workflow_id: workflowId,
        p_expected_revision: 3, p_definition: definition, p_settings: settings }).throwOnError();
      const publishArgs = { p_workflow_id: workflowId, p_organization_id: orgA, p_actor_id: userId,
        p_expected_revision: 4, p_definition: definition, p_settings: settings, p_required_fields: scopes };
      expect((await service.rpc('finalize_guided_workflow_publication', { ...publishArgs,
        p_required_fields: ['business.exists.lifecycle', 'business.exists.stage'] })).error?.code).toBe('42501');
      const finalized = await service.rpc('finalize_guided_workflow_publication', publishArgs);
      expect(finalized.error).toBeNull();
      await service.from('workflow_executions').insert({ id: executionId, workflow_id: workflowId, organization_id: orgA,
        lead_id: leadA, status: 'waiting', next_run_at: '2099-01-01T00:00:00Z' }).throwOnError();
      expect(await executeWorkflow({ supabase: service, executionId, workflowId, organizationId: orgA, leadId: leadA,
        guidedVersionId: finalized.data.version_id, definition: { nodes: [], edges: [] }, loopLimit: 20, context: {} }))
        .toMatchObject({ success: true, status: 'completed' });
      expect((await service.from('workflow_execution_steps').select('node_id').eq('execution_id', executionId)).data?.map(step => step.node_id)).toContain('yes');
      await caller.rpc('set_workflow_data_grant', { p_workflow_id: workflowId, p_fields: [], p_expected_revision: 2 }).throwOnError();
      expect(await evaluateGuidedCondition(service, automatic)).toEqual({ status: 'error', code: 'access_denied' });

      const response = await fetch(`${process.env.SUPABASE_URL}/functions/v1/test-guided-condition`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: process.env.SUPABASE_ANON_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgA, leadId: leadA, condition: wonCondition }), signal: AbortSignal.timeout(15000),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: 'evaluated', matched: true, rules: [{ actual: entryWon }] });
    } finally {
      await service.from('workflows').delete().eq('id', workflowId).throwOnError();
      await service.from('pipeline_entries').delete().in('id', [entryStage, entryValue, entryWon]).throwOnError();
      await service.from('deals').delete().in('id', [dealStage, dealValue, dealWon]).throwOnError();
      await service.from('pipeline_stages').delete().in('id', [stageWanted, stageOther]).throwOnError();
      await service.from('followup_reclassify_queue').delete().eq('organization_id', orgA).throwOnError();
      await service.from('pipelines').delete().eq('id', pipelineId).throwOnError();
    }
  }, 60000);

  it('selects the latest sale that remains won by its canonical outcome date', async () => {
    const pipelineId = crypto.randomUUID(), stageId = crypto.randomUUID();
    const olderDeal = crypto.randomUUID(), newerDeal = crypto.randomUUID(), olderEntry = crypto.randomUUID(), newerEntry = crypto.randomUUID();
    const workflowId = crypto.randomUUID(), executionId = crypto.randomUUID();
    const caller = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: `last-won-${pipelineId}` },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const rule = { version: 1, id: 'last-won', field: 'business.last_won_date', operator: 'equals', value: '2026-08-20' };
    const originalTimezone = (await service.from('organizations').select('timezone').eq('id', orgA).single()).data!.timezone;
    await service.from('pipelines').insert({ id: pipelineId, organization_id: orgA, name: 'Histórico', slug: `last-won-${pipelineId}`, type: 'custom' }).throwOnError();
    try {
      await service.from('pipeline_stages').insert({ id: stageId, organization_id: orgA, pipeline_id: pipelineId,
        stage_key: 'won', name: 'Ganho', position: 0 }).throwOnError();
      await service.from('deals').insert([
        { id: olderDeal, organization_id: orgA, source_lead_id: leadA,
          title: 'Venda anterior', value: 1000, source: 'api', outcome: 'won', outcome_at: '2026-08-10T15:00:00Z', closed_at: '2026-08-10T15:00:00Z' },
        { id: newerDeal, organization_id: orgA, source_lead_id: leadA,
          title: 'Venda mais recente', value: 2000, source: 'api', outcome: 'won', outcome_at: '2026-08-20T15:00:00Z', closed_at: '2026-08-20T15:00:00Z' },
      ]).throwOnError();
      await service.from('pipeline_entries').insert([
        { id: olderEntry, organization_id: orgA, lead_id: leadA, deal_id: olderDeal, pipeline_id: pipelineId, stage_id: stageId, stage_key: 'won' },
        { id: newerEntry, organization_id: orgA, lead_id: leadA, deal_id: newerDeal, pipeline_id: pipelineId, stage_id: stageId, stage_key: 'won' },
      ]).throwOnError();
      const evaluate = (condition: unknown) => evaluateGuidedCondition(caller, { organizationId: orgA, leadId: leadA, condition });
      const leadBeforeRead = await service.from('leads').select('classificacao, classificacao_manual').eq('id', leadA).single();
      const ledgerBeforeRead = await service.from('sale_events').select('id', { count: 'exact', head: true }).in('deal_id', [olderDeal, newerDeal]);
      expect(await evaluate(rule)).toMatchObject({ status: 'evaluated', matched: true,
        rules: [{ actual: '2026-08-20', reference: { id: newerDeal, name: 'Venda mais recente' } }] });
      expect((await service.from('leads').select('classificacao, classificacao_manual').eq('id', leadA).single()).data).toEqual(leadBeforeRead.data);
      expect((await service.from('sale_events').select('id', { count: 'exact', head: true }).in('deal_id', [olderDeal, newerDeal])).count).toBe(ledgerBeforeRead.count);
      await service.from('deals').update({ outcome: 'open', outcome_source: 'api' }).eq('id', newerDeal).throwOnError();
      expect(await evaluate({ ...rule, value: '2026-08-10' })).toMatchObject({ status: 'evaluated', matched: true,
        rules: [{ actual: '2026-08-10', reference: { id: olderDeal, name: 'Venda anterior' } }] });
      await service.from('deals').update({ outcome: 'won', outcome_source: 'api', outcome_at: new Date().toISOString() }).eq('id', newerDeal).throwOnError();
      expect(await evaluate({ ...rule, operator: 'after', value: '2026-08-20' })).toMatchObject({ status: 'evaluated', matched: true,
        rules: [{ reference: { id: newerDeal, name: 'Venda mais recente' } }] });
      await service.from('deals').update({ outcome: 'open', outcome_source: 'api' }).in('id', [olderDeal, newerDeal]).throwOnError();
      expect(await evaluate({ version: 1, id: 'last-won', field: 'business.last_won_date', operator: 'is_empty' }))
        .toMatchObject({ status: 'evaluated', matched: true, rules: [{ actual: null }] });
      expect(await evaluateGuidedCondition(caller, { organizationId: orgA, leadId: leadB, condition: rule }))
        .toEqual({ status: 'error', code: 'context_unavailable' });
      const directArgs = { p_organization_id: orgA, p_lead_id: leadA };
      expect((await service.rpc('test_guided_condition_last_won', directArgs)).error?.code).toBe('42501');
      const anonymous = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false, storageKey: `last-won-anon-${pipelineId}` },
      });
      expect((await anonymous.rpc('test_guided_condition_last_won', directArgs)).error?.code).toBe('42501');

      await service.from('deals').update({ outcome: 'won', outcome_source: 'api' }).eq('id', newerDeal).throwOnError();
      await service.from('deals').update({ outcome_at: null }).eq('id', newerDeal).throwOnError();
      expect(await evaluate(rule)).toEqual({ status: 'error', code: 'source_unavailable' });
      await service.from('deals').update({ outcome_at: '2099-01-01T00:00:00Z' }).eq('id', newerDeal).throwOnError();
      expect(await evaluate(rule)).toEqual({ status: 'error', code: 'source_unavailable' });
      await service.from('organizations').update({ timezone: 'America/Sao_Paulo' }).eq('id', orgA).throwOnError();
      await service.from('deals').update({ outcome_at: '2026-08-20T01:00:00Z', closed_at: '2026-08-20T01:00:00Z' }).eq('id', newerDeal).throwOnError();
      const localRule = { ...rule, value: '2026-08-19' };
      expect(await evaluate(localRule)).toMatchObject({ status: 'evaluated', matched: true,
        rules: [{ actual: '2026-08-19', reference: { id: newerDeal, name: 'Venda mais recente' } }] });
      const response = await fetch(`${process.env.SUPABASE_URL}/functions/v1/test-guided-condition`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: process.env.SUPABASE_ANON_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgA, leadId: leadA, condition: localRule }), signal: AbortSignal.timeout(15000),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: 'evaluated', matched: true,
        rules: [{ actual: '2026-08-19', reference: { id: newerDeal, name: 'Venda mais recente' } }] });

      const definition = { nodes: [
        { id: 't', type: 'trigger', data: { triggerType: 'lead_created', config: {} } },
        { id: 'c', type: 'condition', data: { guidedCondition: localRule } },
        { id: 'yes', type: 'end', data: {} }, { id: 'no', type: 'end', data: {} },
      ], edges: [{ id: 'tc', source: 't', target: 'c' }, { id: 'cy', source: 'c', target: 'yes', sourceHandle: 'yes' },
        { id: 'cn', source: 'c', target: 'no', sourceHandle: 'no' }] };
      const settings = { name: 'Última venda que permanece ganha' };
      await caller.rpc('create_guided_workflow_draft_with_settings', { p_workflow_id: workflowId,
        p_organization_id: orgA, p_definition: definition, p_settings: settings }).throwOnError();
      const automatic = { organizationId: orgA, leadId: leadA, condition: localRule,
        authorization: { kind: 'organization' as const, workflowId } };
      expect(await evaluateGuidedCondition(service, automatic)).toEqual({ status: 'error', code: 'access_denied' });
      await caller.rpc('set_workflow_data_grant', { p_workflow_id: workflowId,
        p_fields: ['business.last_won_date'], p_expected_revision: 0 }).throwOnError();
      expect(await evaluateGuidedCondition(service, automatic)).toMatchObject({ status: 'evaluated', matched: true,
        rules: [{ actual: '2026-08-19', reference: { id: newerDeal, name: 'Venda mais recente' } }] });
      const publication = { p_workflow_id: workflowId, p_organization_id: orgA, p_actor_id: userId,
        p_expected_revision: 1, p_definition: definition, p_settings: settings, p_required_fields: ['business.last_won_date'] };
      expect((await service.rpc('finalize_guided_workflow_publication', { ...publication,
        p_required_fields: [] })).error?.code).toBe('42501');
      const invalidDefinition = { ...definition, nodes: definition.nodes.map(node => node.id === 'c' ? { ...node,
        data: { guidedCondition: { ...localRule, value: '2026-02-30' } } } : node) };
      await caller.rpc('save_guided_workflow_draft_with_settings', { p_workflow_id: workflowId,
        p_expected_revision: 1, p_definition: invalidDefinition, p_settings: settings }).throwOnError();
      expect((await service.rpc('finalize_guided_workflow_publication', { ...publication,
        p_expected_revision: 2, p_definition: invalidDefinition })).error?.code).toBe('22023');
      await caller.rpc('save_guided_workflow_draft_with_settings', { p_workflow_id: workflowId,
        p_expected_revision: 2, p_definition: definition, p_settings: settings }).throwOnError();
      const finalized = await service.rpc('finalize_guided_workflow_publication', { ...publication, p_expected_revision: 3 });
      expect(finalized.error).toBeNull();
      await service.from('workflow_executions').insert({ id: executionId, workflow_id: workflowId, organization_id: orgA,
        lead_id: leadA, status: 'waiting', next_run_at: '2099-01-01T00:00:00Z' }).throwOnError();
      expect(await executeWorkflow({ supabase: service, executionId, workflowId, organizationId: orgA, leadId: leadA,
        guidedVersionId: finalized.data.version_id, definition: { nodes: [], edges: [] }, loopLimit: 20, context: {} }))
        .toMatchObject({ success: true, status: 'completed' });
      expect((await service.from('workflow_execution_steps').select('node_id').eq('execution_id', executionId)).data?.map(step => step.node_id)).toContain('yes');
      await caller.rpc('set_workflow_data_grant', { p_workflow_id: workflowId, p_fields: [], p_expected_revision: 1 }).throwOnError();
      expect(await evaluateGuidedCondition(service, automatic)).toEqual({ status: 'error', code: 'access_denied' });
    } finally {
      await service.from('workflows').delete().eq('id', workflowId).throwOnError();
      await service.from('organizations').update({ timezone: originalTimezone }).eq('id', orgA).throwOnError();
      await service.from('pipeline_entries').delete().in('id', [olderEntry, newerEntry]).throwOnError();
      // Won deals are referenced by the append-only sale ledger. Retire the
      // disposable rows through the product's canonical soft-delete path.
      await service.from('deals').update({ deleted_at: new Date().toISOString() }).in('id', [olderDeal, newerDeal]).throwOnError();
      await service.from('pipeline_stages').delete().eq('id', stageId).throwOnError();
      await service.from('followup_reclassify_queue').delete().eq('organization_id', orgA).throwOnError();
      await service.from('pipelines').delete().eq('id', pipelineId).throwOnError();
    }
  }, 60000);

  it.each(['test_guided_condition_custom_fields', 'test_guided_condition_custom_options'] as const)('%s bounds direct personal requests before reading definitions', async rpc => {
    const fieldId = crypto.randomUUID();
    const caller = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: `custom-limit-${fieldId}` },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    await service.from('lead_custom_fields').insert({ id: fieldId, organization_id: orgA, field_name: 'Limite de consulta', field_type: 'text' }).throwOnError();
    try {
      const args = { p_organization_id: orgA, p_lead_id: leadA, p_field_ids: Array(257).fill(fieldId) };
      expect((await caller.rpc(rpc, args)).error?.code).toBe('22023');
      const allowed = await caller.rpc(rpc, { ...args, p_field_ids: Array(256).fill(fieldId) });
      expect(allowed.error).toBeNull();
      expect(allowed.data).toHaveLength(1);
      expect(allowed.data[0]).toMatchObject({ id: fieldId, name: 'Limite de consulta', field_type: 'text', value: null });
    } finally {
      await service.from('lead_custom_fields').delete().eq('id', fieldId).throwOnError();
    }
  }, 60000);

  it('compares registered custom options exactly and rejects removed options before short circuiting', async () => {
    const fieldId = crypto.randomUUID();
    const caller = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: `custom-select-${fieldId}` },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const condition = { version: 1, id: 'select', field: 'lead.custom', fieldId, fieldType: 'select', operator: 'equals', value: 'Indústria' };
    await service.from('lead_custom_fields').insert({ id: fieldId, organization_id: orgA, field_name: 'Canal cadastrado', field_type: 'select', field_options: ['Indústria', 'industria', 'Revenda'] }).throwOnError();
    try {
      await service.from('lead_custom_field_values').insert({ lead_id: leadA, field_id: fieldId, value: 'Indústria' }).throwOnError();
      const evaluate = (rule: unknown) => evaluateGuidedCondition(caller, { organizationId: orgA, leadId: leadA, condition: rule });
      expect(await evaluate(condition)).toMatchObject({ status: 'evaluated', matched: true, rules: [{ actual: 'Indústria', reference: { id: fieldId, name: 'Canal cadastrado' } }] });
      const response = await fetch(`${process.env.SUPABASE_URL}/functions/v1/test-guided-condition`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: process.env.SUPABASE_ANON_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgA, leadId: leadA, condition }), signal: AbortSignal.timeout(15000),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: 'evaluated', matched: true, rules: [{ actual: 'Indústria' }] });
      expect(await evaluate({ ...condition, value: 'industria' })).toMatchObject({ status: 'evaluated', matched: false });
      expect(await evaluate({ ...condition, operator: 'not_equals', value: 'industria' })).toMatchObject({ status: 'evaluated', matched: true });
      expect(await evaluate({ ...condition, operator: 'contains' })).toEqual({ status: 'error', code: 'invalid_configuration' });
      expect(await evaluate({ ...condition, value: '' })).toEqual({ status: 'error', code: 'invalid_configuration' });
      expect(await evaluateGuidedCondition(caller, { organizationId: orgA, leadId: leadB, condition })).toEqual({ status: 'error', code: 'context_unavailable' });
      expect(await evaluate({ version: 1, id: 'any', kind: 'group', match: 'any', children: [condition,
        { ...condition, id: 'removed', value: 'Não cadastrada' },
      ] })).toEqual({ status: 'error', code: 'reference_unavailable' });
      for (const answer of [null, '']) {
        await service.from('lead_custom_field_values').update({ value: answer }).eq('lead_id', leadA).eq('field_id', fieldId).throwOnError();
        expect(await evaluate(condition)).toMatchObject({ status: 'evaluated', matched: false });
        expect(await evaluate({ ...condition, operator: 'not_equals' })).toMatchObject({ status: 'evaluated', matched: false });
        expect(await evaluate({ ...condition, operator: 'is_empty' })).toMatchObject({ status: 'evaluated', matched: true });
      }
      await service.from('lead_custom_field_values').update({ value: 'Revenda' }).eq('lead_id', leadA).eq('field_id', fieldId).throwOnError();
      await service.from('lead_custom_fields').update({ field_options: ['industria', 'Revenda'] }).eq('id', fieldId).throwOnError();
      expect(await evaluate(condition)).toEqual({ status: 'error', code: 'reference_unavailable' });
      await service.from('lead_custom_fields').update({ field_options: ['industria'] }).eq('id', fieldId).throwOnError();
      expect(await evaluate({ ...condition, value: 'industria', operator: 'not_equals' })).toEqual({ status: 'error', code: 'source_unavailable' });
      expect(await evaluate({ ...condition, operator: 'is_empty' })).toEqual({ status: 'error', code: 'source_unavailable' });
      await service.from('lead_custom_field_values').update({ value: null }).eq('lead_id', leadA).eq('field_id', fieldId).throwOnError();
      await service.from('lead_custom_fields').update({ field_options: null }).eq('id', fieldId).throwOnError();
      expect(await evaluate({ ...condition, operator: 'is_empty' })).toMatchObject({ status: 'evaluated', matched: true });
      expect(await evaluate(condition)).toEqual({ status: 'error', code: 'reference_unavailable' });
      for (const options of [{ value: 'Indústria' }, ['Indústria', 1], ['']]) {
        await service.from('lead_custom_fields').update({ field_options: options }).eq('id', fieldId).throwOnError();
        expect(await evaluate({ ...condition, operator: 'is_empty' })).toEqual({ status: 'error', code: 'source_unavailable' });
      }
      const args = { p_organization_id: orgA, p_lead_id: leadA, p_field_ids: [fieldId] };
      expect((await service.rpc('test_guided_condition_custom_options', args)).error?.code).toBe('42501');
      const anonymous = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false, storageKey: `anonymous-select-${fieldId}` } });
      expect((await anonymous.rpc('test_guided_condition_custom_options', args)).error?.code).toBe('42501');
    } finally {
      await service.from('lead_custom_fields').delete().eq('id', fieldId).throwOnError();
    }
  }, 60000);

  it('compares custom calendar dates without timezone shifts or normalized invalid dates', async () => {
    const fieldId = crypto.randomUUID();
    const caller = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: `custom-date-${fieldId}` },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const condition = { version: 1, id: 'date', field: 'lead.custom', fieldId, fieldType: 'date', operator: 'equals', value: '2024-02-29' };
    await service.from('lead_custom_fields').insert({ id: fieldId, organization_id: orgA, field_name: 'Próxima compra', field_type: 'date' }).throwOnError();
    try {
      await service.from('lead_custom_field_values').insert({ lead_id: leadA, field_id: fieldId, value: '2024-02-29' }).throwOnError();
      expect(await evaluateGuidedCondition(caller, { organizationId: orgA, leadId: leadA, condition })).toMatchObject({
        status: 'evaluated', matched: true, rules: [{ actual: '2024-02-29', reference: { id: fieldId, name: 'Próxima compra' } }],
      });
      const evaluate = (rule: unknown) => evaluateGuidedCondition(caller, { organizationId: orgA, leadId: leadA, condition: rule });
      for (const [operator, value, matched] of [
        ['equals', '2024-02-29', true], ['not_equals', '2024-02-29', false], ['not_equals', '2024-03-01', true],
        ['before', '2024-03-01', true], ['before', '2024-02-29', false], ['on_or_before', '2024-02-29', true],
        ['after', '2024-02-28', true], ['after', '2024-02-29', false], ['on_or_after', '2024-02-29', true],
      ] as const) expect(await evaluate({ ...condition, operator, value })).toMatchObject({ status: 'evaluated', matched });
      for (const answer of [null, '']) {
        await service.from('lead_custom_field_values').update({ value: answer }).eq('lead_id', leadA).eq('field_id', fieldId).throwOnError();
        expect(await evaluate(condition)).toMatchObject({ status: 'evaluated', matched: false });
        expect(await evaluate({ ...condition, operator: 'not_equals' })).toMatchObject({ status: 'evaluated', matched: false });
        expect(await evaluate({ ...condition, operator: 'is_empty' })).toMatchObject({ status: 'evaluated', matched: true });
      }
      for (const answer of ['2023-02-29', '1900-02-29', '2024-04-31', '2024-13-01', '2024-00-01', '0000-01-01', '10000-01-01', '29/02/2024', '2024-02-29T00:00:00Z', ' 2024-02-29']) {
        await service.from('lead_custom_field_values').update({ value: answer }).eq('lead_id', leadA).eq('field_id', fieldId).throwOnError();
        expect(await evaluate({ ...condition, operator: 'is_empty' })).toEqual({ status: 'error', code: 'source_unavailable' });
        expect(await evaluate({ ...condition, value: answer })).toEqual({ status: 'error', code: 'invalid_configuration' });
      }
      await service.from('lead_custom_field_values').update({ value: '2000-02-29' }).eq('lead_id', leadA).eq('field_id', fieldId).throwOnError();
      expect(await evaluate({ ...condition, value: '2000-02-29' })).toMatchObject({ status: 'evaluated', matched: true });
      await service.from('lead_custom_field_values').update({ value: '2025-01-01' }).eq('lead_id', leadA).eq('field_id', fieldId).throwOnError();
      expect(await evaluate({ ...condition, operator: 'after', value: '2024-12-31' })).toMatchObject({ status: 'evaluated', matched: true });
      await service.from('lead_custom_field_values').update({ value: '2024-02-29' }).eq('lead_id', leadA).eq('field_id', fieldId).throwOnError();
      expect(await evaluate({ ...condition, operator: 'contains' })).toEqual({ status: 'error', code: 'invalid_configuration' });
      expect(await evaluateGuidedCondition(caller, { organizationId: orgA, leadId: leadB, condition })).toEqual({ status: 'error', code: 'context_unavailable' });
      expect(await evaluate({ version: 1, id: 'any', kind: 'group', match: 'any', children: [condition,
        { ...condition, id: 'changed', fieldType: 'text' },
      ] })).toEqual({ status: 'error', code: 'reference_unavailable' });
      const response = await fetch(`${process.env.SUPABASE_URL}/functions/v1/test-guided-condition`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: process.env.SUPABASE_ANON_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgA, leadId: leadA, condition }), signal: AbortSignal.timeout(15000),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: 'evaluated', matched: true, rules: [{ actual: '2024-02-29' }] });
    } finally {
      await service.from('lead_custom_fields').delete().eq('id', fieldId).throwOnError();
    }
  }, 60000);

  it('compares custom booleans without treating false as an unanswered field', async () => {
    const fieldId = crypto.randomUUID();
    const caller = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: `custom-boolean-${fieldId}` },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const condition = { version: 1, id: 'boolean', field: 'lead.custom', fieldId, fieldType: 'boolean', operator: 'equals', value: false };
    await service.from('lead_custom_fields').insert({ id: fieldId, organization_id: orgA, field_name: 'Aceita contato', field_type: 'boolean' }).throwOnError();
    try {
      await service.from('lead_custom_field_values').insert({ lead_id: leadA, field_id: fieldId, value: 'false' }).throwOnError();
      expect(await evaluateGuidedCondition(caller, { organizationId: orgA, leadId: leadA, condition })).toMatchObject({
        status: 'evaluated', matched: true, rules: [{ actual: false, reference: { id: fieldId, name: 'Aceita contato' } }],
      });
      const evaluate = (rule: unknown) => evaluateGuidedCondition(caller, { organizationId: orgA, leadId: leadA, condition: rule });
      for (const [answer, comparisons] of [
        ['true', [['equals', true, true], ['equals', false, false], ['not_equals', true, false], ['not_equals', false, true]]],
        ['false', [['equals', true, false], ['equals', false, true], ['not_equals', true, true], ['not_equals', false, false]]],
      ] as const) {
        await service.from('lead_custom_field_values').update({ value: answer }).eq('lead_id', leadA).eq('field_id', fieldId).throwOnError();
        for (const [operator, value, matched] of comparisons) {
          expect(await evaluate({ ...condition, operator, value })).toMatchObject({ status: 'evaluated', matched });
        }
        expect(await evaluate({ ...condition, operator: 'is_empty' })).toMatchObject({ status: 'evaluated', matched: false });
        expect(await evaluate({ ...condition, operator: 'is_not_empty' })).toMatchObject({ status: 'evaluated', matched: true });
      }
      for (const answer of [null, '']) {
        await service.from('lead_custom_field_values').update({ value: answer }).eq('lead_id', leadA).eq('field_id', fieldId).throwOnError();
        expect(await evaluate(condition)).toMatchObject({ status: 'evaluated', matched: false });
        expect(await evaluate({ ...condition, operator: 'not_equals' })).toMatchObject({ status: 'evaluated', matched: false });
        expect(await evaluate({ ...condition, operator: 'is_empty' })).toMatchObject({ status: 'evaluated', matched: true });
      }
      for (const answer of ['0', '1', 'False', ' false', 'não']) {
        await service.from('lead_custom_field_values').update({ value: answer }).eq('lead_id', leadA).eq('field_id', fieldId).throwOnError();
        expect(await evaluate({ ...condition, operator: 'is_empty' })).toEqual({ status: 'error', code: 'source_unavailable' });
      }
      await service.from('lead_custom_field_values').update({ value: 'false' }).eq('lead_id', leadA).eq('field_id', fieldId).throwOnError();
      expect(await evaluate({ ...condition, value: 'false' })).toEqual({ status: 'error', code: 'invalid_configuration' });
      expect(await evaluate({ ...condition, operator: 'contains' })).toEqual({ status: 'error', code: 'invalid_configuration' });
      expect(await evaluateGuidedCondition(caller, { organizationId: orgA, leadId: leadB, condition })).toEqual({ status: 'error', code: 'context_unavailable' });
      expect(await evaluate({ version: 1, id: 'any', kind: 'group', match: 'any', children: [condition,
        { ...condition, id: 'changed', fieldType: 'text', operator: 'equals', value: 'false' },
      ] })).toEqual({ status: 'error', code: 'reference_unavailable' });
      const response = await fetch(`${process.env.SUPABASE_URL}/functions/v1/test-guided-condition`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: process.env.SUPABASE_ANON_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgA, leadId: leadA, condition }), signal: AbortSignal.timeout(15000),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: 'evaluated', matched: true, rules: [{ actual: false }] });
    } finally {
      await service.from('lead_custom_fields').delete().eq('id', fieldId).throwOnError();
    }
  }, 60000);

  it('compares custom numeric strings without turning missing or invalid answers into zero', async () => {
    const fieldId = crypto.randomUUID();
    const caller = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: `custom-number-${fieldId}` },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const condition = { version: 1, id: 'numeric', field: 'lead.custom', fieldId, fieldType: 'number', operator: 'greater_than', value: 10 };
    await service.from('lead_custom_fields').insert({ id: fieldId, organization_id: orgA, field_name: 'Quantidade prevista', field_type: 'number' }).throwOnError();
    try {
      await service.from('lead_custom_field_values').insert({ lead_id: leadA, field_id: fieldId, value: '10.5' }).throwOnError();
      expect(await evaluateGuidedCondition(caller, { organizationId: orgA, leadId: leadA, condition })).toMatchObject({
        status: 'evaluated', matched: true, rules: [{ id: 'numeric', actual: 10.5, reference: { id: fieldId, name: 'Quantidade prevista' } }],
      });
      const evaluate = (rule: unknown) => evaluateGuidedCondition(caller, { organizationId: orgA, leadId: leadA, condition: rule });
      for (const [operator, value, matched] of [
        ['equals', 10.5, true], ['not_equals', 10.5, false], ['greater_than', 11, false],
        ['greater_than_or_equal', 10.5, true], ['less_than', 11, true], ['less_than_or_equal', 10.5, true],
      ] as const) expect(await evaluate({ ...condition, operator, value })).toMatchObject({ status: 'evaluated', matched });
      for (const answer of ['0', '-0', '0.0']) {
        await service.from('lead_custom_field_values').update({ value: answer }).eq('lead_id', leadA).eq('field_id', fieldId).throwOnError();
        expect(await evaluate({ ...condition, operator: 'equals', value: 0 })).toMatchObject({ status: 'evaluated', matched: true });
        expect(await evaluate({ ...condition, operator: 'is_empty' })).toMatchObject({ status: 'evaluated', matched: false });
      }
      for (const answer of [null, '']) {
        await service.from('lead_custom_field_values').update({ value: answer }).eq('lead_id', leadA).eq('field_id', fieldId).throwOnError();
        expect(await evaluate({ ...condition, operator: 'equals', value: 0 })).toMatchObject({ status: 'evaluated', matched: false });
        expect(await evaluate({ ...condition, operator: 'not_equals', value: 0 })).toMatchObject({ status: 'evaluated', matched: false });
        expect(await evaluate({ ...condition, operator: 'is_empty' })).toMatchObject({ status: 'evaluated', matched: true });
      }
      for (const answer of [' ', '10,5', '10 items', '0x10', 'Infinity', '1e309', '1e-324', '9007199254740993', '10.0000000000000001']) {
        await service.from('lead_custom_field_values').update({ value: answer }).eq('lead_id', leadA).eq('field_id', fieldId).throwOnError();
        expect(await evaluate({ ...condition, operator: 'is_empty' })).toEqual({ status: 'error', code: 'source_unavailable' });
      }
      const invalidResponse = await fetch(`${process.env.SUPABASE_URL}/functions/v1/test-guided-condition`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: process.env.SUPABASE_ANON_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgA, leadId: leadA, condition }), signal: AbortSignal.timeout(15000),
      });
      expect(invalidResponse.status).toBe(422);
      expect(await invalidResponse.json()).toEqual({ status: 'error', code: 'source_unavailable' });
      await service.from('lead_custom_field_values').update({ value: '-2.5e2' }).eq('lead_id', leadA).eq('field_id', fieldId).throwOnError();
      expect(await evaluate({ ...condition, operator: 'equals', value: -250 })).toMatchObject({ status: 'evaluated', matched: true, rules: [{ actual: -250 }] });
      expect(await evaluate({ ...condition, operator: 'contains', value: '2' })).toEqual({ status: 'error', code: 'invalid_configuration' });
      expect(await evaluate({ ...condition, value: '2' })).toEqual({ status: 'error', code: 'invalid_configuration' });
      expect(await evaluateGuidedCondition(caller, { organizationId: orgA, leadId: leadB, condition })).toEqual({ status: 'error', code: 'context_unavailable' });
      expect(await evaluate({ version: 1, id: 'any', kind: 'group', match: 'any', children: [
        { ...condition, operator: 'equals', value: -250 }, { ...condition, id: 'wrong-type', fieldType: 'text', operator: 'contains', value: '2' },
      ] })).toEqual({ status: 'error', code: 'reference_unavailable' });
      const response = await fetch(`${process.env.SUPABASE_URL}/functions/v1/test-guided-condition`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: process.env.SUPABASE_ANON_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgA, leadId: leadA, condition: { ...condition, operator: 'equals', value: -250 } }), signal: AbortSignal.timeout(15000),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: 'evaluated', matched: true, rules: [{ actual: -250 }] });
    } finally {
      await service.from('lead_custom_fields').delete().eq('id', fieldId).throwOnError();
    }
  }, 60000);

  it.each(['text', 'number', 'boolean', 'date', 'select'] as const)('publishes a custom %s condition and rejects changed references without replacing its version', async fieldType => {
    const workflowId = crypto.randomUUID(), fieldId = crypto.randomUUID(), foreignId = crypto.randomUUID(), replacementId = crypto.randomUUID();
    const caller = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: `custom-publish-${fieldId}` },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const condition = { version: 1, id: 'custom', field: 'lead.custom', fieldId, fieldType, ...(fieldType === 'text' ? { operator: 'contains', value: 'eletrica' } : fieldType === 'number' ? { operator: 'greater_than', value: 10 } : fieldType === 'select' ? { operator: 'equals', value: 'Indústria' } : fieldType === 'date' ? { operator: 'equals', value: '2024-02-29' } : { operator: 'equals', value: false }) };
    const definitionFor = (rule: unknown) => ({ nodes: [
      { id: 't', type: 'trigger', data: { triggerType: 'lead_created', config: {} } },
      { id: 'c', type: 'condition', data: { guidedCondition: rule } },
      { id: 'yes', type: 'end', data: {} }, { id: 'no', type: 'end', data: {} },
    ], edges: [{ id: 'tc', source: 't', target: 'c' }, { id: 'cy', source: 'c', target: 'yes', sourceHandle: 'yes' }, { id: 'cn', source: 'c', target: 'no', sourceHandle: 'no' }] });
    const definition = definitionFor(condition), settings = { name: 'Custom publication' };
    const publish = async (revision: number) => {
      const response = await fetch(`${process.env.SUPABASE_URL}/functions/v1/publish-guided-workflow`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: process.env.SUPABASE_ANON_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgA, workflowId, expectedRevision: revision }), signal: AbortSignal.timeout(15000),
      });
      return { status: response.status, body: await response.json() };
    };
    await service.from('lead_custom_fields').insert({ id: fieldId, organization_id: orgA, field_name: 'Especialidade', field_type: fieldType, ...(fieldType === 'select' ? { field_options: ['Indústria', 'industria'] } : {}) }).throwOnError();
    try {
      await service.from('lead_custom_field_values').insert({ lead_id: leadA, field_id: fieldId, value: fieldType === 'text' ? 'Distribuição elétrica' : fieldType === 'number' ? '10.5' : fieldType === 'select' ? 'Indústria' : fieldType === 'date' ? '2024-02-29' : 'false' }).throwOnError();
      expect((await caller.rpc('create_guided_workflow_draft_with_settings', { p_workflow_id: workflowId, p_organization_id: orgA, p_definition: definition, p_settings: settings })).error).toBeNull();
      expect((await caller.rpc('set_workflow_data_grant', { p_workflow_id: workflowId, p_fields: [`lead.custom:${fieldId}`], p_expected_revision: 0 })).error).toBeNull();
      const args = { p_workflow_id: workflowId, p_organization_id: orgA, p_actor_id: userId, p_expected_revision: 1,
        p_definition: definition, p_settings: settings, p_required_fields: [`lead.custom:${fieldId}`] };
      expect((await service.rpc('finalize_guided_workflow_publication', args)).error).toBeNull();
      const published = await publish(1);
      expect(published).toMatchObject({ status: 200, body: { status: 'published', version_id: expect.any(String) } });
      const executionId = crypto.randomUUID();
      await service.from('workflow_executions').insert({ id: executionId, workflow_id: workflowId, organization_id: orgA,
        lead_id: leadA, status: 'waiting', next_run_at: '2099-01-01T00:00:00Z' }).throwOnError();
      expect(await executeWorkflow({ supabase: service, executionId, workflowId, organizationId: orgA, leadId: leadA,
        guidedVersionId: published.body.version_id, definition: { nodes: [], edges: [] }, loopLimit: 20, context: {},
      })).toMatchObject({ success: true, status: 'completed' });
      const steps = await service.from('workflow_execution_steps').select('node_id').eq('execution_id', executionId);
      expect(steps.error).toBeNull();
      expect(steps.data?.map(step => step.node_id)).toContain('yes');
      expect(steps.data?.map(step => step.node_id)).not.toContain('no');
      if (fieldType === 'select') {
        await service.from('lead_custom_fields').update({ field_options: ['industria'] }).eq('id', fieldId).throwOnError();
        expect(await publish(1)).toMatchObject({ status: 422, body: { code: 'reference_unavailable', issues: [{ nodeId: 'c' }] } });
        const denied = await service.rpc('finalize_guided_workflow_publication', args);
        expect(denied.error?.code).toBe('PT422');
        expect(await evaluateGuidedCondition(service, { organizationId: orgA, leadId: leadA, condition,
          authorization: { kind: 'organization', workflowId } })).toEqual({ status: 'error', code: 'reference_unavailable' });
        await service.from('lead_custom_fields').update({ field_options: ['Indústria', 'industria'] }).eq('id', fieldId).throwOnError();
      }
      await service.from('lead_custom_fields').update({ field_type: fieldType === 'text' ? 'number' : 'text' }).eq('id', fieldId).throwOnError();
      expect(await publish(1)).toMatchObject({ status: 422, body: { code: 'reference_unavailable', issues: [{ nodeId: 'c' }] } });
      await service.from('lead_custom_fields').update({ field_type: fieldType }).eq('id', fieldId).throwOnError();
      await service.from('lead_custom_fields').insert({ id: foreignId, organization_id: orgB, field_name: 'Especialidade', field_type: fieldType, ...(fieldType === 'select' ? { field_options: ['Indústria', 'industria'] } : {}) }).throwOnError();
      const invalid = definitionFor({ version: 1, id: 'any', kind: 'group', match: 'any', children: [condition, { ...condition, id: 'foreign', fieldId: foreignId }] });
      expect((await caller.rpc('save_guided_workflow_draft_with_settings', { p_workflow_id: workflowId, p_expected_revision: 1, p_definition: invalid, p_settings: settings })).error).toBeNull();
      expect(await publish(2)).toMatchObject({ status: 422, body: { code: 'reference_unavailable', issues: [{ nodeId: 'c' }] } });
      const empty = definitionFor({ version: 1, id: 'empty', field: 'lead.custom', fieldId, fieldType, operator: 'is_empty' });
      expect((await caller.rpc('save_guided_workflow_draft_with_settings', { p_workflow_id: workflowId, p_expected_revision: 2, p_definition: empty, p_settings: settings })).error).toBeNull();
      expect((await service.rpc('finalize_guided_workflow_publication', { ...args, p_expected_revision: 3, p_definition: empty, p_required_fields: [] })).error?.code).toBe('42501');
      expect((await caller.rpc('save_guided_workflow_draft_with_settings', { p_workflow_id: workflowId, p_expected_revision: 3, p_definition: definition, p_settings: settings })).error).toBeNull();
      let finalRevision = 4;
      if (fieldType === 'date') {
        const invalidDate = definitionFor({ ...condition, value: '2023-02-29' });
        expect((await caller.rpc('save_guided_workflow_draft_with_settings', { p_workflow_id: workflowId, p_expected_revision: 4, p_definition: invalidDate, p_settings: settings })).error).toBeNull();
        expect(await publish(5)).toMatchObject({ status: 422, body: { code: 'invalid_configuration', issues: [{ nodeId: 'c', code: 'invalid_condition' }] } });
        expect((await caller.rpc('save_guided_workflow_draft_with_settings', { p_workflow_id: workflowId, p_expected_revision: 5, p_definition: definition, p_settings: settings })).error).toBeNull();
        finalRevision = 6;
      }
      await service.from('lead_custom_fields').delete().eq('id', fieldId).throwOnError();
      await service.from('lead_custom_fields').insert({ id: replacementId, organization_id: orgA, field_name: 'Especialidade', field_type: fieldType, ...(fieldType === 'select' ? { field_options: ['Indústria', 'industria'] } : {}) }).throwOnError();
      expect(await publish(finalRevision)).toMatchObject({ status: 422, body: { code: 'reference_unavailable', issues: [{ nodeId: 'c' }] } });
      const active = await caller.from('workflow_guided_publications').select('version_id').eq('workflow_id', workflowId).single();
      expect(active.error).toBeNull();
      expect(active.data?.version_id).toBe(published.body.version_id);
    } finally {
      await service.from('workflows').delete().eq('id', workflowId).throwOnError();
      await service.from('lead_custom_fields').delete().in('id', [fieldId, foreignId, replacementId]).throwOnError();
    }
  }, 60000);

  it.each([false, true])('publishes a saved condition through the authenticated HTTP boundary (grouped=%s)', async (grouped) => {
    const workflowId = crypto.randomUUID();
    const caller = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const definition = { nodes: [
      { id: 't', type: 'trigger', data: { triggerType: 'lead_created', config: {} } },
      { id: 'c', type: 'condition', data: { guidedCondition: grouped ? {
        version: 1, id: 'group', kind: 'group', match: 'any', children: [
          { version: 1, id: 'r', field: 'lead.name', operator: 'equals', value: 'José' },
          { version: 1, id: 'r2', field: 'lead.name', operator: 'is_empty' },
        ],
      } : { version: 1, id: 'r', field: 'lead.name', operator: 'equals', value: 'José' } } },
      { id: 'y', type: 'end', data: {} }, { id: 'n', type: 'end', data: {} },
    ], edges: [{ id: 'tc', source: 't', target: 'c' },
      { id: 'cy', source: 'c', target: 'y', sourceHandle: 'yes' }, { id: 'cn', source: 'c', target: 'n', sourceHandle: 'no' }] };
    const created = await caller.rpc('create_guided_workflow_draft_with_settings', {
      p_workflow_id: workflowId, p_organization_id: orgA, p_definition: definition, p_settings: { name: 'HTTP publication' },
    });
    expect(created.error).toBeNull();
    expect((await caller.rpc('set_guided_workflow_active', { p_workflow_id: workflowId, p_active: true, p_expected_version_id: crypto.randomUUID() })).error?.code).toBe('42501');
    expect((await caller.from('workflows').update({ is_active: true }).eq('id', workflowId)).error?.code).toBe('42501');
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
    const discoverable = await caller.from('workflows').select('name, trigger_type, trigger_config, is_active').eq('id', workflowId).eq('organization_id', orgA).single();
    expect(discoverable.error).toBeNull();
    expect(discoverable.data).toEqual({ name: 'HTTP publication', trigger_type: 'lead_created', trigger_config: {}, is_active: false });
    const activated = await caller.rpc('set_guided_workflow_active', { p_workflow_id: workflowId, p_active: true, p_expected_version_id: publication.version_id });
    expect(activated.error).toBeNull();
    expect(activated.data).toMatchObject({ is_active: true, version_id: publication.version_id });
    const staleActivation = await caller.rpc('set_guided_workflow_active', { p_workflow_id: workflowId, p_active: true, p_expected_version_id: crypto.randomUUID() });
    expect(staleActivation.error?.code).toBe('PT409');
    expect((await caller.rpc('set_guided_workflow_active', { p_workflow_id: workflowId, p_active: false, p_expected_version_id: null })).error).toBeNull();
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
    expect((await caller.rpc('set_workflow_data_grant', { p_workflow_id: workflowId, p_fields: [], p_expected_revision: 1 })).error).toBeNull();
    expect((await caller.rpc('set_guided_workflow_active', { p_workflow_id: workflowId, p_active: true, p_expected_version_id: publication.version_id })).error?.code).toBe('42501');
    const bypass = await caller.from('workflows').update({ is_active: true }).eq('id', workflowId);
    expect(bypass.error?.code).toBe('42501');
  }, 60000);

  it.each([{ revokeGrant: false, grouped: false }, { revokeGrant: true, grouped: false }, { revokeGrant: false, grouped: true }, { revokeGrant: true, grouped: true }])('resumes old rules without repeating actions (revoked=$revokeGrant, grouped=$grouped)', async ({ revokeGrant, grouped }) => {
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
      { id: 'c', type: 'condition', data: { guidedCondition: grouped ? {
        version: 1, id: 'group', kind: 'group', match: 'any', children: [
          { version: 1, id: 'r', field: 'lead.name', operator: 'equals', value: 'José' },
          { version: 1, id: 'r2', field: 'lead.name', operator: 'is_empty' },
        ],
      } : { version: 1, id: 'r', field: 'lead.name', operator: 'equals', value: 'José' } } },
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
    if (revokeGrant) {
      expect((await caller.rpc('set_workflow_data_grant', { p_workflow_id: workflowId, p_fields: [], p_expected_revision: 1 })).error).toBeNull();
    }
    expect((await service.from('leads').update({ name: 'Mariana' }).eq('organization_id', orgA).eq('id', leadA)).error).toBeNull();
    let restoreError: unknown;
    try {
      const resumed = await executeWorkflow({ ...executionParams, currentNodeId: paused.data!.current_node_id,
        loopCounters: paused.data!.loop_counters, context: paused.data!.context, definition: nextDefinition });
      expect(resumed).toMatchObject(revokeGrant ? { success: false, status: 'failed', error: 'access_denied' } : { success: true, status: 'completed' });
      const tasks = await service.from('follow_ups').select('id').eq('organization_id', orgA).eq('lead_id', leadA).eq('title', title);
      expect(tasks.error).toBeNull();
      expect(tasks.data).toHaveLength(1);
      const steps = await service.from('workflow_execution_steps').select('node_id').eq('execution_id', executionId);
      expect(steps.error).toBeNull();
      expect(steps.data?.map(step => step.node_id).sort()).toEqual(revokeGrant ? ['action', 'c', 't', 'wait'] : ['action', 'c', 'no', 't', 'wait']);
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
      p_workflow_id: workflowId, p_fields: ['lead.name', 'lead.password'], p_expected_revision: 1,
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

  it('evaluates grouped conditions through deployed HTTP without exposing a foreign lead', async () => {
    const condition = { version: 1, id: 'root', kind: 'group', match: 'any', children: [
      { version: 1, id: 'jose', field: 'lead.name', operator: 'equals', value: 'JOSE' },
      { version: 1, id: 'maria', field: 'lead.name', operator: 'equals', value: 'Maria' },
    ] };
    const evaluate = async (leadId: string) => {
      const response = await fetch(`${process.env.SUPABASE_URL}/functions/v1/test-guided-condition`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: process.env.SUPABASE_ANON_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgA, leadId, condition }),
      });
      return { status: response.status, body: await response.json() };
    };
    expect(await evaluate(leadA)).toEqual({ status: 200, body: {
      status: 'evaluated', matched: true,
      groups: [{ id: 'root', status: 'evaluated', matched: true }],
      rules: [{ id: 'jose', status: 'evaluated', matched: true, actual: 'José' }, { id: 'maria', status: 'not_evaluated' }],
    } });
    expect(await evaluate(leadB)).toEqual({ status: 422, body: { status: 'error', code: 'context_unavailable' } });
  }, 60000);

  it('tests numeric zero and missing score through personal HTTP permissions', async () => {
    const evaluate = async (leadId: string, operator: string, value?: number) => {
      const response = await fetch(`${process.env.SUPABASE_URL}/functions/v1/test-guided-condition`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: process.env.SUPABASE_ANON_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgA, leadId, condition: {
          version: 1, id: 'score', field: 'lead.qualification_score', operator, ...(value === undefined ? {} : { value }),
        } }),
      });
      return { status: response.status, body: await response.json() };
    };
    expect((await service.from('leads').update({ qualification_score: 0 }).eq('id', leadA)).error).toBeNull();
    expect(await evaluate(leadA, 'equals', 0)).toMatchObject({ status: 200, body: {
      status: 'evaluated', matched: true, rules: [{ id: 'score', actual: 0, matched: true }],
    } });
    expect(await evaluate(leadA, 'is_empty')).toMatchObject({ status: 200, body: { matched: false } });
    expect(await evaluate(leadA, 'less_than', 0)).toMatchObject({ status: 200, body: { matched: false } });
    expect(await evaluate(leadA, 'less_than_or_equal', 0)).toMatchObject({ status: 200, body: { matched: true } });
    expect(await evaluate(leadA, 'greater_than_or_equal', 0)).toMatchObject({ status: 200, body: { matched: true } });
    expect((await service.from('leads').update({ qualification_score: null }).eq('id', leadA)).error).toBeNull();
    expect(await evaluate(leadA, 'is_empty')).toMatchObject({ status: 200, body: { matched: true } });
    expect(await evaluate(leadB, 'equals', 0)).toEqual({ status: 422, body: { status: 'error', code: 'context_unavailable' } });
  }, 60000);

  it.each([
    { field: 'lead.segment', value: 'DISTRIBUICAO', actual: 'Distribuição' },
    { field: 'lead.urgency', value: 'PRIORIDADE', actual: 'Alta prioridade' },
    { field: 'lead.faturamento', value: '100_mil', actual: 'r$100_mil_a_r$150_mil' },
    { field: 'lead.utm_source', value: 'GOOGLE', actual: 'Google' },
    { field: 'lead.utm_medium', value: 'PESQUISA', actual: 'Pesquisa' },
    { field: 'lead.utm_content', value: 'VIDEO A', actual: 'Vídeo A' },
    { field: 'lead.utm_term', value: 'FABRICA', actual: 'Fábrica' },
    { field: 'lead.utm_campaign', value: 'VERAO', actual: '[VERÃO] B2B.' },
    { field: 'lead.company', value: 'AURORA', actual: 'Fábrica Aurora' },
    { field: 'lead.email', value: '@aurora.example', actual: 'comercial@aurora.example' },
    { field: 'lead.phone', value: '5511', actual: '5511999990000' },
  ])('tests $field through personal HTTP permissions', async ({ field, value, actual }) => {
    if (field.startsWith('lead.utm_') || ['lead.segment', 'lead.urgency', 'lead.faturamento'].includes(field)) {
      const column = field.slice('lead.'.length);
      const caller = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const own = await caller.from('leads').select(column).eq('organization_id', orgA)
        .is('deleted_at', null).not(column, 'is', null).neq(column, '').order(column).limit(25);
      expect(own.error).toBeNull();
      expect(own.data).toContainEqual({ [column]: actual });
      const foreign = await caller.from('leads').select(column).eq('organization_id', orgB)
        .is('deleted_at', null).not(column, 'is', null).neq(column, '').order(column).limit(25);
      expect(foreign.error).toBeNull();
      expect(foreign.data).toEqual([]);
    }
    const response = await fetch(`${process.env.SUPABASE_URL}/functions/v1/test-guided-condition`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: process.env.SUPABASE_ANON_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: orgA, leadId: leadA,
        condition: { version: 1, id: 'company', field, operator: 'contains', value } }),
    });
    expect({ status: response.status, body: await response.json() }).toEqual({ status: 200, body: {
      status: 'evaluated', matched: true,
      rules: [{ id: 'company', status: 'evaluated', matched: true, actual }],
    } });
  }, 60000);

  it.each([
    { field: 'lead.segment', column: 'segment', actual: 'Distribuição', comparison: 'DISTRIBUICAO', fragment: 'DISTRIBUI' },
    { field: 'lead.urgency', column: 'urgency', actual: 'Alta prioridade', comparison: 'ALTA PRIORIDADE', fragment: 'PRIORIDADE' },
    { field: 'lead.faturamento', column: 'faturamento', actual: 'r$100_mil_a_r$150_mil', comparison: 'R$100_MIL_A_R$150_MIL', fragment: '100_mil' },
    { field: 'lead.qualification_score', column: 'qualification_score', actual: 0, comparison: 0, fragment: 0 },
    { field: 'lead.utm_source', column: 'utm_source', actual: 'Google', comparison: 'GOOGLE', fragment: 'GOOGLE' },
    { field: 'lead.utm_medium', column: 'utm_medium', actual: 'Pesquisa', comparison: 'PESQUISA', fragment: 'PESQUISA' },
    { field: 'lead.utm_content', column: 'utm_content', actual: 'Vídeo A', comparison: 'VIDEO A', fragment: 'VIDEO A' },
    { field: 'lead.utm_term', column: 'utm_term', actual: 'Fábrica', comparison: 'FABRICA', fragment: 'FABRICA' },
    { field: 'lead.utm_campaign', column: 'utm_campaign', actual: '[VERÃO] B2B.', comparison: '[verao] b2b.', fragment: 'verao' },
    { field: 'lead.company', column: 'company', actual: 'Fábrica Aurora', comparison: 'FABRICA AURORA', fragment: 'AURORA' },
    { field: 'lead.email', column: 'email', actual: 'comercial@aurora.example', comparison: 'COMERCIAL@AURORA.EXAMPLE', fragment: '@aurora.example' },
    { field: 'lead.phone', column: 'phone', actual: '5511999990000', comparison: '5511999990000', fragment: '5511' },
  ])('requires explicit $field grant through publication and execution', async ({ field, column, actual, comparison, fragment }) => {
    const workflowId = crypto.randomUUID();
    const caller = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } },
    });
    expect((await caller.rpc('create_guided_workflow_draft_with_settings', {
      p_workflow_id: workflowId, p_organization_id: orgA, p_definition: { nodes: [], edges: [] }, p_settings: { name: 'Company grant' },
    })).error).toBeNull();
    expect((await caller.rpc('set_workflow_data_grant', { p_workflow_id: workflowId, p_fields: ['lead.name'], p_expected_revision: 0 })).error).toBeNull();
    if (field === 'lead.qualification_score') expect((await service.from('leads').update({ qualification_score: 0 }).eq('id', leadA)).error).toBeNull();
    const args = { p_workflow_id: workflowId, p_organization_id: orgA, p_lead_id: leadA, p_fields: [field] };
    expect((await service.rpc('read_guided_condition_lead_fields', args)).error?.code).toBe('42501');
    expect((await caller.rpc('set_workflow_data_grant', { p_workflow_id: workflowId, p_fields: [field], p_expected_revision: 1 })).error).toBeNull();
    const read = await service.rpc('read_guided_condition_lead_fields', args);
    expect(read.error).toBeNull();
    expect(read.data).toEqual([{ id: leadA, organization_id: orgA, field_values: { [column]: actual } }]);
    expect(await evaluateGuidedCondition(service, { organizationId: orgA, leadId: leadA,
      authorization: { kind: 'organization', workflowId },
      condition: { version: 1, id: 'company', field, operator: 'equals', value: comparison },
    })).toEqual({ status: 'evaluated', matched: true,
      rules: [{ id: 'company', status: 'evaluated', matched: true, actual }],
    });
    const definition = { nodes: [
      { id: 't', type: 'trigger', data: { triggerType: 'lead_created', config: {} } },
      { id: 'c', type: 'condition', data: { guidedCondition: { version: 1, id: 'company', field, operator: typeof fragment === 'number' ? 'greater_than_or_equal' : 'contains', value: fragment } } },
      { id: 'yes', type: 'end', data: {} }, { id: 'no', type: 'end', data: {} },
    ], edges: [{ id: 'tc', source: 't', target: 'c' }, { id: 'cy', source: 'c', target: 'yes', sourceHandle: 'yes' }, { id: 'cn', source: 'c', target: 'no', sourceHandle: 'no' }] };
    expect((await caller.rpc('save_guided_workflow_draft_with_settings', { p_workflow_id: workflowId, p_expected_revision: 1,
      p_definition: definition, p_settings: { name: 'Company grant' } })).error).toBeNull();
    const response = await fetch(`${process.env.SUPABASE_URL}/functions/v1/publish-guided-workflow`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: process.env.SUPABASE_ANON_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId: orgA, workflowId, expectedRevision: 2 }),
    });
    expect(response.status).toBe(200);
    const publication = await response.json();
    const executionId = crypto.randomUUID();
    expect((await service.from('workflow_executions').insert({ id: executionId, workflow_id: workflowId, organization_id: orgA,
      lead_id: leadA, status: 'waiting', next_run_at: '2099-01-01T00:00:00Z' })).error).toBeNull();
    expect(await executeWorkflow({ supabase: service, executionId, workflowId, organizationId: orgA, leadId: leadA,
      guidedVersionId: publication.version_id, definition: { nodes: [], edges: [] }, loopLimit: 20, context: {},
    })).toMatchObject({ success: true, status: 'completed' });
    const steps = await service.from('workflow_execution_steps').select('node_id').eq('execution_id', executionId);
    expect(steps.error).toBeNull();
    expect(steps.data?.map(step => step.node_id)).toContain('yes');
    expect(steps.data?.map(step => step.node_id)).not.toContain('no');
    expect((await caller.rpc('read_guided_condition_lead_fields', args)).error?.code).toBe('42501');
    expect((await service.rpc('read_guided_condition_lead_fields', { ...args, p_fields: ['lead.name', field] })).error?.code).toBe('42501');
    expect((await service.rpc('read_guided_condition_lead_fields', { ...args, p_organization_id: orgB })).error?.code).toBe('42501');
    expect((await service.rpc('read_guided_condition_lead_fields', { ...args, p_lead_id: leadB })).data).toEqual([]);
    expect((await service.rpc('read_guided_condition_lead_fields', { ...args, p_fields: ['lead.password'] })).error?.code).toBe('22023');
    expect((await caller.rpc('set_workflow_data_grant', { p_workflow_id: workflowId, p_fields: [], p_expected_revision: 2 })).error).toBeNull();
    expect((await service.rpc('read_guided_condition_lead_fields', args)).error?.code).toBe('42501');
  }, 60000);

  it('requires current explicit tag scope and rejects foreign references during automatic reads', async () => {
    const workflowId = crypto.randomUUID();
    const tagId = crypto.randomUUID();
    const foreignTag = crypto.randomUUID();
    const caller = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } },
    });
    try {
      expect((await service.from('tags').insert([
        { id: tagId, organization_id: orgA, name: 'Distribuidor', color: '#ffd700' },
        { id: foreignTag, organization_id: orgB, name: 'Distribuidor', color: '#ffd700' },
      ])).error).toBeNull();
      expect((await service.from('lead_tags').insert({ lead_id: leadA, tag_id: tagId })).error).toBeNull();
      expect((await caller.rpc('create_guided_workflow_draft_with_settings', {
        p_workflow_id: workflowId, p_organization_id: orgA, p_definition: { nodes: [], edges: [] }, p_settings: { name: 'Tag scope' },
      })).error).toBeNull();
      expect((await caller.rpc('set_workflow_data_grant', { p_workflow_id: workflowId, p_fields: ['lead.name'], p_expected_revision: 0 })).error).toBeNull();
      const args = { p_workflow_id: workflowId, p_organization_id: orgA, p_lead_id: leadA, p_fields: ['lead.tags'], p_tag_ids: [tagId] };
      expect((await service.rpc('read_guided_condition_data', args)).error?.code).toBe('42501');
      expect((await caller.rpc('set_workflow_data_grant', { p_workflow_id: workflowId, p_fields: ['lead.tags'], p_expected_revision: 1 })).error).toBeNull();
      const read = await service.rpc('read_guided_condition_data', args);
      expect(read.error).toBeNull();
      expect(read.data).toEqual([{ id: leadA, organization_id: orgA, field_values: {
        tags: [{ tag_id: tagId, tag_name: 'Distribuidor', assigned: true }],
      } }]);
      const request = { organizationId: orgA, leadId: leadA, authorization: { kind: 'organization' as const, workflowId },
        condition: { version: 1, id: 'tag-rule', field: 'lead.tags', operator: 'has_tag', tagId: tagId.toUpperCase() } };
      expect(await evaluateGuidedCondition(service, request)).toEqual({ status: 'evaluated', matched: true,
        rules: [{ id: 'tag-rule', status: 'evaluated', matched: true, actual: true, reference: { id: tagId, name: 'Distribuidor' } }],
      });
      expect((await caller.rpc('read_guided_condition_data', args)).error?.code).toBe('42501');
      expect((await service.rpc('read_guided_condition_data', { ...args, p_fields: ['lead.tags', 'lead.name'] })).error?.code).toBe('42501');
      expect((await service.rpc('read_guided_condition_data', { ...args, p_organization_id: orgB })).error?.code).toBe('42501');
      expect((await service.rpc('read_guided_condition_data', { ...args, p_lead_id: leadB })).error?.code).toBe('PT404');
      expect((await service.rpc('read_guided_condition_data', { ...args, p_tag_ids: [tagId, foreignTag] })).error?.code).toBe('PT422');
      expect((await caller.rpc('set_workflow_data_grant', { p_workflow_id: workflowId,
        p_fields: ['lead.name', 'lead.tags'], p_expected_revision: 2 })).error).toBeNull();
      expect(await evaluateGuidedCondition(service, { ...request, condition: {
        version: 1, id: 'mixed', kind: 'group', match: 'all', children: [
          { version: 1, id: 'name', field: 'lead.name', operator: 'equals', value: 'JOSE' }, request.condition,
        ],
      } })).toMatchObject({ status: 'evaluated', matched: true,
        rules: [{ id: 'name', actual: 'José', matched: true }, { id: 'tag-rule', actual: true, matched: true }],
      });
      const definitionFor = (condition: unknown) => ({ nodes: [
        { id: 't', type: 'trigger', data: { triggerType: 'lead_created', config: {} } },
        { id: 'c', type: 'condition', data: { guidedCondition: condition } },
        { id: 'yes', type: 'end', data: {} }, { id: 'no', type: 'end', data: {} },
      ], edges: [{ id: 'tc', source: 't', target: 'c' }, { id: 'cy', source: 'c', target: 'yes', sourceHandle: 'yes' },
        { id: 'cn', source: 'c', target: 'no', sourceHandle: 'no' }] });
      const definition = definitionFor(request.condition);
      const settings = { name: 'Tag scope' };
      expect((await caller.rpc('save_guided_workflow_draft_with_settings', { p_workflow_id: workflowId, p_expected_revision: 1,
        p_definition: definition, p_settings: settings })).error).toBeNull();
      const publishArgs = { p_workflow_id: workflowId, p_organization_id: orgA, p_actor_id: userId,
        p_expected_revision: 2, p_definition: definition, p_settings: settings, p_required_fields: ['lead.tags'] };
      const published = await service.rpc('finalize_guided_workflow_publication', publishArgs);
      expect(published.error).toBeNull();
      expect(published.data).toMatchObject({ version_id: expect.any(String), version_number: 1 });
      const publishHttp = async (expectedRevision: number) => {
        const response = await fetch(`${process.env.SUPABASE_URL}/functions/v1/publish-guided-workflow`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: process.env.SUPABASE_ANON_KEY!, 'Content-Type': 'application/json' },
          body: JSON.stringify({ organizationId: orgA, workflowId, expectedRevision }),
        });
        return { status: response.status, body: await response.json() };
      };
      const publication = await publishHttp(2);
      expect(publication).toMatchObject({ status: 200, body: { status: 'published', version_id: expect.any(String), version_number: 2 } });
      const invalidBase = definitionFor({ version: 1, id: 'all-references', kind: 'group', match: 'any', children: [
        request.condition, { version: 1, id: 'foreign', field: 'lead.tags', operator: 'not_has_tag', tagId: foreignTag },
      ] });
      const invalidDefinition = { ...invalidBase,
        nodes: [...invalidBase.nodes, { id: 'valid', type: 'condition', data: { guidedCondition: request.condition } }],
        edges: [...invalidBase.edges.map(edge => edge.source === 't' ? { ...edge, target: 'valid' } : edge),
          { id: 'valid-yes', source: 'valid', target: 'c', sourceHandle: 'yes' },
          { id: 'valid-no', source: 'valid', target: 'no', sourceHandle: 'no' }],
      };
      expect((await caller.rpc('save_guided_workflow_draft_with_settings', { p_workflow_id: workflowId, p_expected_revision: 2,
        p_definition: invalidDefinition, p_settings: settings })).error).toBeNull();
      const rejected = await service.rpc('finalize_guided_workflow_publication', { ...publishArgs,
        p_expected_revision: 3, p_definition: invalidDefinition });
      expect(rejected.error?.code).toBe('PT422');
      expect(JSON.parse(rejected.error?.details || '{}')).toEqual({ nodeIds: ['c'] });
      expect(await publishHttp(3)).toEqual({ status: 422, body: { status: 'error', code: 'reference_unavailable', issues: [
        { nodeId: 'c', code: 'reference_unavailable', message: 'Uma referência foi removida ou não está acessível. Revise as escolhas desta condição.' },
      ] } });
      const selected = await caller.from('workflow_guided_publications').select('version_id').eq('workflow_id', workflowId).single();
      expect(selected.error).toBeNull();
      expect(selected.data?.version_id).toBe(publication.body.version_id);
      const executionId = crypto.randomUUID();
      expect((await service.from('workflow_executions').insert({ id: executionId, workflow_id: workflowId, organization_id: orgA,
        lead_id: leadA, status: 'waiting', next_run_at: '2099-01-01T00:00:00Z' })).error).toBeNull();
      expect(await executeWorkflow({ supabase: service, executionId, workflowId, organizationId: orgA, leadId: leadA,
        guidedVersionId: publication.body.version_id, definition: { nodes: [], edges: [] }, loopLimit: 20, context: {},
      })).toMatchObject({ success: true, status: 'completed' });
      const steps = await service.from('workflow_execution_steps').select('node_id').eq('execution_id', executionId);
      expect(steps.error).toBeNull();
      expect(steps.data?.map(step => step.node_id)).toContain('yes');
      expect(steps.data?.map(step => step.node_id)).not.toContain('no');
      expect((await caller.rpc('set_workflow_data_grant', { p_workflow_id: workflowId, p_fields: [], p_expected_revision: 3 })).error).toBeNull();
      expect((await service.rpc('read_guided_condition_data', args)).error?.code).toBe('42501');
      expect(await evaluateGuidedCondition(service, request)).toEqual({ status: 'error', code: 'access_denied' });
    } finally {
      await service.from('lead_tags').delete().eq('lead_id', leadA).eq('tag_id', tagId).throwOnError();
      await service.from('tags').delete().in('id', [tagId, foreignTag]).throwOnError();
    }
  }, 60000);

  it('rejects a master identity as a responsible even when its master registry row is hidden from the caller', async () => {
    const memberId = crypto.randomUUID(), foreignId = crypto.randomUUID();
    let shadowUserId: string | undefined;
    const caller = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: `guided-shadow-${orgA}` }, global: { headers: { Authorization: `Bearer ${token}` } },
    });
    try {
      const created = await service.auth.admin.createUser({ email: `guided-shadow-${crypto.randomUUID()}@example.test`, password: `${crypto.randomUUID()}!Aa1`, email_confirm: true });
      if (created.error) throw created.error;
      shadowUserId = created.data.user.id;
      await service.from('team_members').insert({ id: memberId, user_id: shadowUserId, organization_id: orgA, name: 'Shadow member', role: 'member', is_active: true }).throwOnError();
      await service.from('team_members').insert({ id: foreignId, organization_id: orgB, name: 'Guided foreign', role: 'member', is_active: false }).throwOnError();
      await service.from('master_users').insert({ user_id: shadowUserId, is_active: true }).throwOnError();
      const hiddenRegistry = await caller.from('master_users').select('user_id').eq('user_id', shadowUserId);
      expect(hiddenRegistry.error).toBeNull();
      expect(hiddenRegistry.data).toEqual([]);
      const catalogue = await caller.from('guided_responsible_members').select('id, name, is_active')
        .eq('organization_id', orgA).order('name').order('id').limit(25);
      expect(catalogue.error).toBeNull();
      expect(catalogue.data).toEqual([{ id: adminMemberId, name: 'Guided tester', is_active: true }]);
      const shadowSelection = await caller.from('guided_responsible_members').select('id, name, is_active')
        .eq('organization_id', orgA).eq('id', memberId).maybeSingle();
      expect(shadowSelection.error).toBeNull();
      expect(shadowSelection.data).toBeNull();
      const foreignCatalogue = await caller.from('guided_responsible_members').select('id, name, is_active')
        .eq('organization_id', orgB).order('name').order('id').limit(25);
      expect(foreignCatalogue.error).toBeNull();
      expect(foreignCatalogue.data).toEqual([]);
      const args = { p_organization_id: orgA, p_lead_id: leadA, p_fields: ['lead.pre_sale_responsible_id'], p_member_ids: [memberId] };
      expect((await caller.rpc('test_guided_condition_responsibles', args)).error?.code).toBe('PT422');
      const ordinaryMember = await caller.rpc('test_guided_condition_responsibles', { ...args, p_member_ids: [adminMemberId] });
      expect(ordinaryMember.error).toBeNull();
      expect(ordinaryMember.data).toEqual([{ field_values: { pre_sale_responsible_id: adminMemberId }, members: [{ id: adminMemberId, name: 'Guided tester' }] }]);
      const workflowId = crypto.randomUUID();
      const definition = { nodes: [
        { id: 't', type: 'trigger', data: { triggerType: 'lead_created', config: {} } },
        { id: 'c', type: 'condition', data: { guidedCondition: { version: 1, id: 'master', field: 'lead.pre_sale_responsible_id', operator: 'equals', memberId } } },
        { id: 'yes', type: 'end', data: {} }, { id: 'no', type: 'end', data: {} },
      ], edges: [{ id: 'tc', source: 't', target: 'c' }, { id: 'cy', source: 'c', target: 'yes', sourceHandle: 'yes' }, { id: 'cn', source: 'c', target: 'no', sourceHandle: 'no' }] };
      const settings = { name: 'Protected responsible scope' };
      expect((await caller.rpc('create_guided_workflow_draft_with_settings', {
        p_workflow_id: workflowId, p_organization_id: orgA, p_definition: definition, p_settings: settings,
      })).error).toBeNull();
      expect((await caller.rpc('set_workflow_data_grant', { p_workflow_id: workflowId, p_fields: ['lead.pre_sale_responsible_id'], p_expected_revision: 0 })).error).toBeNull();
      const rejectedPublication = await service.rpc('finalize_guided_workflow_publication', {
        p_workflow_id: workflowId, p_organization_id: orgA, p_actor_id: userId, p_expected_revision: 1,
        p_definition: definition, p_settings: settings, p_required_fields: ['lead.pre_sale_responsible_id'],
      });
      expect(rejectedPublication.error?.code).toBe('PT422');
      expect(JSON.parse(rejectedPublication.error?.details || '{}')).toEqual({ nodeIds: ['c'] });
      const authorizedArgs = { ...args, p_workflow_id: workflowId, p_tag_ids: [], p_origin_ids: [] };
      expect((await service.rpc('read_guided_condition_data', authorizedArgs)).error?.code).toBe('PT422');
      const authorizedMember = await service.rpc('read_guided_condition_data', { ...authorizedArgs, p_member_ids: [adminMemberId] });
      expect(authorizedMember.error).toBeNull();
      expect(authorizedMember.data).toEqual([{ id: leadA, organization_id: orgA, field_values: {
        responsibles: { field_values: { pre_sale_responsible_id: adminMemberId }, members: [{ id: adminMemberId, name: 'Guided tester' }] },
      } }]);

    } finally {
      await service.from('team_members').delete().in('id', [memberId, foreignId]).throwOnError();
      if (shadowUserId) {
        await service.from('master_users').delete().eq('user_id', shadowUserId).throwOnError();
        const deleted = await service.auth.admin.deleteUser(shadowUserId);
        expect(deleted.error).toBeNull();
      }
    }
  }, 60000);

  it('tests canonical responsible identities under caller RLS without mixing sales and presales', async () => {
    const salesId = crypto.randomUUID(), foreignId = crypto.randomUUID();
    const caller = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: `guided-responsible-${orgA}` }, global: { headers: { Authorization: `Bearer ${token}` } },
    });
    try {
      await service.from('team_members').insert([
        { id: salesId, organization_id: orgA, name: 'Marina', role: 'member', is_active: true },
        { id: foreignId, organization_id: orgB, name: 'Marina', role: 'member', is_active: true },
      ]).throwOnError();
      await service.from('leads').update({ sale_responsible_id: salesId }).eq('id', leadA).throwOnError();
      const args = { p_organization_id: orgA, p_lead_id: leadA,
        p_fields: ['lead.pre_sale_responsible_id', 'lead.sale_responsible_id'], p_member_ids: [adminMemberId, salesId] };
      const read = await caller.rpc('test_guided_condition_responsibles', args);
      expect(read.error).toBeNull();
      expect(read.data).toEqual([{ field_values: { pre_sale_responsible_id: adminMemberId, sale_responsible_id: salesId },
        members: expect.arrayContaining([{ id: adminMemberId, name: 'Guided tester' }, { id: salesId, name: 'Marina' }]),
      }]);
      expect(read.data[0].members).toHaveLength(2);
      const salesOnly = await caller.rpc('test_guided_condition_responsibles', { ...args, p_fields: ['lead.sale_responsible_id'], p_member_ids: [salesId] });
      expect(salesOnly.error).toBeNull();
      expect(salesOnly.data).toEqual([{ field_values: { sale_responsible_id: salesId }, members: [{ id: salesId, name: 'Marina' }] }]);
      expect((await caller.rpc('test_guided_condition_responsibles', { ...args, p_lead_id: leadB })).error?.code).toBe('PT404');
      expect((await caller.rpc('test_guided_condition_responsibles', { ...args, p_member_ids: [foreignId] })).error?.code).toBe('PT422');
      expect((await caller.rpc('test_guided_condition_responsibles', { ...args, p_fields: ['lead.password'] })).error?.code).toBe('22023');
      expect((await service.rpc('test_guided_condition_responsibles', args)).error?.code).toBe('42501');
      await service.from('team_members').update({ name: 'Marina atual', is_active: false }).eq('id', salesId).throwOnError();
      expect((await caller.rpc('test_guided_condition_responsibles', { ...args, p_member_ids: [salesId] })).data).toEqual([
        { field_values: { pre_sale_responsible_id: adminMemberId, sale_responsible_id: salesId }, members: [{ id: salesId, name: 'Marina atual' }] },
      ]);
      const condition = { version: 1, id: 'both', kind: 'group', match: 'all', children: [
        { version: 1, id: 'presales', field: 'lead.pre_sale_responsible_id', operator: 'equals', memberId: adminMemberId.toUpperCase() },
        { version: 1, id: 'sales', field: 'lead.sale_responsible_id', operator: 'equals', memberId: salesId },
      ] };
      const response = await fetch(`${process.env.SUPABASE_URL}/functions/v1/test-guided-condition`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: process.env.SUPABASE_ANON_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgA, leadId: leadA, condition }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 'evaluated', matched: true,
        groups: [{ id: 'both', status: 'evaluated', matched: true }], rules: [
          { id: 'presales', status: 'evaluated', matched: true, actual: adminMemberId, reference: { id: adminMemberId, name: 'Guided tester' } },
          { id: 'sales', status: 'evaluated', matched: true, actual: salesId, reference: { id: salesId, name: 'Marina atual' } },
        ],
      });
      await service.from('leads').update({ sale_responsible_id: null }).eq('id', leadA).throwOnError();
      await service.from('team_members').delete().eq('id', salesId).throwOnError();
      expect((await caller.rpc('test_guided_condition_responsibles', { ...args, p_member_ids: [salesId] })).error?.code).toBe('PT422');
      expect((await caller.rpc('test_guided_condition_responsibles', { ...args, p_fields: ['lead.sale_responsible_id'], p_member_ids: [] })).data).toEqual([
        { field_values: { sale_responsible_id: null }, members: [] },
      ]);
      const request = { organizationId: orgA, leadId: leadA };
      expect(await evaluateGuidedCondition(caller, { ...request, condition: { version: 1, id: 'empty', field: 'lead.sale_responsible_id', operator: 'is_empty' } })).toEqual({
        status: 'evaluated', matched: true, rules: [{ id: 'empty', status: 'evaluated', matched: true, actual: null }],
      });
      expect(await evaluateGuidedCondition(caller, { ...request, condition: { version: 1, id: 'different', field: 'lead.sale_responsible_id', operator: 'not_equals', memberId: adminMemberId } })).toMatchObject({ status: 'evaluated', matched: false });
      expect(await evaluateGuidedCondition(caller, { ...request, condition: { version: 1, id: 'any', kind: 'group', match: 'any', children: [
        { version: 1, id: 'name', field: 'lead.name', operator: 'equals', value: 'José' },
        { version: 1, id: 'deleted', field: 'lead.sale_responsible_id', operator: 'not_equals', memberId: salesId },
      ] } })).toEqual({ status: 'error', code: 'reference_unavailable' });
    } finally {
      await service.from('leads').update({ sale_responsible_id: null }).eq('id', leadA).throwOnError();
      await service.from('team_members').delete().in('id', [salesId, foreignId]).throwOnError();
    }
  }, 60000);

  it.each(['lead.origin', 'lead.pre_sale_responsible_id', 'lead.sale_responsible_id'])('checks filled %s without requiring a catalogue comparison reference', async field => {
    const workflowId = crypto.randomUUID(), column = field.slice(5);
    const actual = field === 'lead.origin' ? 'historical-origin-code' : adminMemberId;
    const condition = { version: 1, id: 'presence', field, operator: 'is_not_empty', memberId: crypto.randomUUID(), originId: crypto.randomUUID() };
    const caller = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: `guided-presence-${workflowId}` }, global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const definition = { nodes: [
      { id: 't', type: 'trigger', data: { triggerType: 'lead_created', config: {} } },
      { id: 'c', type: 'condition', data: { guidedCondition: condition } },
      { id: 'yes', type: 'end', data: {} }, { id: 'no', type: 'end', data: {} },
    ], edges: [{ id: 'tc', source: 't', target: 'c' }, { id: 'cy', source: 'c', target: 'yes', sourceHandle: 'yes' }, { id: 'cn', source: 'c', target: 'no', sourceHandle: 'no' }] };
    const settings = { name: 'Reference presence' };
    const post = async (endpoint: string, body: unknown) => {
      const response = await fetch(`${process.env.SUPABASE_URL}/functions/v1/${endpoint}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: process.env.SUPABASE_ANON_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
      });
      return { status: response.status, body: await response.json() };
    };
    try {
      await service.from('leads').update({ [column]: actual }).eq('id', leadA).throwOnError();
      const request = { organizationId: orgA, leadId: leadA, condition };
      expect(await evaluateGuidedCondition(caller, request)).toEqual({ status: 'evaluated', matched: true,
        rules: [{ id: 'presence', status: 'evaluated', matched: true, actual }],
      });
      expect((await caller.rpc('create_guided_workflow_draft_with_settings', { p_workflow_id: workflowId,
        p_organization_id: orgA, p_definition: definition, p_settings: settings })).error).toBeNull();
      expect((await caller.rpc('set_workflow_data_grant', { p_workflow_id: workflowId, p_fields: [field], p_expected_revision: 0 })).error).toBeNull();
      const args = { p_workflow_id: workflowId, p_organization_id: orgA, p_actor_id: userId, p_expected_revision: 1,
        p_definition: definition, p_settings: settings, p_required_fields: [field] };
      expect((await service.rpc('finalize_guided_workflow_publication', args)).error).toBeNull();
      expect((await service.rpc('finalize_guided_workflow_publication', { ...args, p_required_fields: [] })).error?.code).toBe('42501');
      expect(await post('test-guided-condition', request)).toMatchObject({ status: 200, body: { matched: true } });
      expect(await post('publish-guided-workflow', { organizationId: orgA, workflowId, expectedRevision: 1 })).toMatchObject({ status: 200, body: { status: 'published' } });
      const automatic = { ...request, authorization: { kind: 'organization' as const, workflowId } };
      expect(await evaluateGuidedCondition(service, automatic)).toMatchObject({ status: 'evaluated', matched: true });
      await service.from('leads').update({ [column]: null }).eq('id', leadA).throwOnError();
      expect(await evaluateGuidedCondition(service, automatic)).toMatchObject({ status: 'evaluated', matched: false });
      expect(await evaluateGuidedCondition(caller, { ...request, condition: { ...condition, operator: 'is_empty' } })).toMatchObject({ status: 'evaluated', matched: true });
      expect((await caller.rpc('set_workflow_data_grant', { p_workflow_id: workflowId, p_fields: [], p_expected_revision: 1 })).error).toBeNull();
      expect(await evaluateGuidedCondition(service, automatic)).toEqual({ status: 'error', code: 'access_denied' });
    } finally {
      await service.from('leads').update({ [column]: column === 'pre_sale_responsible_id' ? adminMemberId : null }).eq('id', leadA).throwOnError();
    }
  }, 60000);

  it('publishes and evaluates filled scalars using current values and explicit scopes', async () => {
    const workflowId = crypto.randomUUID();
    const caller = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: `guided-filled-${workflowId}` }, global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const condition = { version: 1, id: 'filled', kind: 'group', match: 'all', children: [
      { version: 1, id: 'name', field: 'lead.name', operator: 'is_not_empty' },
      { version: 1, id: 'score', field: 'lead.qualification_score', operator: 'is_not_empty' },
    ] };
    const definition = { nodes: [
      { id: 't', type: 'trigger', data: { triggerType: 'lead_created', config: {} } },
      { id: 'c', type: 'condition', data: { guidedCondition: condition } },
      { id: 'yes', type: 'end', data: {} }, { id: 'no', type: 'end', data: {} },
    ], edges: [{ id: 'tc', source: 't', target: 'c' }, { id: 'cy', source: 'c', target: 'yes', sourceHandle: 'yes' }, { id: 'cn', source: 'c', target: 'no', sourceHandle: 'no' }] };
    const post = async (endpoint: string, body: unknown) => {
      const response = await fetch(`${process.env.SUPABASE_URL}/functions/v1/${endpoint}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: process.env.SUPABASE_ANON_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
      });
      return { status: response.status, body: await response.json() };
    };
    try {
      await service.from('leads').update({ qualification_score: 0 }).eq('id', leadA).throwOnError();
      const request = { organizationId: orgA, leadId: leadA, condition };
      expect(await post('test-guided-condition', request)).toMatchObject({ status: 200, body: { status: 'evaluated', matched: true,
        rules: [{ id: 'name', matched: true }, { id: 'score', matched: true, actual: 0 }],
      } });
      expect(await post('test-guided-condition', { ...request, leadId: leadB })).toMatchObject({ status: 422, body: { code: 'context_unavailable' } });
      expect((await caller.rpc('create_guided_workflow_draft_with_settings', { p_workflow_id: workflowId, p_organization_id: orgA,
        p_definition: definition, p_settings: { name: 'Filled scalar publication' } })).error).toBeNull();
      expect((await caller.rpc('set_workflow_data_grant', { p_workflow_id: workflowId, p_fields: ['lead.name', 'lead.qualification_score'], p_expected_revision: 0 })).error).toBeNull();
      const published = await post('publish-guided-workflow', { organizationId: orgA, workflowId, expectedRevision: 1 });
      expect(published).toMatchObject({ status: 200, body: { status: 'published', version_id: expect.any(String) } });
      const executionId = crypto.randomUUID();
      await service.from('workflow_executions').insert({ id: executionId, workflow_id: workflowId, organization_id: orgA,
        lead_id: leadA, status: 'waiting', next_run_at: '2099-01-01T00:00:00Z' }).throwOnError();
      expect(await executeWorkflow({ supabase: service, executionId, workflowId, organizationId: orgA, leadId: leadA,
        guidedVersionId: published.body.version_id, definition: { nodes: [], edges: [] }, loopLimit: 20, context: {},
      })).toMatchObject({ success: true, status: 'completed' });
      const steps = await service.from('workflow_execution_steps').select('node_id').eq('execution_id', executionId);
      expect(steps.error).toBeNull();
      expect(steps.data?.map(step => step.node_id)).toContain('yes');
      expect(steps.data?.map(step => step.node_id)).not.toContain('no');
      await service.from('leads').update({ qualification_score: null }).eq('id', leadA).throwOnError();
      expect(await post('test-guided-condition', request)).toMatchObject({ status: 200, body: { matched: false } });
      const automatic = { ...request, authorization: { kind: 'organization' as const, workflowId } };
      expect(await evaluateGuidedCondition(service, automatic)).toMatchObject({ status: 'evaluated', matched: false });
      expect((await caller.rpc('set_workflow_data_grant', { p_workflow_id: workflowId, p_fields: ['lead.name'], p_expected_revision: 1 })).error).toBeNull();
      expect(await evaluateGuidedCondition(service, automatic)).toEqual({ status: 'error', code: 'access_denied' });
    } finally {
      await service.from('leads').update({ qualification_score: null }).eq('id', leadA).throwOnError();
    }
  }, 60000);

  it('evaluates organizational responsible conditions only within the granted assignment scope', async () => {
    const workflowId = crypto.randomUUID(), salesId = crypto.randomUUID(), foreignId = crypto.randomUUID();
    const caller = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: `guided-responsible-grant-${orgA}` }, global: { headers: { Authorization: `Bearer ${token}` } },
    });
    try {
      await service.from('team_members').insert([
        { id: salesId, organization_id: orgA, name: 'Marina', role: 'member', is_active: false },
        { id: foreignId, organization_id: orgB, name: 'Marina', role: 'member', is_active: true },
      ]).throwOnError();
      await service.from('leads').update({ sale_responsible_id: salesId }).eq('id', leadA).throwOnError();
      expect((await caller.rpc('create_guided_workflow_draft_with_settings', {
        p_workflow_id: workflowId, p_organization_id: orgA, p_definition: { nodes: [], edges: [] }, p_settings: { name: 'Responsible scope' },
      })).error).toBeNull();
      const grant = (fields: string[], revision: number) => caller.rpc('set_workflow_data_grant', {
        p_workflow_id: workflowId, p_fields: fields, p_expected_revision: revision,
      });
      expect((await grant(['lead.sale_responsible_id'], 0)).error).toBeNull();
      const args = { p_workflow_id: workflowId, p_organization_id: orgA, p_lead_id: leadA,
        p_fields: ['lead.sale_responsible_id'], p_tag_ids: [], p_origin_ids: [], p_member_ids: [salesId] };
      const read = await service.rpc('read_guided_condition_data', args);
      expect(read.error).toBeNull();
      expect(read.data).toEqual([{ id: leadA, organization_id: orgA, field_values: {
        responsibles: { field_values: { sale_responsible_id: salesId }, members: [{ id: salesId, name: 'Marina' }] },
      } }]);
      expect((await caller.rpc('read_guided_condition_data', args)).error?.code).toBe('42501');
      expect((await service.rpc('read_guided_condition_data', { ...args, p_fields: ['lead.pre_sale_responsible_id'] })).error?.code).toBe('42501');
      expect((await service.rpc('read_guided_condition_data', { ...args, p_organization_id: orgB })).error?.code).toBe('42501');
      expect((await service.rpc('read_guided_condition_data', { ...args, p_lead_id: leadB })).error?.code).toBe('PT404');
      expect((await service.rpc('read_guided_condition_data', { ...args, p_member_ids: [foreignId] })).error?.code).toBe('PT422');
      const request = { organizationId: orgA, leadId: leadA, authorization: { kind: 'organization' as const, workflowId },
        condition: { version: 1, id: 'sales', field: 'lead.sale_responsible_id', operator: 'equals', memberId: salesId } };
      expect(await evaluateGuidedCondition(service, request)).toEqual({ status: 'evaluated', matched: true,
        rules: [{ id: 'sales', status: 'evaluated', matched: true, actual: salesId, reference: { id: salesId, name: 'Marina' } }],
      });
      expect((await grant(['lead.pre_sale_responsible_id'], 1)).error).toBeNull();
      expect(await evaluateGuidedCondition(service, request)).toEqual({ status: 'error', code: 'access_denied' });
      expect(await evaluateGuidedCondition(service, { ...request, condition: { ...request.condition, field: 'lead.pre_sale_responsible_id', memberId: adminMemberId } })).toMatchObject({ status: 'evaluated', matched: true });
      expect((await grant(['lead.pre_sale_responsible_id', 'lead.sale_responsible_id', 'lead.company'], 2)).error).toBeNull();
      expect(await evaluateGuidedCondition(service, { ...request, condition: { version: 1, id: 'all', kind: 'group', match: 'all', children: [
        request.condition,
        { version: 1, id: 'pre', field: 'lead.pre_sale_responsible_id', operator: 'equals', memberId: adminMemberId },
        { version: 1, id: 'company', field: 'lead.company', operator: 'contains', value: 'AURORA' },
      ] } })).toMatchObject({ status: 'evaluated', matched: true });
      await service.from('leads').update({ sale_responsible_id: null }).eq('id', leadA).throwOnError();
      await service.from('team_members').delete().eq('id', salesId).throwOnError();
      expect(await evaluateGuidedCondition(service, request)).toEqual({ status: 'error', code: 'reference_unavailable' });
      expect(await evaluateGuidedCondition(service, { ...request, condition: { version: 1, id: 'empty', field: 'lead.sale_responsible_id', operator: 'is_empty' } })).toMatchObject({ status: 'evaluated', matched: true });
    } finally {
      await service.from('leads').update({ sale_responsible_id: null }).eq('id', leadA).throwOnError();
      await service.from('team_members').delete().in('id', [salesId, foreignId]).throwOnError();
    }
  }, 60000);

  it.each(['lead.pre_sale_responsible_id', 'lead.sale_responsible_id'])('publishes $0 with valid responsible references and preserves its active version on rejection', async field => {
    const workflowId = crypto.randomUUID(), memberId = crypto.randomUUID(), foreignId = crypto.randomUUID();
    const column = field.slice('lead.'.length);
    const caller = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, storageKey: `guided-publish-responsible-${workflowId}` }, global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const condition = { version: 1, id: 'responsible', field, operator: 'equals', memberId };
    const definitionFor = (rule: unknown) => ({ nodes: [
      { id: 't', type: 'trigger', data: { triggerType: 'lead_created', config: {} } },
      { id: 'c', type: 'condition', data: { guidedCondition: rule } },
      { id: 'yes', type: 'end', data: {} }, { id: 'no', type: 'end', data: {} },
    ], edges: [{ id: 'tc', source: 't', target: 'c' }, { id: 'cy', source: 'c', target: 'yes', sourceHandle: 'yes' }, { id: 'cn', source: 'c', target: 'no', sourceHandle: 'no' }] });
    const definition = definitionFor(condition), settings = { name: 'Responsible publication' };
    const publish = async (revision: number) => {
      const response = await fetch(`${process.env.SUPABASE_URL}/functions/v1/publish-guided-workflow`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: process.env.SUPABASE_ANON_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgA, workflowId, expectedRevision: revision }), signal: AbortSignal.timeout(15000),
      });
      return { status: response.status, body: await response.json() };
    };
    try {
      await service.from('team_members').insert([
        { id: memberId, organization_id: orgA, name: 'Marina', role: 'member', is_active: false },
        { id: foreignId, organization_id: orgB, name: 'Marina', role: 'member', is_active: true },
      ]).throwOnError();
      await service.from('leads').update({ [column]: memberId }).eq('id', leadA).throwOnError();
      expect((await caller.rpc('create_guided_workflow_draft_with_settings', {
        p_workflow_id: workflowId, p_organization_id: orgA, p_definition: definition, p_settings: settings,
      })).error).toBeNull();
      expect((await caller.rpc('set_workflow_data_grant', { p_workflow_id: workflowId, p_fields: [field], p_expected_revision: 0 })).error).toBeNull();
      const args = { p_workflow_id: workflowId, p_organization_id: orgA, p_actor_id: userId,
        p_expected_revision: 1, p_definition: definition, p_settings: settings, p_required_fields: [field] };
      const finalized = await service.rpc('finalize_guided_workflow_publication', args);
      expect(finalized.error).toBeNull();
      const published = await publish(1);
      expect(published).toMatchObject({ status: 200, body: { status: 'published', version_id: expect.any(String) } });
      const executionId = crypto.randomUUID();
      await service.from('workflow_executions').insert({ id: executionId, workflow_id: workflowId, organization_id: orgA,
        lead_id: leadA, status: 'waiting', next_run_at: '2099-01-01T00:00:00Z' }).throwOnError();
      expect(await executeWorkflow({ supabase: service, executionId, workflowId, organizationId: orgA, leadId: leadA,
        guidedVersionId: published.body.version_id, definition: { nodes: [], edges: [] }, loopLimit: 20, context: {},
      })).toMatchObject({ success: true, status: 'completed' });
      const steps = await service.from('workflow_execution_steps').select('node_id').eq('execution_id', executionId);
      expect(steps.error).toBeNull();
      expect(steps.data?.map(step => step.node_id)).toContain('yes');
      expect(steps.data?.map(step => step.node_id)).not.toContain('no');
      const invalid = definitionFor({ version: 1, id: 'any', kind: 'group', match: 'any', children: [condition, { ...condition, id: 'foreign', memberId: foreignId }] });
      expect((await caller.rpc('save_guided_workflow_draft_with_settings', { p_workflow_id: workflowId, p_expected_revision: 1, p_definition: invalid, p_settings: settings })).error).toBeNull();
      const rejected = await publish(2);
      expect(rejected).toMatchObject({ status: 422, body: { status: 'error', code: 'reference_unavailable', issues: [{ nodeId: 'c', code: 'reference_unavailable' }] } });
      const empty = definitionFor({ version: 1, id: 'empty', field, operator: 'is_empty' });
      expect((await caller.rpc('save_guided_workflow_draft_with_settings', { p_workflow_id: workflowId, p_expected_revision: 2, p_definition: empty, p_settings: settings })).error).toBeNull();
      expect((await service.rpc('finalize_guided_workflow_publication', { ...args, p_expected_revision: 3, p_definition: empty, p_required_fields: [] })).error?.code).toBe('42501');
      expect((await caller.rpc('save_guided_workflow_draft_with_settings', { p_workflow_id: workflowId, p_expected_revision: 3, p_definition: definition, p_settings: settings })).error).toBeNull();
      await service.from('leads').update({ [column]: null }).eq('id', leadA).throwOnError();
      await service.from('team_members').delete().eq('id', memberId).throwOnError();
      expect(await publish(4)).toMatchObject({ status: 422, body: { status: 'error', code: 'reference_unavailable', issues: [{ nodeId: 'c' }] } });
      const active = await caller.from('workflow_guided_publications').select('version_id').eq('workflow_id', workflowId).single();
      expect(active.error).toBeNull();
      expect(active.data?.version_id).toBe(published.body.version_id);
    } finally {
      await service.from('leads').update({ [column]: column === 'pre_sale_responsible_id' ? adminMemberId : null }).eq('id', leadA).throwOnError();
      await service.from('team_members').delete().in('id', [memberId, foreignId]).throwOnError();
    }
  }, 60000);

  it('authorizes origin explicitly and reads mixed fields without exposing unrequested data', async () => {
    const workflowId = crypto.randomUUID(), originId = crypto.randomUUID(), foreignId = crypto.randomUUID(), tagId = crypto.randomUUID();
    const caller = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } },
    });
    try {
      await service.from('tags').insert({ id: tagId, organization_id: orgA, name: 'Distribuidor', color: '#ffd700' }).throwOnError();
      await service.from('lead_tags').insert({ lead_id: leadA, tag_id: tagId }).throwOnError();
      await service.from('lead_origins').insert([
        { id: originId, organization_id: orgA, name: 'Parceiros', slug: 'guided_partner' },
        { id: foreignId, organization_id: orgB, name: 'Parceiros', slug: 'guided_partner' },
      ]).throwOnError();
      await service.from('leads').update({ origin: 'guided_partner' }).eq('id', leadA).throwOnError();
      expect((await caller.rpc('create_guided_workflow_draft_with_settings', {
        p_workflow_id: workflowId, p_organization_id: orgA, p_definition: { nodes: [], edges: [] }, p_settings: { name: 'Origin scope' },
      })).error).toBeNull();
      expect((await caller.rpc('set_workflow_data_grant', { p_workflow_id: workflowId, p_fields: ['lead.origin'], p_expected_revision: 0 })).error).toBeNull();
      const args = { p_workflow_id: workflowId, p_organization_id: orgA, p_lead_id: leadA,
        p_fields: ['lead.origin'], p_tag_ids: [], p_origin_ids: [originId] };
      const read = await service.rpc('read_guided_condition_data', args);
      expect(read.error).toBeNull();
      expect(read.data).toEqual([{ id: leadA, organization_id: orgA, field_values: {
        origin: { actual_origin: 'guided_partner', origins: [{ id: originId, name: 'Parceiros', slug: 'guided_partner' }] },
      } }]);
      expect((await caller.rpc('read_guided_condition_data', args)).error?.code).toBe('42501');
      expect((await service.rpc('read_guided_condition_data', { ...args, p_fields: ['lead.origin', 'lead.name'] })).error?.code).toBe('42501');
      expect((await service.rpc('read_guided_condition_data', { ...args, p_organization_id: orgB })).error?.code).toBe('42501');
      expect((await service.rpc('read_guided_condition_data', { ...args, p_lead_id: leadB })).error?.code).toBe('PT404');
      expect((await service.rpc('read_guided_condition_data', { ...args, p_origin_ids: [foreignId] })).error?.code).toBe('PT422');
      expect((await caller.rpc('set_workflow_data_grant', { p_workflow_id: workflowId, p_fields: ['lead.origin', 'lead.company', 'lead.tags'], p_expected_revision: 1 })).error).toBeNull();
      const mixed = await service.rpc('read_guided_condition_data', { ...args, p_fields: ['lead.origin', 'lead.company', 'lead.tags'], p_tag_ids: [tagId] });
      expect(mixed.error).toBeNull();
      expect(mixed.data).toEqual([{ id: leadA, organization_id: orgA, field_values: {
        tags: [{ tag_id: tagId, tag_name: 'Distribuidor', assigned: true }], company: 'Fábrica Aurora', origin: { actual_origin: 'guided_partner', origins: [{ id: originId, name: 'Parceiros', slug: 'guided_partner' }] },
      } }]);
      const condition = { version: 1, id: 'origin', field: 'lead.origin', operator: 'equals', originId };
      const request = { organizationId: orgA, leadId: leadA, authorization: { kind: 'organization' as const, workflowId }, condition };
      expect(await evaluateGuidedCondition(service, { ...request, condition: {
        version: 1, id: 'mixed', kind: 'group', match: 'all', children: [condition,
          { version: 1, id: 'company', field: 'lead.company', operator: 'equals', value: 'FABRICA AURORA' },
          { version: 1, id: 'tag', field: 'lead.tags', operator: 'has_tag', tagId },
        ],
      } })).toMatchObject({ status: 'evaluated', matched: true, rules: [
        { id: 'origin', matched: true, reference: { id: originId, name: 'Parceiros' } },
        { id: 'company', matched: true, actual: 'Fábrica Aurora' }, { id: 'tag', matched: true, actual: true },
      ] });
      const definition = { nodes: [
        { id: 't', type: 'trigger', data: { triggerType: 'lead_created', config: {} } },
        { id: 'c', type: 'condition', data: { guidedCondition: condition } },
        { id: 'yes', type: 'end', data: {} }, { id: 'no', type: 'end', data: {} },
      ], edges: [{ id: 'tc', source: 't', target: 'c' }, { id: 'cy', source: 'c', target: 'yes', sourceHandle: 'yes' }, { id: 'cn', source: 'c', target: 'no', sourceHandle: 'no' }] };
      const settings = { name: 'Origin scope' };
      expect((await caller.rpc('save_guided_workflow_draft_with_settings', {
        p_workflow_id: workflowId, p_expected_revision: 1, p_definition: definition, p_settings: settings,
      })).error).toBeNull();
      const publishArgs = { p_workflow_id: workflowId, p_organization_id: orgA, p_actor_id: userId,
        p_expected_revision: 2, p_definition: definition, p_settings: settings, p_required_fields: ['lead.origin'] };
      const published = await service.rpc('finalize_guided_workflow_publication', publishArgs);
      expect(published.error).toBeNull();
      expect(published.data).toMatchObject({ version_id: expect.any(String), version_number: 1 });
      const publishHttp = () => fetch(`${process.env.SUPABASE_URL}/functions/v1/publish-guided-workflow`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: process.env.SUPABASE_ANON_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgA, workflowId, expectedRevision: 2 }),
      });
      const publishResponse = await publishHttp();
      expect(publishResponse.status).toBe(200);
      const publication = await publishResponse.json();
      const executionId = crypto.randomUUID();
      await service.from('workflow_executions').insert({ id: executionId, workflow_id: workflowId, organization_id: orgA,
        lead_id: leadA, status: 'waiting', next_run_at: '2099-01-01T00:00:00Z' }).throwOnError();
      expect(await executeWorkflow({ supabase: service, executionId, workflowId, organizationId: orgA, leadId: leadA,
        guidedVersionId: publication.version_id, definition: { nodes: [], edges: [] }, loopLimit: 20, context: {},
      })).toMatchObject({ success: true, status: 'completed' });
      const steps = await service.from('workflow_execution_steps').select('node_id').eq('execution_id', executionId);
      expect(steps.error).toBeNull();
      expect(steps.data?.map(step => step.node_id)).toContain('yes');
      expect(steps.data?.map(step => step.node_id)).not.toContain('no');
      await service.from('lead_origins').delete().eq('id', originId).throwOnError();
      expect((await service.rpc('read_guided_condition_data', args)).error?.code).toBe('PT422');
      const rejected = await service.rpc('finalize_guided_workflow_publication', publishArgs);
      expect(rejected.error?.code).toBe('PT422');
      expect(JSON.parse(rejected.error?.details || '{}')).toEqual({ nodeIds: ['c'] });
      const rejectedHttp = await publishHttp();
      expect(rejectedHttp.status).toBe(422);
      expect(await rejectedHttp.json()).toEqual({ status: 'error', code: 'reference_unavailable', issues: [
        { nodeId: 'c', code: 'reference_unavailable', message: 'Uma referência foi removida ou não está acessível. Revise as escolhas desta condição.' },
      ] });
      const selected = await caller.from('workflow_guided_publications').select('version_id').eq('workflow_id', workflowId).single();
      expect(selected.error).toBeNull();
      expect(selected.data?.version_id).toBe(publication.version_id);

      await service.from('leads').update({ origin: null }).eq('id', leadA).throwOnError();
      expect((await service.rpc('read_guided_condition_data', { ...args, p_origin_ids: [] })).data).toEqual([
        { id: leadA, organization_id: orgA, field_values: { origin: { actual_origin: null, origins: [] } } },
      ]);
      expect((await caller.rpc('set_workflow_data_grant', { p_workflow_id: workflowId, p_fields: [], p_expected_revision: 2 })).error).toBeNull();
      expect((await service.rpc('read_guided_condition_data', { ...args, p_origin_ids: [] })).error?.code).toBe('42501');
      expect(await evaluateGuidedCondition(service, request)).toEqual({ status: 'error', code: 'access_denied' });
    } finally {
      await service.from('lead_tags').delete().eq('lead_id', leadA).eq('tag_id', tagId).throwOnError();
      await service.from('tags').delete().eq('id', tagId).throwOnError();
      await service.from('leads').update({ origin: null }).eq('id', leadA).throwOnError();
      await service.from('lead_origins').delete().in('id', [originId, foreignId]).throwOnError();
    }
  }, 60000);

  it('resolves origin identity and current lead code together under caller RLS', async () => {
    const originId = crypto.randomUUID(), foreignId = crypto.randomUUID(), replacementId = crypto.randomUUID();
    const caller = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } },
    });
    try {
      expect((await service.from('lead_origins').insert([
        { id: originId, organization_id: orgA, name: 'Indicação comercial', slug: 'guided_referral' },
        { id: foreignId, organization_id: orgB, name: 'Indicação comercial', slug: 'guided_referral' },
      ])).error).toBeNull();
      expect((await service.from('leads').update({ origin: 'guided_referral' }).eq('id', leadA)).error).toBeNull();
      const suggestions = await caller.from('lead_origins').select('id, name, is_active').eq('organization_id', orgA)
        .ilike('name', '%comercial%').order('name').order('id').limit(25);
      expect(suggestions.error).toBeNull();
      expect(suggestions.data).toEqual([{ id: originId, name: 'Indicação comercial', is_active: true }]);
      const foreignSuggestions = await caller.from('lead_origins').select('id, name, is_active').eq('organization_id', orgB)
        .ilike('name', '%comercial%').order('name').order('id').limit(25);
      expect(foreignSuggestions.error).toBeNull();
      expect(foreignSuggestions.data).toEqual([]);
      const foreignSelection = await caller.from('lead_origins').select('id, name, is_active')
        .eq('organization_id', orgB).eq('id', foreignId).maybeSingle();
      expect(foreignSelection.error).toBeNull();
      expect(foreignSelection.data).toBeNull();
      const args = { p_organization_id: orgA, p_lead_id: leadA, p_origin_ids: [originId] };
      const read = await caller.rpc('test_guided_condition_origins', args);
      expect(read.error).toBeNull();
      expect(read.data).toEqual([{ actual_origin: 'guided_referral', origins: [{ id: originId, name: 'Indicação comercial', slug: 'guided_referral' }] }]);
      expect((await caller.rpc('test_guided_condition_origins', { ...args, p_lead_id: leadB })).error?.code).toBe('PT404');
      expect((await caller.rpc('test_guided_condition_origins', { ...args, p_origin_ids: [foreignId] })).error?.code).toBe('PT422');
      expect((await service.rpc('test_guided_condition_origins', args)).error?.code).toBe('42501');
      expect((await service.from('lead_origins').update({ name: 'Parceiros', is_active: false }).eq('id', originId)).error).toBeNull();
      expect((await caller.rpc('test_guided_condition_origins', args)).data).toEqual([{ actual_origin: 'guided_referral', origins: [{ id: originId, name: 'Parceiros', slug: 'guided_referral' }] }]);
      const condition = { version: 1, id: 'origin', field: 'lead.origin', operator: 'equals', originId: originId.toUpperCase() };
      const response = await fetch(`${process.env.SUPABASE_URL}/functions/v1/test-guided-condition`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: process.env.SUPABASE_ANON_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgA, leadId: leadA, condition }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 'evaluated', matched: true,
        rules: [{ id: 'origin', status: 'evaluated', matched: true, actual: 'guided_referral', reference: { id: originId, name: 'Parceiros' } }],
      });
      const request = { organizationId: orgA, leadId: leadA, condition };
      expect(await evaluateGuidedCondition(caller, { ...request, leadId: leadB })).toEqual({ status: 'error', code: 'context_unavailable' });
      expect(await evaluateGuidedCondition(caller, { ...request, condition: { ...condition, originId: foreignId } })).toEqual({ status: 'error', code: 'reference_unavailable' });
      // Different catalogue codes remain different even when display-text normalization would merge them.
      expect((await service.from('leads').update({ origin: 'GUIDED_REFERRAL' }).eq('id', leadA)).error).toBeNull();
      expect(await evaluateGuidedCondition(caller, request)).toMatchObject({ status: 'evaluated', matched: false });
      expect(await evaluateGuidedCondition(caller, { ...request, condition: { ...condition, operator: 'not_equals' } })).toMatchObject({ status: 'evaluated', matched: true });
      expect((await service.from('lead_origins').delete().eq('id', originId)).error).toBeNull();
      expect((await service.from('lead_origins').insert({ id: replacementId, organization_id: orgA, name: 'Parceiros', slug: 'guided_referral' })).error).toBeNull();
      expect((await caller.rpc('test_guided_condition_origins', args)).error?.code).toBe('PT422');
      expect(await evaluateGuidedCondition(caller, { ...request, condition: {
        version: 1, id: 'group', kind: 'group', match: 'any', children: [
          { version: 1, id: 'name', field: 'lead.name', operator: 'equals', value: 'José' }, condition,
        ],
      } })).toEqual({ status: 'error', code: 'reference_unavailable' });
      expect((await service.from('leads').update({ origin: null }).eq('id', leadA)).error).toBeNull();
      expect((await caller.rpc('test_guided_condition_origins', { ...args, p_origin_ids: [] })).data).toEqual([{ actual_origin: null, origins: [] }]);
      expect(await evaluateGuidedCondition(caller, { ...request, condition: { ...condition, operator: 'not_equals', originId: replacementId } })).toMatchObject({ status: 'evaluated', matched: false });
      expect(await evaluateGuidedCondition(caller, { ...request, condition: { version: 1, id: 'empty', field: 'lead.origin', operator: 'is_empty' } })).toEqual({
        status: 'evaluated', matched: true, rules: [{ id: 'empty', status: 'evaluated', matched: true, actual: null }],
      });
    } finally {
      await service.from('leads').update({ origin: null }).eq('id', leadA).throwOnError();
      await service.from('lead_origins').delete().in('id', [originId, foreignId, replacementId]).throwOnError();
    }
  }, 60000);

  it('validates all tag identities before deciding membership through caller RLS', async () => {
    const assigned = crypto.randomUUID();
    const unassigned = crypto.randomUUID();
    const foreign = crypto.randomUUID();
    const caller = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } },
    });
    try {
      expect((await service.from('tags').insert([
        { id: assigned, organization_id: orgA, name: 'Cliente prioritário', color: '#ffd700' },
        { id: unassigned, organization_id: orgA, name: 'Sem atribuição', color: '#808080' },
        { id: foreign, organization_id: orgB, name: 'Tag restrita', color: '#808080' },
      ])).error).toBeNull();
      expect((await service.from('lead_tags').insert({ lead_id: leadA, tag_id: assigned })).error).toBeNull();
      const args = { p_organization_id: orgA, p_lead_id: leadA, p_tag_ids: [assigned, unassigned] };
      const read = await caller.rpc('test_guided_condition_tags', args);
      expect(read.error).toBeNull();
      expect(read.data).toEqual(expect.arrayContaining([
        { tag_id: assigned, tag_name: 'Cliente prioritário', assigned: true },
        { tag_id: unassigned, tag_name: 'Sem atribuição', assigned: false },
      ]));
      expect(read.data).toHaveLength(2);
      const condition = { version: 1, id: 'g', kind: 'group', match: 'all', children: [
        { version: 1, id: 'has', field: 'lead.tags', operator: 'has_tag', tagId: assigned.toUpperCase() },
        { version: 1, id: 'not-has', field: 'lead.tags', operator: 'not_has_tag', tagId: unassigned },
      ] };
      expect(await evaluateGuidedCondition(caller, { organizationId: orgA, leadId: leadA, condition })).toMatchObject({
        status: 'evaluated', matched: true, rules: [
          { id: 'has', matched: true, actual: true, reference: { id: assigned, name: 'Cliente prioritário' } },
          { id: 'not-has', matched: true, actual: false, reference: { id: unassigned, name: 'Sem atribuição' } },
        ],
      });
      expect((await service.from('tags').update({ name: 'Cliente preferencial' }).eq('id', assigned)).error).toBeNull();
      const response = await fetch(`${process.env.SUPABASE_URL}/functions/v1/test-guided-condition`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: process.env.SUPABASE_ANON_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: orgA, leadId: leadA, condition }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: 'evaluated', matched: true, rules: [
        { id: 'has', reference: { id: assigned, name: 'Cliente preferencial' }, actual: true },
        { id: 'not-has', reference: { id: unassigned, name: 'Sem atribuição' }, actual: false },
      ] });
      expect((await caller.rpc('test_guided_condition_tags', { ...args, p_lead_id: leadB })).error?.code).toBe('PT404');
      expect((await caller.rpc('test_guided_condition_tags', { ...args, p_tag_ids: [assigned, foreign] })).error?.code).toBe('PT422');
      expect((await service.from('tags').delete().eq('id', unassigned)).error).toBeNull();
      expect((await caller.rpc('test_guided_condition_tags', args)).error?.code).toBe('PT422');
      expect(await evaluateGuidedCondition(caller, { organizationId: orgA, leadId: leadA, condition: {
        version: 1, id: 'invalid-group', kind: 'group', match: 'any', children: [
          { version: 1, id: 'name', field: 'lead.name', operator: 'equals', value: 'José' },
          { version: 1, id: 'missing-tag', field: 'lead.tags', operator: 'not_has_tag', tagId: unassigned },
        ],
      } })).toEqual({ status: 'error', code: 'reference_unavailable' });
    } finally {
      await service.from('lead_tags').delete().eq('lead_id', leadA).in('tag_id', [assigned, unassigned, foreign]).throwOnError();
      await service.from('tags').delete().in('id', [assigned, unassigned, foreign]).throwOnError();
    }
  }, 60000);

  it('honors explicit responsible-only access within the same organization', async () => {
    const workflowId = crypto.randomUUID(), customFieldId = crypto.randomUUID();
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
      await service.from('lead_custom_fields').insert({ id: customFieldId, organization_id: orgA,
        field_name: 'Preferência restrita', field_type: 'text' }).throwOnError();
      await service.from('lead_custom_field_values').insert([
        { lead_id: ownLead, field_id: customFieldId, value: 'Liberado' },
        { lead_id: leadA, field_id: customFieldId, value: 'Protegido' },
      ]).throwOnError();
      const customRequest = { organizationId: orgA, leadId: ownLead,
        condition: { version: 1, id: 'personal-custom', field: 'lead.custom', fieldId: customFieldId, fieldType: 'text', operator: 'equals', value: 'LIBERADO' } };
      expect(await evaluateGuidedCondition(caller, customRequest)).toMatchObject({ status: 'evaluated', matched: true, rules: [{ actual: 'Liberado' }] });
      expect(await evaluateGuidedCondition(caller, { ...customRequest, leadId: leadA })).toEqual({ status: 'error', code: 'context_unavailable' });
      expect((await caller.rpc('test_guided_condition_custom_fields', {
        p_organization_id: orgA, p_lead_id: leadA, p_field_ids: [customFieldId],
      })).error?.code).toBe('PT404');
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
      const tagProbe = { p_organization_id: orgA, p_lead_id: ownLead, p_tag_ids: [crypto.randomUUID()] };
      expect((await caller.rpc('test_guided_condition_tags', tagProbe)).error?.code).toBe('PT422');
      expect((await caller.rpc('test_guided_condition_tags', { ...tagProbe, p_lead_id: leadA })).error?.code).toBe('PT404');
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
    const removedCustom = await service.from('lead_custom_fields').delete().eq('id', customFieldId);
    if (removedCustom.error) failures.push(removedCustom.error);
    const removedWorkflow = await service.from('workflows').delete().eq('organization_id', orgA).eq('id', workflowId);
    if (removedWorkflow.error) failures.push(removedWorkflow.error);
    const deleted = await service.auth.admin.deleteUser(created.data.user.id);
    if (deleted.error) failures.push(deleted.error);
    if (failures.length) throw new AggregateError(failures, 'Responsible-only evaluation or cleanup failed');
  }, 60000);

  it('pins trigger-message identity, provenance and access to one WhatsApp box', async () => {
    const boxA = crypto.randomUUID(), boxB = crypto.randomUUID(), messageA = crypto.randomUUID(), messageB = crypto.randomUUID();
    const media = crypto.randomUUID(), transcript = crypto.randomUUID(), workflowId = crypto.randomUUID();
    const caller = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const db: SupabaseClient = service;
    await db.from('org_quotas').upsert({ organization_id: orgA, resource_key: 'max_whatsapp_instances', plan_base: 2 },
      { onConflict: 'organization_id,resource_key' }).throwOnError();
    await db.from('whatsapp_instances').insert([
      { id: boxA, organization_id: orgA, instance_name: 'Comercial', phone_number: '551130000001', provider: 'uazapi' },
      { id: boxB, organization_id: orgA, instance_name: 'Suporte', phone_number: '551130000002', provider: 'evolution' },
    ]).throwOnError();
    expect((await db.from('whatsapp_messages').insert({ id: crypto.randomUUID(), organization_id: orgA, instance_id: boxA,
      message_id: `guided-invalid-${crypto.randomUUID()}`, remote_jid: '5511999990000@s.whatsapp.net', phone_number: '5511999990000',
      normalized_phone: '5511999990000', direction: 'incoming', message_type: 'text', content: 'sem fonte', condition_text: 'sem fonte' })).error?.code).toBe('23514');
    await db.from('whatsapp_messages').insert([
      { id: messageA, organization_id: orgA, instance_id: boxA, message_id: `guided-${messageA}`, remote_jid: '5511999990000@s.whatsapp.net', phone_number: '5511999990000', normalized_phone: '5511999990000', direction: 'incoming', message_type: 'image', content: 'legenda apresentada', condition_text: 'Quero orçamento', condition_text_source: 'caption' },
      { id: messageB, organization_id: orgA, instance_id: boxB, message_id: `guided-${messageB}`, remote_jid: '5511999990000@s.whatsapp.net', phone_number: '5511999990000', normalized_phone: '5511999990000', direction: 'incoming', message_type: 'text', content: 'texto de outra caixa', condition_text: 'texto de outra caixa', condition_text_source: 'text' },
      { id: media, organization_id: orgA, instance_id: boxA, message_id: `guided-${media}`, remote_jid: '5511999990000@s.whatsapp.net', phone_number: '5511999990000', normalized_phone: '5511999990000', direction: 'incoming', message_type: 'audio', content: null, condition_text: null, condition_text_source: null },
      { id: transcript, organization_id: orgA, instance_id: boxA, message_id: `guided-${transcript}`, remote_jid: '5511999990000@s.whatsapp.net', phone_number: '5511999990000', normalized_phone: '5511999990000', direction: 'incoming', message_type: 'audio', content: null,
        transcription_text: 'Preciso do preço', transcription_provider: 'deepgram', transcription_created_at: '2026-09-07T12:34:56Z' },
    ]).throwOnError();
    await db.from('workflows').insert({ id: workflowId, organization_id: orgA, name: 'Trigger message grant', trigger_type: 'lead_replied' }).throwOnError();
    try {
      const condition = { version: 1, id: 'message', field: 'message.trigger.text', conversation: {
        kind: 'explicit', storage: 'whatsapp_messages', boxId: boxA, provider: 'uazapi',
      }, operator: 'contains', value: 'orcamento' };
      const locator = { storage: 'whatsapp_messages' as const, messageId: messageA, boxId: boxA, provider: 'uazapi', participantId: '5511999990000' };
      expect(await evaluateGuidedCondition(caller, { organizationId: orgA, leadId: leadA, messageContext: locator, condition })).toMatchObject({
        status: 'evaluated', matched: true, rules: [{ actual: 'Quero orçamento', reference: { messageId: messageA, textSource: 'caption',
          textProvider: 'uazapi', textCreatedAt: expect.any(String), boxId: boxA, provider: 'uazapi' } }],
      });
      expect(await evaluateGuidedCondition(caller, { organizationId: orgA, leadId: leadA, messageContext: { ...locator, messageId: messageB, boxId: boxB, provider: 'evolution' }, condition }))
        .toEqual({ status: 'error', code: 'context_unavailable' });
      expect(await evaluateGuidedCondition(caller, { organizationId: orgA, leadId: leadA, messageContext: { ...locator, messageId: media }, condition: { ...condition, operator: 'is_empty' } }))
        .toEqual({ status: 'error', code: 'message_text_unavailable' });
      expect(await evaluateGuidedCondition(caller, { organizationId: orgA, leadId: leadA,
        messageContext: { ...locator, messageId: transcript }, condition: { ...condition, value: 'preco' } })).toMatchObject({
        status: 'evaluated', matched: true, rules: [{ actual: 'Preciso do preço', reference: {
          messageId: transcript, textSource: 'transcription', textProvider: 'deepgram', textCreatedAt: '2026-09-07T12:34:56+00:00',
        } }],
      });
      await db.from('whatsapp_messages').update({ deleted_at: new Date().toISOString() }).eq('id', messageA).throwOnError();
      expect(await evaluateGuidedCondition(caller, { organizationId: orgA, leadId: leadA, messageContext: locator, condition }))
        .toEqual({ status: 'error', code: 'context_unavailable' });
      await db.from('whatsapp_messages').update({ deleted_at: null }).eq('id', messageA).throwOnError();
      const candidates = await caller.rpc('test_guided_condition_message_candidates', {
        p_organization_id: orgA, p_lead_id: leadA, p_storage: 'whatsapp_messages', p_box_id: boxA, p_provider: 'uazapi',
      });
      expect(candidates.error).toBeNull();
      expect(candidates.data).toEqual(expect.arrayContaining([expect.objectContaining({ message_id: messageA, box_id: boxA, provider: 'uazapi', text_source: 'caption' })]));
      expect(candidates.data).not.toEqual(expect.arrayContaining([expect.objectContaining({ message_id: messageB })]));
      expect(await evaluateGuidedCondition(service, { organizationId: orgA, leadId: leadA, messageContext: locator,
        authorization: { kind: 'organization', workflowId }, condition })).toEqual({ status: 'error', code: 'access_denied' });
      expect((await caller.rpc('set_workflow_data_grant', { p_workflow_id: workflowId, p_fields: ['message.trigger.text'], p_expected_revision: 0 })).error).toBeNull();
      expect(await evaluateGuidedCondition(service, { organizationId: orgA, leadId: leadA, messageContext: locator,
        authorization: { kind: 'organization', workflowId }, condition })).toMatchObject({ status: 'evaluated', matched: true });
      const definition = { nodes: [
        { id: 't', type: 'trigger', data: { triggerType: 'lead_replied', config: {} } },
        { id: 'c', type: 'condition', data: { guidedCondition: condition } },
        { id: 'yes', type: 'end', data: {} }, { id: 'no', type: 'end', data: {} },
      ], edges: [
        { id: 'tc', source: 't', target: 'c' },
        { id: 'cy', source: 'c', target: 'yes', sourceHandle: 'yes' },
        { id: 'cn', source: 'c', target: 'no', sourceHandle: 'no' },
      ] };
      expect((await caller.rpc('save_guided_workflow_draft_with_settings', { p_workflow_id: workflowId,
        p_definition: definition, p_settings: { name: 'Trigger message grant' }, p_expected_revision: 0 })).error).toBeNull();
      const publication = { p_workflow_id: workflowId, p_organization_id: orgA, p_actor_id: userId,
        p_expected_revision: 1, p_definition: definition, p_settings: { name: 'Trigger message grant' },
        p_required_fields: ['message.trigger.text'] };
      expect((await service.rpc('finalize_guided_workflow_publication', publication)).error).toBeNull();
      expect((await service.rpc('finalize_guided_workflow_publication', { ...publication, p_required_fields: [] })).error?.code).toBe('42501');
      const malformed = structuredClone(definition);
      (malformed.nodes[1].data.guidedCondition as { conversation: { provider: string } }).conversation.provider = '';
      expect((await caller.rpc('save_guided_workflow_draft_with_settings', { p_workflow_id: workflowId,
        p_definition: malformed, p_settings: { name: 'Trigger message grant' }, p_expected_revision: 1 })).error).toBeNull();
      expect((await service.rpc('finalize_guided_workflow_publication', { ...publication,
        p_expected_revision: 2, p_definition: malformed })).error?.code).toBe('22023');
    } finally {
      await db.from('workflows').delete().eq('id', workflowId);
      await db.from('whatsapp_messages').delete().in('id', [messageA, messageB, media, transcript]);
      await db.from('whatsapp_instances').delete().in('id', [boxA, boxB]);
    }
  }, 60000);
});
