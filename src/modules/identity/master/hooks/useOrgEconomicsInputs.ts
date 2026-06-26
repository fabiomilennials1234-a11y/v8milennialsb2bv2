import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Leitura/escrita dos pressupostos de unit economics por org+cenário
 * (tabela `org_unit_economics_inputs`). A RLS master-only protege o acesso —
 * só master lê/escreve; não-master é deny-all no banco.
 *
 * Autosave-friendly: o debounce fica na UI; aqui o save é um upsert idempotente
 * na PK composta (organization_id, scenario).
 */
export type EconomicsScenario = "dados" | "projecao";

export interface OrgEconomicsInputs {
  organization_id: string;
  scenario: EconomicsScenario;
  anuncios: number;
  embalagem: number;
  frete: number;
  imposto_pct: number;
  admin_pct: number;
  comissao_pct: number;
  recompras: number;
  meta_num_vendas: number | null;
  meta_ticket_medio: number | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Payload de save: chaves obrigatórias + campos editáveis opcionais. */
export type OrgEconomicsInputsUpsert = {
  organization_id: string;
  scenario: EconomicsScenario;
} & Partial<
  Pick<
    OrgEconomicsInputs,
    | "anuncios"
    | "embalagem"
    | "frete"
    | "imposto_pct"
    | "admin_pct"
    | "comissao_pct"
    | "recompras"
    | "meta_num_vendas"
    | "meta_ticket_medio"
  >
>;

export function useOrgEconomicsInputs(
  orgId: string | undefined,
  scenario: EconomicsScenario,
) {
  return useQuery({
    queryKey: ["master-org-economics-inputs", orgId, scenario],
    queryFn: async (): Promise<OrgEconomicsInputs | null> => {
      // Tabela ainda não está nos types gerados (migration não aplicada) → cast.
      const { data, error } = await supabase
        .from("org_unit_economics_inputs" as any)
        .select("*")
        .eq("organization_id", orgId!)
        .eq("scenario", scenario)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as OrgEconomicsInputs | null;
    },
    enabled: !!orgId && !!scenario,
    staleTime: 30_000,
  });
}

export function useSaveOrgEconomicsInputs() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      input: OrgEconomicsInputsUpsert,
    ): Promise<OrgEconomicsInputs> => {
      const { data, error } = await supabase
        .from("org_unit_economics_inputs" as any)
        .upsert(
          { ...input, updated_at: new Date().toISOString() } as any,
          { onConflict: "organization_id,scenario" },
        )
        .select()
        .single();
      if (error) throw error;
      return data as unknown as OrgEconomicsInputs;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: [
          "master-org-economics-inputs",
          data.organization_id,
          data.scenario,
        ],
      });
    },
  });
}
