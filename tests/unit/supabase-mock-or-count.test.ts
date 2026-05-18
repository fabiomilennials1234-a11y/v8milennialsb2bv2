import { describe, it, expect } from 'vitest';
import { createMockSupabase } from '../helpers/supabase-mock';

describe('supabase-mock: or() filter', () => {
  it('returns rows matching any condition in OR filter (basic eq)', async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable('leads', [
      { id: '1', status: 'active', name: 'Alice' },
      { id: '2', status: 'pending', name: 'Bob' },
      { id: '3', status: 'closed', name: 'Charlie' },
    ]);

    const { data } = await sb
      .from('leads')
      .select('*')
      .or('status.eq.active,status.eq.pending');

    expect(data).toHaveLength(2);
    expect(data.map((r: any) => r.id).sort()).toEqual(['1', '2']);
  });

  it('supports different operators in OR (gte, lt)', async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable('scores', [
      { id: '1', score: 80 },
      { id: '2', score: 50 },
      { id: '3', score: 15 },
      { id: '4', score: 30 },
    ]);

    const { data } = await sb
      .from('scores')
      .select('*')
      .or('score.gte.50,score.lt.20');

    expect(data).toHaveLength(3);
    expect(data.map((r: any) => r.id).sort()).toEqual(['1', '2', '3']);
  });

  it('supports is.null syntax in OR filter', async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable('leads', [
      { id: '1', email: 'a@b.com', status: 'active' },
      { id: '2', email: null, status: 'closed' },
      { id: '3', email: 'c@d.com', status: 'closed' },
    ]);

    const { data } = await sb
      .from('leads')
      .select('*')
      .or('email.is.null,status.eq.active');

    expect(data).toHaveLength(2);
    expect(data.map((r: any) => r.id).sort()).toEqual(['1', '2']);
  });
});

describe('supabase-mock: textSearch()', () => {
  it('matches substring case-insensitive', async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable('leads', [
      { id: '1', name: 'Alice Johnson' },
      { id: '2', name: 'Bob Smith' },
      { id: '3', name: 'ALICE Wonder' },
    ]);

    const { data } = await sb
      .from('leads')
      .select('*')
      .textSearch('name', 'alice');

    expect(data).toHaveLength(2);
    expect(data.map((r: any) => r.id).sort()).toEqual(['1', '3']);
  });
});

describe('supabase-mock: count/head queries', () => {
  it('select with count exact + head true returns null data and count', async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable('leads', [
      { id: '1', status: 'active' },
      { id: '2', status: 'active' },
      { id: '3', status: 'closed' },
    ]);

    const result = await sb
      .from('leads')
      .select('*', { count: 'exact', head: true });

    expect(result.data).toBeNull();
    expect(result.error).toBeNull();
    expect(result.count).toBe(3);
  });

  it('select with count exact (no head) returns data and count', async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable('leads', [
      { id: '1', status: 'active' },
      { id: '2', status: 'closed' },
    ]);

    const result = await sb
      .from('leads')
      .select('*', { count: 'exact' });

    expect(result.data).toHaveLength(2);
    expect(result.error).toBeNull();
    expect(result.count).toBe(2);
  });

  it('count with filters returns correct filtered count', async () => {
    const { sb, mockTable } = createMockSupabase();
    mockTable('leads', [
      { id: '1', status: 'active' },
      { id: '2', status: 'active' },
      { id: '3', status: 'closed' },
      { id: '4', status: 'pending' },
    ]);

    const result = await sb
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active');

    expect(result.data).toBeNull();
    expect(result.count).toBe(2);
  });
});
