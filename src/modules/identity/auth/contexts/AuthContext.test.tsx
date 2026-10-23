import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { afterEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { AuthProvider, useAuth } from './AuthContext';

const auth = vi.hoisted(() => ({
  listener: undefined as ((event: AuthChangeEvent, session: Session | null) => void) | undefined,
  getSession: vi.fn(),
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: {
  onAuthStateChange: (listener: typeof auth.listener) => {
    auth.listener = listener;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  },
  getSession: auth.getSession,
} } }));

const session = (id: string): Session => ({
  access_token: '', refresh_token: '', expires_in: 3600, token_type: 'bearer',
  user: { id, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-10-23T10:00:00Z' },
});
const key = ['whatsapp_contacts', 'jrtex', 'multi:principal', ''];
const observations: Array<{ user: string; contacts: unknown }> = [];
function ObserveAccount() {
  const { user } = useAuth();
  const client = useQueryClient();
  if (user) observations.push({ user: user.id, contacts: client.getQueryData(key) });
  const [selectedChat] = useState(user?.id ?? 'signed-out');
  return <><span>{user?.id ?? 'signed-out'}</span><span data-testid="selected-chat">{selectedChat}-selection</span></>;
}
afterEach(() => { observations.length = 0; auth.listener = undefined; vi.clearAllMocks(); });

it('cannot expose administrator chat cache on the first render after switching to a member', async () => {
  const client = new QueryClient();
  auth.getSession.mockResolvedValue({ data: { session: session('admin') } });
  render(<QueryClientProvider client={client}><AuthProvider><ObserveAccount /></AuthProvider></QueryClientProvider>);
  await screen.findByText('admin');
  client.setQueryData(key, [{ lead_id: 'other-vendor-lead', last_message: 'private conversation' }]);
  client.setQueryData(['whatsapp_messages', 'jrtex', 'phone', 'principal'], ['private message']);
  act(() => { auth.listener?.('SIGNED_IN', session('ivan')); });
  await screen.findByText('ivan');
  expect(screen.getByTestId('selected-chat')).toHaveTextContent('ivan');
  expect(observations.filter(o => o.user === 'ivan').every(o => o.contacts === undefined)).toBe(true);
  expect(client.getQueryData(key)).toBeUndefined();
  expect(client.getQueryData(['whatsapp_messages', 'jrtex', 'phone', 'principal'])).toBeUndefined();
});

it('ignores a slow bootstrap response after another account signs in', async () => {
  let resolveBootstrap!: (value: { data: { session: Session } }) => void;
  auth.getSession.mockReturnValue(new Promise(resolve => { resolveBootstrap = resolve; }));
  const client = new QueryClient();
  render(<QueryClientProvider client={client}><AuthProvider><ObserveAccount /></AuthProvider></QueryClientProvider>);
  act(() => { auth.listener?.('SIGNED_IN', session('ivan')); });
  await act(async () => { resolveBootstrap({ data: { session: session('admin') } }); });
  expect(screen.queryByText('admin')).not.toBeInTheDocument();
  expect(screen.getByTestId('selected-chat')).toHaveTextContent('ivan');
});

it('cancels old requests so late responses cannot restore another account cache', async () => {
  const client = new QueryClient();
  auth.getSession.mockResolvedValue({ data: { session: session('admin') } });
  render(<QueryClientProvider client={client}><AuthProvider><ObserveAccount /></AuthProvider></QueryClientProvider>);
  await screen.findByText('admin');
  let resolveOld!: (value: string[]) => void;
  const oldRequest = client.fetchQuery({ queryKey: key, queryFn: () => new Promise<string[]>(resolve => { resolveOld = resolve; }) }).catch(() => undefined);
  act(() => { auth.listener?.('SIGNED_IN', session('ivan')); });
  await act(async () => { resolveOld(['other-vendor-conversation']); await oldRequest; });
  expect(client.getQueryData(key)).toBeUndefined();
});

it('clears private cached data on sign-out but keeps it on a same-user token refresh', async () => {
  const client = new QueryClient();
  auth.getSession.mockResolvedValue({ data: { session: session('ivan') } });
  render(<QueryClientProvider client={client}><AuthProvider><ObserveAccount /></AuthProvider></QueryClientProvider>);
  await screen.findByText('ivan');
  client.setQueryData(key, ['own-conversation']);
  act(() => { auth.listener?.('TOKEN_REFRESHED', session('ivan')); });
  expect(client.getQueryData(key)).toEqual(['own-conversation']);
  act(() => { auth.listener?.('SIGNED_OUT', null); });
  await waitFor(() => expect(client.getQueryData(key)).toBeUndefined());
});
