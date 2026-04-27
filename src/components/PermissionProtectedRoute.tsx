import { ReactNode } from "react";
import { Lock, AlertCircle, Loader2 } from "lucide-react";
import { useFeaturePermission, useIsAdmin } from "@/hooks/useUserRole";
import { useMasterAuth } from "@/hooks/useMasterAuth";
import { useCurrentTeamMember } from "@/hooks/useTeamMembers";
import { Button } from "@/components/ui/button";

interface PermissionProtectedRouteProps {
  featureKey: string;
  children: ReactNode;
  fallback?: ReactNode;
}

export function PermissionProtectedRoute({
  featureKey,
  children,
  fallback,
}: PermissionProtectedRouteProps) {
  const { allowed, isLoading, hasError } = useFeaturePermission(featureKey);
  const { isAdmin, isLoading: adminLoading } = useIsAdmin();
  const { isMaster, isLoading: masterLoading } = useMasterAuth();
  const { data: currentTeamMember, isLoading: teamMemberLoading } = useCurrentTeamMember();

  if (adminLoading || masterLoading) {
    return <LoadingView />;
  }

  if (isMaster || isAdmin) {
    return <>{children}</>;
  }

  // Membro: aguardar team_member + feature permissions resolverem.
  // Antes (incidente 2026-04-24): quando organizationId ficava null,
  // useFeaturePermissions desabilitava, isLoading virava false e a Lock
  // screen renderizava prematuramente em todas as rotas protegidas.
  if (teamMemberLoading || isLoading) {
    return <LoadingView />;
  }

  // Falha técnica ao carregar permissões (400/500/network). Não é
  // "sem permissão" — é erro de infra. Oferecer retry em vez de Lock.
  if (hasError) {
    return <ErrorView message="Nao foi possivel carregar suas permissoes." />;
  }

  // Estado inválido: sem team_member após resolver. Não é "sem permissão"
  // e não deve mostrar Lock. Usuário precisa de intervenção (recarregar
  // ou re-login), não de esconder a tela.
  if (!currentTeamMember) {
    return <ErrorView message="Nao foi possivel carregar seus dados de membro." />;
  }

  if (allowed) {
    return <>{children}</>;
  }

  return (
    fallback ?? (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-muted-foreground">
        <Lock className="h-8 w-8" />
        <p className="text-sm font-medium">
          Voce nao tem permissao para acessar esta pagina.
        </p>
        <p className="text-xs">Solicite acesso ao administrador.</p>
      </div>
    )
  );
}

function LoadingView() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );
}

function ErrorView({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-muted-foreground">
      <AlertCircle className="h-8 w-8" />
      <p className="text-sm font-medium">{message}</p>
      <p className="text-xs">Tente recarregar a pagina.</p>
      <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
        Recarregar
      </Button>
    </div>
  );
}
