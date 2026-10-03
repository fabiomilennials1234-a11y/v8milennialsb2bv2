/**
 * Hook para gerenciamento de áudios pré-gravados dos copilots outbound/híbridos
 *
 * CRUD: listar, upload, deletar, atualizar nome/status
 * Áudios são armazenados no bucket "media" (público) em copilot-audios/{orgId}/{agentId}/
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/modules/identity";
import { toast } from "sonner";
import type { CopilotAgentAudio } from "@/types/copilot";

const MAX_AUDIOS = 5;

/**
 * Lista áudios de um agente específico
 */
export function useCopilotAgentAudios(agentId?: string) {
  return useQuery({
    queryKey: ["copilot_agent_audios", agentId],
    queryFn: async () => {
      if (!agentId) return [];

      const { data, error } = await supabase
        .from("copilot_agent_audios")
        .select("*")
        .eq("agent_id", agentId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return (data || []) as CopilotAgentAudio[];
    },
    enabled: !!agentId,
  });
}

/**
 * Upload de áudio para o storage + criação do registro
 */
export function useUploadCopilotAgentAudio() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      agentId,
      organizationId,
      file,
      name,
    }: {
      agentId: string;
      organizationId: string;
      file: File;
      name: string;
    }) => {
      if (!user?.id) throw new Error("Usuário não autenticado");

      // Verificar limite de 5 áudios
      const { count } = await supabase
        .from("copilot_agent_audios")
        .select("id", { count: "exact", head: true })
        .eq("agent_id", agentId)
        .eq("is_active", true);

      if ((count ?? 0) >= MAX_AUDIOS) {
        throw new Error(`Limite de ${MAX_AUDIOS} áudios atingido`);
      }

      // Normalizar MIME type: remover parâmetros de codec (ex: "audio/webm;codecs=opus" → "audio/webm")
      // O Supabase Storage faz match exato do allowed_mime_types
      const rawMimeType = file.type || "audio/ogg";
      const mimeType = rawMimeType.split(";")[0].trim();

      // Gerar path único
      const ext = file.name.split(".").pop() || "ogg";
      const uuid = crypto.randomUUID();
      const storagePath = `copilot-audios/${organizationId}/${agentId}/${uuid}.${ext}`;

      // 1. Upload para o bucket "media" (público)
      const { error: uploadError } = await supabase.storage
        .from("media")
        .upload(storagePath, file, {
          contentType: mimeType,
          upsert: false,
        });

      if (uploadError) throw uploadError;

      // 2. Obter URL pública
      const { data: urlData } = supabase.storage
        .from("media")
        .getPublicUrl(storagePath);

      const publicUrl = urlData.publicUrl;

      // 3. Criar registro no banco
      const { data: audio, error: insertError } = await supabase
        .from("copilot_agent_audios")
        .insert({
          agent_id: agentId,
          organization_id: organizationId,
          name: name || `Áudio ${new Date().toLocaleDateString("pt-BR")}`,
          storage_path: storagePath,
          public_url: publicUrl,
          mime_type: mimeType,
          file_size: file.size,
          is_active: true,
        })
        .select()
        .single();

      if (insertError) {
        // Rollback: remove do storage se insert falhar
        await supabase.storage.from("media").remove([storagePath]);
        throw insertError;
      }

      return audio as CopilotAgentAudio;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["copilot_agent_audios", variables.agentId],
      });
      toast.success("Áudio cadastrado!");
    },
    onError: (error: Error) => {
      toast.error("Erro ao cadastrar áudio", {
        description: error.message,
      });
    },
  });
}

/**
 * Deletar áudio (remove do storage + banco)
 */
export function useDeleteCopilotAgentAudio() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      audioId,
      storagePath,
      agentId,
    }: {
      audioId: string;
      storagePath: string;
      agentId: string;
    }) => {
      // 1. Remover do storage
      const { error: storageError } = await supabase.storage
        .from("media")
        .remove([storagePath]);

      if (storageError) {
        console.warn("Erro ao remover áudio do storage:", storageError);
      }

      // 2. Remover do banco
      const { error: deleteError } = await supabase
        .from("copilot_agent_audios")
        .delete()
        .eq("id", audioId);

      if (deleteError) throw deleteError;

      return { audioId, agentId };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({
        queryKey: ["copilot_agent_audios", result.agentId],
      });
      toast.success("Áudio removido");
    },
    onError: (error: Error) => {
      toast.error("Erro ao remover áudio", {
        description: error.message,
      });
    },
  });
}

/**
 * Atualizar nome ou status do áudio
 */
export function useUpdateCopilotAgentAudio() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      audioId,
      agentId,
      updates,
    }: {
      audioId: string;
      agentId: string;
      updates: Partial<Pick<CopilotAgentAudio, "name" | "is_active">>;
    }) => {
      const { error } = await supabase
        .from("copilot_agent_audios")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", audioId);

      if (error) throw error;

      return { audioId, agentId };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({
        queryKey: ["copilot_agent_audios", result.agentId],
      });
    },
    onError: (error: Error) => {
      toast.error("Erro ao atualizar áudio", {
        description: error.message,
      });
    },
  });
}
