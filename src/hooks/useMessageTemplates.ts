/**
 * useMessageTemplates — CRUD hook para message_templates.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";

export type MediaType = "text" | "image" | "audio" | "video" | "document";

export interface MessageTemplate {
  id: string;
  organization_id: string;
  command: string;
  display_name: string;
  body: string;
  media_url: string | null;
  media_type: MediaType;
  created_by: string;
  updated_at: string;
  created_at: string;
}

const QUERY_KEY = "message-templates";

export function useMessageTemplates() {
  const { organizationId } = useOrganization();

  return useQuery<MessageTemplate[]>({
    queryKey: [QUERY_KEY, organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from("message_templates")
        .select("*")
        .eq("organization_id", organizationId)
        .order("command");
      if (error) throw error;
      return (data ?? []) as unknown as MessageTemplate[];
    },
    enabled: !!organizationId,
    staleTime: 1000 * 60 * 5,
  });
}

export function useCreateMessageTemplate() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (payload: {
      command: string;
      display_name: string;
      body: string;
      media_url?: string | null;
      media_type?: MediaType;
    }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || !organizationId) throw new Error("Não autenticado");

      const { error } = await supabase.from("message_templates").insert({
        organization_id: organizationId,
        command: payload.command.toLowerCase().trim(),
        display_name: payload.display_name.trim(),
        body: payload.body,
        media_url: payload.media_url ?? null,
        media_type: payload.media_type ?? "text",
        created_by: user.id,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      toast.success("Template criado!");
    },
    onError: (error: any) => {
      if (error.message?.includes("unique") || error.code === "23505") {
        toast.error("Já existe um template com esse comando.");
      } else {
        toast.error(error.message || "Erro ao criar template");
      }
    },
  });
}

export function useUpdateMessageTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: {
      id: string;
      command: string;
      display_name: string;
      body: string;
      media_url?: string | null;
      media_type?: MediaType;
    }) => {
      const { error } = await supabase
        .from("message_templates")
        .update({
          command: payload.command.toLowerCase().trim(),
          display_name: payload.display_name.trim(),
          body: payload.body,
          media_url: payload.media_url ?? null,
          media_type: payload.media_type ?? "text",
        } as any)
        .eq("id", payload.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      toast.success("Template atualizado!");
    },
    onError: (error: any) => {
      if (error.message?.includes("unique") || error.code === "23505") {
        toast.error("Já existe um template com esse comando.");
      } else {
        toast.error(error.message || "Erro ao atualizar template");
      }
    },
  });
}

export function useDeleteMessageTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("message_templates")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      toast.success("Template removido.");
    },
    onError: (error: any) => {
      toast.error(error.message || "Erro ao remover template");
    },
  });
}
