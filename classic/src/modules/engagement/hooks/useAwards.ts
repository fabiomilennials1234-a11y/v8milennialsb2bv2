import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface Award {
  id: string;
  name: string;
  type: string;
  description: string | null;
  threshold: number;
  prize_description: string | null;
  prize_value: number | null;
  month: number | null;
  year: number | null;
  is_active: boolean;
  created_at: string;
}

export function useAwards(month?: number, year?: number) {
  return useQuery({
    queryKey: ["awards", month, year],
    queryFn: async () => {
      let query = supabase
        .from("awards")
        .select("*")
        .eq("is_active", true)
        .order("threshold", { ascending: false });

      if (month && year) {
        query = query
          .or(`month.is.null,month.eq.${month}`)
          .or(`year.is.null,year.eq.${year}`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as Award[];
    },
  });
}

export function useCreateAward() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (award: Omit<Award, "id" | "created_at">) => {
      const { data, error } = await supabase
        .from("awards")
        .insert([award])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["awards"] });
      toast.success("Premiação criada com sucesso!");
    },
    onError: (error) => {
      toast.error("Erro ao criar premiação: " + error.message);
    },
  });
}

export function useUpdateAward() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Award> & { id: string }) => {
      const { data, error } = await supabase
        .from("awards")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["awards"] });
      toast.success("Premiação atualizada com sucesso!");
    },
    onError: (error) => {
      toast.error("Erro ao atualizar premiação: " + error.message);
    },
  });
}

export function useDeleteAward() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("awards").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["awards"] });
      toast.success("Premiação removida com sucesso!");
    },
    onError: (error) => {
      toast.error("Erro ao remover premiação: " + error.message);
    },
  });
}
