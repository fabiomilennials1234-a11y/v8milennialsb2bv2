import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { useCurrentTeamMember } from "@/modules/identity";
import { useLogLeadAction } from "@/shared/hooks/useLogLeadAction";
import { toast } from "sonner";
import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { notifyError } from "@/shared/errors";
import { FALHA_JANELA_MS } from "@/modules/communication/lib/scheduledTray";
import { resolverChipDeQuemAgenda } from "@/modules/communication/lib/chipDeQuemAgenda";
import { useFeatureFlag } from "@/modules/platform";

/** Agendamento sem chip escolhido grava o chip de quem agenda (Café Jurerê). */
export const FLAG_CHIP_DO_CRIADOR = "agendamento_chip_do_criador";

export interface ScheduledMessage {
  id: string;
  organization_id: string;
  lead_id: string | null;
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

/**
 * O que a bandeja da conversa mostra: o que ainda vai sair (`scheduled`), o que
 * está saindo agora (`sending`) e o que falhou nos últimos 7 dias (`failed`).
 *
 * A falha entra porque sumir com ela era o defeito: o worker desiste depois de
 * 3 tentativas, a linha virava `failed` e a conversa voltava a parecer limpa —
 * a pessoa não sabia que o cliente nunca recebeu. A janela de 7 dias evita que
 * uma falha de meses atrás fique no topo para sempre.
 *
 * Única consumidora: `ScheduledMessagesBanner` (verificado por grep em 2026-11-09).
 * `useLeadsWithScheduledMessages` e `useMyScheduledMessages` seguem com a
 * semântica própria.
 */
export const BANDEJA_STATUSES = ["scheduled", "sending", "failed"] as const;

/** Filtro plano (sem `and()` aninhado): "não é falha OU é recente". Janela única: `FALHA_JANELA_MS`. */
function falhaRecenteFilter(now: number = Date.now()): string {
  const desde = new Date(now - FALHA_JANELA_MS).toISOString();
  return `status.neq.failed,scheduled_at.gte.${desde}`;
}

/** Mensagens da bandeja (pendentes, saindo, falhas recentes) de um lead específico */
export function useScheduledMessagesForLead(leadId: string | null) {
  return useQuery({
    queryKey: ["scheduled-messages", "lead", leadId],
    queryFn: async () => {
      if (!leadId) return [];
      const { data, error } = await supabase
        .from("scheduled_user_messages")
        .select("*")
        .eq("lead_id", leadId)
        .in("status", [...BANDEJA_STATUSES])
        .or(falhaRecenteFilter())
        .order("scheduled_at", { ascending: true });
      if (error) return [];
      return (data ?? []) as ScheduledMessage[];
    },
    enabled: !!leadId,
    retry: false,
    // Mesmo ritmo da consulta por conversa: `sending` → `sent`/`failed` muda
    // sozinho no servidor, e a bandeja precisa refletir sem a pessoa recarregar.
    refetchInterval: 60_000,
    staleTime: 60_000,
  });
}

/** Conversation lookup also survives linking a lead after scheduling. Mesmo recorte de status da bandeja. */
export function useScheduledMessagesForConversation(phoneNumber: string, instanceId?: string) {
  const { organizationId } = useOrganization();
  const phone = phoneNumber.replace(/\D/g, "");
  return useQuery({
    queryKey: ["scheduled-messages", "conversation", organizationId, instanceId, phone],
    enabled: !!organizationId && !!instanceId && !!phone,
    queryFn: async (): Promise<ScheduledMessage[]> => {
      if (!organizationId || !instanceId || !phone) return [];
      const { data, error } = await supabase.from("scheduled_user_messages")
        .select("*")
        .eq("organization_id", organizationId)
        .eq("whatsapp_instance_id", instanceId)
        .eq("phone_number", phone)
        .in("status", [...BANDEJA_STATUSES])
        .or(falhaRecenteFilter())
        .order("scheduled_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ScheduledMessage[];
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
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
      return new Set((data ?? []).map((r) => r.lead_id).filter((id): id is string => !!id));
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
  const { enabled: chipDoCriador } = useFeatureFlag(FLAG_CHIP_DO_CRIADOR);

  return useMutation({
    mutationFn: async (input: {
      leadId: string | null;
      phoneNumber: string;
      messageContent?: string;
      mediaFile?: File;
      scheduledAt: Date;
      instanceId?: string;
    }) => {
      if (!organizationId || !member) throw new Error("Contexto não disponível");
      const leadId = input.leadId?.trim() || null;
      if (!leadId && !input.instanceId?.trim()) {
        throw new Error("Selecione uma instância de WhatsApp para agendar nesta conversa.");
      }

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

      // Tela que não escolhe chip (card, detalhe do lead, Revisão): grava o de
      // quem agenda, senão o envio saía pelo chip de quem falou por último com
      // o cliente. Falha ao resolver não impede o agendamento — o worker decide.
      let instanceId = input.instanceId?.trim() || null;
      if (!instanceId && chipDoCriador) {
        instanceId = await resolverChipDeQuemAgenda(supabase, {
          organizationId,
          teamMemberId: member.id,
          leadId,
          phoneNumber: input.phoneNumber,
        }).catch(() => null);
      }

      const { data, error } = await supabase
        .from("scheduled_user_messages")
        .insert({
          organization_id: organizationId,
          lead_id: leadId,
          phone_number: input.phoneNumber.replace(/\D/g, ""),
          created_by: member.id,
          assigned_to: member.id,
          whatsapp_instance_id: instanceId,
          message_content: input.messageContent || null,
          media_url: mediaUrl,
          media_type: mediaType,
          media_filename: mediaFilename,
          scheduled_at: input.scheduledAt.toISOString(),
        // Compatibility until generated types include the nullable lead migration.
        } as TablesInsert<"scheduled_user_messages">)
        .select()
        .single();

      if (error) throw error;

      if (leadId) logAction({
        leadId,
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
      notifyError(err, { fallback: "Não foi possível agendar mensagem." });
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
export function useCancelScheduledMessage(opts?: {
  /** Quem chama já avisou (ex.: toast com Desfazer da bandeja) — sem 2º toast. */
  silencioso?: boolean;
}) {
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
      if (!opts?.silencioso) toast.success("Agendamento cancelado");
    },
    onError: (err: Error) => {
      // Sem isto a falha era muda: a mutation não tinha `onError`, então a
      // pessoa via o item continuar na lista sem nenhuma explicação.
      notifyError(err, { fallback: "Não foi possível cancelar agendamento." });
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
 *
 * `reviverFalha` (opt-in, só a bandeja do chat passa): se a linha for uma
 * FALHA, salvar a reprograma (2º ramo). Sem ele, o contrato antigo vale — CAS
 * só em `scheduled`, e falha cai na guarda de janela (Agenda).
 */
export function useUpdateScheduledMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      id: string;
      messageContent?: string;
      scheduledAt?: Date;
      reviverFalha?: boolean;
    }) => {
      const updates: TablesUpdate<"scheduled_user_messages"> = {};
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
      if (data?.length) return;
      if (!input.reviverFalha) throw new Error(AGENDAMENTO_FORA_DE_JANELA);

      // Editar uma FALHA (bandeja do chat) é reprogramá-la: volta para a fila
      // com o texto/horário novos e as 3 tentativas do worker zeradas. Ramo
      // separado, com CAS próprio em `failed`, para não mexer no `retry_count`
      // de uma linha `scheduled` que está no meio dos retries do worker.
      const { data: reprogramada, error: errFalha } = await supabase
        .from("scheduled_user_messages")
        .update({ ...updates, status: "scheduled", retry_count: 0, error_message: null })
        .eq("id", input.id)
        .eq("status", "failed")
        .select("id");
      if (errFalha) throw errFalha;
      if (!reprogramada?.length) throw new Error(AGENDAMENTO_FORA_DE_JANELA);
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
      notifyError(err, { fallback: "Não foi possível atualizar agendamento." });
      queryClient.invalidateQueries({ queryKey: ["scheduled-messages"] });
      queryClient.invalidateQueries({ queryKey: ["agenda-events"] });
    },
  });
}

/**
 * A falha saiu do estado em que podia ser reenviada ou descartada — alguém já
 * reenviou, descartou ou a linha mudou por outro caminho entre o render e o clique.
 */
export const FALHA_FORA_DE_JANELA =
  "Esta mensagem não está mais marcada como falha — alguém já reenviou ou descartou.";

function invalidarBandeja(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["scheduled-messages"] });
  queryClient.invalidateQueries({ queryKey: ["agenda-events"] });
}

/**
 * "Enviar agora": antecipa o horário para AGORA e deixa o worker enviar.
 *
 * Não envia do navegador — o envio continua passando pelo mesmo caminho do
 * agendamento (lock CAS do worker, dedup, governor). Por isso o toast diz
 * "no próximo minuto": o cron roda a cada minuto e só então a mensagem sai.
 *
 * Mesmo CAS do cancelar: se o worker já pegou a linha, o UPDATE casa zero linha
 * e a guarda devolve a verdade em vez de um sucesso falso.
 */
export function useSendScheduledMessageNow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("scheduled_user_messages")
        .update({ scheduled_at: new Date().toISOString() })
        .eq("id", id)
        .eq("status", "scheduled")
        .select("id");
      if (error) throw error;
      if (!data?.length) throw new Error(AGENDAMENTO_FORA_DE_JANELA);
    },
    onSuccess: () => {
      invalidarBandeja(queryClient);
      toast.success("Enviando no próximo minuto");
    },
    onError: (err: Error) => {
      notifyError(err, { fallback: "Não foi possível antecipar o envio." });
      invalidarBandeja(queryClient);
    },
  });
}

/**
 * "Tentar de novo" numa falha: devolve a linha à fila, para agora, com as 3
 * tentativas do worker zeradas. CAS em `failed` — duas pessoas clicando ao
 * mesmo tempo resultam em UM reenvio, e a segunda recebe a explicação.
 */
export function useRetryFailedScheduledMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("scheduled_user_messages")
        .update({
          status: "scheduled",
          scheduled_at: new Date().toISOString(),
          retry_count: 0,
          error_message: null,
        })
        .eq("id", id)
        .eq("status", "failed")
        .select("id");
      if (error) throw error;
      if (!data?.length) throw new Error(FALHA_FORA_DE_JANELA);
    },
    onSuccess: () => {
      invalidarBandeja(queryClient);
      toast.success("Reenviando no próximo minuto");
    },
    onError: (err: Error) => {
      notifyError(err, { fallback: "Não foi possível reenviar a mensagem." });
      invalidarBandeja(queryClient);
    },
  });
}

/** "Descartar" uma falha: ela sai da bandeja como cancelada. CAS em `failed`. */
export function useDiscardFailedScheduledMessage(opts?: { silencioso?: boolean }) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("scheduled_user_messages")
        .update({ status: "cancelled" })
        .eq("id", id)
        .eq("status", "failed")
        .select("id");
      if (error) throw error;
      if (!data?.length) throw new Error(FALHA_FORA_DE_JANELA);
    },
    onSuccess: () => {
      invalidarBandeja(queryClient);
      if (!opts?.silencioso) toast.success("Mensagem descartada");
    },
    onError: (err: Error) => {
      notifyError(err, { fallback: "Não foi possível descartar a mensagem." });
      invalidarBandeja(queryClient);
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
