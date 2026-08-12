import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";
import { DEFAULT_STAGES } from "@/contracts/pipe";
import { normalizePhone } from "@/lib/normalizePhone";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";

/**
 * Fetches the first active stage_key for a pipeline type from pipeline_stages.
 * Falls back to DEFAULT_STAGES if no dynamic stage exists.
 */
async function getFirstStageKey(orgId: string, pipelineType: string): Promise<string> {
  const { data } = await supabase
    .from("pipeline_stages")
    .select("stage_key")
    .eq("organization_id", orgId)
    .eq("pipeline_type", pipelineType)
    .eq("is_active", true)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (data?.stage_key) return data.stage_key;
  const fallback = DEFAULT_STAGES[pipelineType as keyof typeof DEFAULT_STAGES];
  return fallback?.[0]?.id || "novo";
}

/**
 * Teto de linhas lidas por lead num funil — espelha `PIPE_ENTRY_READ_CAP` em
 * `supabase/functions/_shared/pipeline-adapter.ts`.
 */
const PIPE_ENTRY_READ_CAP = 50;

/**
 * "Este lead já está neste funil?" — tolerante a N linhas.
 *
 * Depois do M1 (drop de `uq_pipeline_entries_pipeline_lead` e irmãos) o par
 * (funil, lead) deixou de ser único: recompra cria outro negócio no MESMO funil.
 * Com N>1 o `.maybeSingle()` que existia nestes guards **zera o `data`** e
 * devolve `PGRST116` (postgrest-js `dist/index.mjs:107-119`), então "existem 2"
 * ficava indistinguível de "não existe" — e um guard que só serve para NÃO
 * inserir passava a mandar inserir.
 *
 * `null` = a leitura falhou (não sei). Quem chama trata `null` como "não
 * inserir", mesmo critério de `upsertPipeEntry`: negócio duplicado é permanente
 * e aparece no kanban do cliente; inserção pulada é retentável.
 */
function pipePresence(res: { data: unknown[] | null; error: unknown }): boolean | null {
  if (res.error) return null;
  return (res.data?.length ?? 0) > 0;
}

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

      const normalizedPhone = normalizePhone(phone) || phone.replace(/\D/g, "");

      const { data, error } = await supabase
        .from("leads")
        .select(`
          *,
          responsible:team_members!leads_responsible_id_fkey(id, name),
          sdr:team_members!leads_sdr_id_fkey(id, name),
          closer:team_members!leads_closer_id_fkey(id, name),
          lead_tags(tag:tags(id, name, color))
        `)
        .eq("organization_id", organizationId)
        .eq("normalized_phone", normalizedPhone)
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

      // N negócios por (funil, lead) são legítimos depois do M1. A view
      // `pipe_whatsapp` NÃO projeta `closed_at` nem `stage_changed_at` (ver
      // Views.pipe_whatsapp em `@/integrations/supabase/types`), então o passo
      // "aberto primeiro" de `pickActiveEntry`
      // (`supabase/functions/_shared/pipeline-adapter.ts`) não é expressável
      // aqui; sobra o passo seguinte — o negócio mexido por último, com
      // `updated_at` no lugar de `stage_changed_at`, e `id` fechando a ordem
      // total para leitor e escritor nunca elegerem cards diferentes.
      const { data, error } = await supabase
        .from("pipe_whatsapp")
        .select("*")
        .eq("lead_id", leadId)
        .eq("organization_id", organizationId)
        .order("updated_at", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(PIPE_ENTRY_READ_CAP);

      // O `error.code !== "PGRST116"` que existia aqui engolia exatamente o
      // sinal de N>1 e devolvia `null` = "o lead não está no funil".
      if (error) {
        console.error("Erro ao buscar pipe_whatsapp:", error);
        return null;
      }

      const rows = data ?? [];
      if (rows.length > 1) {
        console.warn(
          `[pipe_whatsapp] ${rows.length} negócios para lead=${leadId}; usando o mexido por último.`,
        );
      }

      return rows[0] ?? null;
    },
    enabled: !!leadId && !!organizationId,
  });
}

export type LeadDestination = "qualificacao" | "confirmacao" | "propostas" | "campanha" | "custom" | "none";

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
      customPipelineId,
      customStageId,
    }: {
      phone: string;
      pushName?: string | null;
      origin?: string;
      sdrId?: string;
      destination?: LeadDestination;
      campanhaId?: string;
      customPipelineId?: string;
      customStageId?: string;
    }) => {
      if (!teamMember?.organization_id) {
        throw new Error("Usuário não está vinculado a uma organização");
      }

      const normalizedPhone = normalizePhone(phone) || phone.replace(/\D/g, "");
      const effectiveSdrId = sdrId || teamMember.id;
      const effectiveDestination = destination || "qualificacao";

      // 1. Verificar se já existe lead com esse telefone na mesma organização
      const { data: existingLead } = await supabase
        .from("leads")
        .select("id, is_shadow")
        .eq("organization_id", teamMember.organization_id)
        .eq("normalized_phone", normalizedPhone)
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
        const effectiveSdr = sdrId || teamMember.id;
        await supabase
          .from("leads")
          .update({
            is_shadow: false,
            name: pushName || `WhatsApp ${normalizedPhone.slice(-4)}`,
            origin: origin || "whatsapp",
            responsible_id: effectiveSdr,
            sdr_id: effectiveSdr,
            notes: "Lead criado via WhatsApp (promovido de shadow)",
          })
          .eq("id", existingLead.id);

        // Inserir no pipe correto (mesmo fluxo de um lead novo, abaixo)
        const effectiveSdrIdForShadow = sdrId || teamMember.id;

        if (effectiveDestination === "qualificacao") {
          // Não duplicar se já estiver em confirmação ou propostas (ver `pipePresence`)
          const [confRes, propRes] = await Promise.all([
            supabase.from("pipe_confirmacao").select("id").eq("lead_id", existingLead.id).limit(1),
            supabase.from("pipe_propostas").select("id").eq("lead_id", existingLead.id).limit(1),
          ]);
          const inConf = pipePresence(confRes);
          const inProp = pipePresence(propRes);

          if (inConf === false && inProp === false) {
            const firstStage = await getFirstStageKey(teamMember.organization_id, "whatsapp");
            await supabase.from("pipe_whatsapp").insert({
              lead_id: existingLead.id,
              status: firstStage,
              responsible_id: effectiveSdrIdForShadow,
              sdr_id: effectiveSdrIdForShadow,
              organization_id: teamMember.organization_id,
            });
          } else if (inConf === null || inProp === null) {
            console.warn(
              "[WhatsApp Lead] Leitura dos funis falhou; não inserimos em qualificação às cegas para não duplicar negócio.",
            );
          }
        } else if (effectiveDestination === "confirmacao") {
          const firstStage = await getFirstStageKey(teamMember.organization_id, "confirmacao");
          await supabase.from("pipe_confirmacao").insert({
            lead_id: existingLead.id,
            status: firstStage,
            responsible_id: effectiveSdrIdForShadow,
            sdr_id: effectiveSdrIdForShadow,
            organization_id: teamMember.organization_id,
          });
        } else if (effectiveDestination === "propostas") {
          const firstStage = await getFirstStageKey(teamMember.organization_id, "propostas");
          await supabase.from("pipe_propostas").insert({
            lead_id: existingLead.id,
            status: firstStage,
            responsible_id: effectiveSdrIdForShadow,
            closer_id: effectiveSdrIdForShadow,
            sale_responsible_id: effectiveSdrIdForShadow,
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
              responsible_id: effectiveSdrIdForShadow,
              sdr_id: effectiveSdrIdForShadow,
            });
          }
        } else if (effectiveDestination === "custom" && customPipelineId && customStageId) {
          await supabase.from("custom_pipe_entries").insert({
            organization_id: teamMember.organization_id,
            pipeline_id: customPipelineId,
            lead_id: existingLead.id,
            stage_id: customStageId,
            assigned_to: effectiveSdrIdForShadow,
          });
        }

        return { leadId: existingLead.id, isNew: false };
      }

      // 2. Criar novo lead
      const leadData: TablesInsert<"leads"> = {
        name: pushName || `WhatsApp ${normalizedPhone.slice(-4)}`,
        phone: normalizedPhone,
        origin: origin || "whatsapp",
        responsible_id: effectiveSdrId,
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

      // 3. Inserir no destino escolhido (using dynamic first stages)
      if (effectiveDestination === "qualificacao") {
        // Verificar se o lead já está ativo em outro pipe antes de inserir em qualificação
        // (tri-estado — ver `pipePresence`)
        const [confRes, propRes] = await Promise.all([
          supabase.from("pipe_confirmacao").select("id").eq("lead_id", newLead.id).limit(1),
          supabase.from("pipe_propostas").select("id").eq("lead_id", newLead.id).limit(1),
        ]);
        const inConfirmacao = pipePresence(confRes);
        const inPropostas = pipePresence(propRes);

        if (inConfirmacao === false && inPropostas === false) {
          const firstStage = await getFirstStageKey(teamMember.organization_id, "whatsapp");
          const { error: pipeError } = await supabase.from("pipe_whatsapp").insert({
            lead_id: newLead.id,
            status: firstStage,
            responsible_id: effectiveSdrId,
            sdr_id: effectiveSdrId,
            organization_id: teamMember.organization_id,
          });
          if (pipeError) {
            console.error("[WhatsApp Lead] Erro ao adicionar ao pipeline qualificação:", pipeError);
          }
        } else if (inConfirmacao === null || inPropostas === null) {
          console.warn(
            "[WhatsApp Lead] Leitura dos funis falhou; não inserimos em qualificação às cegas para não duplicar negócio.",
          );
        } else {
          console.log("[WhatsApp Lead] Lead já está em outro pipe ativo — não inserido em qualificação.");
        }
      } else if (effectiveDestination === "confirmacao") {
        const firstStage = await getFirstStageKey(teamMember.organization_id, "confirmacao");
        const { error: pipeError } = await supabase.from("pipe_confirmacao").insert({
          lead_id: newLead.id,
          status: firstStage,
          responsible_id: effectiveSdrId,
          sdr_id: effectiveSdrId,
          organization_id: teamMember.organization_id,
        });
        if (pipeError) {
          console.error("[WhatsApp Lead] Erro ao adicionar ao pipeline confirmação:", pipeError);
        }
      } else if (effectiveDestination === "propostas") {
        const firstStage = await getFirstStageKey(teamMember.organization_id, "propostas");
        const { error: pipeError } = await supabase.from("pipe_propostas").insert({
          lead_id: newLead.id,
          status: firstStage,
          responsible_id: effectiveSdrId,
          closer_id: effectiveSdrId,
          sale_responsible_id: effectiveSdrId,
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
            responsible_id: effectiveSdrId,
            sdr_id: effectiveSdrId,
          });
          if (campError) {
            console.error("[WhatsApp Lead] Erro ao adicionar à campanha:", campError);
          }
        }
      } else if (effectiveDestination === "custom" && customPipelineId && customStageId) {
        const { error: customError } = await supabase.from("custom_pipe_entries").insert({
          organization_id: teamMember.organization_id,
          pipeline_id: customPipelineId,
          lead_id: newLead.id,
          stage_id: customStageId,
          assigned_to: effectiveSdrId,
        });
        if (customError) {
          console.error("[WhatsApp Lead] Erro ao adicionar ao funil customizado:", customError);
        }
      }
      // destination === "none" → no pipe/campaign insertion

      // 4. Vincular lead_id nas mensagens existentes desse número
      const { error: updateError } = await supabase
        .from("whatsapp_messages")
        .update({ lead_id: newLead.id })
        .eq("normalized_phone", normalizedPhone)
        .is("lead_id", null);

      if (updateError) {
        console.error("[WhatsApp Lead] Erro ao vincular mensagens:", updateError);
      }

      return { leadId: newLead.id, isNew: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline_entries"] });
      queryClient.invalidateQueries({ queryKey: ["campanha_leads"] });
      queryClient.invalidateQueries({ queryKey: ["custom_pipe_entries"] });
      queryClient.invalidateQueries({ queryKey: ["lead_all_pipelines"] });
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
      const normalizedPhone = normalizePhone(phone) || phone.replace(/\D/g, "");

      // 1. Atualizar telefone do lead se necessário
      const { error: leadError } = await supabase
        .from("leads")
        .update({ phone: normalizedPhone })
        .eq("id", leadId)
        .is("phone", null);

      if (leadError) {
        console.error("[WhatsApp Lead] Erro ao atualizar lead:", leadError);
      }

      // 2. Verificar se lead já está no pipeline WhatsApp ou em outro pipe ativo
      // (tri-estado — ver `pipePresence`). Este era o site mais caro do arquivo:
      // vincular é repetível, então com 2 negócios no funil WhatsApp o
      // `.maybeSingle()` devolvia "não existe" e cada vínculo empilhava mais um
      // card — 2 → 3 → 4.
      const [whatsappRes, confRes, propRes] = await Promise.all([
        supabase.from("pipe_whatsapp").select("id").eq("lead_id", leadId).limit(1),
        supabase.from("pipe_confirmacao").select("id").eq("lead_id", leadId).limit(1),
        supabase.from("pipe_propostas").select("id").eq("lead_id", leadId).limit(1),
      ]);
      const existingPipe = pipePresence(whatsappRes);
      const inConfirmacao = pipePresence(confRes);
      const inPropostas = pipePresence(propRes);

      if (existingPipe === null || inConfirmacao === null || inPropostas === null) {
        console.warn(
          "[WhatsApp Lead] Leitura dos funis falhou; não inserimos no pipeline às cegas para não duplicar negócio.",
        );
      } else if (!existingPipe && !inConfirmacao && !inPropostas) {
        if (!teamMember?.id || !teamMember?.organization_id) {
          throw new Error("Usuário não está vinculado a uma organização");
        }
        const firstStage = await getFirstStageKey(teamMember.organization_id, "whatsapp");
        const { error: pipeError } = await supabase.from("pipe_whatsapp").insert({
          lead_id: leadId,
          status: firstStage,
          responsible_id: teamMember.id,
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
        .eq("normalized_phone", normalizedPhone);

      if (updateError) {
        console.error("[WhatsApp Lead] Erro ao vincular mensagens:", updateError);
        throw new Error(updateError.message || "Falha ao vincular mensagens");
      }

      return { leadId };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline_entries"] });
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
      queryClient.invalidateQueries({ queryKey: ["pipeline_entries"] });
      queryClient.invalidateQueries({ queryKey: ["pipe_whatsapp_by_lead"] });
    },
  });
}
