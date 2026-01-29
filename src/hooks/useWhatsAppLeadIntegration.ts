import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "./useTeamMembers";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";

export type Lead = Tables<"leads">;

/**
 * Busca lead por número de telefone
 */
export function useLeadByPhone(phone: string | null) {
  return useQuery({
    queryKey: ["lead_by_phone", phone],
    queryFn: async () => {
      if (!phone) return null;

      // Normalizar o número (remover caracteres especiais)
      const normalizedPhone = phone.replace(/\D/g, "");

      // Buscar lead com esse telefone (pode ter variações de formato)
      const { data, error } = await supabase
        .from("leads")
        .select(`
          *,
          sdr:team_members!leads_sdr_id_fkey(id, name),
          closer:team_members!leads_closer_id_fkey(id, name),
          lead_tags(tag:tags(id, name, color))
        `)
        .or(`phone.ilike.%${normalizedPhone}%,phone.ilike.%${normalizedPhone.slice(-9)}%`)
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error("Erro ao buscar lead por telefone:", error);
        return null;
      }

      return data;
    },
    enabled: !!phone,
  });
}

/**
 * Busca status do lead no pipeline WhatsApp
 */
export function usePipeWhatsappByLeadId(leadId: string | null) {
  return useQuery({
    queryKey: ["pipe_whatsapp_by_lead", leadId],
    queryFn: async () => {
      if (!leadId) return null;

      const { data, error } = await supabase
        .from("pipe_whatsapp")
        .select("*")
        .eq("lead_id", leadId)
        .maybeSingle();

      if (error && error.code !== "PGRST116") {
        console.error("Erro ao buscar pipe_whatsapp:", error);
        return null;
      }

      return data;
    },
    enabled: !!leadId,
  });
}

/**
 * Cria lead automaticamente a partir do contato WhatsApp
 */
export function useCreateLeadFromWhatsApp() {
  const queryClient = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();

  return useMutation({
    mutationFn: async ({
      phone,
      pushName,
    }: {
      phone: string;
      pushName?: string | null;
    }) => {
      if (!teamMember?.organization_id) {
        throw new Error("Usuário não está vinculado a uma organização");
      }

      const normalizedPhone = phone.replace(/\D/g, "");

      // 1. Verificar se já existe lead com esse telefone
      const { data: existingLead } = await supabase
        .from("leads")
        .select("id")
        .or(`phone.ilike.%${normalizedPhone}%,phone.ilike.%${normalizedPhone.slice(-9)}%`)
        .limit(1)
        .maybeSingle();

      if (existingLead) {
        console.log("[WhatsApp Lead] Lead já existe:", existingLead.id);
        return { leadId: existingLead.id, isNew: false };
      }

      // 2. Criar novo lead
      const leadData: TablesInsert<"leads"> = {
        name: pushName || `WhatsApp ${normalizedPhone.slice(-4)}`,
        phone: normalizedPhone,
        origin: "whatsapp",
        sdr_id: teamMember.id,
        notes: `Lead criado automaticamente via WhatsApp`,
      };

      const { data: newLead, error: leadError } = await supabase
        .from("leads")
        .insert(leadData)
        .select()
        .single();

      if (leadError) {
        console.error("[WhatsApp Lead] Erro ao criar lead:", leadError);
        throw leadError;
      }

      console.log("[WhatsApp Lead] Novo lead criado:", newLead.id);

      // 3. Adicionar ao Pipeline WhatsApp (etapa "novo")
      const { error: pipeError } = await supabase.from("pipe_whatsapp").insert({
        lead_id: newLead.id,
        status: "novo",
        sdr_id: teamMember.id,
      });

      if (pipeError) {
        console.error("[WhatsApp Lead] Erro ao adicionar ao pipeline:", pipeError);
        // Não falha a operação, apenas loga
      }

      // 4. Vincular lead_id nas mensagens existentes desse número
      const { error: updateError } = await supabase
        .from("whatsapp_messages")
        .update({ lead_id: newLead.id })
        .eq("phone_number", normalizedPhone)
        .is("lead_id", null);

      if (updateError) {
        console.error("[WhatsApp Lead] Erro ao vincular mensagens:", updateError);
      }

      return { leadId: newLead.id, isNew: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["pipe_whatsapp"] });
      queryClient.invalidateQueries({ queryKey: ["whatsapp_contacts"] });
      queryClient.invalidateQueries({ queryKey: ["lead_by_phone"] });
    },
  });
}

/**
 * Vincula lead existente a um contato WhatsApp
 */
export function useLinkLeadToWhatsApp() {
  const queryClient = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();

  return useMutation({
    mutationFn: async ({
      leadId,
      phone,
    }: {
      leadId: string;
      phone: string;
    }) => {
      const normalizedPhone = phone.replace(/\D/g, "");

      // 1. Atualizar telefone do lead se necessário
      const { error: leadError } = await supabase
        .from("leads")
        .update({ phone: normalizedPhone })
        .eq("id", leadId)
        .is("phone", null);

      if (leadError) {
        console.error("[WhatsApp Lead] Erro ao atualizar lead:", leadError);
      }

      // 2. Verificar se lead já está no pipeline WhatsApp
      const { data: existingPipe } = await supabase
        .from("pipe_whatsapp")
        .select("id")
        .eq("lead_id", leadId)
        .maybeSingle();

      if (!existingPipe && teamMember?.id) {
        // Adicionar ao pipeline se não estiver
        await supabase.from("pipe_whatsapp").insert({
          lead_id: leadId,
          status: "novo",
          sdr_id: teamMember.id,
        });
      }

      // 3. Vincular lead_id nas mensagens
      const { error: updateError } = await supabase
        .from("whatsapp_messages")
        .update({ lead_id: leadId })
        .eq("phone_number", normalizedPhone);

      if (updateError) {
        console.error("[WhatsApp Lead] Erro ao vincular mensagens:", updateError);
        throw updateError;
      }

      return { leadId };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["pipe_whatsapp"] });
      queryClient.invalidateQueries({ queryKey: ["whatsapp_contacts"] });
      queryClient.invalidateQueries({ queryKey: ["whatsapp_messages"] });
      queryClient.invalidateQueries({ queryKey: ["lead_by_phone"] });
    },
  });
}

/**
 * Atualiza status do lead no pipeline WhatsApp
 */
export function useUpdateLeadPipelineStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      pipeId,
      leadId,
      status,
      scheduledDate,
    }: {
      pipeId: string;
      leadId: string;
      status: "novo" | "abordado" | "respondeu" | "esfriou" | "agendado";
      scheduledDate?: string;
    }) => {
      const updateData: any = { status };
      if (scheduledDate) {
        updateData.scheduled_date = scheduledDate;
      }

      const { data, error } = await supabase
        .from("pipe_whatsapp")
        .update(updateData)
        .eq("id", pipeId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipe_whatsapp"] });
      queryClient.invalidateQueries({ queryKey: ["pipe_whatsapp_by_lead"] });
    },
  });
}
