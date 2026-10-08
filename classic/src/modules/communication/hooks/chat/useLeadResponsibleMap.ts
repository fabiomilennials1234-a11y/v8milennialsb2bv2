/**
 * useLeadResponsibleMap — mapa lead_id → responsible_id (o "vendedor" do lead).
 *
 * A conversa do chat não carrega um vínculo próprio de vendedor: ela aponta pra
 * um lead (`ChatContact.lead_id`), e é o LEAD que tem o responsável
 * (`leads.responsible_id`, FK → team_members.id). Este hook resolve esse mapa
 * para os leads atualmente visíveis na lista, para que o filtro "por vendedor"
 * possa decidir a quem cada conversa pertence — sem migração de schema.
 *
 * Recebe só os lead_ids presentes na lista, mas isso NÃO é mais um teto pequeno:
 * com filtro ativo a página do inbox vai a 1000 conversas (`FILTERED_PAGE_LIMIT`)
 * e um `.in()` com 1000 uuids passa de 39 KB de URL — o gateway devolve 400.
 * Por isso a consulta vai em lotes (`selectInChunks`). O comentário anterior
 * ("o `.in()` é pequeno") virou mentira quando o limite subiu de 500 pra 1000, e
 * essa mentira custou o chamado da Goletric Pinheiros (2026-07-31).
 *
 * Devolve `status` junto do mapa: um mapa vazio por FALHA é indistinguível de um
 * mapa vazio por "ninguém tem responsável" — e a diferença inverte o resultado
 * do filtro (`vendor: "unassigned"` casaria todo mundo).
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { selectInChunks, IN_CHUNK_SIZE } from "@/shared/supabase/selectInChunks";
import type { EnrichmentStatus } from "@/modules/communication/lib/inboxEnrichment";

export interface LeadResponsibleMapResult {
  map: ReadonlyMap<string, string | null>;
  status: EnrichmentStatus;
}

const EMPTY: ReadonlyMap<string, string | null> = new Map();

/**
 * @param leadIds  IDs dos leads visíveis (derivados dos contatos da lista).
 * @param organizationId  org atual (multi-tenancy).
 */
export function useLeadResponsibleMap(
  leadIds: string[],
  organizationId: string | null,
): LeadResponsibleMapResult {
  // Chave estável: dedupa + ordena, pra não refetchar quando só muda a ordem.
  const sortedIds = useMemo(() => [...new Set(leadIds)].sort(), [leadIds]);

  const vacuous = !organizationId || sortedIds.length === 0;

  const { data, isError } = useQuery({
    queryKey: ["lead-responsible-map", organizationId, sortedIds],
    queryFn: async (): Promise<Map<string, string | null>> => {
      const rows = await selectInChunks<{ id: string; responsible_id: string | null }>(
        sortedIds,
        (chunk) =>
          supabase
            .from("leads")
            .select("id, responsible_id")
            .eq("organization_id", organizationId as string)
            .in("id", chunk),
        IN_CHUNK_SIZE,
      );

      const map = new Map<string, string | null>();
      for (const row of rows) map.set(row.id, row.responsible_id ?? null);
      return map;
    },
    enabled: !vacuous,
    staleTime: 60_000,
  });

  return useMemo(() => {
    // Mesma ordem de ramos do useLeadInboxMeta — ver o comentário de lá.
    const status: EnrichmentStatus =
      vacuous || data !== undefined ? "ready" : isError ? "error" : "pending";
    return { map: vacuous ? EMPTY : data ?? EMPTY, status };
  }, [vacuous, data, isError]);
}
