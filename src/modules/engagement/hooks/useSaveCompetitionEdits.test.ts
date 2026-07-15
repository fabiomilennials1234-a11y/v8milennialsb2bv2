/**
 * Regression — editar competição (aba Ranking).
 *
 * Contrato do useSaveCompetitionEdits:
 * - UPDATE na row `competitions` (sem tocar em status)
 * - Diff de participantes: DELETE só os removidos, INSERT só os novos,
 *   preserva os que permanecem
 * - Replace wholesale de prêmios: DELETE all + INSERT desejados
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createWrapper } from '../../../../tests/helpers/hook-test-utils';

interface Recorded {
  table: string;
  op: string;
  payload: unknown;
  filters: Array<{ m: string; c: string; v: unknown }>;
}

let recorded: Recorded[] = [];

const fromMock = (table: string) => {
  const rec: Recorded = { table, op: '', payload: undefined, filters: [] };
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    update(p: unknown) { rec.op = 'update'; rec.payload = p; return b; },
    delete() { rec.op = 'delete'; return b; },
    insert(p: unknown) { rec.op = 'insert'; rec.payload = p; return b; },
    eq(c: string, v: unknown) { rec.filters.push({ m: 'eq', c, v }); return b; },
    in(c: string, v: unknown) { rec.filters.push({ m: 'in', c, v }); return b; },
    then(onF: (r: { error: null }) => unknown, onR?: (e: unknown) => unknown) {
      recorded.push(rec);
      return Promise.resolve({ error: null }).then(onF, onR);
    },
  });
  return b;
};

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: (t: string) => fromMock(t) },
}));

import { useSaveCompetitionEdits } from './useCompetitions';

const baseInput = {
  id: 'comp-1',
  name: 'Corrida de Vendas',
  criteria: 'absolute_value' as const,
  metric_type: 'sales' as const,
  month: 6,
  year: 2026,
  start_date: '2026-06-01T00:00:00.000Z',
  end_date: '2026-06-30T23:59:59.999Z',
};

describe('useSaveCompetitionEdits', () => {
  beforeEach(() => {
    recorded = [];
  });

  it('updates the competition row without touching status', async () => {
    const { result } = renderHook(() => useSaveCompetitionEdits(), { wrapper: createWrapper() });

    await result.current.mutateAsync({
      ...baseInput,
      participants: [],
      existingParticipants: [],
      prizes: [],
    });

    const upd = recorded.find((r) => r.table === 'competitions' && r.op === 'update');
    expect(upd).toBeTruthy();
    expect(upd!.payload).not.toHaveProperty('status');
    expect(upd!.payload).toMatchObject({ name: 'Corrida de Vendas', metric_type: 'sales' });
    expect(upd!.filters).toContainEqual({ m: 'eq', c: 'id', v: 'comp-1' });
  });

  it('diffs participants — removes only dropped, inserts only new, keeps unchanged', async () => {
    const { result } = renderHook(() => useSaveCompetitionEdits(), { wrapper: createWrapper() });

    // existentes [a,b,c] → desejados [b,c,d]  ⇒ remove [a], add [d]
    await result.current.mutateAsync({
      ...baseInput,
      existingParticipants: ['a', 'b', 'c'],
      participants: ['b', 'c', 'd'],
      prizes: [],
    });

    const del = recorded.find((r) => r.table === 'competition_participants' && r.op === 'delete');
    expect(del).toBeTruthy();
    expect(del!.filters).toContainEqual({ m: 'in', c: 'team_member_id', v: ['a'] });

    const ins = recorded.find((r) => r.table === 'competition_participants' && r.op === 'insert');
    expect(ins).toBeTruthy();
    expect(ins!.payload).toEqual([{ competition_id: 'comp-1', team_member_id: 'd' }]);
  });

  it('skips participant delete/insert when the set is unchanged', async () => {
    const { result } = renderHook(() => useSaveCompetitionEdits(), { wrapper: createWrapper() });

    await result.current.mutateAsync({
      ...baseInput,
      existingParticipants: ['a', 'b'],
      participants: ['a', 'b'],
      prizes: [],
    });

    expect(recorded.some((r) => r.table === 'competition_participants')).toBe(false);
  });

  it('replaces prizes wholesale — delete all then insert desired', async () => {
    const { result } = renderHook(() => useSaveCompetitionEdits(), { wrapper: createWrapper() });

    await result.current.mutateAsync({
      ...baseInput,
      existingParticipants: [],
      participants: [],
      prizes: [
        { position: 1, prize_name: 'iPhone', prize_value: 5000, prize_icon: '🏆' },
        { position: 2, prize_name: 'Fone', prize_icon: '🎧' },
      ],
    });

    const prizeOps = recorded.filter((r) => r.table === 'competition_prizes');
    expect(prizeOps.map((r) => r.op)).toEqual(['delete', 'insert']);

    const del = prizeOps[0];
    expect(del.filters).toContainEqual({ m: 'eq', c: 'competition_id', v: 'comp-1' });

    const ins = prizeOps[1];
    expect(ins.payload).toEqual([
      { competition_id: 'comp-1', position: 1, prize_name: 'iPhone', prize_description: null, prize_value: 5000, prize_icon: '🏆' },
      { competition_id: 'comp-1', position: 2, prize_name: 'Fone', prize_description: null, prize_value: null, prize_icon: '🎧' },
    ]);
  });

  it('deletes prizes even when the desired list is empty (no insert)', async () => {
    const { result } = renderHook(() => useSaveCompetitionEdits(), { wrapper: createWrapper() });

    await result.current.mutateAsync({
      ...baseInput,
      existingParticipants: [],
      participants: [],
      prizes: [],
    });

    const prizeOps = recorded.filter((r) => r.table === 'competition_prizes');
    expect(prizeOps.map((r) => r.op)).toEqual(['delete']);
  });
});
