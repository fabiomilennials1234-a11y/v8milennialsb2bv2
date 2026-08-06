import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";

export interface UseOrgCustomFieldValuesResult {
  values: string[];
  isLoading: boolean;
}

/**
 * Lista, read-only, os valores distintos que JÁ existem nos leads da org para um
 * campo personalizado (`lead_custom_fields.id`). Alimenta o combobox creatable
 * do node de condição.
 *
 * Existe pelo mesmo motivo de `useOrgUtmValues`: o valor gravado não é o que o
 * humano digitaria. Formulário slugifica a resposta — "Barril de Chopp" vira
 * `barril_de_chopp`, "Ainda não sei" vira `ainda_não_sei` (underscore + acento
 * preservado). Quem digita "Barril" com `equals` monta uma condição que nunca é
 * verdadeira, e falha em silêncio: o avaliador devolve `""` e todo lead desce
 * pela saída "Não".
 *
 * Recebe o **id** (não o nome) porque o painel já tem o catálogo em mãos —
 * evita uma segunda ida ao banco só pra resolver nome → id.
 *
 * Postgrest não tem DISTINCT direto: puxamos até 1000 linhas não-nulas /
 * não-vazias e deduplicamos + ordenamos no client (localeCompare pt-BR).
 *
 * A RLS de `lead_custom_field_values` é escopada por lead (org + responsável),
 * então um membro sem `view_all` vê o subconjunto dos leads dele — sugestão
 * parcial, nunca vazamento cross-org.
 *
 * org vem de `useOrganization` (NÃO de `useAuth` — `useAuth` não expõe
 * `organizationId`, o que desabilitaria a query silenciosamente).
 */
export function useOrgCustomFieldValues(
  fieldId: string | undefined | null,
): UseOrgCustomFieldValuesResult {
  const { organizationId, isReady } = useOrganization();
  const enabled = isReady && !!organizationId && !!fieldId;

  const query = useQuery({
    queryKey: ["org-custom-field-values", fieldId, organizationId],
    queryFn: async () => {
      if (!fieldId) return [];

      const { data, error } = await supabase
        .from("lead_custom_field_values")
        .select("value")
        .eq("field_id", fieldId)
        .not("value", "is", null)
        .neq("value", "")
        .limit(1000);

      if (error) throw error;

      const seen = new Set<string>();
      for (const row of (data ?? []) as Array<{ value: string | null }>) {
        const raw = row?.value;
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
