import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { useOrganization } from "./useOrganization";

export type Webhook = Tables<"webhooks">;
export type WebhookInsert = TablesInsert<"webhooks">;
export type WebhookUpdate = TablesUpdate<"webhooks">;

export const WEBHOOK_EVENTS = [
  { value: "lead.created", label: "Lead criado" },
  { value: "lead.updated", label: "Lead atualizado" },
  { value: "pipe_whatsapp.created", label: "Pipe WhatsApp – criado" },
  { value: "pipe_whatsapp.updated", label: "Pipe WhatsApp – atualizado" },
  { value: "pipe_confirmacao.created", label: "Pipe Confirmação – criado" },
  { value: "pipe_confirmacao.updated", label: "Pipe Confirmação – atualizado" },
  { value: "pipe_propostas.created", label: "Pipe Propostas – criado" },
  { value: "pipe_propostas.updated", label: "Pipe Propostas – atualizado" },
  { value: "follow_up.created", label: "Follow-up criado" },
  { value: "follow_up.updated", label: "Follow-up atualizado" },
  { value: "follow_up.completed", label: "Follow-up concluído" },
  { value: "campaign_dispatch.scheduled", label: "Disparo de campanha agendado" },
  { value: "campaign_dispatch.completed", label: "Disparo de campanha concluído" },
  { value: "campaign.lead_added", label: "Lead adicionado à campanha" },
  { value: "acao_dia.created", label: "Tarefa (ação do dia) criada" },
  { value: "acao_dia.completed", label: "Tarefa (ação do dia) concluída" },
  { value: "whatsapp_message.received", label: "Mensagem WhatsApp recebida" },
  { value: "whatsapp_message.sent", label: "Mensagem WhatsApp enviada" },
  { value: "test", label: "Teste (manual)" },
] as const;

export const HTTP_METHODS = ["POST", "PUT", "PATCH"] as const;

export function useWebhooks() {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["webhooks", organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from("webhooks")
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Webhook[];
    },
    enabled: isReady && !!organizationId,
  });
}

export function useCreateWebhook() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (webhook: WebhookInsert | Omit<WebhookInsert, "organization_id">) => {
      if (!organizationId) throw new Error("Organização não disponível");
      const payload: WebhookInsert = { ...webhook, organization_id: organizationId };
      const { data, error } = await supabase
        .from("webhooks")
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      return data as Webhook;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["webhooks"] });
    },
  });
}

export function useUpdateWebhook() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async ({ id, ...updates }: WebhookUpdate & { id: string }) => {
      if (!organizationId) throw new Error("Organização não disponível");
      const { data, error } = await supabase
        .from("webhooks")
        .update(updates)
        .eq("id", id)
        .eq("organization_id", organizationId)
        .select()
        .single();
      if (error) throw error;
      return data as Webhook;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["webhooks"] });
    },
  });
}

export function useDeleteWebhook() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (id: string) => {
      if (!organizationId) throw new Error("Organização não disponível");
      const { error } = await supabase
        .from("webhooks")
        .delete()
        .eq("id", id)
        .eq("organization_id", organizationId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["webhooks"] });
    },
  });
}

export function useWebhookDeliveryLogs(webhookId: string | null) {
  return useQuery({
    queryKey: ["webhook-delivery-logs", webhookId],
    queryFn: async () => {
      if (!webhookId) return [];
      const { data, error } = await supabase
        .from("webhook_delivery_logs")
        .select("*")
        .eq("webhook_id", webhookId)
        .order("delivered_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!webhookId,
  });
}
