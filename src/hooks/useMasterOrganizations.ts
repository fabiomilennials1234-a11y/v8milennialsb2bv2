/**
 * Hooks para gerenciamento de organizações pelo Master Admin
 *
 * Diferente dos hooks normais, estes NÃO filtram por organization_id,
 * permitindo ao Master ver e gerenciar TODAS as organizações.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface MasterOrganization {
  id: string;
  name: string;
  slug: string;
  subscription_status: string;
  subscription_plan: string | null;
  subscription_expires_at: string | null;
  billing_override: boolean;
  billing_override_reason: string | null;
  billing_override_by: string | null;
  billing_override_at: string | null;
  payment_customer_id: string | null;
  payment_subscription_id: string | null;
  created_at: string;
  updated_at: string;
  // Computed/joined
  members_count?: number;
  leads_count?: number;
}

export interface OrganizationStats {
  total: number;
  active: number;
  trial: number;
  suspended: number;
  cancelled: number;
  withOverride: number;
}

/**
 * Lista TODAS as organizações (sem filtro de org)
 */
export function useMasterOrganizations() {
  return useQuery({
    queryKey: ["master-organizations"],
    queryFn: async (): Promise<MasterOrganization[]> => {
      const { data, error } = await supabase
        .from("organizations")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as MasterOrganization[];
    },
    staleTime: 30 * 1000, // 30 segundos
  });
}

/**
 * Busca uma organização específica com detalhes
 */
export function useMasterOrganization(orgId: string | undefined) {
  return useQuery({
    queryKey: ["master-organization", orgId],
    queryFn: async (): Promise<MasterOrganization | null> => {
      if (!orgId) return null;

      const { data, error } = await supabase
        .from("organizations")
        .select("*")
        .eq("id", orgId)
        .single();

      if (error) throw error;
      return data as MasterOrganization;
    },
    enabled: !!orgId,
  });
}

/**
 * Estatísticas gerais das organizações
 */
export function useMasterOrganizationStats() {
  return useQuery({
    queryKey: ["master-organization-stats"],
    queryFn: async (): Promise<OrganizationStats> => {
      const { data, error } = await supabase
        .from("organizations")
        .select("subscription_status, billing_override");

      if (error) throw error;

      const orgs = data || [];
      return {
        total: orgs.length,
        active: orgs.filter((o) => o.subscription_status === "active").length,
        trial: orgs.filter((o) => o.subscription_status === "trial").length,
        suspended: orgs.filter((o) => o.subscription_status === "suspended").length,
        cancelled: orgs.filter((o) => o.subscription_status === "cancelled" || o.subscription_status === "expired").length,
        withOverride: orgs.filter((o) => o.billing_override).length,
      };
    },
    staleTime: 60 * 1000, // 1 minuto
  });
}

/**
 * Criar nova organização
 */
export function useMasterCreateOrganization() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      name: string;
      slug: string;
      subscription_plan?: string;
      subscription_status?: string;
    }) => {
      const { data: org, error } = await supabase
        .from("organizations")
        .insert({
          name: data.name,
          slug: data.slug,
          subscription_plan: data.subscription_plan || "free",
          subscription_status: data.subscription_status || "trial",
        })
        .select()
        .single();

      if (error) throw error;
      return org;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["master-organizations"] });
      queryClient.invalidateQueries({ queryKey: ["master-organization-stats"] });
      toast.success("Organização criada com sucesso!");
    },
    onError: (error: any) => {
      console.error("Error creating organization:", error);
      toast.error(error.message || "Erro ao criar organização");
    },
  });
}

/**
 * Atualizar organização
 */
export function useMasterUpdateOrganization() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: Partial<MasterOrganization> & { id: string }) => {
      const { data, error } = await supabase
        .from("organizations")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["master-organizations"] });
      queryClient.invalidateQueries({ queryKey: ["master-organization", variables.id] });
      toast.success("Organização atualizada!");
    },
    onError: (error: any) => {
      toast.error(error.message || "Erro ao atualizar organização");
    },
  });
}

/**
 * Excluir organização
 */
export function useMasterDeleteOrganization() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("organizations")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["master-organizations"] });
      queryClient.invalidateQueries({ queryKey: ["master-organization-stats"] });
      toast.success("Organização excluída!");
    },
    onError: (error: any) => {
      toast.error(error.message || "Erro ao excluir organização");
    },
  });
}

/**
 * Override de billing (liberar plano manualmente)
 */
export function useMasterBillingOverride() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      orgId,
      plan,
      reason,
      expiresAt,
    }: {
      orgId: string;
      plan: string;
      reason: string;
      expiresAt?: string;
    }) => {
      const { error } = await supabase.rpc("master_override_billing", {
        _org_id: orgId,
        _plan: plan,
        _reason: reason,
        _expires_at: expiresAt || null,
      });

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["master-organizations"] });
      queryClient.invalidateQueries({ queryKey: ["master-organization", variables.orgId] });
      queryClient.invalidateQueries({ queryKey: ["master-organization-stats"] });
      toast.success("Plano liberado com sucesso!");
    },
    onError: (error: any) => {
      toast.error(error.message || "Erro ao liberar plano");
    },
  });
}

/**
 * Buscar membros de uma organização
 */
export function useMasterOrganizationMembers(orgId: string | undefined) {
  return useQuery({
    queryKey: ["master-organization-members", orgId],
    queryFn: async () => {
      if (!orgId) return [];

      const { data, error } = await supabase
        .from("team_members")
        .select(`
          *,
          user_roles:user_roles(role)
        `)
        .eq("organization_id", orgId)
        .order("name");

      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
  });
}
