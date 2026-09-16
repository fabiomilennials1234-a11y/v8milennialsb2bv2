import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMockSupabase } from '../helpers/supabase-mock';
const mocks = vi.hoisted(() => ({ log: vi.fn(), db: null as ReturnType<typeof createMockSupabase> | null }));
vi.mock('@/modules/identity', () => ({
  useOrganization: () => ({ organizationId: 'org' }),
  useCurrentTeamMember: () => ({ data: { id: 'member' } }),
}));
vi.mock('@/shared/hooks/useLogLeadAction', () => ({ useLogLeadAction: () => mocks.log }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/integrations/supabase/client', () => ({ get supabase() { return mocks.db!.sb; } }));
import { useCreateScheduledMessage, useScheduledMessagesForConversation } from '@/modules/communication/hooks/useScheduledMessages';
const input = { leadId: '', phoneNumber: '5551999999999', messageContent: 'Teste', instanceId: 'instance', scheduledAt: new Date('2030-01-01') };
function mount() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return renderHook(() => useCreateScheduledMessage(), { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.db = createMockSupabase();
  mocks.db.mockTable('scheduled_user_messages', []);
});
describe('schedule from a conversation without a lead', () => {
  it('finds the pending message by organization, selected instance and phone', async () => {
    const row = { id: 'scheduled', lead_id: null, organization_id: 'org', whatsapp_instance_id: 'instance', phone_number: input.phoneNumber, status: 'scheduled' };
    mocks.db!.mockTable('scheduled_user_messages', [row,
      { ...row, id: 'other-org', organization_id: 'other' },
      { ...row, id: 'other-instance', whatsapp_instance_id: 'other' },
      { ...row, id: 'other-phone', phone_number: '5551888888888' },
      { ...row, id: 'cancelled', status: 'cancelled' },
    ]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useScheduledMessagesForConversation('+55 (51) 99999-9999', 'instance'), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].lead_id).toBeNull();
    expect(result.current.data?.map(row => row.id)).toEqual(['scheduled']);
  });
  it('writes null, retains the selected number and instance, and skips lead history', async () => {
    const { result } = mount();
    await act(async () => { await result.current.mutateAsync(input); });
    expect(mocks.db!.getInserted('scheduled_user_messages')).toEqual([expect.objectContaining({ lead_id: null, phone_number: input.phoneNumber, whatsapp_instance_id: 'instance' })]);
    expect(mocks.log).not.toHaveBeenCalled();
  });
  it('requires an explicit instance when there is no lead', async () => {
    const { result } = mount();
    await act(async () => { await expect(result.current.mutateAsync({ ...input, instanceId: undefined })).rejects.toThrow(/instância/i); });
    expect(mocks.db!.getInserted('scheduled_user_messages')).toEqual([]);
  });
  it('keeps the linked lead and its history', async () => {
    const { result } = mount();
    await act(async () => { await result.current.mutateAsync({ ...input, leadId: 'lead' }); });
    expect(mocks.db!.getInserted('scheduled_user_messages')).toEqual([expect.objectContaining({ lead_id: 'lead' })]);
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ leadId: 'lead' }));
  });
});
