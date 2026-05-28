import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useCurrentTeamMember } from '../hooks/useTeamMembers';
import { useIdentity } from '../hooks/useIdentity';
import { AlertTriangle, Clock } from 'lucide-react';
import { TorqueLoader } from '@/components/ui/branding/TorqueLoader';
import { Button } from '@/components/ui/button';

interface ProtectedRouteProps {
  children: ReactNode;
  requireOrganization?: boolean;
}

export function ProtectedRoute({ children, requireOrganization = true }: ProtectedRouteProps) {
  const { user, loading: authLoading, signOut } = useAuth();
  const { data: teamMember, isLoading: teamMemberLoading, error: teamMemberError } = useCurrentTeamMember();
  const { isMaster, isLoading: masterLoading } = useIdentity();

  if (authLoading || masterLoading) {
    return <TorqueLoader variant="full" />;
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (teamMemberLoading && requireOrganization && !isMaster) {
    return <TorqueLoader variant="full" />;
  }

  if (requireOrganization && !isMaster) {
    if (!teamMember || !teamMember.organization_id) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="flex flex-col items-center gap-4 max-w-md text-center p-6">
            <Clock className="h-12 w-12 text-amber-500" />
            <h2 className="text-xl font-semibold">Aguardando Ativação</h2>
            <p className="text-muted-foreground">
              Sua conta está sendo configurada. Entre em contato com o administrador para liberar o acesso.
            </p>
            <Button onClick={() => signOut()} variant="outline">
              Fazer logout
            </Button>
          </div>
        </div>
      );
    }

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
