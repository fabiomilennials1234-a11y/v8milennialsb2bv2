/**
 * Slice 9 — SimulatorPanel (T8). Sends a message to the simulate hook and renders
 * the dry-run trace (tool "IRIA executar" / blocked badge + tier). Hooks mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SimulatorPanel } from '../../../src/modules/copilot/components/v2-wizard/SimulatorPanel';
import type { DryRunTrace } from '../../../src/modules/copilot/lib/copilot-v2-sim';

const trace: DryRunTrace = {
  trace_id: 't',
  steps: [
    { step: 'cognition', reason: null, meta: { archetype: 'qualificador', model: 'google/gemini-2.5-flash', tool_count: 1 } },
    { step: 'tool', reason: 'capability_off', meta: { name: 'move_lead_stage', allowed: false } },
    { step: 'outbound', reason: null, meta: { reply_length: 3 } },
  ],
  result: { archetype: 'qualificador', reply: 'oi!', tier: 'ouro', stoppedReason: 'text_reply' },
};

const mutateAsync = vi.fn(async () => ({ trace, writes: [], reply: 'oi!', model: 'google/gemini-2.5-flash' }) as any);
vi.mock('../../../src/modules/copilot/hooks/useCopilotV2Simulator', () => ({
  useSimulateTurn: () => ({ mutateAsync, isPending: false }),
  useRunEvalSuite: () => ({ mutate: vi.fn(), isPending: false, data: undefined, isError: false }),
}));

beforeEach(() => mutateAsync.mockClear());

describe('SimulatorPanel', () => {
  it('sends the typed message to the simulate hook (draft config in create mode)', async () => {
    render(<SimulatorPanel archetype="qualificador" mode="create" draftConfig={{ capabilities: {} }} />);
    fireEvent.change(screen.getByPlaceholderText(/como se fosse o lead/i), { target: { value: 'olá' } });
    fireEvent.click(screen.getByRole('button', { name: /Enviar/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync.mock.calls[0][0]).toMatchObject({ archetype: 'qualificador', message: 'olá' });
  });

  it('renders the trace with a blocked tool badge and the tier', async () => {
    render(<SimulatorPanel archetype="qualificador" mode="create" draftConfig={{ capabilities: {} }} />);
    fireEvent.change(screen.getByPlaceholderText(/como se fosse o lead/i), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /Enviar/i }));
    await waitFor(() => expect(screen.getByText(/bloqueado: capability_off/i)).toBeInTheDocument());
    expect(screen.getByText(/tier: ouro/i)).toBeInTheDocument();
  });
});
