/**
 * Ids dos números da organização reservados à cobrança
 * (`whatsapp_instances.reserved_for = 'collections'`, ADR-0040).
 *
 * O chat usa isto só para SINALIZAR a conversa ("Cobrança") — o isolamento de
 * verdade (sem vínculo com lead, sem copilot) acontece no banco e na edge.
 *
 * Consulta própria e tolerante, de propósito fora de `useWhatsAppInstancesForUser`:
 * aquele select alimenta o chat inteiro, e pedir uma coluna que ainda não foi
 * migrada derrubaria a lista para todo mundo. Aqui o erro vira "nenhum número
 * reservado" — sem selo, e nada mais muda.
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";

const VAZIO: ReadonlySet<string> = new Set();

export function useNumerosDaCobranca(): ReadonlySet<string> {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id ?? null;
  const { data } = useQuery({
    queryKey: ["whatsapp_instances_da_cobranca", organizationId],
    enabled: !!organizationId,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      const { data: linhas, error } = await supabase
        .from("whatsapp_instances")
        .select("id")
        .eq("organization_id", organizationId as string)
        .eq("reserved_for", "collections");
      if (error) return [] as string[];
      return (linhas ?? []).map((l) => l.id);
    },
  });
  return useMemo(() => (data?.length ? new Set(data) : VAZIO), [data]);
}
