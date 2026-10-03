import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useCurrentTeamMember } from '../../org-team/hooks/useTeamMembers';
import { useIdentity } from '../hooks/useIdentity';
import { useGestor } from '../../gestor/hooks/useGestor';
import { useMfaRequired } from '../hooks/useMfaRequired';
import { useDeactivatedMembership } from '../../org-team/hooks/useMembershipStatus';
import { AlertTriangle, Clock } from 'lucide-react';
import { TorqueLoader } from '@/components/ui/branding/TorqueLoader';
import { Button } from '@/components/ui/button';
import { IS_DEMO_MODE } from '@/core/demo-mode';

interface ProtectedRouteProps {
  children: ReactNode;
  requireOrganization?: boolean;
}

export function ProtectedRoute({ children, requireOrganization = true }: ProtectedRouteProps) {
  const { user, loading: authLoading, signOut } = useAuth();
  const { data: teamMember, isLoading: teamMemberLoading, error: teamMemberError } = useCurrentTeamMember();
  const { isMaster, isLoading: masterLoading } = useIdentity();
  const { isGestor, isLoading: gestorLoading } = useGestor();
  // Gate de MFA. A propria rota /seguranca/mfa fica de fora, senao o redirect
  // aponta para si mesmo e vira loop.
  const location = useLocation();
  const naRotaDeMfa = location.pathname.startsWith('/seguranca/mfa');
  const { required: precisaMfa, isLoading: mfaLoading } = useMfaRequired(isMaster, !naRotaDeMfa);
  // Só consultamos quando não há vínculo ativo — é o único caso ambíguo.
  const semVinculoAtivo = !teamMemberLoading && !teamMember?.organization_id;
  const { data: foiDesativado, isLoading: desativadoLoading } =
    useDeactivatedMembership(semVinculoAtivo && !isMaster && !isGestor);

  // Modo demonstração (build de dev + VITE_DEMO_MODE=1). Em produção
  // `IS_DEMO_MODE` é a constante `false` e este bloco não chega ao bundle.
  // Fica ANTES dos gates para não depender de sessão/team_member — a demo
  // roda sem Supabase. Ver src/core/demo-mode.ts.
  if (IS_DEMO_MODE) {
    return <>{children}</>;
  }

  if (authLoading || masterLoading || gestorLoading) {
    return <TorqueLoader variant="full" />;
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  // Master em aal1 nao acessa NADA do sistema ate passar pelo segundo fator.
  // Vem antes dos gates de org de proposito: vale para o app inteiro, nao so
  // para /master. Quem nao tem fator cadastra na mesma tela.
  if (isMaster && !naRotaDeMfa) {
    if (mfaLoading) {
      return <TorqueLoader variant="full" />;
    }
    if (precisaMfa) {
      return <Navigate to="/seguranca/mfa" replace />;
    }
  }

  if (teamMemberLoading && requireOrganization && !isMaster) {
    return <TorqueLoader variant="full" />;
  }

  if (requireOrganization && !isMaster) {
    if (!teamMember || !teamMember.organization_id) {
      // Gestor de Portfólio (ADR-0021): não tem team_member enquanto não entra
      // numa org vinculada pelo hub. Não está "sendo configurado" — mandar pra
      // Área do Gestor, não pra tela de aguardando ativação.
      if (isGestor) {
        return <Navigate to="/gestor" replace />;
      }

      if (desativadoLoading) {
        return <TorqueLoader variant="full" />;
      }

      // Vínculo existe e foi desativado ≠ vínculo nunca criado. São dois avisos
      // diferentes e a pessoa merece o certo — "sua conta está sendo
      // configurada" para quem acabou de ser desligado é desinformação.
      if (foiDesativado) {
        return (
          <div className="min-h-screen flex items-center justify-center bg-background">
            <div className="flex flex-col items-center gap-4 max-w-md text-center p-6">
              <AlertTriangle className="h-12 w-12 text-red-500" />
              <h2 className="text-xl font-semibold">Conta Desativada</h2>
              <p className="text-muted-foreground">
                Seu acesso a esta organização foi desativado. Fale com o administrador
                se isso não deveria ter acontecido.
              </p>
              <Button onClick={() => signOut()} variant="outline">
                Fazer logout
              </Button>
            </div>
          </div>
        );
      }

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
