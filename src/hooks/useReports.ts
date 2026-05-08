import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export type ChartType = "bar" | "line" | "pie" | "table" | "number" | "funnel" | "area";
export type EntityType = "leads" | "deals" | "contacts" | "activities" | "pipelines";

export interface Report {
  id: string;
  name: string;
  description: string | null;
  entity_type: EntityType;
  chart_type: ChartType;
  config: Record<string, unknown>;
  filters: unknown[];
  dimensions: unknown[];
  metrics: unknown[];
  date_range: { type: string; start?: string; end?: string };
  is_shared: boolean;
  is_favorite: boolean;
  is_system: boolean;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
}

export function useReports() {
  const { organization } = useOrganization();
  const orgId = organization?.id;

  return useQuery<Report[]>({
    queryKey: ["reports", orgId],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("reports")
        .select("*")
        .eq("organization_id", orgId!)
        .order("sort_order")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data as Report[];
    },
    enabled: !!orgId,
  });
}

export function useReport(reportId: string | null) {
  return useQuery<Report>({
    queryKey: ["report", reportId],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("reports")
        .select("*")
        .eq("id", reportId!)
        .single();
      if (error) throw error;
      return data as Report;
    },
    enabled: !!reportId,
  });
}

export type ReportInsert = {
  name: string;
  entity_type: EntityType;
  chart_type: ChartType;
  description?: string;
  config?: Record<string, unknown>;
  filters?: unknown[];
  dimensions?: unknown[];
  metrics?: unknown[];
  date_range?: Record<string, unknown>;
  is_shared?: boolean;
};

export function useCreateReport() {
  const queryClient = useQueryClient();
  const { organization } = useOrganization();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: ReportInsert) => {
      const { data, error } = await (supabase.from as any)("reports")
        .insert({
          organization_id: organization!.id,
          owner_id: user!.id,
          ...input,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Relatório criado");
      queryClient.invalidateQueries({ queryKey: ["reports"] });
    },
  });
}

export function useUpdateReport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Report> & { id: string }) => {
      const { error } = await (supabase.from as any)("reports")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reports"] });
    },
  });
}

export function useDeleteReport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from as any)("reports").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Relatório removido");
      queryClient.invalidateQueries({ queryKey: ["reports"] });
    },
  });
}
