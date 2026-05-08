import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";
import { useRealtimeSubscription } from "./useRealtimeSubscription";

// ── Types ──────────────────────────────────────────────────────────────

export interface Company {
  id: string;
  organization_id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  size_range: string | null;
  revenue_range: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string;
  parent_id: string | null;
  health_score: number | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type CompanyInsert = Omit<Company, "id" | "organization_id" | "created_at" | "updated_at">;
export type CompanyUpdate = Partial<CompanyInsert>;

export interface Contact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  company_id: string | null;
  source_lead_id: string | null;
  created_at: string;
}

// ── Queries ────────────────────────────────────────────────────────────

export function useCompanies(search?: string) {
  const { organizationId, isReady } = useOrganization();

  useRealtimeSubscription("companies", ["companies"]);

  return useQuery({
    queryKey: ["companies", organizationId, search],
    queryFn: async () => {
      if (!organizationId) return [] as Company[];

      let query = (supabase.from as any)("companies")
        .select("*")
        .eq("organization_id", organizationId);

      if (search?.trim()) {
        query = query.ilike("name", `%${search.trim()}%`);
      }

      const { data, error } = await query.order("name", { ascending: true });

      if (error) throw error;
      return data as Company[];
    },
    enabled: isReady,
    staleTime: 2 * 60_000,
  });
}

export function useCompany(id: string | undefined) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["companies", organizationId, "detail", id],
    queryFn: async () => {
      if (!organizationId || !id) return null;

      const { data, error } = await (supabase.from as any)("companies")
        .select("*")
        .eq("id", id)
        .eq("organization_id", organizationId)
        .single();

      if (error) throw error;
      return data as Company;
    },
    enabled: isReady && !!id,
    staleTime: 2 * 60_000,
  });
}

export function useCompanyContacts(companyId: string | undefined) {
  return useQuery({
    queryKey: ["contacts", companyId],
    queryFn: async () => {
      if (!companyId) return [] as Contact[];

      const { data, error } = await (supabase.from as any)("contacts")
        .select("*")
        .eq("company_id", companyId)
        .order("name", { ascending: true });

      if (error) throw error;
      return data as Contact[];
    },
    enabled: !!companyId,
    staleTime: 2 * 60_000,
  });
}

// ── Mutations ──────────────────────────────────────────────────────────

export function useCreateCompany() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (company: CompanyInsert) => {
      if (!organizationId) {
        throw new Error("Cannot create company: No organization context");
      }

      const { data, error } = await (supabase.from as any)("companies")
        .insert({ ...company, organization_id: organizationId })
        .select()
        .single();

      if (error) throw error;
      return data as Company;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["companies"] });
    },
  });
}

export function useUpdateCompany() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async ({ id, ...updates }: CompanyUpdate & { id: string }) => {
      if (!organizationId) {
        throw new Error("Cannot update company: No organization context");
      }

      const { organization_id: _, ...safeUpdates } = updates as CompanyUpdate & { organization_id?: string };

      const { data, error } = await (supabase.from as any)("companies")
        .update(safeUpdates)
        .eq("id", id)
        .eq("organization_id", organizationId)
        .select()
        .single();

      if (error) throw error;
      return data as Company;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["companies"] });
    },
  });
}

export function useDeleteCompany() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (id: string) => {
      if (!organizationId) {
        throw new Error("Cannot delete company: No organization context");
      }

      const { error } = await (supabase.from as any)("companies")
        .delete()
        .eq("id", id)
        .eq("organization_id", organizationId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["companies"] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
  });
}
