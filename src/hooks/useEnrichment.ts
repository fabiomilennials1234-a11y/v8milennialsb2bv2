import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";

export interface EnrichmentRequest {
  id: string;
  organization_id: string;
  contact_id: string | null;
  lead_id: string | null;
  provider: string;
  status: "pending" | "processing" | "completed" | "failed";
  result: Record<string, any> | null;
  created_at: string;
}

export function useEnrichmentRequests(opts?: { contactId?: string; leadId?: string }) {
  const { organization } = useOrganization();
  const orgId = organization?.id;

  return useQuery<EnrichmentRequest[]>({
    queryKey: ["enrichment-requests", orgId, opts?.contactId, opts?.leadId],
    queryFn: async () => {
      let q = (supabase.from as any)("enrichment_requests")
        .select("*")
        .eq("organization_id", orgId!)
        .order("created_at", { ascending: false })
        .limit(10);

      if (opts?.contactId) q = q.eq("contact_id", opts.contactId);
      if (opts?.leadId) q = q.eq("lead_id", opts.leadId);

      const { data, error } = await q;
      if (error) throw error;
      return data as EnrichmentRequest[];
    },
    enabled: !!orgId && !!(opts?.contactId || opts?.leadId),
  });
}

export function useRequestEnrichment() {
  const queryClient = useQueryClient();
  const { organization } = useOrganization();

  return useMutation({
    mutationFn: async (payload: {
      contactId?: string;
      leadId?: string;
      provider?: string;
    }) => {
      const { data, error } = await (supabase.from as any)("enrichment_requests")
        .insert({
          organization_id: organization!.id,
          contact_id: payload.contactId ?? null,
          lead_id: payload.leadId ?? null,
          provider: payload.provider ?? "linkedin",
          status: "pending",
        })
        .select("id")
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Enriquecimento solicitado");
      queryClient.invalidateQueries({ queryKey: ["enrichment-requests"] });
    },
    onError: (error: Error) => {
      toast.error(`Erro ao solicitar enriquecimento: ${error.message}`);
    },
  });
}
