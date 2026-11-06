import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ row: {} as Record<string, unknown>, error: null as unknown }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: () => {
  let patch: Record<string, unknown> = {};
  const query = {
    update: (value: Record<string, unknown>) => { patch = value; return query; },
    eq: () => query, select: () => query,
    single: async () => {
      if (state.error) return { data: null, error: state.error };
      state.row = { ...state.row, ...patch };
      return { data: state.row, error: null };
    },
  };
  return query;
} } }));
vi.mock('@/modules/identity', () => ({
  useOrganization: () => ({ organizationId: 'org' }),
  useCanDo: () => ({ allowed: true }), useIdentity: () => ({ isAdmin: true }),
}));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));
import { useUpdateLead } from '@/modules/leads/hooks/useLeads';

let client: QueryClient;
afterEach(() => client?.clear());

it.each(['pre_sale_responsible_id', 'sale_responsible_id'] as const)(
  'removing %s refreshes both chat lookup paths without a reload or realtime', async field => {
    state.error = null;
    state.row = { id: 'lead', pre_sale_responsible_id: 'owner', sale_responsible_id: 'owner' };
    client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const phoneKey = ['lead_by_phone', '5547999999999', 'org'];
    const idKey = ['lead_by_id', 'lead', 'org'];
    client.setQueryData(phoneKey, { ...state.row });
    client.setQueryData(idKey, { ...state.row });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const hook = renderHook(() => ({
      phone: useQuery({ queryKey: phoneKey, queryFn: async () => ({ ...state.row }) }),
      byId: useQuery({ queryKey: idKey, queryFn: async () => ({ ...state.row }) }),
      update: useUpdateLead(),
    }), { wrapper });
    await act(async () => { await hook.result.current.update.mutateAsync({ id: 'lead', [field]: null }); });
    await waitFor(() => {
      expect(hook.result.current.phone.data?.[field]).toBeNull();
      expect(hook.result.current.byId.data?.[field]).toBeNull();
    });
    const other = field === 'sale_responsible_id' ? 'pre_sale_responsible_id' : 'sale_responsible_id';
    expect(hook.result.current.phone.data?.[other]).toBe('owner');
    hook.unmount();
  },
);
