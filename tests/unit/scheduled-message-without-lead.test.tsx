import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMockSupabase } from '../helpers/supabase-mock';
const mocks = vi.hoisted(() => ({ log: vi.fn(), db: null as ReturnType<typeof createMockSupabase> | null, flagChip: false }));
vi.mock('@/modules/platform/feature-flags', () => ({
  useFeatureFlag: (key: string) => ({ enabled: key === 'agendamento_chip_do_criador' && mocks.flagChip, isLoading: false }),
}));
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
  mocks.flagChip = false;
  mocks.db = createMockSupabase();
  mocks.db.mockTable('scheduled_user_messages', []);
  mocks.db.mockTable('whatsapp_instance_allowed_members', []);
  mocks.db.mockTable('team_members', []);
  mocks.db.mockTable('whatsapp_instances', []);
  mocks.db.mockTable('whatsapp_messages', []);
});

// A agenda pelo card do lead (sem chip na tela); B falou por último com o cliente.
describe('agendamento sem chip na tela grava o chip de quem agenda (flag)', () => {
  const chip = (id: string, extra: Record<string, unknown> = {}) =>
    ({ id, organization_id: 'org', provider: 'uazapi', status: 'connected', reserved_for: null, ...extra });
  const atende = (...ids: string[]) => ids.map((id) => ({ whatsapp_instance_id: id, team_member_id: 'member' }));
  const peloCard = { ...input, leadId: 'lead', instanceId: undefined };
  const gravado = () => mocks.db!.getInserted('scheduled_user_messages')[0]?.whatsapp_instance_id;
  const seed = (t: { instances: unknown[]; allowed?: unknown[]; members?: unknown[]; messages?: unknown[] }) => {
    mocks.db!.mockTable('whatsapp_instances', t.instances as Record<string, unknown>[]);
    mocks.db!.mockTable('whatsapp_instance_allowed_members', [
      ...(t.allowed ?? []), { whatsapp_instance_id: 'inst-b', team_member_id: 'outro' },
    ] as Record<string, unknown>[]);
    mocks.db!.mockTable('team_members', (t.members ?? []) as Record<string, unknown>[]);
    mocks.db!.mockTable('whatsapp_messages', (t.messages ?? []) as Record<string, unknown>[]);
  };
  const B_FALOU = { organization_id: 'org', lead_id: 'lead', instance_id: 'inst-b', phone_number: input.phoneNumber, timestamp: '2026-11-09T15:00:00Z' };

  it('grava o chip de quem agenda, não o de quem falou por último', async () => {
    mocks.flagChip = true;
    seed({ instances: [chip('inst-a'), chip('inst-b')], allowed: atende('inst-a'), messages: [B_FALOU] });
    const { result } = mount();
    await act(async () => { await result.current.mutateAsync(peloCard); });
    expect(gravado()).toBe('inst-a');
  });

  it('sem a flag, segue gravando nulo', async () => {
    seed({ instances: [chip('inst-a'), chip('inst-b')], allowed: atende('inst-a') });
    const { result } = mount();
    await act(async () => { await result.current.mutateAsync(peloCard); });
    expect(gravado()).toBeNull();
  });

  it('chip escolhido na tela vence, com flag', async () => {
    mocks.flagChip = true;
    seed({ instances: [chip('inst-a'), chip('inst-b')], allowed: atende('inst-a') });
    const { result } = mount();
    await act(async () => { await result.current.mutateAsync({ ...peloCard, instanceId: 'inst-b' }); });
    expect(gravado()).toBe('inst-b');
  });

  it('o preferido conta como chip de quem agenda', async () => {
    mocks.flagChip = true;
    seed({ instances: [chip('inst-a'), chip('inst-b')], members: [{ id: 'member', organization_id: 'org', preferred_whatsapp_instance_id: 'inst-a' }], messages: [B_FALOU] });
    const { result } = mount();
    await act(async () => { await result.current.mutateAsync(peloCard); });
    expect(gravado()).toBe('inst-a');
  });

  it('dois chips: o dele com a conversa mais recente; sem conversa, o preferido', async () => {
    mocks.flagChip = true;
    seed({
      instances: [chip('inst-a'), chip('inst-a2'), chip('inst-b')],
      allowed: atende('inst-a', 'inst-a2'),
      messages: [
        { organization_id: 'org', lead_id: 'lead', instance_id: 'inst-a', timestamp: '2026-11-01T10:00:00Z' },
        { organization_id: 'org', lead_id: 'lead', instance_id: 'inst-a2', timestamp: '2026-11-05T10:00:00Z' },
        B_FALOU,
      ],
    });
    const { result } = mount();
    await act(async () => { await result.current.mutateAsync(peloCard); });
    expect(gravado()).toBe('inst-a2');

    mocks.db!.mockTable('scheduled_user_messages', []);
    seed({
      instances: [chip('inst-a'), chip('inst-a2')],
      allowed: atende('inst-a', 'inst-a2'),
      members: [{ id: 'member', organization_id: 'org', preferred_whatsapp_instance_id: 'inst-a2' }],
    });
    await act(async () => { await result.current.mutateAsync(peloCard); });
    expect(gravado()).toBe('inst-a2');
  });

  it('chip desconectado, reservado, Meta ou de outra org não entra: grava nulo e o worker decide', async () => {
    mocks.flagChip = true;
    seed({
      instances: [
        chip('inst-a', { status: 'disconnected' }),
        chip('inst-a2', { reserved_for: 'cobranca' }),
        chip('inst-a3', { provider: 'meta_cloud' }),
        chip('inst-a4', { organization_id: 'outra' }),
        chip('inst-b'),
      ],
      allowed: atende('inst-a', 'inst-a2', 'inst-a3', 'inst-a4'),
      messages: [B_FALOU],
    });
    const { result } = mount();
    await act(async () => { await result.current.mutateAsync(peloCard); });
    expect(gravado()).toBeNull();
  });
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
