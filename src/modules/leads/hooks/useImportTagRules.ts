/**
 * Mapa coluna→etiqueta da importação, lembrado por org (`import_tag_rules`).
 *
 * Só conveniência de quem importa: a edge não lê a tabela. As etiquetas de cada linha
 * vão no corpo do import e passam pela validação de etiqueta da org lá.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { foldValue, type SavedTagRule, type ValueTagMap } from "../lib/import-tag-rules";

const KEY = "import_tag_rules";

export function useImportTagRules(enabled: boolean) {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: [KEY, organizationId],
    enabled: enabled && !!organizationId,
    staleTime: 60_000,
    queryFn: async (): Promise<SavedTagRule[]> => {
      const { data, error } = await supabase
        .from("import_tag_rules")
        .select("source_column, source_value, tag_id")
        .eq("organization_id", organizationId!);
      if (error) throw error;
      return data ?? [];
    },
  });

  /**
   * Grava o mapa de UMA coluna: valor com etiqueta vira linha (upsert); valor sem
   * etiqueta apaga a linha que houver. Os outros valores e colunas ficam.
   */
  const save = useMutation({
    mutationFn: async ({ column, values, map }: { column: string; values: string[]; map: ValueTagMap }) => {
      if (!organizationId) return;
      const col = foldValue(column);
      const keys = [...new Set(values.map(foldValue).filter(Boolean))];
      const withTag = keys.filter((k) => map[k]);
      const withoutTag = keys.filter((k) => !map[k]);

      if (withTag.length > 0) {
        const { error } = await supabase.from("import_tag_rules").upsert(
          withTag.map((k) => ({
            organization_id: organizationId,
            source_column: col,
            source_value: k,
            tag_id: map[k],
            updated_at: new Date().toISOString(),
          })),
          { onConflict: "organization_id,source_column,source_value" },
        );
        if (error) throw error;
      }
      if (withoutTag.length > 0) {
        const { error } = await supabase
          .from("import_tag_rules")
          .delete()
          .eq("organization_id", organizationId)
          .eq("source_column", col)
          .in("source_value", withoutTag);
        if (error) throw error;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY, organizationId] }),
  });

  return { rules: query.data ?? [], isLoading: query.isLoading, save: save.mutateAsync };
}
