import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import type { Json } from "@/integrations/supabase/types";
import type { StudioWindow } from "@/modules/analytics/lib/metrics-studio-window";

export interface StudioPanel {
  id: string;
  nome: string;
  ordem: number;
  templateKey: string | null;
  layout: StudioWindow[];
}
export interface PanelsApi {
  organizationId: string | null;
  paineis: StudioPanel[];
  isLoading: boolean;
  isPending: boolean;
  error: Error | null;
  refetch: () => void;
  criar: (nome: string, layout?: StudioWindow[], templateKey?: string | null) => Promise<string | null>;
  renomear: (id: string, nome: string) => Promise<void>;
  remover: (id: string) => Promise<void>;
  reordenar: (idsNaOrdem: string[]) => Promise<void>;
}
const key = (org: string | null) => ["metrics-studio-panels", org];
const nomeValido = (nome: string) => nome.trim().slice(0, 60) || "Nova aba";

export function useMetricsStudioPanels(): PanelsApi {
  const { organizationId, isReady } = useOrganization();
  const queryClient = useQueryClient();
  const ativa = isReady && !!organizationId;
  const query = useQuery({
    queryKey: key(organizationId),
    queryFn: async (): Promise<StudioPanel[]> => {
      const { data, error } = await supabase.from("metrics_studio_panels")
        .select("id, nome, ordem, template_key, layout").eq("organization_id", organizationId!)
        .order("ordem").order("created_at").order("id");
      if (error) throw new Error(`Carregar abas: ${error.message}`);
      return (data ?? []).map((row) => ({
        id: row.id, nome: row.nome, ordem: row.ordem, templateKey: row.template_key,
        layout: Array.isArray(row.layout) ? row.layout as unknown as StudioWindow[] : [],
      }));
    },
    enabled: ativa,
    refetchOnWindowFocus: false,
  });

  // O destino viaja com a mutation: concluir uma escrita da org A não invalida B.
  type Change = { org: string } & (
    | { kind: "create"; nome: string; layout: StudioWindow[]; templateKey: string | null; ordem: number }
    | { kind: "rename"; id: string; nome: string }
    | { kind: "delete"; id: string }
    | { kind: "reorder"; ids: string[] }
  );
  const mutation = useMutation({
    mutationFn: async (change: Change): Promise<string | null> => {
      if (change.kind === "create") {
        const { data, error } = await supabase.from("metrics_studio_panels")
          .insert({ organization_id: change.org, nome: nomeValido(change.nome), ordem: change.ordem,
            template_key: change.templateKey, layout: change.layout as unknown as Json })
          .select("id").single();
        if (error) throw new Error(`Criar aba: ${error.message}`);
        return data.id;
      }
      if (change.kind === "reorder") {
        // Uma falha parcial é reportada e a lista relida, nunca sucesso falso.
        const responses = await Promise.all(change.ids.map((id, ordem) => supabase.from("metrics_studio_panels")
          .update({ ordem }).eq("id", id).eq("organization_id", change.org).select("id").single()));
        const failed = responses.find((response) => response.error);
        if (failed?.error) throw new Error(`Reordenar abas: ${failed.error.message}`);
        return null;
      }
      const command = change.kind === "delete" ? supabase.from("metrics_studio_panels").delete()
        : supabase.from("metrics_studio_panels").update({ nome: nomeValido(change.nome) });
      const { error } = await command.eq("id", change.id).eq("organization_id", change.org).select("id").single();
      if (error) throw new Error(`Alterar aba: ${error.message}`);
      return null;
    },
    onSettled: (_data, _error, change) => queryClient.invalidateQueries({ queryKey: key(change.org) }),
    onSuccess: (_data, change) => {
      if (change.kind === "delete") queryClient.removeQueries({ queryKey: ["metrics-studio-panel", change.org, change.id], exact: true });
    },
  });
  const org = () => {
    if (!ativa || !organizationId) throw new Error("A organização ainda não está pronta");
    return organizationId;
  };
  return {
    organizationId, paineis: query.data ?? [], isLoading: !isReady || query.isLoading,
    isPending: mutation.isPending, error: query.error,
    refetch: () => { void query.refetch(); },
    criar: (nome, layout = [], templateKey = null) => mutation.mutateAsync({
      org: org(), kind: "create", nome, layout, templateKey,
      ordem: (query.data ?? []).reduce((max, panel) => Math.max(max, panel.ordem), -1) + 1,
    }),
    renomear: async (id, nome) => { await mutation.mutateAsync({ org: org(), kind: "rename", id, nome }); },
    remover: async (id) => { await mutation.mutateAsync({ org: org(), kind: "delete", id }); },
    reordenar: async (ids) => {
      const expected = query.data ?? [];
      if (new Set(ids).size !== expected.length || ids.length !== expected.length || ids.some((id) => !expected.some((p) => p.id === id))) {
        throw new Error("As abas mudaram. Atualize a lista e tente novamente");
      }
      await mutation.mutateAsync({ org: org(), kind: "reorder", ids });
    },
  };
}
