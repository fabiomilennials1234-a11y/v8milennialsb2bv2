import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";

/**
 * O contexto do lead em foco no cartão de ouro do Comando: em que etapa ele
 * está e como está qualificado. Uma consulta por lead SELECIONADO (não por
 * linha da fila) — a fila continua leve.
 *
 * Etapa: o negócio aberto mais recente do lead, lido de `negocio_projetado`
 * com o mesmo embed que a ficha do lead já usa (`useLeadDetail`). Lead pode
 * estar em vários funis; o cartão mostra o que mexeu por último e diz qual é
 * o funil, em vez de fingir que só existe um.
 */
export interface FocoDoLead {
  etapa: string | null;
  funil: string | null;
  /** `qualification_tier` do lead — chave de `QUALIFICATION_TIER_CONFIG`. */
  qualificacao: string | null;
  empresa: string | null;
}

interface NegocioProjetado {
  closed_at?: string | null;
  stage_changed_at?: string | null;
  entered_at?: string | null;
  updated_at?: string | null;
  stage?: { name?: string | null } | null;
  pipeline?: { name?: string | null; is_active?: boolean | null } | null;
}

function quando(n: NegocioProjetado) {
  return new Date(n.stage_changed_at ?? n.updated_at ?? n.entered_at ?? 0).getTime();
}

export function useFocoDoLead(leadId: string | null | undefined) {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ["comando-foco-lead", organizationId, leadId],
    enabled: !!organizationId && !!leadId,
    staleTime: 60_000,
    queryFn: async (): Promise<FocoDoLead> => {
      const [lead, negocios] = await Promise.all([
        supabase.from("leads").select("qualification_tier, company").eq("id", leadId!).maybeSingle(),
        supabase
          .from("negocio_projetado")
          .select("*, stage:pipeline_stages(name), pipeline:pipelines(name, is_active)")
          .eq("lead_id", leadId!),
      ]);
      if (lead.error) throw lead.error;
      if (negocios.error) throw negocios.error;

      const abertos = ((negocios.data ?? []) as unknown as NegocioProjetado[])
        .filter((n) => !n.closed_at && n.pipeline?.is_active !== false)
        .sort((a, b) => quando(b) - quando(a));
      const atual = abertos[0];

      return {
        etapa: atual?.stage?.name ?? null,
        funil: atual?.pipeline?.name ?? null,
        qualificacao: (lead.data?.qualification_tier as string | null | undefined) ?? null,
        empresa: (lead.data?.company as string | null | undefined) ?? null,
      };
    },
  });
}
