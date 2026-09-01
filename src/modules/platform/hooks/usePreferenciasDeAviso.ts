/**
 * As preferências de entrega de quem está logado, na organização aberta.
 *
 * Guardadas no banco e não no navegador por dois motivos: a configuração viaja
 * com a pessoa entre máquinas, e o envio de push roda no servidor, onde
 * localStorage não existe.
 */

import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useAuth, useOrganization } from "@/modules/identity";

import {
  resolverPreferencias,
  type PreferenciasDeAviso,
} from "../lib/preferencias-de-aviso";

/**
 * types.ts é gerado a partir de PROD e ainda não conhece
 * notification_preferences — a tabela nasce na migration desta entrega.
 * Regenerar os tipos depois do deploy dispensa esta ponte.
 */
type ClienteComPreferencias = {
  from: (tabela: "notification_preferences") => {
    select: (colunas: string) => {
      eq: (coluna: string, valor: string) => {
        eq: (coluna: string, valor: string) => {
          maybeSingle: () => Promise<{
            data: Partial<PreferenciasDeAviso> | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
    upsert: (
      linha: Record<string, unknown>,
      opcoes: { onConflict: string },
    ) => Promise<{ error: { message: string } | null }>;
  };
};

const db = supabase as unknown as ClienteComPreferencias;

export interface UsePreferenciasDeAvisoResult {
  preferencias: PreferenciasDeAviso;
  carregando: boolean;
  salvar: (mudanca: Partial<PreferenciasDeAviso>) => Promise<void>;
  salvando: boolean;
}

export function usePreferenciasDeAviso(): UsePreferenciasDeAvisoResult {
  const { user } = useAuth();
  const { organizationId, isReady } = useOrganization();
  const queryClient = useQueryClient();

  const queryKey = useMemo(
    () => ["preferencias-de-aviso", organizationId, user?.id],
    [organizationId, user?.id],
  );
  const habilitado = isReady && !!organizationId && !!user?.id;

  const { data, isLoading, isFetching } = useQuery({
    queryKey,
    queryFn: async (): Promise<PreferenciasDeAviso> => {
      if (!organizationId || !user?.id) return resolverPreferencias(null);

      const { data: linha, error } = await db
        .from("notification_preferences")
        .select(
          "sound_enabled, volume, quiet_hours_start, quiet_hours_end, mute_active_conversation, push_enabled, overrides",
        )
        .eq("user_id", user.id)
        .eq("organization_id", organizationId)
        .maybeSingle();

      if (error) throw error;
      // Ausência de linha não é erro: é quem nunca abriu esta tela.
      return resolverPreferencias(linha);
    },
    enabled: habilitado,
    staleTime: 60_000,
  });

  const preferencias = data ?? resolverPreferencias(null);

  const salvar = useCallback(
    async (mudanca: Partial<PreferenciasDeAviso>) => {
      if (!organizationId || !user?.id) return;

      const proximas = { ...preferencias, ...mudanca };
      queryClient.setQueryData(queryKey, proximas);

      const { error } = await db.from("notification_preferences").upsert(
        {
          user_id: user.id,
          organization_id: organizationId,
          ...proximas,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,organization_id" },
      );

      if (error) {
        // Devolve a tela ao estado do banco em vez de mentir que salvou.
        await queryClient.invalidateQueries({ queryKey });
        throw error;
      }
    },
    [organizationId, preferencias, queryClient, queryKey, user?.id],
  );

  return {
    preferencias,
    carregando: isLoading,
    salvar,
    salvando: isFetching && !isLoading,
  };
}
