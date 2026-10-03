import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
export type OnboardingState =
  | "pending_whatsapp"
  | "pending_profile"
  | "pending_pipelines"
  | "pending_automations"
  | "completed";

export interface OnboardingInfo {
  state: OnboardingState;
  answers: Record<string, Record<string, unknown>> | null;
  completed_at: string | null;
}

export function useOnboardingState() {
  const { organizationId } = useOrganization();

  const query = useQuery({
    queryKey: ["onboarding-state", organizationId],
    queryFn: async (): Promise<OnboardingInfo | null> => {
      if (!organizationId) return null;
      const { data, error } = await supabase
        .from("organizations")
        .select("onboarding_state, onboarding_answers, onboarding_completed_at")
        .eq("id", organizationId)
        .single();
      if (error) throw error;
      return {
        state: (data as any).onboarding_state as OnboardingState,
        answers: (data as any).onboarding_answers,
        completed_at: (data as any).onboarding_completed_at,
      };
    },
    enabled: !!organizationId,
    staleTime: 30_000,
  });

  return {
    info: query.data,
    state: query.data?.state ?? "completed",
    isLoading: query.isLoading,
    needsOnboarding: !!query.data && query.data.state !== "completed",
    refetch: query.refetch,
  };
}
