import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";

export type ConsentType = "marketing_email" | "marketing_whatsapp" | "marketing_sms" | "data_processing" | "data_sharing";

export interface ConsentRecord {
  id: string;
  lead_id: string | null;
  contact_email: string | null;
  consent_type: ConsentType;
  granted: boolean;
  granted_at: string;
  revoked_at: string | null;
  source: string;
  created_at: string;
}

export function useLeadConsents(leadId: string | null) {
  return useQuery<ConsentRecord[]>({
    queryKey: ["consents", leadId],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("consent_records")
        .select("*")
        .eq("lead_id", leadId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ConsentRecord[];
    },
    enabled: !!leadId,
  });
}

export function useRecordConsent() {
  const queryClient = useQueryClient();
  const { organization } = useOrganization();

  return useMutation({
    mutationFn: async (input: {
      lead_id?: string;
      contact_email?: string;
      contact_phone?: string;
      consent_type: ConsentType;
      granted: boolean;
      source?: string;
    }) => {
      const { data, error } = await (supabase.from as any)("consent_records")
        .insert({
          organization_id: organization!.id,
          lead_id: input.lead_id ?? null,
          contact_email: input.contact_email ?? null,
          contact_phone: input.contact_phone ?? null,
          consent_type: input.consent_type,
          granted: input.granted,
          source: input.source ?? "manual",
        })
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      toast.success(vars.granted ? "Consentimento registrado" : "Consentimento revogado");
      if (vars.lead_id) {
        queryClient.invalidateQueries({ queryKey: ["consents", vars.lead_id] });
      }
    },
  });
}

export function useRevokeConsent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, leadId }: { id: string; leadId?: string }) => {
      const { error } = await (supabase.from as any)("consent_records")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
      return { leadId };
    },
    onSuccess: (result) => {
      toast.success("Consentimento revogado");
      if (result.leadId) {
        queryClient.invalidateQueries({ queryKey: ["consents", result.leadId] });
      }
    },
  });
}
