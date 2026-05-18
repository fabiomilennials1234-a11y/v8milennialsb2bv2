import { describe, it, expect } from 'vitest';
import { createMockSupabase } from '../helpers/supabase-mock';

describe('createMockSupabase — comparison filters', () => {
  const rows = [
    { id: '1', score: 10, created_at: '2026-01-01T00:00:00Z' },
    { id: '2', score: 50, created_at: '2026-03-15T00:00:00Z' },
    { id: '3', score: 90, created_at: '2026-05-01T00:00:00Z' },
  ];

  it('gte filters rows where field >= value', async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable('leads', rows);

    const { data } = await sb.from('leads').select('*').gte('score', 50);

    expect(data).toHaveLength(2);
    expect(data.map((r: any) => r.id)).toEqual(['2', '3']);
  });

  it('lte filters rows where field <= value', async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable('leads', rows);

    const { data } = await sb.from('leads').select('*').lte('score', 50);

    expect(data).toHaveLength(2);
    expect(data.map((r: any) => r.id)).toEqual(['1', '2']);
  });

  it('gt filters rows where field > value (strict)', async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable('leads', rows);

    const { data } = await sb.from('leads').select('*').gt('score', 50);

    expect(data).toHaveLength(1);
    expect(data[0].id).toBe('3');
  });

  it('lt filters rows where field < value (strict)', async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable('leads', rows);

    const { data } = await sb.from('leads').select('*').lt('score', 50);

    expect(data).toHaveLength(1);
    expect(data[0].id).toBe('1');
  });

  it('is with null filters rows where field is null', async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable('sessions', [
      { id: '1', session_dead_since: null },
      { id: '2', session_dead_since: '2026-01-01T00:00:00Z' },
      { id: '3', session_dead_since: null },
    ]);

    const { data } = await sb.from('sessions').select('*').is('session_dead_since', null);

    expect(data).toHaveLength(2);
    expect(data.map((r: any) => r.id)).toEqual(['1', '3']);
  });

  it('is with value filters rows where field === value', async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable('leads', [
      { id: '1', status: 'active' },
      { id: '2', status: 'inactive' },
      { id: '3', status: 'active' },
    ]);

    const { data } = await sb.from('leads').select('*').is('status', 'active');

    expect(data).toHaveLength(2);
    expect(data.map((r: any) => r.id)).toEqual(['1', '3']);
  });

  it('gte + lt compose for time-window range queries', async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable('leads', rows);

    const { data } = await sb
      .from('leads')
      .select('*')
      .gte('created_at', '2026-02-01T00:00:00Z')
      .lt('created_at', '2026-04-01T00:00:00Z');

    expect(data).toHaveLength(1);
    expect(data[0].id).toBe('2');
  });

  it('new filters compose with existing eq filter', async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable('leads', [
      { id: '1', org_id: 'org-a', score: 30 },
      { id: '2', org_id: 'org-a', score: 70 },
      { id: '3', org_id: 'org-b', score: 80 },
    ]);

    const { data } = await sb
      .from('leads')
      .select('*')
      .eq('org_id', 'org-a')
      .gte('score', 50);

    expect(data).toHaveLength(1);
    expect(data[0].id).toBe('2');
  });
});
