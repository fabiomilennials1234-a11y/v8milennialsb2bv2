// @vitest-environment node
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { createMockSupabase } from '../helpers/supabase-mock';
type WebhookHandler = (request: Request) => Promise<Response>;
const state = vi.hoisted(() => ({
  db: null as ReturnType<typeof createMockSupabase>['sb'] | null,
  handler: null as WebhookHandler | null,
  org: 'org' as string | undefined,
}));
vi.mock('https://esm.sh/@supabase/supabase-js@2', () => ({ createClient: () => state.db }));
vi.mock('../../supabase/functions/_shared/error-boundary.ts', () => ({ withErrorBoundary: (_: string, fn: unknown) => fn }));
vi.mock('../../supabase/functions/_shared/auth.ts', () => ({
  validateCalcomWebhook: () => ({valid:true}),checkRateLimit: () => ({allowed:true}),getClientIdentifier: () => 'test',
  unauthorizedResponse:vi.fn(),rateLimitedResponse:vi.fn(),
}));
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ logRuntime: vi.fn().mockResolvedValue(undefined) }));
beforeEach(async () => {
  state.org='org';
  vi.stubGlobal('Deno',{ env:{get:(key:string) => key==='CALCOM_ORGANIZATION_ID'?state.org:'test'},serve:(fn:WebhookHandler) => {state.handler=fn;} });
  vi.spyOn(console,'log').mockImplementation(() => {});
  vi.spyOn(console,'error').mockImplementation(() => {});
  await import('../../supabase/functions/webhook-calcom/index.ts');
});
afterEach(() => {vi.unstubAllGlobals();vi.restoreAllMocks();});
const body={triggerEvent:'BOOKING_CREATED',payload:{uid:'booking-1',title:'Discovery',startTime:'2026-09-20T12:00:00Z',endTime:'2026-09-20T12:30:00Z',attendees:[{email:'lead@example.com',name:'Lead'}]}};
const request=() => new Request('https://test.invalid/calcom',{method:'POST',body:JSON.stringify(body)});
it('creates canonical meeting without any legacy or default pipeline',async () => {
  const mock=createMockSupabase();state.db=mock.sb;
  const response=await state.handler!(request());
  expect(response.status).toBe(200);
  const meetings=mock.getInserted('meetings');
  expect(meetings).toHaveLength(1);
  expect(meetings[0]).toMatchObject({organization_id:'org',event_type:'meeting',start_at:'2026-09-20T12:00:00.000Z',end_at:'2026-09-20T12:30:00.000Z',external_ref:'calcom:booking-1'});
  expect(mock.getInserted('pipeline_entries')).toEqual([]);
  expect(mock.getInserted('follow_ups')).toEqual([]);
});
it('fails closed when tenant configuration is absent',async () => {
  const mock=createMockSupabase();state.db=mock.sb;state.org=undefined;
  mock.mockTable('organizations',[{id:'first-customer',subscription_status:'active'}]);
  const response=await state.handler!(request());
  expect(response.status).toBe(500);
  expect(mock.getInserted('meetings')).toEqual([]);
  expect(mock.getInserted('leads')).toEqual([]);
});
