import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useOnboarding } from "@/hooks/useOnboarding";
import { useMasterAuth } from "@/hooks/useMasterAuth";
import { useIsAdmin } from "@/hooks/useUserRole";
import { Loader2 } from "lucide-react";

interface OnboardingGateProps {
  children: ReactNode;
}

export function OnboardingGate({ children }: OnboardingGateProps) {
  const { onboarding, isLoading, needsOnboarding, noRecord } = useOnboarding();
  const { isMaster } = useMasterAuth();
  const { isAdmin } = useIsAdmin();

  if (isMaster) return <>{children}</>;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (noRecord) return <>{children}</>;

  if (needsOnboarding && isAdmin) {
    return <Navigate to="/onboarding" replace />;
  }

  if (needsOnboarding && !isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="max-w-sm text-center p-6 space-y-4">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
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
