import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useRealtimeSubscription } from "@/shared/realtime/useRealtimeSubscription";
import { useOrganization } from "@/modules/identity";
import { limitesDoDia } from "@/shared/time/dia-da-org";
export interface FollowUp {
  id: string;
  lead_id: string;
  assigned_to: string | null;
  title: string;
  description: string | null;
  due_date: string;
  completed_at: string | null;
  archived_at: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  source_pipe: "whatsapp" | "confirmacao" | "propostas" | null;
  source_pipe_id: string | null;
  /**
   * O Negócio dono da tarefa — `pipeline_entries.id`.
   *
   * **Nulo = tarefa da PESSOA**, vale para todos os negócios dela (decisão do
   * CTO em 2026-08-25, mesma regra do checklist — ADR-0031).
   *
   * Não é o mesmo que `source_pipe_id`, que era a meia-ponte antiga: texto do
   * funil + uuid sem FK, preenchido em 373 das 1.185 linhas e apontando para
   * card inexistente em 63 delas. `pipeline_entry_id` é a coluna canônica, com
   * FK; a antiga fica até ser aposentada em fatia própria.
   *
   * Declarado à mão: `integrations/supabase/types.ts` é gerado e ainda não foi
   * regenerado — regerar a partir de branch efêmera corrompe o arquivo.
   */
  pipeline_entry_id?: string | null;
  deal_id?: string | null;
  is_automated: boolean;
  created_at: string;
  updated_at: string;
  lead?: {
    id: string;
    name: string;
    company: string | null;
    phone: string | null;
    email: string | null;
  };
  team_member?: {
    id: string;
    name: string;
    role: string;
  };
}

export type TriggerType = "stage_change" | "no_response_from_team" | "no_response_from_lead" | "not_confirmed";

export interface FollowUpAutomation {
  id: string;
  pipe_type: "whatsapp" | "confirmacao" | "propostas";
  stage: string;
  title_template: string;
  description_template: string | null;
  days_offset: number;
  priority: "low" | "normal" | "high" | "urgent";
  is_active: boolean;
  created_at: string;
  updated_at: string;
  trigger_type: TriggerType;
  trigger_delay_hours: number;
  trigger_delay_minutes: number;
  max_triggers_per_lead: number;
  copilot_can_handle: boolean;
  organization_id: string | null;
  filter_stages: string[] | null;
}

export function useFollowUps(filters?: {
  assignedTo?: string;
  showCompleted?: boolean;
  showArchived?: boolean;
  dateFilter?: "today" | "overdue" | "upcoming" | "all";
}) {
  const { organizationId, isReady, timezone } = useOrganization();
  useRealtimeSubscription("follow_ups", ["follow_ups"]);

  return useQuery({
    // `timezone` entra na chave: a fronteira do dia abaixo depende dele, e ele
    // chega null nos primeiros renders. Sem isto, o resultado calculado com o
    // fallback UTC ficaria cacheado e a lista não se corrigiria quando a org
    // resolvesse.
    queryKey: ["follow_ups", filters, organizationId, timezone],
    queryFn: async () => {
      if (!organizationId) return [];
      let query = supabase
        .from("follow_ups")
        .select(`
          *,
          lead:leads(id, name, company, phone, email),
          team_member:team_members!follow_ups_assigned_to_fkey(id, name, role)
        `)
        .eq("organization_id", organizationId)
        .order("due_date", { ascending: true });

      if (filters?.assignedTo) {
        query = query.eq("assigned_to", filters.assignedTo);
      }

      if (!filters?.showArchived) {
        query = query.is("archived_at", null);
      }

      if (!filters?.showCompleted) {
        query = query.is("completed_at", null);
      }

      // O corte é o da ORG, não o do browser. `new Date(y, m, d)` — que estava
      // aqui — usa o fuso da máquina de quem abriu a tela: dois vendedores da
      // mesma organização, em fusos diferentes, viam listas de "atrasados"
      // diferentes. Mesma regra que a aba Comando já aplicava às tarefas do dia.
      const { inicioDeHoje, inicioDeAmanha } = limitesDoDia(timezone);

      if (filters?.dateFilter === "today") {
        query = query
          .gte("due_date", inicioDeHoje)
          .lt("due_date", inicioDeAmanha);
      } else if (filters?.dateFilter === "overdue") {
        query = query.lt("due_date", inicioDeHoje);
      } else if (filters?.dateFilter === "upcoming") {
        query = query.gte("due_date", inicioDeAmanha);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data as unknown as FollowUp[];
    },
    enabled: isReady && !!organizationId,
    staleTime: 5 * 60 * 1000, // 5 minutos
  });
}

export function useFollowUpAutomations(triggerType?: TriggerType) {
  const { organizationId } = useOrganization();

  return useQuery({
    queryKey: ["follow_up_automations", triggerType, organizationId],
    queryFn: async () => {
      let query = supabase
        .from("follow_up_automations")
        .select("*")
        .order("pipe_type", { ascending: true })
        .order("stage", { ascending: true });

      if (triggerType) {
        query = query.eq("trigger_type", triggerType);
      }

      // Para regras baseadas em tempo, filtrar por organização
      if (triggerType && triggerType !== "stage_change" && organizationId) {
        query = query.eq("organization_id", organizationId);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data as unknown as FollowUpAutomation[];
    },
    staleTime: 5 * 60 * 1000, // 5 minutos
  });
}

export function useCreateFollowUp() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (followUp: {
      lead_id: string;
      assigned_to?: string;
      title: string;
      description?: string;
      due_date: string;
      priority?: "low" | "normal" | "high" | "urgent";
      source_pipe?: "whatsapp" | "confirmacao" | "propostas";
      source_pipe_id?: string;
      /** O Negócio dono da tarefa. Ausente = tarefa da pessoa. */
      pipeline_entry_id?: string | null;
      is_automated?: boolean;
    }) => {
      if (!organizationId) throw new Error("Organização não disponível");
      const secured = { ...followUp, organization_id: organizationId };
      const { data, error } = await supabase
        .from("follow_ups")
        // `as never`: `pipeline_entry_id` existe desde a migration
        // `20270828000030` e ainda não está nos tipos gerados.
        .insert(secured as never)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["follow_ups"] });
      toast({
        title: "Follow up criado",
        description: "Tarefa agendada com sucesso!",
      });
    },
    onError: (error) => {
      toast({
        title: "Erro ao criar follow up",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useUpdateFollowUp() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<FollowUp> & { id: string }) => {
      if (!organizationId) throw new Error("Organização não disponível");
      const { organization_id: _, ...safeUpdates } = updates as Partial<FollowUp> & { organization_id?: string };
      const { data, error } = await supabase
        .from("follow_ups")
        .update(safeUpdates)
        .eq("id", id)
        .eq("organization_id", organizationId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["follow_ups"] });
    },
    onError: (error) => {
      toast({
        title: "Erro ao atualizar follow up",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useCompleteFollowUp() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async ({ id, completion_notes }: { id: string; completion_notes?: string }) => {
      if (!organizationId) throw new Error("Organização não disponível");
      const updateData: Record<string, string> = { completed_at: new Date().toISOString() };
      if (completion_notes) updateData.completion_notes = completion_notes;
      const { data, error } = await supabase
        .from("follow_ups")
        .update(updateData)
        .eq("id", id)
        .eq("organization_id", organizationId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["follow_ups"] });
      toast({
        title: "Tarefa concluída! ✅",
        description: "Follow up marcado como concluído.",
      });
    },
    onError: (error) => {
      toast({
        title: "Erro ao concluir follow up",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useArchiveFollowUp() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (id: string) => {
      if (!organizationId) throw new Error("Organização não disponível");
      const { data, error } = await supabase
        .from("follow_ups")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", id)
        .eq("organization_id", organizationId)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["follow_ups"] });
      toast({
        title: "Tarefa arquivada",
        description: "A tarefa foi arquivada e não aparecerá na lista principal.",
      });
    },
    onError: (error) => {
      toast({
        title: "Erro ao arquivar",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useArchiveManyFollowUps() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (!organizationId) throw new Error("Organização não disponível");
      if (ids.length === 0) return { count: 0 };
      const { error } = await supabase
        .from("follow_ups")
        .update({ archived_at: new Date().toISOString() })
        .eq("organization_id", organizationId)
        .in("id", ids);

      if (error) throw error;
      return { count: ids.length };
    },
    onSuccess: (_, ids) => {
      queryClient.invalidateQueries({ queryKey: ["follow_ups"] });
      toast({
        title: "Tarefas arquivadas",
        description: `${ids.length} tarefa(s) arquivada(s).`,
      });
    },
    onError: (error) => {
      toast({
        title: "Erro ao arquivar",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useDeleteFollowUp() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (id: string) => {
      if (!organizationId) throw new Error("Organização não disponível");
      const { error } = await supabase
        .from("follow_ups")
        .delete()
        .eq("id", id)
        .eq("organization_id", organizationId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["follow_ups"] });
      toast({
        title: "Follow up excluído",
        description: "Tarefa removida com sucesso.",
      });
    },
    onError: (error) => {
      toast({
        title: "Erro ao excluir follow up",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useCreateFollowUpAutomation() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (automation: {
      pipe_type: "whatsapp" | "confirmacao" | "propostas";
      stage: string;
      title_template: string;
      description_template?: string;
      days_offset?: number;
      priority?: "low" | "normal" | "high" | "urgent";
      is_active?: boolean;
      trigger_type?: TriggerType;
      trigger_delay_hours?: number;
      trigger_delay_minutes?: number;
      max_triggers_per_lead?: number;
      copilot_can_handle?: boolean;
      filter_stages?: string[];
    }) => {
      const payload = {
        ...automation,
        // Para regras baseadas em tempo, incluir organization_id
        ...(automation.trigger_type && automation.trigger_type !== "stage_change"
          ? { organization_id: organizationId }
          : {}),
      };
      const { data, error } = await supabase
        .from("follow_up_automations")
        .insert(payload)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["follow_up_automations"] });
      toast({
        title: "Automação criada",
        description: "Nova automação configurada com sucesso!",
      });
    },
    onError: (error) => {
      toast({
        title: "Erro ao criar automação",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useUpdateFollowUpAutomation() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<FollowUpAutomation> & { id: string }) => {
      const { data, error } = await supabase
        .from("follow_up_automations")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["follow_up_automations"] });
      toast({
        title: "Automação atualizada",
        description: "Configuração salva com sucesso!",
      });
    },
    onError: (error) => {
      toast({
        title: "Erro ao atualizar automação",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useDeleteFollowUpAutomation() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("follow_up_automations")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["follow_up_automations"] });
      toast({
        title: "Automação excluída",
        description: "Automação removida com sucesso.",
      });
    },
    onError: (error) => {
      toast({
        title: "Erro ao excluir automação",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

export function useCreateAutomatedFollowUps() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async ({
      leadId,
      assignedTo,
      pipeType,
      stage,
      sourcePipeId,
    }: {
      leadId: string;
      assignedTo: string;
      pipeType: "whatsapp" | "confirmacao" | "propostas";
      stage: string;
      sourcePipeId: string;
    }) => {
      if (!organizationId) throw new Error("Organização não disponível");

      // Fetch active automations for this pipe and stage
      const { data: automations, error: automationsError } = await supabase
        .from("follow_up_automations")
        .select("id, pipe_type, stage, title_template, description_template, days_offset, priority, is_active, trigger_type")
        .eq("pipe_type", pipeType)
        .eq("stage", stage)
        .eq("is_active", true);

      if (automationsError) throw automationsError;
      if (!automations || automations.length === 0) return [];

      // Create follow ups for each automation (scoped to current organization)
      const followUps = automations.map((automation: FollowUpAutomation) => {
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + automation.days_offset);

        return {
          lead_id: leadId,
          assigned_to: assignedTo,
          title: automation.title_template,
          description: automation.description_template,
          due_date: dueDate.toISOString(),
          priority: automation.priority,
          source_pipe: pipeType,
          source_pipe_id: sourcePipeId,
          is_automated: true,
          organization_id: organizationId,
        };
      });

      const { data, error } = await supabase
        .from("follow_ups")
        .insert(followUps)
        .select();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["follow_ups"] });
    },
  });
}
