import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
export interface DuplicateGroup {
  lead_a_id: string;
  lead_a_name: string;
  lead_a_phone: string | null;
  lead_a_email: string | null;
  lead_a_company: string | null;
  lead_b_id: string;
  lead_b_name: string;
  lead_b_phone: string | null;
  lead_b_email: string | null;
  lead_b_company: string | null;
  match_type: "phone" | "email" | "name" | string;
  similarity: number;
}

// Args das RPCs (migration 20260722184420_duplicate_leads_rpcs.sql).
interface FindDuplicateLeadsArgs {
  p_organization_id: string;
}
interface MergeLeadsArgs {
  p_keep_lead_id: string;
  p_merge_lead_id: string;
}

// `find_duplicate_leads` e `merge_leads` aplicadas em prod (migration
// 20260722184420) e presentes em types.ts (regenerado) — RPCs tipadas.

export function useDuplicateLeads() {
  const { organizationId } = useOrganization();
  return useQuery({
    queryKey: ["duplicate_leads", organizationId],
    queryFn: async (): Promise<DuplicateGroup[]> => {
      // org validada server-side (assert_org_access) — "frontend nunca envia
      // org" = não CONFIAR nela; aqui é enviada E validada na RPC.
      const args: FindDuplicateLeadsArgs = { p_organization_id: organizationId! };
      const { data, error } = await supabase.rpc("find_duplicate_leads", args);
      if (error) throw error;
      return (data ?? []) as DuplicateGroup[];
    },
    enabled: !!organizationId,
  });
}

export function useMergeLeads() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: { keep_id: string; merge_id: string }) => {
      const args: MergeLeadsArgs = {
        p_keep_lead_id: params.keep_id,
        p_merge_lead_id: params.merge_id,
      };
      const { error } = await supabase.rpc("merge_leads", args);
      if (error) throw error;
    },
    onSuccess: () => {
      // O merge re-aponta pipeline_entries / custom_pipe_entries do lead
      // absorvido → o card dele precisa sumir do kanban (board + contadores).
      const keys = [
        "duplicate_leads",
        "leads",
        "pipeline-page",
        "pipeline-stage-counts",
        "pipeline_entries",
        "custom_pipe_entries",
        "custom_pipe_stage_counts",
      ];
      keys.forEach((key) => qc.invalidateQueries({ queryKey: [key] }));
    },
  });
}

/** O que a comparação campo a campo do par mostra — só colunas que o lead já tem. */
export interface DuplicatePairLead {
  id: string;
  uf: string | null;
  origin: string | null;
  qualification_tier: string | null;
  created_at: string;
  responsible: string | null;
  tags: string[];
}

/**
 * Detalhe do par em foco na tela de Duplicatas — UMA leitura dos dois leads
 * (`in`), só quando há par selecionado. Escopo pela org + RLS.
 */
export function useDuplicatePairDetail(ids: [string, string] | null) {
  const { organizationId } = useOrganization();
  return useQuery({
    queryKey: ["duplicate_pair_detail", organizationId, ids?.[0], ids?.[1]],
    queryFn: async (): Promise<Record<string, DuplicatePairLead>> => {
      const { data, error } = await supabase
        .from("leads")
        .select(`
          id, uf, origin, qualification_tier, created_at,
          responsible:team_members!leads_responsible_id_fkey(name),
          pre_sale_responsible:team_members!leads_pre_sale_responsible_id_fkey(name),
          sale_responsible:team_members!leads_sale_responsible_id_fkey(name),
          lead_tags(tag:tags(name))
        `)
        .eq("organization_id", organizationId!)
        .in("id", ids!);
      if (error) throw error;
      const out: Record<string, DuplicatePairLead> = {};
      for (const row of (data ?? []) as unknown as Array<{
        id: string;
        uf: string | null;
        origin: string | null;
        qualification_tier: string | null;
        created_at: string;
        responsible: { name: string | null } | null;
        pre_sale_responsible: { name: string | null } | null;
        sale_responsible: { name: string | null } | null;
        lead_tags: { tag: { name: string | null } | null }[] | null;
      }>) {
        out[row.id] = {
          id: row.id,
          uf: row.uf,
          origin: row.origin,
          qualification_tier: row.qualification_tier,
          created_at: row.created_at,
          // Mesma precedência da coluna "Dono da conta" da lista de Leads.
          responsible: row.sale_responsible?.name ?? row.pre_sale_responsible?.name ?? row.responsible?.name ?? null,
          tags: (row.lead_tags ?? []).map((t) => t.tag?.name).filter((n): n is string => !!n),
        };
      }
      return out;
    },
    enabled: !!organizationId && !!ids,
    staleTime: 30_000,
  });
}
