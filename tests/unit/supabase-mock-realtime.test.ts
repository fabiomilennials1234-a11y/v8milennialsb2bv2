import { describe, it, expect } from 'vitest';
import { createMockSupabase } from '../helpers/supabase-mock';

describe('supabase-mock realtime', () => {
  it('sb.channel(name) returns chainable object', () => {
    const { sb } = createMockSupabase();
    const channel = sb.channel('test-channel');
    expect(channel).toBeDefined();
    expect(channel).not.toBeNull();
    expect(typeof channel.on).toBe('function');
  });

  it('.on().subscribe() chain works without error', () => {
    const { sb } = createMockSupabase();
    const result = sb
      .channel('ch1')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leads' }, () => {})
      .subscribe();
    expect(result).toBeDefined();
  });

  it('.subscribe(cb) calls statusCallback with SUBSCRIBED', () => {
    const { sb } = createMockSupabase();
    let status: string | null = null;
    sb.channel('ch2')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leads' }, () => {})
      .subscribe((s: string) => { status = s; });
    expect(status).toBe('SUBSCRIBED');
  });

  it('emitEvent triggers registered handler with correct payload shape', () => {
    const { sb, emitEvent } = createMockSupabase();
    let received: any = null;
    sb.channel('ch3')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leads' }, (payload: any) => {
        received = payload;
      })
      .subscribe();

    const row = { id: '1', name: 'Test Lead' };
    emitEvent('ch3', 'leads', 'INSERT', { new: row });

    expect(received).toEqual({ new: row, old: null, eventType: 'INSERT' });
  });

  it('multiple channels coexist independently', () => {
    const { sb, emitEvent } = createMockSupabase();
    let receivedA: any = null;
    let receivedB: any = null;

    sb.channel('channelA')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leads' }, (p: any) => { receivedA = p; })
      .subscribe();

    sb.channel('channelB')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leads' }, (p: any) => { receivedB = p; })
      .subscribe();

    emitEvent('channelA', 'leads', 'INSERT', { new: { id: 'a1' } });

    expect(receivedA).toEqual({ new: { id: 'a1' }, old: null, eventType: 'INSERT' });
    expect(receivedB).toBeNull();
  });

  it('.unsubscribe() prevents further event delivery', () => {
    const { sb, emitEvent } = createMockSupabase();
    let callCount = 0;

    const channel = sb.channel('ch-unsub')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leads' }, () => { callCount++; })
      .subscribe();

    emitEvent('ch-unsub', 'leads', 'INSERT', { new: { id: '1' } });
    expect(callCount).toBe(1);

    channel.unsubscribe();

    emitEvent('ch-unsub', 'leads', 'INSERT', { new: { id: '2' } });
    expect(callCount).toBe(1); // no increment after unsubscribe
  });

  it('emitEvent with UPDATE passes new + old + eventType', () => {
    const { sb, emitEvent } = createMockSupabase();
    let received: any = null;

    sb.channel('ch-update')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'leads' }, (p: any) => { received = p; })
      .subscribe();

    const oldRow = { id: '1', name: 'Before' };
    const newRow = { id: '1', name: 'After' };
    emitEvent('ch-update', 'leads', 'UPDATE', { new: newRow, old: oldRow });

    expect(received).toEqual({ new: newRow, old: oldRow, eventType: 'UPDATE' });
  });
});
