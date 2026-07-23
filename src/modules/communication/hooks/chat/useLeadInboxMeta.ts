/**
 * useLeadInboxMeta — enrichment do inbox: para os leads visíveis, resolve os
 * funis em que estão (+ etapa atual) e a qualificação (qualification_tier).
 *
 * Mesma filosofia do useLeadResponsibleMap: a conversa aponta pra um lead, e é o
 * LEAD que carrega funil/etapa/qualificação. Resolvemos só os lead_ids da lista
 * (bounded), sem migração de schema. Dados unificados vêm de `pipeline_entries`
 * (pipes de sistema + custom sincronizam pra lá), então um único `.in()` cobre
 * todos os funis. Lead pode estar em vários funis ao mesmo tempo.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface LeadInboxMeta {
  qualificationTier: string | null;
  funnels: { pipelineId: string; stageKey: string }[];
}

const EMPTY = new Map<string, LeadInboxMeta>();

export function useLeadInboxMeta(leadIds: string[], organizationId: string | null) {
  // Chave estável: ordena os ids pra não refetchar quando só muda a ordem.
  const sortedIds = [...leadIds].sort();

  const { data } = useQuery({
    queryKey: ["lead-inbox-meta", organizationId, sortedIds],
    queryFn: async (): Promise<Map<string, LeadInboxMeta>> => {
      if (!organizationId || sortedIds.length === 0) return EMPTY;

      const [{ data: leads, error: leadsErr }, { data: entries, error: entriesErr }] =
        await Promise.all([
          supabase
            .from("leads")
            .select("id, qualification_tier")
            .eq("organization_id", organizationId)
            .in("id", sortedIds),
          (supabase.from as any)("pipeline_entries")
            .select("lead_id, pipeline_id, stage_key")
            .eq("organization_id", organizationId)
            .in("lead_id", sortedIds),
        ]);

      if (leadsErr) throw leadsErr;
      if (entriesErr) throw entriesErr;

      const map = new Map<string, LeadInboxMeta>();
      const ensure = (id: string): LeadInboxMeta => {
        let m = map.get(id);
        if (!m) {
          m = { qualificationTier: null, funnels: [] };
          map.set(id, m);
        }
        return m;
      };

      for (const row of leads ?? []) {
        ensure(row.id as string).qualificationTier =
          (row.qualification_tier as string | null) ?? null;
      }
      for (const e of (entries ?? []) as {
        lead_id: string | null;
        pipeline_id: string;
        stage_key: string;
      }[]) {
        if (!e.lead_id) continue;
        ensure(e.lead_id).funnels.push({ pipelineId: e.pipeline_id, stageKey: e.stage_key });
      }
      return map;
    },
    enabled: !!organizationId && sortedIds.length > 0,
    staleTime: 60_000,
  });

  return data ?? EMPTY;
}
