import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export interface ApprovalRule {
  id: string;
  name: string;
  entity_type: string;
  conditions: unknown[];
  approvers: string[];
  is_active: boolean;
}

export interface ApprovalRequest {
  id: string;
  rule_id: string;
  entity_type: string;
  entity_id: string;
  status: ApprovalStatus;
  requested_by: string;
  decided_by: string | null;
  comment: string | null;
  decided_at: string | null;
  created_at: string;
}

export function useApprovalRules() {
  const { organizationId } = useOrganization();
  const orgId = organizationId;

  return useQuery<ApprovalRule[]>({
    queryKey: ["approval-rules", orgId],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("approval_rules")
        .select("*")
        .eq("organization_id", orgId!)
        .eq("is_active", true);
      if (error) throw error;
      return data as ApprovalRule[];
    },
    enabled: !!orgId,
  });
}

export function usePendingApprovals() {
  const { organizationId } = useOrganization();
  const orgId = organizationId;

  return useQuery<ApprovalRequest[]>({
    queryKey: ["pending-approvals", orgId],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("approval_requests")
        .select("*")
        .eq("organization_id", orgId!)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as ApprovalRequest[];
    },
    enabled: !!orgId,
  });
}

export function useRequestApproval() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: { rule_id: string; entity_type: string; entity_id: string }) => {
      const { data, error } = await (supabase.from as any)("approval_requests")
        .insert({
          organization_id: organizationId!,
          requested_by: user!.id,
          ...input,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Aprovação solicitada");
      queryClient.invalidateQueries({ queryKey: ["pending-approvals"] });
    },
  });
}

export function useDecideApproval() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ id, status, comment }: { id: string; status: "approved" | "rejected"; comment?: string }) => {
      const { error } = await (supabase.from as any)("approval_requests")
        .update({
          status,
          decided_by: user!.id,
          decided_at: new Date().toISOString(),
          comment: comment ?? null,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      toast.success(vars.status === "approved" ? "Aprovado" : "Rejeitado");
      queryClient.invalidateQueries({ queryKey: ["pending-approvals"] });
    },
  });
}
