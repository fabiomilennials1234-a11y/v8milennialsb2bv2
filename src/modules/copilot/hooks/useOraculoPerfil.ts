import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { OraculoPerfilChave } from "./useOraculoTurno";
import { toast } from "sonner";

export interface OraculoPerfilRow {
  team_member_id: string;
  team_member_name: string;
  question_key: OraculoPerfilChave;
  member_answer: string;
  member_answered_at?: string;
  admin_answer?: string | null;
  admin_answered_at?: string | null;
  effective_answer: string;
  divergent: boolean;
  measured_context?: Record<string, unknown>;
}

interface ProfileListResponse {
  perfis: OraculoPerfilRow[];
}

export function useOraculoPerfil(organizationId: string | null) {
  const queryClient = useQueryClient();
  const key = ["oraculo-profile", organizationId] as const;
  const query = useQuery({
    queryKey: key,
    enabled: Boolean(organizationId),
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke<ProfileListResponse>("oraculo-profile", {
        body: { acao: "listar", organization_id: organizationId },
      });
      if (error) throw error;
      return data?.perfis ?? [];
    },
  });

  const mutation = useMutation({
    mutationFn: async (input: {
      action: "editar" | "ajustar";
      teamMemberId?: string;
      questionKey: OraculoPerfilChave;
      answer: string;
    }) => {
      const { error } = await supabase.functions.invoke("oraculo-profile", {
        body: {
          acao: input.action,
          membro_id: input.teamMemberId,
          chave: input.questionKey,
          resposta: input.answer,
          organization_id: organizationId,
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Perfil da operação atualizado");
      return queryClient.invalidateQueries({ queryKey: key });
    },
    onError: () => toast.error("Não consegui atualizar o perfil. Tente novamente."),
  });

  return {
    ...query,
    saveOwn: (questionKey: OraculoPerfilChave, answer: string) =>
      mutation.mutate({ action: "editar", questionKey, answer }),
    adjust: (teamMemberId: string, questionKey: OraculoPerfilChave, answer: string) =>
      mutation.mutate({ action: "ajustar", teamMemberId, questionKey, answer }),
    isSaving: mutation.isPending,
  };
}
