import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeSubscription } from "./useRealtimeSubscription";
import { useOrganization } from "./useOrganization";

export interface Deal {
  id: string;
  organization_id: string;
  title: string;
  value: number | null;
  currency: string;
  pipeline_id: string | null;
  stage_id: string | null;
  company_id: string | null;
  owner_id: string | null;
  source_lead_id: string | null;
  probability: number | null;
  expected_close_date: string | null;
  closed_at: string | null;
  won: boolean | null;
  loss_reason: string | null;
  loss_reason_id: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  created_at: string;
  updated_at: string;
}

export type DealInsert = Omit<Deal, "id" | "organization_id" | "created_at" | "updated_at" | "deleted_at" | "deleted_by">;
export type DealUpdate = Partial<DealInsert>;

export interface DealContact {
  id: string;
  deal_id: string;
  contact_id: string;
  role: string;
  is_primary: boolean;
  created_at: string;
}

interface DealsFilters {
  won?: boolean | null;
  companyId?: string;
  ownerId?: string;
  stageId?: string;
}

const STALE_TIME = 2 * 60_000;

export function useDeals(filters?: DealsFilters) {
  const { organizationId } = useOrganization();

  useRealtimeSubscription("deals", ["deals"]);

  return useQuery({
    queryKey: ["deals", organizationId, filters],
    queryFn: async () => {
      if (!organizationId) return [] as Deal[];

      let query = (supabase.from as any)("deals")
        .select("*")
        .eq("organization_id", organizationId)
        .is("deleted_at", null);

      if (filters?.won === true) {
        query = query.eq("won", true);
      } else if (filters?.won === false) {
        query = query.eq("won", false);
      }

      if (filters?.companyId) {
        query = query.eq("company_id", filters.companyId);
      }
      if (filters?.ownerId) {
        query = query.eq("owner_id", filters.ownerId);
      }
      if (filters?.stageId) {
        query = query.eq("stage_id", filters.stageId);
      }

      const { data, error } = await query.order("created_at", { ascending: false });

      if (error) throw error;
      return data as Deal[];
    },
    enabled: !!organizationId,
    staleTime: STALE_TIME,
  });
}

export function useDeal(id: string | undefined) {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ["deals", organizationId, id],
    queryFn: async () => {
      if (!organizationId || !id) return null;

      const { data, error } = await (supabase.from as any)("deals")
        .select("*")
        .eq("id", id)
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .single();

      if (error) throw error;
      return data as Deal;
    },
    enabled: !!organizationId && !!id,
    staleTime: STALE_TIME,
  });
}

export function useCreateDeal() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (deal: DealInsert) => {
      if (!organizationId) {
        throw new Error("Cannot create deal: No organization context");
      }

      const { data, error } = await (supabase.from as any)("deals")
        .insert({ ...deal, organization_id: organizationId })
        .select()
        .single();

      if (error) throw error;
      return data as Deal;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deals"] });
    },
  });
}

export function useUpdateDeal() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async ({ id, ...updates }: DealUpdate & { id: string }) => {
      if (!organizationId) {
        throw new Error("Cannot update deal: No organization context");
      }

      const { organization_id: _, ...safeUpdates } = updates as DealUpdate & { organization_id?: string };

      const { data, error } = await (supabase.from as any)("deals")
        .update(safeUpdates)
        .eq("id", id)
        .eq("organization_id", organizationId)
        .select()
        .single();

      if (error) throw error;
      return data as Deal;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deals"] });
    },
  });
}

export function useDeleteDeal() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async ({ id, userId }: { id: string; userId: string }) => {
      if (!organizationId) {
        throw new Error("Cannot delete deal: No organization context");
      }

      const { data, error } = await (supabase.from as any)("deals")
        .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
        .eq("id", id)
        .eq("organization_id", organizationId)
        .select()
        .single();

      if (error) throw error;
      return data as Deal;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deals"] });
    },
  });
}

export function useDealContacts(dealId: string | undefined) {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ["deal_contacts", organizationId, dealId],
    queryFn: async () => {
      if (!dealId) return [] as DealContact[];

      const { data, error } = await (supabase.from as any)("deal_contacts")
        .select("*")
        .eq("deal_id", dealId);

      if (error) throw error;
      return data as DealContact[];
    },
    enabled: !!organizationId && !!dealId,
    staleTime: STALE_TIME,
  });
}

export function useAddDealContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      dealId,
      contactId,
      role = "contact",
      isPrimary = false,
    }: {
      dealId: string;
      contactId: string;
      role?: string;
      isPrimary?: boolean;
    }) => {
      const { data, error } = await (supabase.from as any)("deal_contacts")
        .insert({
          deal_id: dealId,
          contact_id: contactId,
          role,
          is_primary: isPrimary,
        })
        .select()
        .single();

      if (error) throw error;
      return data as DealContact;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deal_contacts"] });
    },
  });
}

export function useRemoveDealContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from as any)("deal_contacts")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deal_contacts"] });
    },
  });
}
