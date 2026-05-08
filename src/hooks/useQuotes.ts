import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export type QuoteStatus = "draft" | "sent" | "accepted" | "rejected" | "expired";

export interface Quote {
  id: string;
  deal_id: string;
  version: number;
  status: QuoteStatus;
  title: string | null;
  subtotal: number;
  discount_percent: number;
  tax_percent: number;
  total: number;
  currency: string;
  valid_until: string | null;
  terms: string | null;
  items: unknown[];
  pdf_url: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  created_at: string;
}

export function useQuotes(dealId: string | null) {
  return useQuery<Quote[]>({
    queryKey: ["quotes", dealId],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("quotes")
        .select("*")
        .eq("deal_id", dealId!)
        .order("version", { ascending: false });
      if (error) throw error;
      return data as Quote[];
    },
    enabled: !!dealId,
  });
}

export function useCreateQuote() {
  const queryClient = useQueryClient();
  const { organization } = useOrganization();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: {
      deal_id: string;
      title?: string;
      items: unknown[];
      subtotal: number;
      discount_percent?: number;
      tax_percent?: number;
      total: number;
      terms?: string;
      valid_until?: string;
    }) => {
      const { data: latest } = await (supabase.from as any)("quotes")
        .select("version")
        .eq("deal_id", input.deal_id)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();

      const nextVersion = (latest?.version ?? 0) + 1;

      const { data, error } = await (supabase.from as any)("quotes")
        .insert({
          organization_id: organization!.id,
          deal_id: input.deal_id,
          version: nextVersion,
          title: input.title ?? `Proposta v${nextVersion}`,
          items: input.items,
          subtotal: input.subtotal,
          discount_percent: input.discount_percent ?? 0,
          tax_percent: input.tax_percent ?? 0,
          total: input.total,
          terms: input.terms ?? null,
          valid_until: input.valid_until ?? null,
          created_by: user!.id,
        })
        .select("id, version")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data, vars) => {
      toast.success(`Proposta v${data.version} criada`);
      queryClient.invalidateQueries({ queryKey: ["quotes", vars.deal_id] });
    },
  });
}

export function useUpdateQuoteStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, deal_id, status, reason }: {
      id: string;
      deal_id: string;
      status: QuoteStatus;
      reason?: string;
    }) => {
      const updates: Record<string, unknown> = {
        status,
        updated_at: new Date().toISOString(),
      };
      if (status === "sent") updates.sent_at = new Date().toISOString();
      if (status === "accepted") updates.accepted_at = new Date().toISOString();
      if (status === "rejected") {
        updates.rejected_at = new Date().toISOString();
        updates.rejection_reason = reason ?? null;
      }

      const { error } = await (supabase.from as any)("quotes").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["quotes", vars.deal_id] });
    },
  });
}
