/**
 * Regression — aba Saúde deve acompanhar o período selecionado no Comando
 * (Hoje / Semana / Mês / Trimestre), não travar no mês-calendário.
 *
 * Contrato: useFunnelHealth({ start, end }) chama a RPC com exatamente o
 * range recebido — mesmo contrato de useCommandMetrics.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createWrapper } from '../../../../tests/helpers/hook-test-utils';

const rpcMock = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

vi.mock('@/modules/identity', () => ({
  useCurrentTeamMember: () => ({
    data: { organization_id: 'org-123' },
  }),
}));

import { useFunnelHealth } from './useFunnelHealth';

describe('useFunnelHealth', () => {
  beforeEach(() => {
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({
      data: { cohort_total: 0, stages: {}, tiers: {}, depth: {}, sellers: [] },
      error: null,
    });
  });

  it('calls the RPC with exactly the selected period range (not the whole calendar month)', async () => {
    // período "Hoje" — um único dia no meio do mês
    const start = new Date('2026-06-11T00:00:00.000Z');
    const end = new Date('2026-06-11T23:59:59.999Z');

    const { result } = renderHook(() => useFunnelHealth({ start, end }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(rpcMock).toHaveBeenCalledWith('get_funnel_health', {
      p_org_id: 'org-123',
      p_start_date: start.toISOString(),
      p_end_date: end.toISOString(),
    });
  });

  it('refetches when the range changes (new query key per period)', async () => {
    const r1 = {
      start: new Date('2026-06-01T00:00:00.000Z'),
      end: new Date('2026-06-30T23:59:59.999Z'),
    };
    const r2 = {
      start: new Date('2026-06-08T00:00:00.000Z'),
      end: new Date('2026-06-14T23:59:59.999Z'),
    };

    const { result, rerender } = renderHook(({ range }) => useFunnelHealth(range), {
      wrapper: createWrapper(),
      initialProps: { range: r1 },
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    rerender({ range: r2 });
    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith(
        'get_funnel_health',
        expect.objectContaining({ p_start_date: r2.start.toISOString() })
      )
    );

    expect(rpcMock).toHaveBeenCalledTimes(2);
  });
});
