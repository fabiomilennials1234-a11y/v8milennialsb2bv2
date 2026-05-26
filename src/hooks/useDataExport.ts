import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { useAuth } from "@/modules/identity";
import { toast } from "sonner";

export type ExportType = "full_export" | "erasure" | "portability";
export type ExportStatus = "pending" | "processing" | "completed" | "failed";

export interface DataExportRequest {
  id: string;
  lead_id: string | null;
  contact_email: string | null;
  export_type: ExportType;
  status: ExportStatus;
  file_url: string | null;
  completed_at: string | null;
  created_at: string;
}

export function useDataExportRequests() {
  const { organizationId } = useOrganization();
  const orgId = organizationId;

  return useQuery<DataExportRequest[]>({
    queryKey: ["data-export-requests", orgId],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("data_export_requests")
        .select("*")
        .eq("organization_id", orgId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as DataExportRequest[];
    },
    enabled: !!orgId,
  });
}

export function useRequestDataExport() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: {
      lead_id?: string;
      contact_email?: string;
      export_type: ExportType;
    }) => {
      const { data, error } = await (supabase.from as any)("data_export_requests")
        .insert({
          organization_id: organizationId!,
          requested_by: user!.id,
          lead_id: input.lead_id ?? null,
          contact_email: input.contact_email ?? null,
          export_type: input.export_type,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Solicitação de exportação criada");
      queryClient.invalidateQueries({ queryKey: ["data-export-requests"] });
    },
  });
}

export function useExportLeadData() {
  return useMutation({
    mutationFn: async (leadId: string) => {
      const { data, error } = await (supabase.rpc as any)("export_lead_data", {
        p_lead_id: leadId,
      });
      if (error) throw error;
      return data as Record<string, unknown>;
    },
    onSuccess: () => {
      toast.success("Dados exportados com sucesso");
    },
    onError: () => {
      toast.error("Erro ao exportar dados — verifique permissões de admin");
    },
  });
}
