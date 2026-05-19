import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";

type OnboardingAction =
  | "advance_whatsapp"
  | "advance_profile"
  | "apply_pipelines"
  | "get_automation_templates"
  | "activate_automations";

interface AdvanceParams {
  action: OnboardingAction;
  payload?: Record<string, unknown>;
}

export function useOnboardingAdvance() {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ action, payload }: AdvanceParams) => {
      const { data, error } = await supabase.functions.invoke("onboarding-advance", {
        body: { action, payload },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Onboarding advance failed");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["onboarding-state", organizationId] });
    },
  });
}
