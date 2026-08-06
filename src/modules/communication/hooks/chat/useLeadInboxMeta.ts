/**
 * useLeadInboxMeta — enrichment do inbox: para os leads visíveis, resolve os
 * funis em que estão (+ etapa atual) e a qualificação (qualification_tier).
 *
 * Mesma filosofia do useLeadResponsibleMap: a conversa aponta pra um lead, e é o
 * LEAD que carrega funil/etapa/qualificação. Resolvemos só os lead_ids da lista
 * (bounded), sem migração de schema. Dados unificados vêm de `pipeline_entries`
 * (pipes de sistema + custom sincronizam pra lá), então um único `.in()` cobre
 * todos os funis. Lead pode estar em vários funis ao mesmo tempo.
 *
 * As consultas vão em LOTES (`selectInChunks`). A página do inbox chega a 1000
 * conversas quando há filtro ativo (`FILTERED_PAGE_LIMIT`), e um `.in()` com
 * 1000 uuids passa de 39 KB de URL — o gateway devolve 400 e o enriquecimento
 * sumia em silêncio, fazendo o filtro do cliente descartar a página inteira
 * (incidente Goletric Pinheiros, 2026-07-31).
 *
 * O hook devolve `status` junto do mapa: quem filtra por funil/etapa/qualificação
 * precisa distinguir "esse lead não está em funil nenhum" de "eu não sei ainda".
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  selectInChunks,
  IN_CHUNK_SIZE,
  IN_CHUNK_SIZE_FANOUT,
} from "@/shared/supabase/selectInChunks";
import type { EnrichmentStatus } from "@/modules/communication/lib/inboxEnrichment";

export interface LeadInboxMeta {
  qualificationTier: string | null;
  funnels: { pipelineId: string; stageKey: string }[];
}

export interface LeadInboxMetaResult {
  map: ReadonlyMap<string, LeadInboxMeta>;
  status: EnrichmentStatus;
}

const EMPTY: ReadonlyMap<string, LeadInboxMeta> = new Map();

export function useLeadInboxMeta(
  leadIds: string[],
  organizationId: string | null,
): LeadInboxMetaResult {
  // Chave estável: dedupa + ordena, pra não refetchar quando só muda a ordem.
  const sortedIds = useMemo(() => [...new Set(leadIds)].sort(), [leadIds]);

  // Sem org ou sem lead não há o que buscar — e "nada a buscar" é um resultado
  // conhecido, não um carregamento eterno.
  const vacuous = !organizationId || sortedIds.length === 0;

  const { data, isError } = useQuery({
    queryKey: ["lead-inbox-meta", organizationId, sortedIds],
    queryFn: async (): Promise<Map<string, LeadInboxMeta>> => {
      const [leads, entries] = await Promise.all([
        selectInChunks<{ id: string; qualification_tier: string | null }>(
          sortedIds,
          (chunk) =>
            supabase
              .from("leads")
              .select("id, qualification_tier")
              .eq("organization_id", organizationId as string)
              .in("id", chunk),
          IN_CHUNK_SIZE,
        ),
        selectInChunks<{ lead_id: string | null; pipeline_id: string; stage_key: string }>(
          sortedIds,
          (chunk) =>
            (supabase.from as any)("pipeline_entries")
              .select("lead_id, pipeline_id, stage_key")
              .eq("organization_id", organizationId as string)
              .in("lead_id", chunk),
          IN_CHUNK_SIZE_FANOUT,
        ),
      ]);

      const map = new Map<string, LeadInboxMeta>();
      const ensure = (id: string): LeadInboxMeta => {
        let m = map.get(id);
        if (!m) {
          m = { qualificationTier: null, funnels: [] };
          map.set(id, m);
        }
        return m;
      };

      for (const row of leads) {
        ensure(row.id).qualificationTier = row.qualification_tier ?? null;
      }
      for (const e of entries) {
        if (!e.lead_id) continue;
        ensure(e.lead_id).funnels.push({ pipelineId: e.pipeline_id, stageKey: e.stage_key });
      }
      return map;
    },
    enabled: !vacuous,
    staleTime: 60_000,
  });

  return useMemo(() => {
    // A ordem destes ramos importa:
    // 1. `vacuous` primeiro — query desabilitada nunca produz `data`, e sem isto
    //    uma página sem lead ficaria em "pending" pra sempre (skeleton eterno).
    // 2. `data !== undefined` antes de `isError` — refetch de background que
    //    falha tendo dado válido em cache não pode virar faixa de erro na tela.
    const status: EnrichmentStatus =
      vacuous || data !== undefined ? "ready" : isError ? "error" : "pending";
    return { map: vacuous ? EMPTY : data ?? EMPTY, status };
  }, [vacuous, data, isError]);
}
