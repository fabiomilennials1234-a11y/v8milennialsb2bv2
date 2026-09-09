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

describe.skipIf(shouldSkip)('lead webhooks → create_lead_with_pipe contract', () => {
  beforeAll(async () => {
    await expectOk('cleanup stale organization', supabase.from('organizations').delete().eq('id', ORG_ID));

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
    await supabase.from('leads').delete().eq('organization_id', ORG_ID);
    await supabase.from('api_keys').delete().eq('id', API_KEY_ID);
    await supabase.from('organizations').update({ default_pipeline_id: null }).eq('id', ORG_ID);
    await supabase.from('pipeline_stages').delete().eq('organization_id', ORG_ID);
    await supabase.from('followup_reclassify_queue').delete().eq('organization_id', ORG_ID);
    await supabase.from('pipelines').delete().eq('organization_id', ORG_ID);
    await supabase.from('organizations').delete().eq('id', ORG_ID);
  });

  it('creates a new lead through webhook-new-lead', async () => {
    const { response, payload } = await postWebhook('webhook-new-lead', {
      name: 'Webhook New Contract',
      email: EMAILS[0],
      origin: 'site',
    });

    expect(response.status, JSON.stringify(payload)).toBe(200);
    expect(payload.success).toBe(true);
    expect(payload.lead_id).toMatch(/^[0-9a-f-]{36}$/);

    const lead = await expectOk(
      'read new-lead result',
      supabase.from('leads').select('organization_id, email').eq('id', payload.lead_id).single(),
    );
    expect(lead).toEqual({ organization_id: ORG_ID, email: EMAILS[0] });
  });

  it('creates a meeting lead through webhook-confirmacao', async () => {
    const meetingDate = '2026-09-10T15:00:00.000Z';
    const { response, payload } = await postWebhook('webhook-confirmacao', {
      name: 'Webhook Confirmation Contract',
      email: EMAILS[1],
      origin: 'cal',
      meeting_date: meetingDate,
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
    expect(entry?.metadata).toMatchObject({ meeting_date: meetingDate });
  });
});
