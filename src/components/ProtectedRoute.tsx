import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrentTeamMember } from '@/hooks/useTeamMembers';
import { useMasterAuth } from '@/hooks/useMasterAuth';
import { Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ProtectedRouteProps {
  children: ReactNode;
  requireOrganization?: boolean;
}

// Paths that a pending_payment user is allowed to visit
const CHECKOUT_PATHS = ['/checkout', '/checkout/success'];

export function ProtectedRoute({ children, requireOrganization = true }: ProtectedRouteProps) {
  const { user, loading: authLoading, signOut } = useAuth();
  const { data: teamMember, isLoading: teamMemberLoading, error: teamMemberError } = useCurrentTeamMember();
  const { isMaster, isLoading: masterLoading } = useMasterAuth();
  const location = useLocation();

  // Loading state - auth ou master
  if (authLoading || masterLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Verificando autenticação...</p>
        </div>
      </div>
    );
  }

  // Not authenticated
  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  // Pending payment: gate all protected routes except checkout itself
  if (
    user.user_metadata?.subscription_status === 'pending_payment' &&
    !CHECKOUT_PATHS.includes(location.pathname)
  ) {
    return <Navigate to="/checkout" replace />;
  }

  // Loading team member data (master bypass: virtual member resolve assíncrono)
  if (teamMemberLoading && requireOrganization && !isMaster) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Carregando dados do usuário...</p>
        </div>
      </div>
    );
  }

  // SECURITY: Validate organization membership (master bypassa todas as validações)
  // A user with no team_member record AND no org is a newly signed-up user who
  // hasn't paid yet — redirect them to /checkout instead of showing an error.
  // This is the DB-backed equivalent of the old JWT metadata pending_payment check.
  if (requireOrganization && !isMaster) {
    // No team member record → user has no org → redirect to checkout (pending payment)
    if (!teamMember) {
      if (!CHECKOUT_PATHS.includes(location.pathname)) {
        return <Navigate to="/checkout" replace />;
      }
      // If already on a checkout path, let them through
      return <>{children}</>;
    }

    // Has team_member but no organization linked → redirect to checkout
    if (!teamMember.organization_id) {
      if (!CHECKOUT_PATHS.includes(location.pathname)) {
        return <Navigate to="/checkout" replace />;
      }
      return <>{children}</>;
    }

    // Team member is not active
    if (!teamMember.is_active) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="flex flex-col items-center gap-4 max-w-md text-center p-6">
            <AlertTriangle className="h-12 w-12 text-red-500" />
            <h2 className="text-xl font-semibold">Conta Desativada</h2>
            <p className="text-muted-foreground">
              Sua conta foi desativada. Entre em contato com o administrador.
            </p>
            <Button onClick={() => signOut()} variant="outline">
              Fazer logout
            </Button>
          </div>
        </div>
      );
    }
  }

  // Error fetching team member (but don't block if we already have data or is master)
  if (teamMemberError && !teamMember && requireOrganization && !isMaster) {
    console.error('[ProtectedRoute] Error fetching team member:', teamMemberError);
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 max-w-md text-center p-6">
          <AlertTriangle className="h-12 w-12 text-red-500" />
          <h2 className="text-xl font-semibold">Erro ao Carregar</h2>
          <p className="text-muted-foreground">
            Não foi possível carregar os dados do usuário. Tente novamente.
          </p>
          <Button onClick={() => window.location.reload()}>
            Recarregar página
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
