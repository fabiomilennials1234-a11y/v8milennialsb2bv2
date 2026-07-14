import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";

/**
 * lead_origins — origens de lead gerenciáveis por org (substitui a lista fixa
 * hardcoded em src/lib/lead/lead-origins.ts). Criada na migration
 * 20270214000000_lead_origins.sql. types.ts ainda não regenerado — castamos
 * via `any` localmente (mesmo padrão de useLeadComments).
 */
export interface LeadOrigin {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  color: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string | null;
}

export type LeadOriginInput = {
  name: string;
  slug?: string;
  color?: string;
  sort_order?: number;
};

/** Gera slug estável a partir do nome (a-z0-9 + underscore). */
export function slugifyOrigin(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "origem";
}

function fromLeadOrigins() {
  return (supabase.from as unknown as (t: string) => any)("lead_origins");
}

export function useLeadOrigins(opts?: { includeInactive?: boolean }) {
  const { organizationId, isReady } = useOrganization();
  const includeInactive = opts?.includeInactive ?? false;

  return useQuery({
    queryKey: ["lead-origins", organizationId, includeInactive],
    queryFn: async (): Promise<LeadOrigin[]> => {
      if (!organizationId) return [];
      let q = fromLeadOrigins()
        .select("*")
        .eq("organization_id", organizationId)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      if (!includeInactive) q = q.eq("is_active", true);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as LeadOrigin[];
    },
    enabled: isReady,
  });
}

export function useCreateLeadOrigin() {
  const qc = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (input: LeadOriginInput) => {
      const name = input.name.trim();
      if (!name) throw new Error("Nome é obrigatório");
      const slug = (input.slug && input.slug.trim()) || slugifyOrigin(name);
      const { data, error } = await fromLeadOrigins()
        .insert({
          organization_id: organizationId,
          name,
          slug,
          color: input.color ?? "#6B7280",
          sort_order: input.sort_order ?? 50,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data as LeadOrigin;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lead-origins"] });
    },
  });
}

export function useUpdateLeadOrigin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<LeadOrigin> & { id: string }) => {
      const { data, error } = await fromLeadOrigins()
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;
      return data as LeadOrigin;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lead-origins"] });
    },
  });
}

export function useDeleteLeadOrigin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await fromLeadOrigins().delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lead-origins"] });
    },
  });
}
