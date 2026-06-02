import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// ─── Mocks ──────────────────────────────────────────────
vi.mock('@/modules/identity/permissions/hooks/useUserRole', () => ({
  useFeaturePermission: vi.fn(),
  useIsAdmin: vi.fn(),
  useFeaturePermissions: () => ({ data: {}, isLoading: false, isError: false }),
  useUserRole: () => ({ data: { role: "admin" }, isLoading: false }),
  useCanManageCopilot: () => ({ canManage: true, canCreate: true, canEdit: true, canDelete: true, canToggle: true, isLoading: false }),
  useCanManageWhatsApp: () => ({ canManage: true, isLoading: false }),
  useJobTitle: () => ({ jobTitle: "", isLoading: false }),
  useMetricType: () => ({ metricType: "sales", isLoading: false }),
  useHasRole: () => ({ hasRole: true, isLoading: false }),
}));

vi.mock('@/modules/identity/master/hooks/useMasterAuth', () => ({
  useMasterAuth: vi.fn(),
}));

vi.mock('@/modules/identity/org-team/hooks/useTeamMembers', () => ({
  useCurrentTeamMember: vi.fn(),
}));

const mockIdentity = vi.fn();
vi.mock('@/modules/identity/auth/hooks/useIdentity', () => ({
  useIdentity: (...args: unknown[]) => mockIdentity(...args),
}));

import { useFeaturePermission, useIsAdmin } from '@/modules/identity/permissions/hooks/useUserRole';
import { useMasterAuth } from '@/modules/identity/master/hooks/useMasterAuth';
import { useCurrentTeamMember } from '@/modules/identity/org-team/hooks/useTeamMembers';
import { PermissionProtectedRoute } from '@/modules/identity/permissions/components/PermissionProtectedRoute';

// ─── Typed references ───────────────────────────────────
const mockUseFeaturePermission = useFeaturePermission as ReturnType<typeof vi.fn>;
const mockUseIsAdmin = useIsAdmin as ReturnType<typeof vi.fn>;
const mockUseMasterAuth = useMasterAuth as ReturnType<typeof vi.fn>;
const mockUseCurrentTeamMember = useCurrentTeamMember as ReturnType<typeof vi.fn>;

const fakeTeamMember = {
  id: 'tm-1',
  user_id: 'u-1',
  organization_id: 'org-1',
  role: 'member',
  is_active: true,
};

// ─── Helpers ────────────────────────────────────────────
function setMocks(overrides: {
  admin?: { isAdmin: boolean; isLoading: boolean };
  master?: { isMaster: boolean; isLoading: boolean };
  feature?: { allowed: boolean; isLoading: boolean; hasError?: boolean };
  teamMember?: { data: unknown; isLoading: boolean };
}) {
  const isAdmin = overrides.admin?.isAdmin ?? false;
  const isMaster = overrides.master?.isMaster ?? false;
  const isLoading = (overrides.admin?.isLoading ?? false) || (overrides.master?.isLoading ?? false);
  mockUseIsAdmin.mockReturnValue(
    overrides.admin ?? { isAdmin: false, isLoading: false },
  );
  mockUseMasterAuth.mockReturnValue(
    overrides.master ?? { isMaster: false, isLoading: false },
  );
  mockUseFeaturePermission.mockReturnValue(
    overrides.feature ?? { allowed: false, isLoading: false, hasError: false },
  );
  mockUseCurrentTeamMember.mockReturnValue(
    overrides.teamMember ?? { data: fakeTeamMember, isLoading: false },
  );
  mockIdentity.mockReturnValue({
    userId: 'u-1',
    organizationId: 'org-1',
    teamMemberId: 'tm-1',
    effectiveRole: (isAdmin || isMaster ? 'admin' : 'member') as const,
    isMaster,
    isAdmin: isAdmin || isMaster,
    features: {} as Record<string, boolean>,
    isLoading,
    isReady: !isLoading,
  });
}

// ─── Tests ──────────────────────────────────────────────
describe('PermissionProtectedRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows spinner when admin is loading', () => {
    setMocks({
      admin: { isAdmin: false, isLoading: true },
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
      master: { isMaster: false, isLoading: true },
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

  it('shows spinner when team_member is still loading (prevents premature Lock)', () => {
    setMocks({
      teamMember: { data: undefined, isLoading: true },
    });

    const { container } = render(
      <PermissionProtectedRoute featureKey="leads.view">
        <p>Protected Content</p>
      </PermissionProtectedRoute>,
    );

    expect(container.querySelector('.animate-spin')).toBeTruthy();
    expect(screen.queryByText('Protected Content')).toBeNull();
  });

  it('shows error view (retry) when feature permission fetch fails', () => {
    setMocks({
      feature: { allowed: false, isLoading: false, hasError: true },
    });

    render(
      <PermissionProtectedRoute featureKey="leads.view">
        <p>Protected Content</p>
      </PermissionProtectedRoute>,
    );

    expect(screen.queryByText('Protected Content')).toBeNull();
    expect(
      screen.getByText('Nao foi possivel carregar suas permissoes.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /recarregar/i })).toBeTruthy();
  });

  it('shows error view when team_member is missing after resolve (not Lock)', () => {
    setMocks({
      teamMember: { data: undefined, isLoading: false },
    });

    render(
      <PermissionProtectedRoute featureKey="leads.view">
        <p>Protected Content</p>
      </PermissionProtectedRoute>,
    );

    expect(screen.queryByText('Protected Content')).toBeNull();
    expect(
      screen.getByText('Nao foi possivel carregar seus dados de membro.'),
    ).toBeTruthy();
    expect(
      screen.queryByText('Voce nao tem permissao para acessar esta pagina.'),
    ).toBeNull();
  });

  it('renders children when feature is allowed', () => {
    setMocks({
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
