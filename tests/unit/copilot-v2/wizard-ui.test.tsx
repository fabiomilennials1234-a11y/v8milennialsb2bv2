/**
 * Copilot v2 wizard component (redesign 2026-06-08). Verifies the 2-editable-tab
 * layout (Base / Especificidades / Testar), that the activation mirror gates the
 * "Ativar" button, that a save posts a single transactional payload with the
 * server-derived (locked) capability set, and that tone lives on the Base tab.
 * The hook is mocked (its data layer is the edge endpoint, covered by
 * save-config-flow + the RPC integration suite).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CopilotV2Wizard } from '../../../src/modules/copilot/components/v2-wizard/CopilotV2Wizard';
import { BaseTab } from '../../../src/modules/copilot/components/v2-wizard/BaseTab';

const mutateAsync = vi.fn(async () => ({ status: 'ok', config: {} }) as any);
vi.mock('../../../src/modules/copilot/hooks/useCopilotV2Config', () => ({
  useSaveCopilotV2Config: () => ({ mutateAsync, isPending: false }),
}));
// The simulator panel pulls its own hook chain — stub it to a marker.
vi.mock('../../../src/modules/copilot/components/v2-wizard/SimulatorPanel', () => ({
  SimulatorPanel: () => <div data-testid="sim-panel" />,
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
  capabilities: {},
};

beforeEach(() => mutateAsync.mockClear());

describe('CopilotV2Wizard — tabs', () => {
  it('renders the three tabs (Base / Especificidades / Testar)', () => {
    render(<CopilotV2Wizard agentId="a1" archetype="vendedor" mode="edit" initialConfig={completeVendedor} />);
    expect(screen.getByRole('tab', { name: /Base/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Especificidades/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Testar/i })).toBeInTheDocument();
  });
});

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
  it('posts one draft-save payload with the agentId, activate=false, and the locked caps', async () => {
    render(<CopilotV2Wizard agentId="a1" archetype="vendedor" mode="edit" initialConfig={completeVendedor} />);
    fireEvent.click(screen.getByRole('button', { name: /Salvar alterações/i }));
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    const payload = mutateAsync.mock.calls[0][0] as any;
    expect(payload.agentId).toBe('a1');
    expect(payload.activate).toBe(false);
    expect(payload.archetype).toBe('vendedor');
    // Capabilities are server-derived → the wizard sends the full vendedor whitelist ON.
    expect(payload.config.capabilities.can_move_stage).toBe(true);
    expect(payload.config.capabilities.can_handoff).toBeUndefined(); // not in vendedor whitelist
  });
});

describe('BaseTab — factory core surface', () => {
  it('shows the Torque-verified seal, tone cards with micro-examples, and read-only caps', () => {
    const onToneChange = vi.fn();
    render(<BaseTab archetype="vendedor" tone="Objetivo e enxuto (comprador ocupado)" onToneChange={onToneChange} />);
    expect(screen.getByText(/Verificado pela Torque/i)).toBeInTheDocument();
    expect(screen.getByText(/Núcleo de fábrica do Vendedor/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Tom de voz/i).length).toBeGreaterThan(0);
    // capability chips render as text (NOT switches)
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByText(/Mover lead de estágio/i)).toBeInTheDocument();
    // "O que ele nunca faz" guarantees section present
    expect(screen.getByText(/O que ele nunca faz/i)).toBeInTheDocument();
  });

  it('selecting a tone card calls onToneChange', () => {
    const onToneChange = vi.fn();
    render(<BaseTab archetype="qualificador" tone={undefined} onToneChange={onToneChange} />);
    fireEvent.click(screen.getByText('Profissional e direto'));
    expect(onToneChange).toHaveBeenCalledWith('Profissional e direto');
  });
});
