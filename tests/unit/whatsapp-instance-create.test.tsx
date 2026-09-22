import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type PropsWithChildren } from 'react';

const mocks = vi.hoisted(() => ({ create: vi.fn(), read: vi.fn(), eq: vi.fn() }));
vi.mock('@/modules/identity', () => ({ useCurrentTeamMember: () => ({ data: { organization_id: 'org' } }) }));
vi.mock('@/modules/communication/lib/whatsappApi', () => ({ createWhatsAppInstance: mocks.create }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: () => {
  const chain = { update: () => chain, select: () => chain,
    eq: (...args: unknown[]) => { mocks.eq(...args); return chain; },
    maybeSingle: mocks.read };
  return chain;
} } }));
import { useCreateWhatsAppInstance } from '@/modules/communication/hooks/useWhatsAppInstances';

describe('create WhatsApp instance after provisioning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({ instance_id: 'box', result: { status: { connected: false } } });
    mocks.read.mockResolvedValue({ data: { id: 'box', organization_id: 'org' }, error: null });
  });
  function setup() {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidation = vi.spyOn(client,'invalidateQueries');
    const hook = renderHook(() => useCreateWhatsAppInstance(), { wrapper: ({children}:PropsWithChildren) =>
      <QueryClientProvider client={client}>{children}</QueryClientProvider> });
    return { ...hook, invalidation };
  }
  it('returns the created connection and scopes the read to the organization', async () => {
    const { result } = setup();
    await act(async () => { expect(await result.current.mutateAsync({instance_name:'new'})).toMatchObject({id:'box'}); });
    expect(mocks.eq).toHaveBeenCalledWith('organization_id','org');
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it.each([null, {message:'network error'}])('reports successful creation separately from unavailable read: %j', async error => {
    mocks.read.mockResolvedValue({data:null,error});
    const { result, invalidation } = setup();
    await act(async () => { await expect(result.current.mutateAsync({instance_name:'new'})).rejects.toThrow('A instância foi criada'); });
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(invalidation).toHaveBeenCalledWith({queryKey:['whatsapp_instances']});
    expect(invalidation).toHaveBeenCalledWith({queryKey:['whatsapp_instances_with_agent']});
  });
});
