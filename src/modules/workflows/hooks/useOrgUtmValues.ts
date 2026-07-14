import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";

/**
 * Campos UTM da tabela `leads` cujos valores distintos podem ser sugeridos no
 * node de condição das automações. É uma allowlist ESTRITA: só estes 5 nomes
 * podem virar coluna no `.select()`, evitando injeção de coluna arbitrária a
 * partir de `data.field` (que carrega valores livres como `custom.<x>`).
 */
export const UTM_VALUE_FIELDS = new Set<string>([
  "utm_campaign",
  "utm_source",
  "utm_medium",
  "utm_content",
  "utm_term",
]);

/** True se `field` é um dos campos UTM sugeríveis. */
export function isUtmValueField(field: string | undefined | null): boolean {
  return !!field && UTM_VALUE_FIELDS.has(field);
}

export interface UseOrgUtmValuesResult {
  values: string[];
  isLoading: boolean;
}

/**
 * Lista, read-only, os valores UTM distintos que JÁ existem nos leads da org
 * logada para um dado campo (`utm_campaign`, `utm_source`, ...). Alimenta o
 * combobox creatable do node de condição — o usuário escolhe um valor real
 * (evita errar acento/colchete/pontuação em valores vindos do Meta, ex.:
 * `[TESTE CRIATIVOS] BATERIA.`) mas ainda pode digitar valor livre.
 *
 * Postgrest não tem DISTINCT direto: puxamos até 1000 linhas não-nulas /
 * não-vazias e deduplicamos + ordenamos no client (localeCompare pt-BR).
 *
 * org vem de `useOrganization` (NÃO de `useAuth` — `useAuth` não expõe
 * `organizationId`, o que desabilitaria a query silenciosamente).
 */
export function useOrgUtmValues(field: string | undefined | null): UseOrgUtmValuesResult {
  const { organizationId, isReady } = useOrganization();
  const enabled = isReady && !!organizationId && isUtmValueField(field);

  const query = useQuery({
    queryKey: ["org-utm-values", field, organizationId],
    queryFn: async () => {
      // Guard extra: só chega aqui com field na allowlist (enabled), mas
      // reafirmamos antes de interpolar o nome da coluna no select.
      if (!organizationId || !field || !UTM_VALUE_FIELDS.has(field)) return [];

      const { data, error } = await supabase
        .from("leads")
        .select(field)
        .eq("organization_id", organizationId)
        .not(field, "is", null)
        .neq(field, "")
        .limit(1000);

      if (error) throw error;

      const seen = new Set<string>();
      // `.select(<dynamic string>)` loses the row type — cast through unknown.
      for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) {
        const raw = row?.[field];
        if (typeof raw === "string" && raw.trim() !== "") seen.add(raw);
      }

      return Array.from(seen).sort((a, b) =>
        a.localeCompare(b, "pt-BR", { sensitivity: "base" }),
      );
    },
    enabled,
    staleTime: 60_000,
  });

  return {
    values: query.data ?? [],
    isLoading: enabled && query.isLoading,
  };
}
