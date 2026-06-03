/**
 * Slice 8 — CopilotV2Wizard component (T9). Verifies the activation mirror gates
 * the "Ativar" button, that a save posts a single transactional payload via the
 * hook, and that the stepper renders. The hook is mocked (its data layer is the
 * edge endpoint, covered by save-config-flow + the RPC integration suite).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CopilotV2Wizard } from '../../../src/modules/copilot/components/v2-wizard/CopilotV2Wizard';

const mutateAsync = vi.fn(async () => ({ status: 'ok', config: {} }) as any);
vi.mock('../../../src/modules/copilot/hooks/useCopilotV2Config', () => ({
  useSaveCopilotV2Config: () => ({ mutateAsync, isPending: false }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const completeVendedor = {
  company: { name: 'Aço Forte' },
  icp: 'construtoras',
  products: ['Vergalhão'],
  tone: 'Objetivo e enxuto (comprador ocupado)',
  businessHours: 'Seg–Sex 08h–18h',
  objective: 'fechar_conversa',
  commercialPolicy: 'sem desconto',
  capabilities: { can_transfer: true },
};

beforeEach(() => mutateAsync.mockClear());

describe('CopilotV2Wizard — activation gating', () => {
  it('disables "Ativar" for an incomplete agent', () => {
    render(<CopilotV2Wizard agentId="a1" archetype="vendedor" mode="edit" initialConfig={{ capabilities: {} }} />);
    expect(screen.getByRole('button', { name: /Ativar agente/i })).toBeDisabled();
  });

  it('enables "Ativar" once the required set is satisfied', () => {
    render(<CopilotV2Wizard agentId="a1" archetype="vendedor" mode="edit" initialConfig={completeVendedor} />);
    expect(screen.getByRole('button', { name: /Ativar agente/i })).not.toBeDisabled();
  });
});

describe('CopilotV2Wizard — save', () => {
  it('posts one draft-save payload with the agentId and activate=false', async () => {
    render(<CopilotV2Wizard agentId="a1" archetype="vendedor" mode="edit" initialConfig={completeVendedor} />);
    fireEvent.click(screen.getByRole('button', { name: /Salvar rascunho/i }));
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    const payload = mutateAsync.mock.calls[0][0] as any;
    expect(payload.agentId).toBe('a1');
    expect(payload.activate).toBe(false);
    expect(payload.archetype).toBe('vendedor');
  });
});

describe('CopilotV2Wizard — stepper (create)', () => {
  it('renders the linear stepper starting at section 1 of 14 (12 sections + escape-hatch + Testar)', () => {
    render(<CopilotV2Wizard agentId="a1" archetype="qualificador" mode="create" />);
    expect(screen.getByText('1/14')).toBeInTheDocument();
    expect(screen.getByText('Empresa')).toBeInTheDocument();
  });
});
