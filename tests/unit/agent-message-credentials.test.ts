// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  handler: null as null | ((request: Request) => Promise<Response>),
  env: {} as Record<string, string>,
  active: false,
  createLead: false,
  workflow: false,
  rpc: vi.fn(),
  fire: vi.fn(),
  lead: vi.fn(),
  client: vi.fn(),
  process: vi.fn(),
}));
vi.mock('../../supabase/functions/_shared/error-boundary.ts', () => ({ withErrorBoundary: (_: string, h: typeof state.handler) => h }));
vi.mock('../../supabase/functions/_shared/logger.ts', () => ({ logRuntime: vi.fn(async () => {}) }));
vi.mock('../../supabase/functions/_shared/track.ts', () => ({ trackEvent: vi.fn(async () => {}) }));
vi.mock('../../supabase/functions/_shared/whatsapp-providers/evolution-provider.ts', () => ({}));
vi.mock('../../supabase/functions/_shared/whatsapp-providers/uazapi-provider.ts', () => ({}));
vi.mock('../../supabase/functions/agent-message/openrouter-client.ts', () => ({ OpenRouterClient: class { constructor(key: string) { state.client(key); } } }));
vi.mock('../../supabase/functions/agent-message/agent-engine.ts', () => ({ AgentEngine: class { processMessage = state.process; } }));
vi.mock('../../supabase/functions/agent-message/batch-helpers.ts', () => ({ buildBatchContent: vi.fn(), absorbPendingMessages: vi.fn(async () => ({ iterations: 0, messagesProcessed: 0 })) }));
vi.mock('../../supabase/functions/_shared/audio-transcription.ts', () => ({ resolveMediaContent: async (m: { content: string }) => m.content }));
vi.mock('../../supabase/functions/_shared/org-status.ts', () => ({ isOrgBlocked: async () => false }));
vi.mock('../../supabase/functions/_shared/plan-gate.ts', () => ({ assertPlanFeature: async () => {}, PlanFeatureDeniedError: class extends Error {} }));
vi.mock('../../supabase/functions/agent-message/audience-gate.ts', () => ({ checkAudienceGate: async () => ({ blocked: false }) }));
vi.mock('../../supabase/functions/_shared/copilot/cancellation.ts', () => ({ isCopilotCanceled: async () => ({ canceled: false }), logCopilotCancellation: vi.fn(), reactivateSystemDisabledContact: vi.fn() }));
vi.mock('../../supabase/functions/_shared/workflow-trigger.ts', () => ({ hasActiveWorkflowsForTrigger: async () => state.workflow, fireTrigger: state.fire }));
vi.mock('../../supabase/functions/_shared/lead-service.ts', () => ({ findLeadByPhoneOrEmail: async () => ({ id: 'lead-test' }), getOrCreateLead: state.lead, normalizePhoneForSearch: (s: string) => s }));
vi.mock('https://esm.sh/@supabase/supabase-js@2', () => ({ createClient: () => ({
  rpc: state.rpc,
  from(table: string) {
    const data = table === 'copilot_agents' ? (state.active ? { id: 'agent-test' } : null)
      : table === 'organizations' ? { auto_create_lead_on_inbound: state.createLead }
      : null;
    const chain: Record<string, unknown> = {};
    for (const key of ['select', 'eq', 'limit', 'maybeSingle', 'update', 'insert', 'delete']) chain[key] = () => chain;
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data, error: null });
    return chain;
  },
}) }));

beforeAll(async () => {
  vi.stubGlobal('Deno', {
    env: { get: (key: string) => state.env[key] },
    serve: (handler: typeof state.handler) => { state.handler = handler; },
  });
  await import('../../supabase/functions/agent-message/index.ts');
});
beforeEach(() => {
  vi.clearAllMocks();
  state.env = { SUPABASE_URL: 'https://qa.invalid', SUPABASE_SERVICE_ROLE_KEY: 'service-test' };
  state.active = false;
  state.createLead = false;
  state.workflow = false;
  state.rpc.mockResolvedValue({ data: true });
  state.fire.mockResolvedValue(undefined);
  state.lead.mockResolvedValue({ lead: { id: 'lead-test', organization_id: 'org-test' }, created: false });
  state.process.mockResolvedValue({ message: '', action: 'noop' });
});
function invoke(body: Record<string, unknown> = {}, token = 'service-test') {
  return state.handler!(new Request('https://qa.invalid/agent-message', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: '5511999990000', organization_id: 'org-test', channel: 'whatsapp', message: 'QA', ...body }),
  }));
}
describe('agent-message AI credentials are scoped to eligible turns', () => {
  it('rejects unauthorized callers even without a model key', async () => {
    expect((await invoke({}, 'invalid')).status).toBe(401);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it('keeps tenant validation ahead of model configuration', async () => {
    const result = await invoke({ organization_id: null });
    expect(result.status).toBe(400);
    expect((await result.json()).code).toBe('MISSING_ORGANIZATION_ID');
  });
  it('skips an org without agents instead of returning a configuration error', async () => {
    const result = await invoke();
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ skipped: true, reason: 'no_active_agents' });
    expect(state.lead).not.toHaveBeenCalled();
    expect(state.client).not.toHaveBeenCalled();
  });
  it('still fires an eligible lead_replied workflow without a model key', async () => {
    state.workflow = true;
    expect((await invoke()).status).toBe(200);
    expect(state.fire).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org-test', triggerType: 'lead_replied', leadId: 'lead-test' }));
    expect(state.process).not.toHaveBeenCalled();
  });
  it('preserves opted-in lead creation without agents or a model key', async () => {
    state.createLead = true;
    expect((await invoke()).status).toBe(200);
    expect(state.lead).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ organizationId: 'org-test' }));
    expect(state.client).not.toHaveBeenCalled();
  });
  it('reports missing credentials for a turn that actually needs AI', async () => {
    state.active = true;
    const result = await invoke();
    expect(result.status).toBe(500);
    expect(await result.json()).toEqual({ error: 'OPENROUTER_API_KEY not configured' });
    expect(state.process).not.toHaveBeenCalled();
  });
  it('processes an eligible turn with the configured client', async () => {
    state.active = true;
    state.env.OPENROUTER_API_KEY = 'model-test';
    const result = await invoke();
    expect(result.status).toBe(200);
    expect(state.client).toHaveBeenCalledWith('model-test');
    expect(state.process).toHaveBeenCalledWith('lead-test', 'QA', undefined);
  });
});
