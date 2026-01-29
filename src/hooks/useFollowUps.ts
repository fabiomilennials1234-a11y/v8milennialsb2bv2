import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useRealtimeSubscription } from "./useRealtimeSubscription";

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
}

export function useFollowUps(filters?: { 
  assignedTo?: string;
  showCompleted?: boolean;
  showArchived?: boolean;
  dateFilter?: "today" | "overdue" | "upcoming" | "all";
}) {
  useRealtimeSubscription("follow_ups", ["follow_ups"]);
  
  return useQuery({
    queryKey: ["follow_ups", filters],
    queryFn: async () => {
      let query = supabase
        .from("follow_ups")
        .select(`
          *,
          lead:leads(id, name, company, phone, email),
          team_member:team_members!follow_ups_assigned_to_fkey(id, name, role)
        `)
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

      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      if (filters?.dateFilter === "today") {
        query = query
          .gte("due_date", today.toISOString())
          .lt("due_date", tomorrow.toISOString());
      } else if (filters?.dateFilter === "overdue") {
        query = query.lt("due_date", today.toISOString());
      } else if (filters?.dateFilter === "upcoming") {
        query = query.gte("due_date", tomorrow.toISOString());
      }

      const { data, error } = await query;
      
      if (error) throw error;
      return data as unknown as FollowUp[];
    },
  });
}

export function useFollowUpAutomations() {
  return useQuery({
    queryKey: ["follow_up_automations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("follow_up_automations")
        .select("*")
        .order("pipe_type", { ascending: true })
        .order("stage", { ascending: true });

      if (error) throw error;
      return data as unknown as FollowUpAutomation[];
    },
  });
}

export function useCreateFollowUp() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

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
      is_automated?: boolean;
    }) => {
      const { data, error } = await supabase
        .from("follow_ups")
        .insert(followUp)
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

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<FollowUp> & { id: string }) => {
      const { data, error } = await supabase
        .from("follow_ups")
        .update(updates)
        .eq("id", id)
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

  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("follow_ups")
        .update({ completed_at: new Date().toISOString() })
        .eq("id", id)
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

  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("follow_ups")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", id)
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

  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return { count: 0 };
      const { error } = await supabase
        .from("follow_ups")
        .update({ archived_at: new Date().toISOString() })
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

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("follow_ups")
        .delete()
        .eq("id", id);

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

  return useMutation({
    mutationFn: async (automation: {
      pipe_type: "whatsapp" | "confirmacao" | "propostas";
      stage: string;
      title_template: string;
      description_template?: string;
      days_offset?: number;
      priority?: "low" | "normal" | "high" | "urgent";
      is_active?: boolean;
    }) => {
      const { data, error } = await supabase
        .from("follow_up_automations")
        .insert(automation)
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
      // Fetch active automations for this pipe and stage
      const { data: automations, error: automationsError } = await supabase
        .from("follow_up_automations")
        .select("*")
        .eq("pipe_type", pipeType)
        .eq("stage", stage)
        .eq("is_active", true);

      if (automationsError) throw automationsError;
      if (!automations || automations.length === 0) return [];

      // Create follow ups for each automation
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
