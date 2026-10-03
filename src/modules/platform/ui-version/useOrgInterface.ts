/**
 * A interface que a organização escolheu: nova (V5) ou clássica.
 *
 * Lê `organizations.ui_v5_enabled` numa consulta SEPARADA de
 * `useOrganizationSettings`: se a migration ainda não chegou, a coluna não
 * existe e o PostgREST responde 42703 — misturar com as outras colunas
 * derrubaria junto o prazo de confirmação e o funil padrão.
 *
 * Escreve por `set_org_settings` (admin da org ou master). `organizations` não
 * tem policy de UPDATE para admin, de propósito.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";

/** PostgREST: coluna inexistente — a migration 20271104120000 não rodou. */
const COLUNA_AUSENTE = "42703";

export interface InterfaceDaOrg {
  /** `null` enquanto carrega. Sem a coluna, `false` (clássica). */
  uiV5Enabled: boolean | null;
  /** `false` quando o banco ainda não tem a coluna — o switch fica travado. */
  disponivel: boolean;
  isError: boolean;
  definir: (ligar: boolean) => Promise<void>;
  isSaving: boolean;
}

export function useOrgInterface(): InterfaceDaOrg {
  const { organizationId, isReady } = useOrganization();
  const queryClient = useQueryClient();
  const queryKey = ["organization-ui", organizationId];

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        // Coluna da 20271104120000 — cast até o próximo `supabase gen types`.
        .select("ui_v5_enabled" as "id")
        .eq("id", organizationId!)
        .maybeSingle();
      if (error) {
        if (error.code === COLUNA_AUSENTE) return { uiV5Enabled: false, disponivel: false };
        throw error;
      }
      const linha = data as { ui_v5_enabled?: boolean } | null;
      return { uiV5Enabled: linha?.ui_v5_enabled === true, disponivel: true };
    },
    enabled: isReady && !!organizationId,
    staleTime: 60_000,
  });

  const mutation = useMutation({
    mutationFn: async (ligar: boolean) => {
      if (!organizationId) throw new Error("Sem organização");
      const { error } = await supabase.rpc("set_org_settings", {
        p_org_id: organizationId,
        p_patch: { ui_v5_enabled: ligar },
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  return {
    uiV5Enabled: query.data?.uiV5Enabled ?? null,
    disponivel: query.data?.disponivel ?? true,
    isError: query.isError,
    definir: mutation.mutateAsync,
    isSaving: mutation.isPending,
  };
}
