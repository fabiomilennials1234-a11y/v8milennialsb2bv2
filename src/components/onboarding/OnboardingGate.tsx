import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useOnboarding } from "@/hooks/useOnboarding";
import { useMasterAuth } from "@/hooks/useMasterAuth";
import { useIsAdmin } from "@/hooks/useUserRole";
import { TorqueLoader } from "@/components/branding/TorqueLoader";

interface OnboardingGateProps {
  children: ReactNode;
}

export function OnboardingGate({ children }: OnboardingGateProps) {
  const { onboarding, isLoading, needsOnboarding, noRecord } = useOnboarding();
  const { isMaster } = useMasterAuth();
  const { isAdmin } = useIsAdmin();

  if (isMaster) return <>{children}</>;

  if (isLoading) {
    return <TorqueLoader variant="full" />;
  }

  if (noRecord) return <>{children}</>;

  if (needsOnboarding && isAdmin) {
    return <Navigate to="/onboarding" replace />;
  }

  if (needsOnboarding && !isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="max-w-sm text-center p-6 space-y-4">
          <TorqueLoader variant="inline" />
          <h2 className="text-lg font-semibold">Configuração em andamento</h2>
          <p className="text-sm text-muted-foreground">
            O administrador está configurando o sistema. Aguarde a conclusão para acessar.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
