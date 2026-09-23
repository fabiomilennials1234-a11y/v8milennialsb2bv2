import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockUseAuth = vi.fn();
const mockUseCurrentTeamMember = vi.fn();
const mockUseMasterAuth = vi.fn();
const mockUseLocation = vi.fn();

vi.mock('@/modules/identity/auth/contexts/AuthContext', () => ({
  useAuth: (...args: unknown[]) => mockUseAuth(...args),
}));

vi.mock('@/modules/identity/org-team/hooks/useTeamMembers', () => ({
  useCurrentTeamMember: (...args: unknown[]) => mockUseCurrentTeamMember(...args),
}));

vi.mock('@/modules/identity/master/hooks/useMasterAuth', () => ({
  useMasterAuth: (...args: unknown[]) => mockUseMasterAuth(...args),
}));

const mockUseIdentity = vi.fn();
vi.mock('@/modules/identity/auth/hooks/useIdentity', () => ({
  useIdentity: (...args: unknown[]) => mockUseIdentity(...args),
}));

const mockUseGestor = vi.fn();
vi.mock('@/modules/identity/gestor/hooks/useGestor', () => ({
  useGestor: (...args: unknown[]) => mockUseGestor(...args),
}));

// `ProtectedRoute` passou a chamar `useDeactivatedMembership` (36c837b1, #1812).
// É `useQuery` de verdade: sem mock, os 17 casos morrem em "No QueryClient set"
// — este arquivo monta o componente cru, sem QueryClientProvider, como os
// outros 6 hooks aqui já pressupõem. Default `false` = membro NÃO desativado,
// que é o caminho que os casos existentes exercitam; o "Conta Desativada" desta
// suíte vem por `useCurrentTeamMember({ is_active: false })`, outro ramo.
const mockUseDeactivatedMembership = vi.fn();
vi.mock('@/modules/identity/org-team/hooks/useMembershipStatus', () => ({
  useDeactivatedMembership: (...args: unknown[]) => mockUseDeactivatedMembership(...args),
}));

// `ProtectedRoute` passou a chamar `useMfaRequired` (cfce0903, #1838) — todo
// master precisa estar em aal2 para acessar qualquer rota.
//
// Sem este mock o hook REAL roda, e ele nasce `isLoading: true`: para master, o
// efeito aguarda `supabase.auth.mfa.getAuthenticatorAssuranceLevel()`, que em
// jsdom nunca resolve. O gate de MFA vem ANTES dos gates de org, então o
// componente para no TorqueLoader e todo caso de master afirma sobre uma tela
// de carregamento. Era o que derrubava "master bypasses all org checks".
//
// Default `{ required: false, isLoading: false }` = sessão já em aal2, que é a
// pré-condição de todos os casos desta suíte — nenhum deles é sobre MFA.
const mockUseMfaRequired = vi.fn();
vi.mock('@/modules/identity/auth/hooks/useMfaRequired', () => ({
  useMfaRequired: (...args: unknown[]) => mockUseMfaRequired(...args),
}));

vi.mock('@/modules/identity/permissions/hooks/useUserRole', () => ({
  useUserRole: () => ({ data: { role: "admin" }, isLoading: false }),
  useIsAdmin: () => ({ isAdmin: true, isLoading: false }),
  useFeaturePermissions: () => ({ data: {}, isLoading: false, isError: false }),
  useFeaturePermission: () => ({ allowed: true, isLoading: false, hasError: false }),
  useCanManageCopilot: () => ({ canManage: true, canCreate: true, canEdit: true, canDelete: true, canToggle: true, isLoading: false }),
  useCanManageWhatsApp: () => ({ canManage: true, isLoading: false }),
  useJobTitle: () => ({ jobTitle: "", isLoading: false }),
  useMetricType: () => ({ metricType: "sales", isLoading: false }),
  useHasRole: () => ({ hasRole: true, isLoading: false }),
}));

vi.mock('react-router-dom', () => ({
  Navigate: ({ to, replace }: { to: string; replace?: boolean }) => (
    <div data-testid="navigate" data-to={to} data-replace={String(!!replace)} />
  ),
  useLocation: (...args: unknown[]) => mockUseLocation(...args),
}));

// Stub lucide-react icons to avoid SVG rendering complexity in jsdom
vi.mock('lucide-react', () => ({
  Loader2: ({ className }: { className?: string }) => (
    <span data-testid="loader2" className={className} />
  ),
  AlertTriangle: ({ className }: { className?: string }) => (
    <span data-testid="alert-triangle" className={className} />
  ),
  Clock: ({ className }: { className?: string }) => (
    <span data-testid="clock" className={className} />
  ),
}));

// Stub the Button component to a simple button element
vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    variant,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    variant?: string;
  }) => (
    <button data-variant={variant} onClick={onClick}>
      {children}
    </button>
  ),
}));

import { ProtectedRoute } from '@/modules/identity/auth/components/ProtectedRoute';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Minimal Supabase-shaped user object */
function makeUser(metadataOverrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: 'test@example.com',
    user_metadata: { ...metadataOverrides },
  };
}

/** Minimal team member object */
function makeTeamMember(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tm-1',
    user_id: 'user-1',
    organization_id: 'org-1',
    is_active: true,
    role: 'member',
    ...overrides,
  };
}

/** Default mock return values — authenticated, active, non-master */
function setDefaults() {
  mockUseAuth.mockReturnValue({
    user: makeUser(),
    loading: false,
    signOut: vi.fn(),
  });
  mockUseCurrentTeamMember.mockReturnValue({
    data: makeTeamMember(),
    isLoading: false,
    error: null,
  });
  mockUseMasterAuth.mockReturnValue({
    isMaster: false,
    isLoading: false,
  });
  mockUseDeactivatedMembership.mockReturnValue({
    data: false,
    isLoading: false,
  });
  mockUseIdentity.mockReturnValue({
    userId: 'user-1',
    organizationId: 'org-1',
    teamMemberId: 'tm-1',
    effectiveRole: 'member' as const,
    isMaster: false,
    isAdmin: false,
    features: {} as Record<string, boolean>,
    isLoading: false,
    isReady: true,
  });
  mockUseMfaRequired.mockReturnValue({ required: false, isLoading: false });
  mockUseLocation.mockReturnValue({ pathname: '/dashboard' });
  mockUseGestor.mockReturnValue({ isGestor: false, gestorId: null, isLoading: false });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('ProtectedRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDefaults();
  });

  // 1
  it('shows spinner when auth is loading', () => {
    mockUseAuth.mockReturnValue({ user: null, loading: true, signOut: vi.fn() });

    render(
      <ProtectedRoute>
        <p>protected</p>
      </ProtectedRoute>,
    );

    expect(screen.getByAltText('Torque')).toBeInTheDocument();
    expect(screen.queryByText('protected')).not.toBeInTheDocument();
  });

  // 2
  it('shows spinner when master is loading', () => {
    mockUseIdentity.mockReturnValue({
      userId: 'user-1', organizationId: 'org-1', teamMemberId: 'tm-1',
      effectiveRole: null, isMaster: false, isAdmin: false,
      features: {}, isLoading: true, isReady: false,
    });

    render(
      <ProtectedRoute>
        <p>protected</p>
      </ProtectedRoute>,
    );

    expect(screen.getByAltText('Torque')).toBeInTheDocument();
    expect(screen.queryByText('protected')).not.toBeInTheDocument();
  });

  // 3
  it('redirects to /auth when no user', () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, signOut: vi.fn() });

    render(
      <ProtectedRoute>
        <p>protected</p>
      </ProtectedRoute>,
    );

    const nav = screen.getByTestId('navigate');
    expect(nav).toHaveAttribute('data-to', '/auth');
    expect(screen.queryByText('protected')).not.toBeInTheDocument();
  });

  // 4
    // PULADO — afirma um gate que NÃO EXISTE no código desde cc8fc0a7
  // (2026-05-19, "remove checkout system — orgs provisioned via master admin").
  // `pending_payment` não aparece em nenhum arquivo de `src/` hoje; o
  // componente nunca redireciona para `/checkout`.
  //
  // Não é teste quebrado, é teste órfão: ficou vermelho por três meses afirmando
  // comportamento deletado de propósito, e foi o que escondeu a falha REAL deste
  // arquivo (o `useMfaRequired` sem mock, de 25/08).
  //
  // NÃO apagar. SCRUM-486…490 reconstroem o checkout nesta sprint, e este bloco
  // é o registro de como o gate se comportava — inclusive as duas exceções de
  // rota, que são a parte que se esquece ao reescrever.
  it.skip('redirects to /checkout when pending_payment metadata', () => {
    mockUseAuth.mockReturnValue({
      user: makeUser({ subscription_status: 'pending_payment' }),
      loading: false,
      signOut: vi.fn(),
    });
    mockUseLocation.mockReturnValue({ pathname: '/dashboard' });

    render(
      <ProtectedRoute>
        <p>protected</p>
      </ProtectedRoute>,
    );

    const nav = screen.getByTestId('navigate');
    expect(nav).toHaveAttribute('data-to', '/checkout');
  });

  // 5
    // PULADO — afirma um gate que NÃO EXISTE no código desde cc8fc0a7
  // (2026-05-19, "remove checkout system — orgs provisioned via master admin").
  // `pending_payment` não aparece em nenhum arquivo de `src/` hoje; o
  // componente nunca redireciona para `/checkout`.
  //
  // Não é teste quebrado, é teste órfão: ficou vermelho por três meses afirmando
  // comportamento deletado de propósito, e foi o que escondeu a falha REAL deste
  // arquivo (o `useMfaRequired` sem mock, de 25/08).
  //
  // NÃO apagar. SCRUM-486…490 reconstroem o checkout nesta sprint, e este bloco
  // é o registro de como o gate se comportava — inclusive as duas exceções de
  // rota, que são a parte que se esquece ao reescrever.
  it.skip('does NOT redirect when pending_payment and on /checkout', () => {
    mockUseAuth.mockReturnValue({
      user: makeUser({ subscription_status: 'pending_payment' }),
      loading: false,
      signOut: vi.fn(),
    });
    mockUseLocation.mockReturnValue({ pathname: '/checkout' });
    // No team member — requireOrganization will redirect, but we're on a checkout path
    mockUseCurrentTeamMember.mockReturnValue({ data: null, isLoading: false, error: null });

    render(
      <ProtectedRoute>
        <p>protected</p>
      </ProtectedRoute>,
    );

    expect(screen.queryByTestId('navigate')).not.toBeInTheDocument();
    expect(screen.getByText('protected')).toBeInTheDocument();
  });

  // 6
    // PULADO — afirma um gate que NÃO EXISTE no código desde cc8fc0a7
  // (2026-05-19, "remove checkout system — orgs provisioned via master admin").
  // `pending_payment` não aparece em nenhum arquivo de `src/` hoje; o
  // componente nunca redireciona para `/checkout`.
  //
  // Não é teste quebrado, é teste órfão: ficou vermelho por três meses afirmando
  // comportamento deletado de propósito, e foi o que escondeu a falha REAL deste
  // arquivo (o `useMfaRequired` sem mock, de 25/08).
  //
  // NÃO apagar. SCRUM-486…490 reconstroem o checkout nesta sprint, e este bloco
  // é o registro de como o gate se comportava — inclusive as duas exceções de
  // rota, que são a parte que se esquece ao reescrever.
  it.skip('does NOT redirect when pending_payment and on /checkout/success', () => {
    mockUseAuth.mockReturnValue({
      user: makeUser({ subscription_status: 'pending_payment' }),
      loading: false,
      signOut: vi.fn(),
    });
    mockUseLocation.mockReturnValue({ pathname: '/checkout/success' });
    mockUseCurrentTeamMember.mockReturnValue({ data: null, isLoading: false, error: null });

    render(
      <ProtectedRoute>
        <p>protected</p>
      </ProtectedRoute>,
    );

    expect(screen.queryByTestId('navigate')).not.toBeInTheDocument();
    expect(screen.getByText('protected')).toBeInTheDocument();
  });

  // 7
  it('shows spinner when teamMember loading + requireOrganization + !master', () => {
    mockUseCurrentTeamMember.mockReturnValue({ data: null, isLoading: true, error: null });

    render(
      <ProtectedRoute requireOrganization={true}>
        <p>protected</p>
      </ProtectedRoute>,
    );

    expect(screen.getByAltText('Torque')).toBeInTheDocument();
    expect(screen.queryByText('protected')).not.toBeInTheDocument();
  });

  // 8
  // Era "redirects to /checkout". O checkout saiu do produto em cc8fc0a7
  // (2026-05-19, "remove checkout system — orgs provisioned via master admin")
  // e `ProtectedRoute` passou a mostrar "Aguardando Ativação" no lugar do
  // redirect. O caso continua valendo — quem não tem vínculo NÃO entra no app —,
  // então ele afirma o comportamento de hoje em vez de ser pulado.
  it('sem team member, não entra no app: mostra "Aguardando Ativação"', () => {
    mockUseCurrentTeamMember.mockReturnValue({ data: null, isLoading: false, error: null });
    mockUseLocation.mockReturnValue({ pathname: '/dashboard' });

    render(
      <ProtectedRoute requireOrganization={true}>
        <p>protected</p>
      </ProtectedRoute>,
    );

    expect(screen.getByText('Aguardando Ativação')).toBeInTheDocument();
    expect(screen.queryByText('protected')).not.toBeInTheDocument();
  });

  // 9
  // PULADO — a premissa deixou de existir. `/checkout` era rota especial: sem
  // vínculo, o componente deixava passar quem já estivesse nela. O checkout foi
  // removido em cc8fc0a7 (2026-05-19) e não há mais caminho privilegiado.
  //
  // NÃO apagar: SCRUM-488 ("O cliente compra sozinho no site") reconstrói o
  // checkout nesta sprint. Quem o reconstruir decide se o gate volta a ter
  // exceção de rota — e este caso é o registro de que ela já existiu e por quê.
  it.skip('renders children when no teamMember + already on /checkout path', () => {
    mockUseCurrentTeamMember.mockReturnValue({ data: null, isLoading: false, error: null });
    mockUseLocation.mockReturnValue({ pathname: '/checkout' });

    render(
      <ProtectedRoute requireOrganization={true}>
        <p>protected</p>
      </ProtectedRoute>,
    );

    expect(screen.queryByTestId('navigate')).not.toBeInTheDocument();
    expect(screen.getByText('protected')).toBeInTheDocument();
  });

  // 10
  // Era "redirects to /checkout" — mesma troca do caso 8 (cc8fc0a7). Vínculo sem
  // organização é indistinguível de vínculo ausente para o gate, e este caso é o
  // que trava isso.
  it('team member sem organization_id também não entra no app', () => {
    mockUseCurrentTeamMember.mockReturnValue({
      data: makeTeamMember({ organization_id: null }),
      isLoading: false,
      error: null,
    });
    mockUseLocation.mockReturnValue({ pathname: '/dashboard' });

    render(
      <ProtectedRoute requireOrganization={true}>
        <p>protected</p>
      </ProtectedRoute>,
    );

    expect(screen.getByText('Aguardando Ativação')).toBeInTheDocument();
    expect(screen.queryByText('protected')).not.toBeInTheDocument();
  });

  // 11
  it('shows "Conta Desativada" when is_active=false', () => {
    mockUseCurrentTeamMember.mockReturnValue({
      data: makeTeamMember({ is_active: false }),
      isLoading: false,
      error: null,
    });

    render(
      <ProtectedRoute requireOrganization={true}>
        <p>protected</p>
      </ProtectedRoute>,
    );

    expect(screen.getByText('Conta Desativada')).toBeInTheDocument();
    expect(
      screen.getByText('Sua conta foi desativada. Entre em contato com o administrador.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Fazer logout')).toBeInTheDocument();
    expect(screen.queryByText('protected')).not.toBeInTheDocument();
  });

  // 12
    // PULADO — o bloco que este caso tenta exercitar é INALCANÇÁVEL, e o próprio
  // teste chegou a essa conclusão: o corpo original era um despejo de raciocínio
  // que terminava em "Dead code confirmed" e mesmo assim afirmava algo.
  //
  // O achado é real e vale mais que o teste. Em `ProtectedRoute`:
  //   · o gate de vínculo (`requireOrganization && !isMaster` → `!teamMember`)
  //     retorna "Aguardando Ativação" ANTES;
  //   · o bloco de erro exige `teamMemberError && !teamMember && requireOrganization
  //     && !isMaster` — o mesmo `!teamMember` que já foi capturado acima.
  // Como as duas condições são avaliadas no MESMO render síncrono, com os mesmos
  // valores, a segunda nunca é alcançada. "Erro ao Carregar" não aparece nunca:
  // falha de rede ao buscar o team member é mostrada como "Aguardando Ativação".
  //
  // HERDADO — não é defeito desta branch e o conserto é no COMPONENTE (ordenar
  // o gate de erro antes do de vínculo), não no teste.
  //
  // Em vez de pular, o caso passa a AFIRMAR o comportamento vigente. Um `skip`
  // não cobre nada e envelhece calado; uma asserção trava o que o produto faz
  // hoje e fica VERMELHA no dia em que alguém corrigir a ordem — que é
  // exatamente o lembrete de que a expectativa precisa mudar junto.
  it('lets the membership guard win over the error UI, which is unreachable', () => {
    mockUseCurrentTeamMember.mockReturnValue({
      data: null,
      isLoading: false,
      error: new Error('Network failure'),
    });
    mockUseLocation.mockReturnValue({ pathname: '/dashboard' });

    render(
      <ProtectedRoute requireOrganization={true}>
        <p>protected</p>
      </ProtectedRoute>,
    );

    // A falha de rede é engolida: quem não conseguiu carregar o vínculo recebe
    // a mesma tela de quem ainda não tem vínculo nenhum.
    expect(screen.getByText('Aguardando Ativação')).toBeInTheDocument();
    expect(screen.queryByText('Erro ao Carregar')).not.toBeInTheDocument();
    expect(screen.queryByText('protected')).not.toBeInTheDocument();
  });

  // 12b
  it('distingue vínculo REVOGADO de vínculo que nunca existiu', () => {
    // O ramo `useDeactivatedMembership` (#1812) não tinha cobertura nenhuma: o
    // mock só existia no default `false`, então nenhum caso chegava a entrar
    // aqui. É o único ramo do gate de vínculo que ninguém exercitava.
    //
    // A distinção é o motivo de ele existir: "sem vínculo" pode ser "ainda não
    // criaram" ou "criaram e revogaram", e as duas frases são diferentes de
    // propósito — dizer "sua conta está sendo configurada" para quem acabou de
    // ser desligado é desinformação.
    mockUseCurrentTeamMember.mockReturnValue({ data: null, isLoading: false, error: null });
    mockUseDeactivatedMembership.mockReturnValue({ data: true, isLoading: false });

    render(
      <ProtectedRoute requireOrganization={true}>
        <p>protected</p>
      </ProtectedRoute>,
    );

    expect(screen.getByText('Conta Desativada')).toBeInTheDocument();
    expect(screen.getByText(/Seu acesso a esta organização foi desativado/)).toBeInTheDocument();
    expect(screen.queryByText('Aguardando Ativação')).not.toBeInTheDocument();
    expect(screen.queryByText('protected')).not.toBeInTheDocument();
  });

  // 13
  it('master bypasses all org checks (renders children even without teamMember)', () => {
    mockUseIdentity.mockReturnValue({
      userId: 'user-1', organizationId: null, teamMemberId: null,
      effectiveRole: 'admin' as const, isMaster: true, isAdmin: true,
      features: {}, isLoading: false, isReady: true,
    });
    mockUseCurrentTeamMember.mockReturnValue({ data: null, isLoading: false, error: null });

    render(
      <ProtectedRoute requireOrganization={true}>
        <p>protected</p>
      </ProtectedRoute>,
    );

    expect(screen.queryByTestId('navigate')).not.toBeInTheDocument();
    expect(screen.getByText('protected')).toBeInTheDocument();
  });

  // 14
  it('requireOrganization=false skips team member validation', () => {
    mockUseCurrentTeamMember.mockReturnValue({ data: null, isLoading: false, error: null });

    render(
      <ProtectedRoute requireOrganization={false}>
        <p>protected</p>
      </ProtectedRoute>,
    );

    expect(screen.queryByTestId('navigate')).not.toBeInTheDocument();
    expect(screen.getByText('protected')).toBeInTheDocument();
  });

  // 15
  it('renders children when all checks pass', () => {
    render(
      <ProtectedRoute>
        <p>protected</p>
      </ProtectedRoute>,
    );

    expect(screen.getByText('protected')).toBeInTheDocument();
    expect(screen.queryByTestId('navigate')).not.toBeInTheDocument();
    expect(screen.queryByTestId('loader2')).not.toBeInTheDocument();
  });
});

describe('ProtectedRoute — Gestor de Portfólio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDefaults();
  });

  it('redirects an active Gestor (no team member yet) to /gestor instead of "Aguardando Ativação"', () => {
    // Gestor: não-master, sem team_member (ainda não escolheu org vinculada no hub).
    mockUseCurrentTeamMember.mockReturnValue({ data: null, isLoading: false, error: null });
    mockUseGestor.mockReturnValue({ isGestor: true, gestorId: 'g-1', isLoading: false });

    render(
      <ProtectedRoute requireOrganization>
        <p>app</p>
      </ProtectedRoute>,
    );

    expect(screen.getByTestId('navigate')).toHaveAttribute('data-to', '/gestor');
    expect(screen.queryByText(/sendo configurada/i)).not.toBeInTheDocument();
    expect(screen.queryByText('app')).not.toBeInTheDocument();
  });

  it('lets a Gestor into the app once a bound org is selected (virtual member present)', () => {
    mockUseCurrentTeamMember.mockReturnValue({
      data: makeTeamMember({ id: 'gestor-virtual-user-1', role: 'admin' }),
      isLoading: false,
      error: null,
    });
    mockUseGestor.mockReturnValue({ isGestor: true, gestorId: 'g-1', isLoading: false });

    render(
      <ProtectedRoute requireOrganization>
        <p>app</p>
      </ProtectedRoute>,
    );

    expect(screen.getByText('app')).toBeInTheDocument();
    expect(screen.queryByTestId('navigate')).not.toBeInTheDocument();
  });
});
