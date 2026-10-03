/**
 * /onboarding-preview — PREVIEW DEV-ONLY do OnboardingHub.
 *
 * Renderiza a view pura (OnboardingHubView) com dados mockados, sem auth e sem
 * backend. Existe só para co-design da UI enquanto o projeto dev de Supabase
 * está indisponível (quota). A rota é registrada apenas quando import.meta.env.DEV
 * — nunca chega em produção.
 */

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OnboardingHubView } from "@/modules/platform/components/onboarding/OnboardingHub";
import type {
  OnboardingProgress,
  OnboardingStepKey,
} from "@/modules/platform/hooks/onboarding/useOnboardingChecklist";

const MOCK_BASE: OnboardingProgress = {
  organization_id: "preview",
  step_connect_whatsapp: true,
  step_import_lead: true,
  step_configure_copilot: false,
  step_create_workflow: false,
  step_add_member: false,
  step_first_sale: false,
  dismissed_at: null,
  created_at: "",
  updated_at: "",
};

export default function OnboardingHubPreview() {
  const [progress, setProgress] = useState<OnboardingProgress>(MOCK_BASE);

  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto mb-6 flex w-full max-w-2xl items-center justify-between">
        <span className="rounded-full border border-border bg-card px-3 py-1 text-[11px] font-medium text-muted-foreground">
          PREVIEW · dev-only · sem backend
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs text-muted-foreground"
          onClick={() => setProgress(MOCK_BASE)}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Resetar
        </Button>
      </div>

      <OnboardingHubView
        progress={progress}
        completingKey={null}
        onComplete={(key: OnboardingStepKey) =>
          setProgress((p) => ({ ...p, [key]: !p[key] }))
        }
      />
    </div>
  );
}
