import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";

export interface Deal {
  id: string;
  organization_id: string;
  title: string;
  value: number;
  currency: string;
  pipeline_id: string | null;
  stage_id: string | null;
  company_id: string | null;
  owner_id: string | null;
  source_lead_id: string | null;
  probability: number;
  expected_close_date: string | null;
  closed_at: string | null;
  won: boolean | null;
  loss_reason: string | null;
  loss_reason_id: string | null;
  notes: string | null;
  metadata: Record<string, unknown> | null;
  created_by: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  lead?: { id: string; name: string; phone: string | null } | null;
  company?: { id: string; name: string } | null;
  owner?: { id: string; name: string } | null;
  deal_items?: DealItemRow[];
}

export interface DealItemRow {
  id: string;
  deal_id: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit_price: number;
  discount_percent: number;
  total: number;
  sort_order: number;
  notes: string | null;
  organization_id: string;
  created_at: string;
}

export interface DealsFilter {
  status?: "all" | "open" | "won" | "lost";
  ownerId?: string;
  pipelineId?: string;
  productId?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  valueMin?: number;
  valueMax?: number;
}

export interface DealKPIs {
  forecastWeighted: number;
  expectedThisMonth: number;
  openCount: number;
  avgProbability: number;
  openValue: number;
  wonThisMonth: number;
  wonValueThisMonth: number;
  lostThisMonth: number;
}

export function useDeals(filters?: DealsFilter) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["deals", organizationId, filters],
    queryFn: async () => {
      if (!organizationId) return [];

      let query = supabase
        .from("deals")
        .select(`
          *,
          lead:leads!source_lead_id(id, name, phone),
          company:companies!company_id(id, name),
          owner:team_members!owner_id(id, name),
          deal_items(id, product_id, product_name, quantity, unit_price, discount_percent, total, sort_order)
        `)
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

      if (filters?.status === "open") query = query.is("won", null);
      if (filters?.status === "won") query = query.eq("won", true);
      if (filters?.status === "lost") query = query.eq("won", false);
      if (filters?.ownerId) query = query.eq("owner_id", filters.ownerId);
      if (filters?.pipelineId) query = query.eq("pipeline_id", filters.pipelineId);
      if (filters?.search) query = query.ilike("title", `%${filters.search}%`);
      if (filters?.valueMin) query = query.gte("value", filters.valueMin);
      if (filters?.valueMax) query = query.lte("value", filters.valueMax);
      if (filters?.dateFrom) query = query.gte("expected_close_date", filters.dateFrom);
      if (filters?.dateTo) query = query.lte("expected_close_date", filters.dateTo);

      const { data, error } = await query;
      if (error) throw error;

      if (filters?.productId && data) {
        return data.filter((d: any) =>
          d.deal_items?.some((item: any) => item.product_id === filters.productId)
        );
      }

      return (data ?? []) as Deal[];
    },
    enabled: isReady,
  });
}

export function useDealKPIs() {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["deals-kpis", organizationId],
    queryFn: async (): Promise<DealKPIs> => {
      if (!organizationId) {
        return { forecastWeighted: 0, expectedThisMonth: 0, openCount: 0, avgProbability: 0, openValue: 0, wonThisMonth: 0, wonValueThisMonth: 0, lostThisMonth: 0 };
      }

      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();

      const [openRes, wonRes, lostRes] = await Promise.all([
        supabase
          .from("deals")
          .select("value, probability, expected_close_date")
          .eq("organization_id", organizationId)
          .is("won", null)
          .is("deleted_at", null),
        supabase
          .from("deals")
          .select("value")
          .eq("organization_id", organizationId)
          .eq("won", true)
          .is("deleted_at", null)
          .gte("closed_at", monthStart)
          .lte("closed_at", monthEnd),
        supabase
          .from("deals")
          .select("id")
          .eq("organization_id", organizationId)
          .eq("won", false)
          .is("deleted_at", null)
          .gte("closed_at", monthStart)
          .lte("closed_at", monthEnd),
      ]);

      const open = openRes.data ?? [];
      const won = wonRes.data ?? [];
      const lost = lostRes.data ?? [];

      const forecastWeighted = open.reduce((sum, d) => sum + (d.value ?? 0) * ((d.probability ?? 0) / 100), 0);
      const expectedThisMonth = open
        .filter((d) => d.expected_close_date && d.expected_close_date >= monthStart && d.expected_close_date <= monthEnd)
        .reduce((sum, d) => sum + (d.value ?? 0), 0);
      const openValue = open.reduce((sum, d) => sum + (d.value ?? 0), 0);
      const avgProbability = open.length > 0
        ? open.reduce((sum, d) => sum + (d.probability ?? 0), 0) / open.length
        : 0;

      return {
        forecastWeighted,
        expectedThisMonth,
        openCount: open.length,
        avgProbability: Math.round(avgProbability),
        openValue,
        wonThisMonth: won.length,
        wonValueThisMonth: won.reduce((sum, d) => sum + (d.value ?? 0), 0),
        lostThisMonth: lost.length,
      };
    },
    enabled: isReady,
  });
}

export function useDeal(dealId: string | null) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["deal", dealId],
    queryFn: async () => {
      if (!dealId || !organizationId) return null;

      const { data, error } = await supabase
        .from("deals")
        .select(`
          *,
          lead:leads!source_lead_id(id, name, phone),
          company:companies!company_id(id, name),
          owner:team_members!owner_id(id, name),
          deal_items(*)
        `)
        .eq("id", dealId)
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .single();

      if (error) throw error;
      return data as Deal;
    },
    enabled: isReady && !!dealId,
  });
}

export type DealInsert = {
  title: string;
  value?: number;
  pipeline_id?: string;
  stage_id?: string;
  company_id?: string | null;
  owner_id?: string | null;
  source_lead_id?: string | null;
  probability?: number;
  expected_close_date?: string | null;
  notes?: string | null;
  organization_id: string;
};

export function useCreateDeal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (deal: DealInsert) => {
      const { data, error } = await supabase
        .from("deals")
        .insert({ ...deal, value: deal.value ?? 0, probability: deal.probability ?? 50 })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deals"] });
      queryClient.invalidateQueries({ queryKey: ["deals-kpis"] });
      toast.success("Negócio criado");
    },
    onError: (error: Error) => {
      toast.error(`Erro ao criar negócio: ${error.message}`);
    },
  });
}

export function useUpdateDeal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Deal> & { id: string }) => {
      const { data, error } = await supabase
        .from("deals")
        .update({ ...updates, updated_at: new Date().toISOString() } as any)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["deals"] });
      queryClient.invalidateQueries({ queryKey: ["deal", variables.id] });
      queryClient.invalidateQueries({ queryKey: ["deals-kpis"] });
    },
    onError: (error: Error) => {
      toast.error(`Erro ao atualizar negócio: ${error.message}`);
    },
  });
}

export function useDeleteDeal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (dealId: string) => {
      const { error } = await supabase
        .from("deals")
        .update({ deleted_at: new Date().toISOString() } as any)
        .eq("id", dealId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["deals"] });
      queryClient.invalidateQueries({ queryKey: ["deals-kpis"] });
      toast.success("Negócio removido");
    },
  });
}

export function useMarkDealWon() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (dealId: string) => {
      const { data, error } = await supabase
        .from("deals")
        .update({ won: true, closed_at: new Date().toISOString() } as any)
        .eq("id", dealId)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, dealId) => {
      queryClient.invalidateQueries({ queryKey: ["deals"] });
      queryClient.invalidateQueries({ queryKey: ["deal", dealId] });
      queryClient.invalidateQueries({ queryKey: ["deals-kpis"] });
      queryClient.invalidateQueries({ queryKey: ["lead-products"] });
      toast.success("Negócio ganho!");
    },
  });
}

export function useMarkDealLost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ dealId, reason }: { dealId: string; reason?: string }) => {
      const { data, error } = await supabase
        .from("deals")
        .update({ won: false, closed_at: new Date().toISOString(), loss_reason: reason ?? null } as any)
        .eq("id", dealId)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, { dealId }) => {
      queryClient.invalidateQueries({ queryKey: ["deals"] });
      queryClient.invalidateQueries({ queryKey: ["deal", dealId] });
      queryClient.invalidateQueries({ queryKey: ["deals-kpis"] });
      toast.success("Negócio perdido registrado");
    },
  });
}
