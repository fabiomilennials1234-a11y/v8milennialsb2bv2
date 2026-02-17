/**
 * Hook para gerenciamento de documentos do agente (Knowledge Base)
 *
 * CRUD completo: listar, upload, deletar, processar (gerar resumo via LLM).
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export type AgentDocument = {
  id: string;
  agent_id: string;
  organization_id: string;
  file_name: string;
  file_path: string;
  file_size: number | null;
  mime_type: string | null;
  status: string | null;
  summary: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Lista documentos de um agente específico
 */
export function useAgentDocuments(agentId?: string) {
  return useQuery({
    queryKey: ["agent_documents", agentId],
    queryFn: async () => {
      if (!agentId) return [];

      const { data, error } = await supabase
        .from("copilot_agent_documents")
        .select("*")
        .eq("agent_id", agentId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data || []) as AgentDocument[];
    },
    enabled: !!agentId,
  });
}

/**
 * Upload de documento + criação do registro + disparo do processamento
 */
export function useUploadAgentDocument() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      agentId,
      organizationId,
      file,
    }: {
      agentId: string;
      organizationId: string;
      file: File;
    }) => {
      if (!user?.id) throw new Error("Usuário não autenticado");

      // 1. Upload do arquivo para o storage
      const filePath = `${organizationId}/${agentId}/${Date.now()}_${file.name}`;

      const { error: uploadError } = await supabase.storage
        .from("agent-documents")
        .upload(filePath, file, {
          contentType: file.type,
          upsert: false,
        });

      if (uploadError) throw uploadError;

      // 2. Criar registro no banco
      const { data: doc, error: insertError } = await supabase
        .from("copilot_agent_documents")
        .insert({
          agent_id: agentId,
          organization_id: organizationId,
          file_name: file.name,
          file_path: filePath,
          file_size: file.size,
          mime_type: file.type,
          status: "pending",
        })
        .select()
        .single();

      if (insertError) throw insertError;

      // 3. Disparar processamento (edge function)
      try {
        const { error: fnError } = await supabase.functions.invoke(
          "process-agent-document",
          {
            body: { documentId: doc.id },
          }
        );

        if (fnError) {
          console.error("Error invoking process-agent-document:", fnError);
          // Não falha o upload, apenas marca que o processamento falhou
        }
      } catch (processError) {
        console.error("Error processing document:", processError);
      }

      return doc as AgentDocument;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["agent_documents", variables.agentId],
      });
      toast.success("Documento enviado!", {
        description: "O resumo será gerado automaticamente.",
      });
    },
    onError: (error: Error) => {
      toast.error("Erro ao enviar documento", {
        description: error.message,
      });
    },
  });
}

/**
 * Deletar documento (remove do storage + banco)
 */
export function useDeleteAgentDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      documentId,
      filePath,
      agentId,
    }: {
      documentId: string;
      filePath: string;
      agentId: string;
    }) => {
      // 1. Remover do storage
      const { error: storageError } = await supabase.storage
        .from("agent-documents")
        .remove([filePath]);

      if (storageError) {
        console.warn("Error removing file from storage:", storageError);
      }

      // 2. Remover do banco
      const { error: deleteError } = await supabase
        .from("copilot_agent_documents")
        .delete()
        .eq("id", documentId);

      if (deleteError) throw deleteError;

      return { documentId, agentId };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({
        queryKey: ["agent_documents", result.agentId],
      });
      toast.success("Documento removido");
    },
    onError: (error: Error) => {
      toast.error("Erro ao remover documento", {
        description: error.message,
      });
    },
  });
}

/**
 * Reprocessar documento (gerar resumo novamente)
 */
export function useReprocessDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      documentId,
      agentId,
    }: {
      documentId: string;
      agentId: string;
    }) => {
      // Marcar como pending
      await supabase
        .from("copilot_agent_documents")
        .update({ status: "pending", error_message: null })
        .eq("id", documentId);

      // Disparar processamento
      const { error: fnError } = await supabase.functions.invoke(
        "process-agent-document",
        {
          body: { documentId },
        }
      );

      if (fnError) throw fnError;
      return { documentId, agentId };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({
        queryKey: ["agent_documents", result.agentId],
      });
      toast.success("Reprocessamento iniciado!");
    },
    onError: (error: Error) => {
      toast.error("Erro ao reprocessar", {
        description: error.message,
      });
    },
  });
}

/**
 * Busca resumos prontos de todos os documentos de um agente
 * Usado pelo prompt builder para injetar no prompt
 */
export async function fetchAgentDocumentSummaries(
  agentId: string
): Promise<Array<{ fileName: string; summary: string }>> {
  const { data, error } = await supabase
    .from("copilot_agent_documents")
    .select("file_name, summary")
    .eq("agent_id", agentId)
    .eq("status", "ready")
    .not("summary", "is", null);

  if (error) {
    console.error("Error fetching document summaries:", error);
    return [];
  }

  return (data || []).map((d) => ({
    fileName: d.file_name,
    summary: d.summary!,
  }));
}
