/**
 * Public HTTP contract for both lead-ingest webhooks.
 *
 * The callers and `create_lead_with_pipe` evolved independently. PostgREST
 * resolves RPC overloads by the complete named-argument set, so one stale
 * argument makes the whole webhook return 500 before a lead is inserted.
 */
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { supabase } from './setup';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://localhost:54321';
const shouldSkip = process.env.SKIP_INTEGRATION === 'true' || (!process.env.SUPABASE_URL && !process.env.CI);

const ORG_ID = 'aacc0000-0000-0000-0000-000000000001';
const API_KEY_ID = 'aacc0000-0000-0000-0000-000000000002';
const SDR_ID = 'aacc0000-0000-0000-0000-000000000003';
const CLOSER_ID = 'aacc0000-0000-0000-0000-000000000004';
const RAW_API_KEY = 'tq_live_webhook_contract_20260909';
const EMAILS = ['webhook-new-contract@milennials.test', 'webhook-confirm-contract@milennials.test'];

async function expectOk<T>(label: string, promise: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T | null> {
  const { data, error } = await promise;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

async function postWebhook(name: 'webhook-new-lead' | 'webhook-confirmacao', body: Record<string, unknown>) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': RAW_API_KEY,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  return { response, payload };
}

async function cleanupOrganization() {
  await expectOk('cleanup leads', supabase.from('leads').delete().eq('organization_id', ORG_ID));
  await expectOk('cleanup API keys', supabase.from('api_keys').delete().eq('organization_id', ORG_ID));
  await expectOk('cleanup team members', supabase.from('team_members').delete().eq('organization_id', ORG_ID));
  await expectOk('cleanup quotas', supabase.from('org_quotas').delete().eq('organization_id', ORG_ID));
  await expectOk(
    'clear default pipeline',
    supabase.from('organizations').update({ default_pipeline_id: null }).eq('id', ORG_ID),
  );
  await expectOk('cleanup stages', supabase.from('pipeline_stages').delete().eq('organization_id', ORG_ID));
  await expectOk(
    'cleanup reclassification queue',
    supabase.from('followup_reclassify_queue').delete().eq('organization_id', ORG_ID),
  );
  await expectOk('cleanup pipelines', supabase.from('pipelines').delete().eq('organization_id', ORG_ID));
  await expectOk('cleanup organization', supabase.from('organizations').delete().eq('id', ORG_ID));
}

describe.skipIf(shouldSkip)('lead webhooks → create_lead_with_pipe contract', () => {
  beforeAll(async () => {
    await cleanupOrganization();

    await expectOk(
      'create organization',
      supabase.from('organizations').insert({
        id: ORG_ID,
        name: 'Webhook RPC Contract',
        slug: 'webhook-rpc-contract',
        subscription_status: 'active',
      }),
    );

    await expectOk(
      'create API key',
      supabase.from('api_keys').insert({
        id: API_KEY_ID,
        organization_id: ORG_ID,
        name: 'Webhook contract test',
        key_prefix: RAW_API_KEY.slice(0, 12),
        key_hash: createHash('sha256').update(RAW_API_KEY).digest('hex'),
        scopes: ['lead:write'],
      }),
    );

    await expectOk(
      'configure member seats',
      supabase.from('org_quotas').upsert(
        {
          organization_id: ORG_ID,
          resource_key: 'max_users',
          plan_base: 2,
          purchased_addons: 0,
          admin_adjustment: 0,
        },
        { onConflict: 'organization_id,resource_key' },
      ),
    );

    await expectOk(
      'create responsible members',
      supabase.from('team_members').insert([
        { id: SDR_ID, organization_id: ORG_ID, name: 'Webhook SDR', role: 'member', is_active: true },
        { id: CLOSER_ID, organization_id: ORG_ID, name: 'Webhook Closer', role: 'member', is_active: true },
      ]),
    );

    const pipeline = await expectOk(
      'create confirmation pipeline',
      supabase
        .from('pipelines')
        .insert({
          organization_id: ORG_ID,
          name: 'Confirmação',
          slug: 'confirmacao',
          type: 'system',
        })
        .select('id')
        .single(),
    );
    if (!pipeline) throw new Error('confirmation pipeline returned no id');

    await expectOk(
      'create confirmation stage',
      supabase.from('pipeline_stages').insert({
        organization_id: ORG_ID,
        pipeline_id: pipeline.id,
        pipeline_type: 'confirmacao',
        stage_key: 'reuniao_marcada',
        name: 'Reunião marcada',
        position: 0,
        is_active: true,
      }),
    );
  });

  afterAll(async () => {
    await cleanupOrganization();
  });

  it('creates a new lead through webhook-new-lead', async () => {
    const { response, payload } = await postWebhook('webhook-new-lead', {
      name: 'Webhook New Contract',
      email: EMAILS[0],
      origin: 'site',
      sdr_id: SDR_ID,
    });

    expect(response.status, JSON.stringify(payload)).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.lead_id).toMatch(/^[0-9a-f-]{36}$/);

    const lead = await expectOk(
      'read new-lead result',
      supabase.from('leads').select('organization_id, email').eq('id', payload.lead_id).single(),
    );
    expect(lead).toEqual({ organization_id: ORG_ID, email: EMAILS[0] });

    const entry = await expectOk(
      'read new-lead entry',
      supabase.from('pipeline_entries').select('metadata').eq('lead_id', payload.lead_id).single(),
    );
    expect(entry?.metadata).toMatchObject({ pre_sale_responsible_id: SDR_ID });
  });

  it('creates a meeting lead through webhook-confirmacao', async () => {
    const meetingDate = '2026-09-10T15:00:00.000Z';
    const { response, payload } = await postWebhook('webhook-confirmacao', {
      name: 'Webhook Confirmation Contract',
      email: EMAILS[1],
      origin: 'cal',
      meeting_date: meetingDate,
      sdr_id: SDR_ID,
      closer_id: CLOSER_ID,
    });

    expect(response.status, JSON.stringify(payload)).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.lead_id).toMatch(/^[0-9a-f-]{36}$/);

    const entry = await expectOk(
      'read confirmation entry',
      supabase
        .from('pipeline_entries')
        .select('organization_id, stage_key, metadata')
        .eq('lead_id', payload.lead_id)
        .single(),
    );
    expect(entry?.organization_id).toBe(ORG_ID);
    expect(entry?.stage_key).toBe('reuniao_marcada');
    expect(entry?.metadata).toMatchObject({
      pre_sale_responsible_id: SDR_ID,
      sale_responsible_id: CLOSER_ID,
    });
    const metadata = entry?.metadata as Record<string, unknown>;
    expect(new Date(String(metadata.meeting_date)).toISOString()).toBe(meetingDate);
  });
});
