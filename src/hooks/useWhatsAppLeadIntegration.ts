import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "./useTeamMembers";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";

export type Lead = Tables<"leads">;

/**
 * Busca lead por número de telefone na organização atual.
 * SECURITY: Filtra por organization_id para isolamento entre organizações.
 */
export function useLeadByPhone(phone: string | null) {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id ?? null;

  return useQuery({
    queryKey: ["lead_by_phone", phone, organizationId],
    queryFn: async () => {
      if (!phone || !organizationId) return null;

      const normalizedPhone = phone.replace(/\D/g, "");

      const { data, error } = await supabase
        .from("leads")
        .select(`
          *,
          sdr:team_members!leads_sdr_id_fkey(id, name),
          closer:team_members!leads_closer_id_fkey(id, name),
          lead_tags(tag:tags(id, name, color))
        `)
        .eq("organization_id", organizationId)
        .or(`phone.ilike.%${normalizedPhone}%,phone.ilike.%${normalizedPhone.slice(-9)}%`)
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error("Erro ao buscar lead por telefone:", error);
        return null;
      }

      return data;
    },
    enabled: !!phone && !!organizationId,
  });
}

/**
 * Busca status do lead no pipeline WhatsApp da organização atual.
 */
export function usePipeWhatsappByLeadId(leadId: string | null) {
  const { data: teamMember } = useCurrentTeamMember();
  const organizationId = teamMember?.organization_id ?? null;

  return useQuery({
    queryKey: ["pipe_whatsapp_by_lead", leadId, organizationId],
    queryFn: async () => {
      if (!leadId || !organizationId) return null;

      const { data, error } = await supabase
        .from("pipe_whatsapp")
        .select("*")
        .eq("lead_id", leadId)
        .eq("organization_id", organizationId)
        .maybeSingle();

      if (error && error.code !== "PGRST116") {
        console.error("Erro ao buscar pipe_whatsapp:", error);
        return null;
      }

      return data;
    },
    enabled: !!leadId && !!organizationId,
  });
}

export type LeadDestination = "qualificacao" | "confirmacao" | "propostas" | "campanha" | "none";

/**
 * Cria lead manualmente a partir do contato WhatsApp com destino configurável
 */
export function useCreateLeadFromWhatsApp() {
  const queryClient = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();

  return useMutation({
    mutationFn: async ({
      phone,
      pushName,
      origin,
      sdrId,
      destination,
      campanhaId,
    }: {
      phone: string;
      pushName?: string | null;
      origin?: string;
      sdrId?: string;
      destination?: LeadDestination;
      campanhaId?: string;
    }) => {
      if (!teamMember?.organization_id) {
        throw new Error("Usuário não está vinculado a uma organização");
      }

      const normalizedPhone = phone.replace(/\D/g, "");
      const effectiveSdrId = sdrId || teamMember.id;
      const effectiveDestination = destination || "qualificacao";

      // 1. Verificar se já existe lead com esse telefone na mesma organização
      const { data: existingLead } = await supabase
        .from("leads")
        .select("id, is_shadow")
        .eq("organization_id", teamMember.organization_id)
        .or(`phone.ilike.%${normalizedPhone}%,phone.ilike.%${normalizedPhone.slice(-9)}%`)
        .limit(1)
        .maybeSingle();

      if (existingLead && !existingLead.is_shadow) {
        // Lead real já existe — retornar sem criar
        console.log("[WhatsApp Lead] Lead já existe:", existingLead.id);
        return { leadId: existingLead.id, isNew: false };
      }

      if (existingLead?.is_shadow) {
        // Shadow lead encontrado — promover para lead real
        console.log("[WhatsApp Lead] Promovendo shadow lead:", existingLead.id);

        // Atualizar shadow lead com dados completos
        await supabase
          .from("leads")
          .update({
            is_shadow: false,
            name: pushName || `WhatsApp ${normalizedPhone.slice(-4)}`,
            origin: origin || "whatsapp",
            sdr_id: sdrId || teamMember.id,
            notes: "Lead criado via WhatsApp (promovido de shadow)",
          })
          .eq("id", existingLead.id);

        // Inserir no pipe correto (mesmo fluxo de um lead novo, abaixo)
        const effectiveSdrIdForShadow = sdrId || teamMember.id;

        if (effectiveDestination === "qualificacao") {
          await supabase.from("pipe_whatsapp").insert({
            lead_id: existingLead.id,
            status: "novo",
            sdr_id: effectiveSdrIdForShadow,
            organization_id: teamMember.organization_id,
          });
        } else if (effectiveDestination === "confirmacao") {
          await supabase.from("pipe_confirmacao").insert({
            lead_id: existingLead.id,
            status: "pre_confirmacao",
            sdr_id: effectiveSdrIdForShadow,
            organization_id: teamMember.organization_id,
          });
        } else if (effectiveDestination === "propostas") {
          await supabase.from("pipe_propostas").insert({
            lead_id: existingLead.id,
            status: "proposta_enviada",
            closer_id: effectiveSdrIdForShadow,
            organization_id: teamMember.organization_id,
          });
        } else if (effectiveDestination === "campanha" && campanhaId) {
          const { data: stages } = await supabase
            .from("campanha_stages")
            .select("id, position")
            .eq("campanha_id", campanhaId)
            .order("position", { ascending: true })
            .limit(1);

          if (stages && stages.length > 0) {
            await supabase.from("campanha_leads").insert({
              campanha_id: campanhaId,
              lead_id: existingLead.id,
              stage_id: stages[0].id,
              sdr_id: effectiveSdrIdForShadow,
            });
          }
        }

        return { leadId: existingLead.id, isNew: false };
      }

      // 2. Criar novo lead
      const leadData: TablesInsert<"leads"> = {
        name: pushName || `WhatsApp ${normalizedPhone.slice(-4)}`,
        phone: normalizedPhone,
        origin: origin || "whatsapp",
        sdr_id: effectiveSdrId,
        notes: `Lead criado via WhatsApp`,
        organization_id: teamMember.organization_id,
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

      // 3. Inserir no destino escolhido
      if (effectiveDestination === "qualificacao") {
        const { error: pipeError } = await supabase.from("pipe_whatsapp").insert({
          lead_id: newLead.id,
          status: "novo",
          sdr_id: effectiveSdrId,
          organization_id: teamMember.organization_id,
        });
        if (pipeError) {
          console.error("[WhatsApp Lead] Erro ao adicionar ao pipeline qualificação:", pipeError);
        }
      } else if (effectiveDestination === "confirmacao") {
        const { error: pipeError } = await supabase.from("pipe_confirmacao").insert({
          lead_id: newLead.id,
          status: "pre_confirmacao",
          sdr_id: effectiveSdrId,
          organization_id: teamMember.organization_id,
        });
        if (pipeError) {
          console.error("[WhatsApp Lead] Erro ao adicionar ao pipeline confirmação:", pipeError);
        }
      } else if (effectiveDestination === "propostas") {
        const { error: pipeError } = await supabase.from("pipe_propostas").insert({
          lead_id: newLead.id,
          status: "proposta_enviada",
          closer_id: effectiveSdrId,
          organization_id: teamMember.organization_id,
        });
        if (pipeError) {
          console.error("[WhatsApp Lead] Erro ao adicionar ao pipeline propostas:", pipeError);
        }
      } else if (effectiveDestination === "campanha" && campanhaId) {
        // Buscar primeira etapa da campanha
        const { data: stages } = await supabase
          .from("campanha_stages")
          .select("id, position")
          .eq("campanha_id", campanhaId)
          .order("position", { ascending: true })
          .limit(1);

        if (stages && stages.length > 0) {
          const { error: campError } = await supabase.from("campanha_leads").insert({
            campanha_id: campanhaId,
            lead_id: newLead.id,
            stage_id: stages[0].id,
            sdr_id: effectiveSdrId,
          });
          if (campError) {
            console.error("[WhatsApp Lead] Erro ao adicionar à campanha:", campError);
          }
        }
      }
      // destination === "none" → no pipe/campaign insertion

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
      queryClient.invalidateQueries({ queryKey: ["pipe_confirmacao"] });
      queryClient.invalidateQueries({ queryKey: ["pipe_propostas"] });
      queryClient.invalidateQueries({ queryKey: ["campanha_leads"] });
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

      if (!existingPipe) {
        if (!teamMember?.id || !teamMember?.organization_id) {
          throw new Error("Usuário não está vinculado a uma organização");
        }
        const { error: pipeError } = await supabase.from("pipe_whatsapp").insert({
          lead_id: leadId,
          status: "novo",
          sdr_id: teamMember.id,
          organization_id: teamMember.organization_id,
        });
        if (pipeError) {
          console.error("[WhatsApp Lead] Erro ao adicionar ao pipeline:", pipeError);
          throw new Error(pipeError.message || "Falha ao inserir no pipeline");
        }
      }

      // 3. Vincular lead_id nas mensagens
      const { error: updateError } = await supabase
        .from("whatsapp_messages")
        .update({ lead_id: leadId })
        .eq("phone_number", normalizedPhone);

      if (updateError) {
        console.error("[WhatsApp Lead] Erro ao vincular mensagens:", updateError);
        throw new Error(updateError.message || "Falha ao vincular mensagens");
      }

      return { leadId };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["pipe_whatsapp"] });
      queryClient.invalidateQueries({ queryKey: ["pipe_whatsapp_by_lead"] });
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
