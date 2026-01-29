import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrentTeamMember } from '@/hooks/useTeamMembers';
import { Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ProtectedRouteProps {
  children: ReactNode;
  requireOrganization?: boolean;
}

export function ProtectedRoute({ children, requireOrganization = true }: ProtectedRouteProps) {
  const { user, loading: authLoading, signOut } = useAuth();
  const { data: teamMember, isLoading: teamMemberLoading, error: teamMemberError } = useCurrentTeamMember();

  // Loading state - auth
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-millennials-yellow" />
          <p className="text-muted-foreground">Verificando autenticação...</p>
        </div>
      </div>
    );
  }

  // Not authenticated
  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  // Loading team member data
  if (teamMemberLoading && requireOrganization) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-millennials-yellow" />
          <p className="text-muted-foreground">Carregando dados do usuário...</p>
        </div>
      </div>
    );
  }

  // SECURITY: Validate organization membership
  if (requireOrganization) {
    // No team member record
    if (!teamMember) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="flex flex-col items-center gap-4 max-w-md text-center p-6">
            <AlertTriangle className="h-12 w-12 text-yellow-500" />
            <h2 className="text-xl font-semibold">Acesso Restrito</h2>
            <p className="text-muted-foreground">
              Sua conta não está vinculada a nenhuma organização. 
              Entre em contato com o administrador do sistema para solicitar acesso.
            </p>
            <Button onClick={() => signOut()} variant="outline">
              Fazer logout
            </Button>
          </div>
        </div>
      );
    }

    // No organization linked
    if (!teamMember.organization_id) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="flex flex-col items-center gap-4 max-w-md text-center p-6">
            <AlertTriangle className="h-12 w-12 text-yellow-500" />
            <h2 className="text-xl font-semibold">Organização Não Configurada</h2>
            <p className="text-muted-foreground">
              Seu perfil ainda não foi associado a uma organização. 
              Entre em contato com o administrador para completar a configuração.
            </p>
            <div className="text-xs text-muted-foreground bg-muted p-2 rounded">
              ID do usuário: {user.id?.slice(0, 8)}...
            </div>
            <Button onClick={() => signOut()} variant="outline">
              Fazer logout
            </Button>
          </div>
        </div>
      );
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

  // Error fetching team member (but don't block if we already have data)
  if (teamMemberError && !teamMember && requireOrganization) {
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
