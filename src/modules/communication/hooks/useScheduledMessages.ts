import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { useCurrentTeamMember } from "@/modules/identity";
import { useLogLeadAction } from "@/shared/hooks/useLogLeadAction";
import { toast } from "sonner";

export interface ScheduledMessage {
  id: string;
  organization_id: string;
  lead_id: string;
  phone_number: string;
  created_by: string;
  assigned_to: string | null;
  whatsapp_instance_id: string | null;
  message_content: string | null;
  media_url: string | null;
  media_type: string | null;
  media_filename: string | null;
  scheduled_at: string;
  status: "scheduled" | "sending" | "sent" | "failed" | "cancelled";
  sent_at: string | null;
  error_message: string | null;
  retry_count: number;
  created_at: string;
}

/** Mensagens agendadas pendentes de um lead específico */
export function useScheduledMessagesForLead(leadId: string | null) {
  return useQuery({
    queryKey: ["scheduled-messages", "lead", leadId],
    queryFn: async () => {
      if (!leadId) return [];
      const { data, error } = await supabase
        .from("scheduled_user_messages")
        .select("*")
        .eq("lead_id", leadId)
        .eq("status", "scheduled")
        .order("scheduled_at", { ascending: true });
      if (error) return [];
      return (data ?? []) as ScheduledMessage[];
    },
    enabled: !!leadId,
    retry: false,
    staleTime: 60_000,
  });
}

/** Set de lead_ids com agendamentos pendentes (para filtro nos pipes) */
export function useLeadsWithScheduledMessages() {
  const { organizationId } = useOrganization();
  return useQuery({
    queryKey: ["scheduled-messages", "lead-ids", organizationId],
    queryFn: async () => {
      if (!organizationId) return new Set<string>();
      const { data, error } = await supabase
        .from("scheduled_user_messages")
        .select("lead_id")
        .eq("organization_id", organizationId)
        .eq("status", "scheduled");
      if (error) return new Set<string>();
      return new Set((data ?? []).map((r) => r.lead_id));
    },
    enabled: !!organizationId,
    retry: false,
    refetchInterval: 60_000,
  });
}

/** Criar mensagem agendada */
export function useCreateScheduledMessage() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();
  const { data: member } = useCurrentTeamMember();
  const logAction = useLogLeadAction();

  return useMutation({
    mutationFn: async (input: {
      leadId: string;
      phoneNumber: string;
      messageContent?: string;
      mediaFile?: File;
      scheduledAt: Date;
      instanceId?: string;
    }) => {
      if (!organizationId || !member) throw new Error("Contexto não disponível");

      let mediaUrl: string | null = null;
      let mediaType: string | null = null;
      let mediaFilename: string | null = null;

      if (input.mediaFile) {
        const ext = input.mediaFile.name.split(".").pop() || "bin";
        const path = `scheduled-messages/${organizationId}/${Date.now()}.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from("media")
          .upload(path, input.mediaFile);
        if (uploadErr) throw new Error("Erro no upload: " + uploadErr.message);

        const { data: urlData } = supabase.storage.from("media").getPublicUrl(path);
        mediaUrl = urlData.publicUrl;
        mediaFilename = input.mediaFile.name;

        const mime = input.mediaFile.type;
        if (mime.startsWith("image/")) mediaType = "image";
        else if (mime.startsWith("video/")) mediaType = "video";
        else if (mime.startsWith("audio/")) mediaType = "audio";
        else mediaType = "document";
      }

      const { data, error } = await supabase
        .from("scheduled_user_messages")
        .insert({
          organization_id: organizationId,
          lead_id: input.leadId,
          phone_number: input.phoneNumber,
          created_by: member.id,
          assigned_to: member.id,
          whatsapp_instance_id: input.instanceId || null,
          message_content: input.messageContent || null,
          media_url: mediaUrl,
          media_type: mediaType,
          media_filename: mediaFilename,
          scheduled_at: input.scheduledAt.toISOString(),
        })
        .select()
        .single();

      if (error) throw error;

      logAction({
        leadId: input.leadId,
        action: "scheduled_message_created",
        description: `Mensagem agendada para ${input.scheduledAt.toLocaleString("pt-BR")}`,
      });

      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["scheduled-messages"] });
      toast.success(
        `Mensagem agendada para ${variables.scheduledAt.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`,
      );
    },
    onError: (err: Error) => {
      toast.error(err.message || "Erro ao agendar mensagem");
    },
  });
}

/**
 * A janela de edição fechou entre abrir o formulário e salvar.
 *
 * `scheduled` não é estado estável: o cron roda a cada minuto e a primeira
 * coisa que faz é virar a linha para `sending` (o compare-and-swap em
 * `process-scheduled-user-messages`). Quem estava com o modal aberto perde a
 * corrida — e perder aqui é o certo, porque a mensagem já está saindo.
 */
export const AGENDAMENTO_FORA_DE_JANELA =
  "Este agendamento não está mais editável — ele já saiu, está saindo ou foi cancelado.";

/**
 * Cancelar mensagem agendada.
 *
 * 🚨 O `.eq("status", "scheduled")` é um compare-and-swap, e o PostgREST devolve
 * SUCESSO quando ele não casa linha nenhuma. Sem `.select()` e sem checar o que
 * voltou, cancelar uma mensagem que o worker já pegou não fazia nada — e ainda
 * dizia "Agendamento cancelado". A UI mentia e a mensagem saía assim mesmo. É a
 * mesma armadilha que o worker documenta no próprio lock (`if (!locked?.length)
 * continue`).
 */
export function useCancelScheduledMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("scheduled_user_messages")
        .update({ status: "cancelled" })
        .eq("id", id)
        .eq("status", "scheduled")
        .select("id");
      if (error) throw error;
      if (!data?.length) throw new Error(AGENDAMENTO_FORA_DE_JANELA);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheduled-messages"] });
      queryClient.invalidateQueries({ queryKey: ["agenda-events"] });
      toast.success("Agendamento cancelado");
    },
    onError: (err: Error) => {
      // Sem isto a falha era muda: a mutation não tinha `onError`, então a
      // pessoa via o item continuar na lista sem nenhuma explicação.
      toast.error(err.message || "Erro ao cancelar agendamento");
      queryClient.invalidateQueries({ queryKey: ["scheduled-messages"] });
      queryClient.invalidateQueries({ queryKey: ["agenda-events"] });
    },
  });
}

/**
 * Editar mensagem agendada (conteúdo e/ou horário).
 *
 * Mesma guarda de janela do cancelamento, pelo mesmo motivo: editar a linha que
 * o worker já travou é um UPDATE que casa zero linha e volta 200.
 */
export function useUpdateScheduledMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      id: string;
      messageContent?: string;
      scheduledAt?: Date;
    }) => {
      const updates: Record<string, unknown> = {};
      if (input.messageContent !== undefined) updates.message_content = input.messageContent;
      if (input.scheduledAt) updates.scheduled_at = input.scheduledAt.toISOString();

      // Nada a gravar: um `.update({})` iria à rede para não mudar coisa
      // alguma, voltaria zero linha e cairia na guarda abaixo acusando janela
      // fechada — erro errado para "você não alterou nada".
      if (Object.keys(updates).length === 0) return;

      const { data, error } = await supabase
        .from("scheduled_user_messages")
        .update(updates)
        .eq("id", input.id)
        .eq("status", "scheduled")
        .select("id");
      if (error) throw error;
      if (!data?.length) throw new Error(AGENDAMENTO_FORA_DE_JANELA);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheduled-messages"] });
      // A Agenda lê pela RPC `get_agenda_events`, com chave própria: sem esta
      // linha, editar pela Agenda deixava o card com o texto e o horário
      // ANTIGOS até o staleTime vencer.
      queryClient.invalidateQueries({ queryKey: ["agenda-events"] });
      toast.success("Agendamento atualizado");
    },
    onError: (err: Error) => {
      toast.error(err.message || "Erro ao atualizar agendamento");
      queryClient.invalidateQueries({ queryKey: ["scheduled-messages"] });
      queryClient.invalidateQueries({ queryKey: ["agenda-events"] });
    },
  });
}

/** Todas as mensagens agendadas do membro logado (ou da org para admin) */
export function useMyScheduledMessages(filters?: {
  showCompleted?: boolean;
  assignedTo?: string;
}) {
  const { organizationId } = useOrganization();
  const { data: member } = useCurrentTeamMember();

  return useQuery({
    queryKey: ["scheduled-messages", "my", organizationId, member?.id, filters],
    queryFn: async () => {
      if (!organizationId || !member) return [];

      let query = supabase
        .from("scheduled_user_messages")
        .select("*, lead:leads(name, company, phone)")
        .eq("organization_id", organizationId)
        .order("scheduled_at", { ascending: true });

      if (filters?.assignedTo && filters.assignedTo !== "all") {
        query = query.eq("assigned_to", filters.assignedTo);
      } else if (!filters?.assignedTo) {
        query = query.eq("assigned_to", member.id);
      }

      if (filters?.showCompleted) {
        query = query.in("status", ["scheduled", "sent", "cancelled", "failed"]);
      } else {
        query = query.eq("status", "scheduled");
      }

      const { data, error } = await query;
      if (error) return [];
      return data ?? [];
    },
    enabled: !!organizationId && !!member,
    retry: false,
    staleTime: 30_000,
  });
}
