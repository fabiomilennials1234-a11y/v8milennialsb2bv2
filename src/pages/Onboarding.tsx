import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { useOnboarding } from "@/hooks/useOnboarding";
import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";

export default function Onboarding() {
  const { onboarding, isLoading, noRecord } = useOnboarding();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  if (noRecord || onboarding?.status === "completed" || onboarding?.status === "skipped") {
    return <Navigate to="/" replace />;
  }

  return <OnboardingWizard />;
}
