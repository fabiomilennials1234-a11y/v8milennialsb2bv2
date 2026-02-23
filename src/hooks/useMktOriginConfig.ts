import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";
import { toast } from "sonner";

/** All possible lead origins in the system */
export const ALL_ORIGINS = [
  "whatsapp",
  "meta_ads",
  "site",
  "remarketing",
  "google_ads",
  "cal",
  "outro",
] as const;

export type LeadOrigin = (typeof ALL_ORIGINS)[number];

export const ORIGIN_LABELS: Record<LeadOrigin, string> = {
  whatsapp: "WhatsApp",
  meta_ads: "Meta Ads",
  site: "Site",
  remarketing: "Remarketing",
  google_ads: "Google Ads",
  cal: "Cal.com",
  outro: "Outro",
};

export const ORIGIN_COLORS: Record<LeadOrigin, string> = {
  whatsapp: "#25D366",
  meta_ads: "#1877F2",
  site: "#6366F1",
  remarketing: "#F59E0B",
  google_ads: "#EA4335",
  cal: "#292929",
  outro: "#64748B",
};

export interface MktOriginConfig {
  id: string;
  organization_id: string;
  origin: string;
  month: number;
  year: number;
  investimento_cents: number;
  show_leads: boolean;
  show_agendamentos: boolean;
  show_comparecimentos: boolean;
  show_propostas: boolean;
  show_vendas: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Fetch mkt_origin_config rows for a given month/year.
 * When month=0 (Geral), fetches ALL rows and sums investment per origin.
 * Returns a map origin -> config for convenience.
 */
export function useMktOriginConfigs(month: number, year: number) {
  const { organizationId, isReady } = useOrganization();
  const isGeral = month === 0;

  const query = useQuery({
    queryKey: ["mkt_origin_config", organizationId, month, year],
    queryFn: async () => {
      if (!organizationId) return [];

      if (isGeral) {
        // Geral: fetch ALL configs for this org
        const { data, error } = await supabase
          .from("mkt_origin_config")
          .select("*")
          .eq("organization_id", organizationId);
        if (error) throw error;
        return (data ?? []) as MktOriginConfig[];
      }

      const { data, error } = await supabase
        .from("mkt_origin_config")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("month", month)
        .eq("year", year);
      if (error) throw error;
      return (data ?? []) as MktOriginConfig[];
    },
    enabled: isReady && !!organizationId,
  });

  // Build configMap — when Geral, sum investment across all months/years per origin
  const configMap: Record<string, MktOriginConfig> = {};
  if (isGeral) {
    const rows = query.data ?? [];
    // Group by origin and sum
    const grouped: Record<string, MktOriginConfig[]> = {};
    rows.forEach((c) => {
      (grouped[c.origin] ??= []).push(c);
    });
    Object.entries(grouped).forEach(([origin, configs]) => {
      const totalCents = configs.reduce((s, c) => s + c.investimento_cents, 0);
      // Use most permissive visibility (if any month shows it, show it)
      configMap[origin] = {
        ...configs[0],
        investimento_cents: totalCents,
        show_leads: configs.some((c) => c.show_leads),
        show_agendamentos: configs.some((c) => c.show_agendamentos),
        show_comparecimentos: configs.some((c) => c.show_comparecimentos),
        show_propostas: configs.some((c) => c.show_propostas),
        show_vendas: configs.some((c) => c.show_vendas),
      };
    });
  } else {
    (query.data ?? []).forEach((c) => {
      configMap[c.origin] = c;
    });
  }

  return { ...query, configMap };
}

/**
 * Upsert a single origin config (investment + visibility toggles).
 * Uses the unique constraint (organization_id, origin, month, year).
 */
export function useUpsertMktOriginConfig() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (input: {
      origin: string;
      month: number;
      year: number;
      investimento_cents: number;
      show_leads: boolean;
      show_agendamentos: boolean;
      show_comparecimentos: boolean;
      show_propostas: boolean;
      show_vendas: boolean;
    }) => {
      if (!organizationId) throw new Error("Sem organização");

      const { data, error } = await supabase
        .from("mkt_origin_config")
        .upsert(
          {
            organization_id: organizationId,
            origin: input.origin,
            month: input.month,
            year: input.year,
            investimento_cents: input.investimento_cents,
            show_leads: input.show_leads,
            show_agendamentos: input.show_agendamentos,
            show_comparecimentos: input.show_comparecimentos,
            show_propostas: input.show_propostas,
            show_vendas: input.show_vendas,
          },
          { onConflict: "organization_id,origin,month,year" }
        )
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({
        queryKey: ["mkt_origin_config", organizationId, vars.month, vars.year],
      });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Erro ao salvar configuração");
    },
  });
}

/**
 * Batch upsert all 7 origins at once (used by the config modal).
 */
export function useBatchUpsertMktOriginConfig() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (inputs: Array<{
      origin: string;
      month: number;
      year: number;
      investimento_cents: number;
      show_leads: boolean;
      show_agendamentos: boolean;
      show_comparecimentos: boolean;
      show_propostas: boolean;
      show_vendas: boolean;
    }>) => {
      if (!organizationId) throw new Error("Sem organização");
      if (inputs.length === 0) return [];

      const rows = inputs.map((input) => ({
        organization_id: organizationId,
        origin: input.origin,
        month: input.month,
        year: input.year,
        investimento_cents: input.investimento_cents,
        show_leads: input.show_leads,
        show_agendamentos: input.show_agendamentos,
        show_comparecimentos: input.show_comparecimentos,
        show_propostas: input.show_propostas,
        show_vendas: input.show_vendas,
      }));

      const { data, error } = await supabase
        .from("mkt_origin_config")
        .upsert(rows, { onConflict: "organization_id,origin,month,year" })
        .select();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      if (vars.length > 0) {
        queryClient.invalidateQueries({
          queryKey: ["mkt_origin_config", organizationId, vars[0].month, vars[0].year],
        });
      }
    },
    onError: (err: Error) => {
      toast.error(err.message || "Erro ao salvar configurações");
    },
  });
}
