import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface AcaoDoDia {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  proposta_id: string | null;
  lead_id: string | null;
  confirmacao_id: string | null;
  follow_up_id: string | null;
  is_completed: boolean;
  position: number;
  created_at: string;
  completed_at: string | null;
  // Joined data
  proposta?: {
    id: string;
    lead?: { name: string; company: string | null; phone: string | null; email: string | null };
    sale_value: number | null;
  } | null;
  lead?: { id: string; name: string; company: string | null; phone: string | null; email: string | null } | null;
  confirmacao?: { id: string; lead?: { name: string; phone: string | null; email: string | null; company: string | null } } | null;
  follow_up?: { id: string; title: string; lead?: { name: string; phone: string | null; email: string | null; company: string | null } } | null;
}

export interface CreateAcaoDoDiaInput {
  title: string;
  description?: string;
  proposta_id?: string;
  lead_id?: string;
  confirmacao_id?: string;
  follow_up_id?: string;
}

export function useAcoesDoDia() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["acoes_do_dia", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];

      const { data, error } = await supabase
        .from("acoes_do_dia")
        .select(`
          *,
          proposta:pipe_propostas(
            id,
            sale_value,
            lead:leads(name, company, phone, email)
          ),
          lead:leads(id, name, company, phone, email),
          confirmacao:pipe_confirmacao(
            id,
            lead:leads(name, phone, email, company)
          ),
          follow_up:follow_ups(id, title, lead:leads(name, phone, email, company))
        `)
        .eq("user_id", user.id)
        .order("is_completed", { ascending: true })
        .order("position", { ascending: true })
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as AcaoDoDia[];
    },
    enabled: !!user?.id,
  });
}

export function useCreateAcaoDoDia() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: CreateAcaoDoDiaInput) => {
      if (!user?.id) throw new Error("User not authenticated");

      const { data, error } = await supabase
        .from("acoes_do_dia")
        .insert({
          user_id: user.id,
          title: input.title,
          description: input.description || null,
          proposta_id: input.proposta_id || null,
          lead_id: input.lead_id || null,
          confirmacao_id: input.confirmacao_id || null,
          follow_up_id: input.follow_up_id || null,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["acoes_do_dia"] });
      toast.success("Ação adicionada às tarefas do dia!");
    },
    onError: () => {
      toast.error("Erro ao criar ação do dia");
    },
  });
}

export function useCompleteAcaoDoDia() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("acoes_do_dia")
        .update({
          is_completed: true,
          completed_at: new Date().toISOString(),
        })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["acoes_do_dia"] });
      toast.success("Tarefa concluída!");
    },
    onError: () => {
      toast.error("Erro ao completar tarefa");
    },
  });
}

export function useUncompleteAcaoDoDia() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("acoes_do_dia")
        .update({
          is_completed: false,
          completed_at: null,
        })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["acoes_do_dia"] });
    },
    onError: () => {
      toast.error("Erro ao desfazer conclusão");
    },
  });
}

export function useDeleteAcaoDoDia() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("acoes_do_dia")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["acoes_do_dia"] });
      toast.success("Tarefa removida");
    },
    onError: () => {
      toast.error("Erro ao remover tarefa");
    },
  });
}

export function useUpdateAcaoDoDiaPosition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, position }: { id: string; position: number }) => {
      const { error } = await supabase
        .from("acoes_do_dia")
        .update({ position })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["acoes_do_dia"] });
    },
  });
}
