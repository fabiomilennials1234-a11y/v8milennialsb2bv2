import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ─── Mocks ──────────────────────────────────────────────────────────────────
const mockUseOrgSwitcher = vi.fn();
const mockNavigate = vi.fn();
const mockSignOut = vi.fn();
const mockSwitchOrg = vi.fn().mockResolvedValue(undefined);

vi.mock('@/modules/identity/org-team/hooks/useOrgSwitcher', () => ({
  useOrgSwitcher: (...args: unknown[]) => mockUseOrgSwitcher(...args),
}));

vi.mock('@/modules/identity/auth/contexts/AuthContext', () => ({
  useAuth: () => ({ signOut: mockSignOut }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('@/components/ui/branding/TorqueLoader', () => ({
  TorqueLoader: () => <div data-testid="loader" />,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
  ),
}));

vi.mock('lucide-react', () => ({
  Building2: () => <span />,
  ArrowRight: () => <span />,
  LifeBuoy: () => <span />,
  LogOut: () => <span />,
  LayoutGrid: () => <span />,
}));

// Isola a unidade: o hub não renderiza o painel de suporte real (tem teste
// próprio em use-gestor-support). Evita arrastar a cadeia platform/support →
// SubscriptionProtectedRoute pro teste do hub.
vi.mock('@/modules/identity/gestor/components/GestorSupportPanel', () => ({
  GestorSupportPanel: () => null,
}));

import AreaGestor from '@/modules/identity/gestor/pages/AreaGestor';

function setSwitcher(overrides: Record<string, unknown> = {}) {
  mockUseOrgSwitcher.mockReturnValue({
    orgs: [],
    isLoading: false,
    isSwitching: false,
    switchOrg: mockSwitchOrg,
    ...overrides,
  });
}

describe('AreaGestor (hub)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSwitcher();
  });

  it('shows loader while orgs load', () => {
    setSwitcher({ isLoading: true });
    render(<AreaGestor />);
    expect(screen.getByTestId('loader')).toBeInTheDocument();
  });

  it('empty state when zero bound orgs', () => {
    setSwitcher({ orgs: [] });
    render(<AreaGestor />);
    expect(screen.getByText('Nenhuma organização vinculada')).toBeInTheDocument();
  });

  it('lists bound orgs as cards', () => {
    setSwitcher({
      orgs: [
        { id: 'o1', name: 'Org Alpha', slug: 'alpha', org_type: 'client', role: 'admin' },
        { id: 'o2', name: 'Org Beta', slug: 'beta', org_type: 'client', role: 'admin' },
      ],
    });
    render(<AreaGestor />);
    expect(screen.getByText('Org Alpha')).toBeInTheDocument();
    expect(screen.getByText('Org Beta')).toBeInTheDocument();
    expect(screen.queryByText('Nenhuma organização vinculada')).not.toBeInTheDocument();
  });

  it('clicking a card sets the org and enters the app', async () => {
    setSwitcher({
      orgs: [{ id: 'o1', name: 'Org Alpha', slug: 'alpha', org_type: 'client', role: 'admin' }],
    });
    render(<AreaGestor />);

    fireEvent.click(screen.getByText('Org Alpha'));

    await waitFor(() => expect(mockSwitchOrg).toHaveBeenCalledWith('o1'));
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
  });
});
