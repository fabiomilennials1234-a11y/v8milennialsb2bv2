import { ReactNode } from "react";
import { useIdentity } from "@/modules/identity";
import { useOnboardingState } from "@/hooks/useOnboardingState";
import { TorqueLoader } from "@/components/branding/TorqueLoader";
import { OnboardingFlow } from "./OnboardingFlow";

interface OnboardingGateProps {
  children: ReactNode;
}

export function OnboardingGate({ children }: OnboardingGateProps) {
  const { state, isLoading, needsOnboarding } = useOnboardingState();
  const { isAdmin, isMaster } = useIdentity();

  if (isMaster) return <>{children}</>;

  if (isLoading) return <TorqueLoader variant="full" />;

  if (!needsOnboarding) return <>{children}</>;

  if (isAdmin) return <OnboardingFlow currentState={state} />;

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
