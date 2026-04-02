import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// ─── Mocks ──────────────────────────────────────────────
vi.mock('@/hooks/useUserRole', () => ({
  useFeaturePermission: vi.fn(),
  useIsAdmin: vi.fn(),
}));

vi.mock('@/hooks/useMasterAuth', () => ({
  useMasterAuth: vi.fn(),
}));

import { useFeaturePermission, useIsAdmin } from '@/hooks/useUserRole';
import { useMasterAuth } from '@/hooks/useMasterAuth';
import { PermissionProtectedRoute } from '@/components/PermissionProtectedRoute';

// ─── Typed references ───────────────────────────────────
const mockUseFeaturePermission = useFeaturePermission as ReturnType<typeof vi.fn>;
const mockUseIsAdmin = useIsAdmin as ReturnType<typeof vi.fn>;
const mockUseMasterAuth = useMasterAuth as ReturnType<typeof vi.fn>;

// ─── Helpers ────────────────────────────────────────────
function setMocks(overrides: {
  admin?: { isAdmin: boolean; isLoading: boolean };
  master?: { isMaster: boolean; isLoading: boolean };
  feature?: { allowed: boolean; isLoading: boolean };
}) {
  mockUseIsAdmin.mockReturnValue(
    overrides.admin ?? { isAdmin: false, isLoading: false },
  );
  mockUseMasterAuth.mockReturnValue(
    overrides.master ?? { isMaster: false, isLoading: false },
  );
  mockUseFeaturePermission.mockReturnValue(
    overrides.feature ?? { allowed: false, isLoading: false },
  );
}

// ─── Tests ──────────────────────────────────────────────
describe('PermissionProtectedRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows spinner when admin is loading', () => {
    setMocks({
      admin: { isAdmin: false, isLoading: true },
      master: { isMaster: false, isLoading: false },
      feature: { allowed: false, isLoading: false },
    });

    const { container } = render(
      <PermissionProtectedRoute featureKey="leads.view">
        <p>Protected Content</p>
      </PermissionProtectedRoute>,
    );

    expect(container.querySelector('.animate-spin')).toBeTruthy();
    expect(screen.queryByText('Protected Content')).toBeNull();
  });

  it('shows spinner when master is loading', () => {
    setMocks({
      admin: { isAdmin: false, isLoading: false },
      master: { isMaster: false, isLoading: true },
      feature: { allowed: false, isLoading: false },
    });

    const { container } = render(
      <PermissionProtectedRoute featureKey="leads.view">
        <p>Protected Content</p>
      </PermissionProtectedRoute>,
    );

    expect(container.querySelector('.animate-spin')).toBeTruthy();
    expect(screen.queryByText('Protected Content')).toBeNull();
  });

  it('master renders children immediately (skips feature check)', () => {
    setMocks({
      admin: { isAdmin: false, isLoading: false },
      master: { isMaster: true, isLoading: false },
      feature: { allowed: false, isLoading: true },
    });

    render(
      <PermissionProtectedRoute featureKey="leads.view">
        <p>Master Content</p>
      </PermissionProtectedRoute>,
    );

    expect(screen.getByText('Master Content')).toBeTruthy();
  });

  it('admin renders children immediately (skips feature check)', () => {
    setMocks({
      admin: { isAdmin: true, isLoading: false },
      master: { isMaster: false, isLoading: false },
      feature: { allowed: false, isLoading: true },
    });

    render(
      <PermissionProtectedRoute featureKey="leads.view">
        <p>Admin Content</p>
      </PermissionProtectedRoute>,
    );

    expect(screen.getByText('Admin Content')).toBeTruthy();
  });

  it('shows spinner when feature permission is loading (non-admin)', () => {
    setMocks({
      admin: { isAdmin: false, isLoading: false },
      master: { isMaster: false, isLoading: false },
      feature: { allowed: false, isLoading: true },
    });

    const { container } = render(
      <PermissionProtectedRoute featureKey="leads.view">
        <p>Protected Content</p>
      </PermissionProtectedRoute>,
    );

    expect(container.querySelector('.animate-spin')).toBeTruthy();
    expect(screen.queryByText('Protected Content')).toBeNull();
  });

  it('renders children when feature is allowed', () => {
    setMocks({
      admin: { isAdmin: false, isLoading: false },
      master: { isMaster: false, isLoading: false },
      feature: { allowed: true, isLoading: false },
    });

    render(
      <PermissionProtectedRoute featureKey="leads.view">
        <p>Allowed Content</p>
      </PermissionProtectedRoute>,
    );

    expect(screen.getByText('Allowed Content')).toBeTruthy();
  });

  it('shows default lock screen when feature is denied', () => {
    setMocks({
      admin: { isAdmin: false, isLoading: false },
      master: { isMaster: false, isLoading: false },
      feature: { allowed: false, isLoading: false },
    });

    render(
      <PermissionProtectedRoute featureKey="leads.delete">
        <p>Secret Content</p>
      </PermissionProtectedRoute>,
    );

    expect(screen.queryByText('Secret Content')).toBeNull();
    expect(
      screen.getByText('Voce nao tem permissao para acessar esta pagina.'),
    ).toBeTruthy();
    expect(
      screen.getByText('Solicite acesso ao administrador.'),
    ).toBeTruthy();
  });

  it('renders custom fallback when feature denied + fallback prop', () => {
    setMocks({
      admin: { isAdmin: false, isLoading: false },
      master: { isMaster: false, isLoading: false },
      feature: { allowed: false, isLoading: false },
    });

    render(
      <PermissionProtectedRoute
        featureKey="leads.delete"
        fallback={<div>Custom Denied Page</div>}
      >
        <p>Secret Content</p>
      </PermissionProtectedRoute>,
    );

    expect(screen.queryByText('Secret Content')).toBeNull();
    expect(screen.getByText('Custom Denied Page')).toBeTruthy();
    expect(
      screen.queryByText('Voce nao tem permissao para acessar esta pagina.'),
    ).toBeNull();
  });

  it('nonexistent featureKey shows lock screen', () => {
    setMocks({
      admin: { isAdmin: false, isLoading: false },
      master: { isMaster: false, isLoading: false },
      feature: { allowed: false, isLoading: false },
    });

    render(
      <PermissionProtectedRoute featureKey="totally.fake.feature">
        <p>Hidden</p>
      </PermissionProtectedRoute>,
    );

    expect(screen.queryByText('Hidden')).toBeNull();
    expect(
      screen.getByText('Voce nao tem permissao para acessar esta pagina.'),
    ).toBeTruthy();
  });

  it('admin renders children even when featureKey is invalid', () => {
    setMocks({
      admin: { isAdmin: true, isLoading: false },
      master: { isMaster: false, isLoading: false },
      feature: { allowed: false, isLoading: false },
    });

    render(
      <PermissionProtectedRoute featureKey="totally.fake.feature">
        <p>Admin Bypass</p>
      </PermissionProtectedRoute>,
    );

    expect(screen.getByText('Admin Bypass')).toBeTruthy();
  });
});
