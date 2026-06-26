/**
 * /onboarding — página dedicada de onboarding (tasks + checklist).
 *
 * Gate: admin + master. Membro não configura a org → redireciona p/ dashboard.
 * O conteúdo vive em OnboardingHub (components/onboarding).
 */

import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useIdentity } from "@/modules/identity";
import { OnboardingHub } from "@/modules/platform/components/onboarding/OnboardingHub";

export default function OnboardingHubPage() {
  const { isAdmin, isMaster, isLoading } = useIdentity();

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAdmin && !isMaster) {
    return <Navigate to="/dashboard" replace />;
  }

  return <OnboardingHub />;
}
