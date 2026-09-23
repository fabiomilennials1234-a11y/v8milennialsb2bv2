import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureUazapiWebhook, normalizeWebhook, requestGroupCapture, UAZAPI_WEBHOOK_EVENTS } from '../../supabase/functions/_shared/uazapi-webhook-policy';

import { UazapiClient } from '../../supabase/functions/_shared/uazapi-client';

afterEach(() => vi.unstubAllGlobals());
const url = 'https://fixture.invalid/webhook/redacted';
const intent = { token: 'lease', revision: 2, exclude_groups: true };
const config = { url, enabled: true, events: UAZAPI_WEBHOOK_EVENTS, excludeMessages: ['wasSentByApi','isGroupYes'], addUrlEvents: true, addUrlTypesMessages: false };
const client = () => ({ updateWebhook: vi.fn().mockResolvedValue(undefined), getWebhook: vi.fn().mockResolvedValue(config) });
const admin = (data: unknown = intent) => ({ rpc: vi.fn().mockResolvedValueOnce({ data, error: null }).mockResolvedValue({ error: null }) });
beforeEach(() => vi.stubGlobal('Deno', { env: { get: () => undefined } }));

describe('managed webhook policy', () => {
 it('keeps default-off legacy contract without filtering', async () => {
  const c=client(), a=admin(null);
  await configureUazapiWebhook(c, a as never, 'i', 'org', url);
  expect(a.rpc).toHaveBeenCalledWith('prepare_uazapi_group_webhook', { p_instance_id:'i',p_organization_id:'org',p_filter_enabled:false });
  expect(c.updateWebhook.mock.calls[0][0].excludeMessages).toEqual(['wasSentByApi']);
  expect(c.getWebhook).not.toHaveBeenCalled();
 });
 it('uses server intent, verifies full contract and finishes scoped CAS', async () => {
  const c=client(),a=admin();
  await configureUazapiWebhook(c,a as never,'i','org',url);
  expect(c.updateWebhook).toHaveBeenCalledWith(config,{noRetry:true});
  expect(a.rpc).toHaveBeenLastCalledWith('finish_uazapi_group_webhook',{p_instance_id:'i',p_organization_id:'org',p_token:'lease',p_revision:2,p_excluded:true});
 });
 it('removes exclusion for managed capture=true', async () => {
  const c=client(),a=admin({...intent,exclude_groups:false});
  c.getWebhook.mockResolvedValue({...config,excludeMessages:['wasSentByApi']});
  await configureUazapiWebhook(c,a as never,'i','org',url);
  expect(a.rpc.mock.calls[1][1].p_excluded).toBe(false);
 });
 it.each([
  {...config,excludeMessages:undefined}, {...config,excludeMessages:['wasSentByApi']},
  {...config,events:['messages']}, {...config,enabled:null}, {...config,url:'https://wrong.invalid'},
  [config,config], {...config,addUrlEvents:false}, {...config,addUrlTypesMessages:true},
 ])('does not finish uncertain readback %#', async raw => {
  const c=client(),a=admin(); c.getWebhook.mockResolvedValue(raw as never);
  await expect(configureUazapiWebhook(c,a as never,'i','org',url)).rejects.toThrow('inconclusive');
  expect(a.rpc).toHaveBeenCalledTimes(1);
 });
 it('never replays an uncertain managed POST through the real provider client', async () => {
  UazapiClient._resetCircuitState();
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{"error":"ambiguous"}',{status:500})));
  const c=new UazapiClient({baseUrl:'https://fixture.invalid',token:'fixture-token'}),a=admin();
  await expect(configureUazapiWebhook(c,a as never,'i','org',url)).rejects.toBeDefined();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(a.rpc).toHaveBeenCalledTimes(1);
 });
 it('retains lease after remote failure', async () => {
  const c=client(),a=admin(); c.updateWebhook.mockRejectedValue(new Error('timeout'));
  await expect(configureUazapiWebhook(c,a as never,'i','org',url)).rejects.toThrow('timeout');
  expect(a.rpc).toHaveBeenCalledTimes(1);
 });
 it('does not send provider mutation when reservation fails', async () => {
  const c=client(),a={rpc:vi.fn().mockResolvedValue({error:{message:'busy'}})};
  await expect(configureUazapiWebhook(c,a as never,'i','org',url)).rejects.toThrow('reserve');
  expect(c.updateWebhook).not.toHaveBeenCalled();
 });
 it('propagates stale finish without claiming success', async () => {
  const c=client(),a={rpc:vi.fn().mockResolvedValueOnce({data:intent}).mockResolvedValue({error:{message:'stale'}})};
  await expect(configureUazapiWebhook(c,a as never,'i','org',url)).rejects.toThrow('confirmation');
 });
 it('normalizes nested singleton without assuming multiple webhooks', () => {
  expect(normalizeWebhook({data:[config]}).excludeMessages).toEqual(config.excludeMessages);
  expect(normalizeWebhook([config,config]).url).toBeNull();
 });
});

describe('capture management authorization', () => {
 function db(row:unknown, error:unknown=null) {
  const chain={select:vi.fn(),eq:vi.fn(),maybeSingle:vi.fn().mockResolvedValue({data:row,error})};
  chain.select.mockReturnValue(chain);chain.eq.mockReturnValue(chain);
  return {from:vi.fn().mockReturnValue(chain),rpc:vi.fn().mockResolvedValue({error:null}),chain};
 }
 it('requires active admin in resolved org and only passes resolved org',async()=>{
  const a=db({id:'member'});
  expect((await requestGroupCapture(a as never,'user','resolved-org',false,true)).status).toBe(202);
  expect(a.chain.eq.mock.calls).toEqual([['organization_id','resolved-org'],['user_id','user'],['is_active',true],['role','admin']]);
  expect(a.rpc).toHaveBeenCalledWith('request_uazapi_group_capture',{p_organization_id:'resolved-org',p_capture:true});
 });
 it.each([null,undefined])('denies missing/scoped-out memberships',async row=>{
  const a=db(row);expect((await requestGroupCapture(a as never,'u','org',false,true)).status).toBe(403);expect(a.rpc).not.toHaveBeenCalled();
 });
 it('fails closed on authorization query error',async()=>{
  const a=db({id:'m'},{message:'db'});expect((await requestGroupCapture(a as never,'u','org',false,true)).status).toBe(403);expect(a.rpc).not.toHaveBeenCalled();
 });
 it('allows authenticated master scoped by existing endpoint resolver',async()=>{
  const a=db(null);expect((await requestGroupCapture(a as never,'u','org',true,false)).status).toBe(202);expect(a.from).not.toHaveBeenCalled();
 });
 it('rejects nonboolean intent',async()=>{
  const a=db(null);expect((await requestGroupCapture(a as never,'u','org',true,'false')).status).toBe(400);expect(a.rpc).not.toHaveBeenCalled();
 });
});
