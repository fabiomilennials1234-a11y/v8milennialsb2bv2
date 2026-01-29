import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface PipePropostaItem {
  id: string;
  pipe_proposta_id: string;
  product_id: string | null;
  sale_value: number | null;
  created_at: string;
  product?: {
    id: string;
    name: string;
    type: "mrr" | "projeto";
    ticket: number | null;
    ticket_minimo: number | null;
  };
}

export interface PipePropostaItemInsert {
  pipe_proposta_id: string;
  product_id: string | null;
  sale_value: number | null;
}

export function usePipePropostaItems(propostaId: string | null | undefined) {
  return useQuery({
    queryKey: ["pipe_proposta_items", propostaId],
    queryFn: async () => {
      if (!propostaId) return [];
      
      const { data, error } = await supabase
        .from("pipe_proposta_items")
        .select(`
          *,
          product:products(id, name, type, ticket, ticket_minimo)
        `)
        .eq("pipe_proposta_id", propostaId)
        .order("created_at", { ascending: true });
      
      if (error) throw error;
      return data as PipePropostaItem[];
    },
    enabled: !!propostaId,
  });
}

export function useCreatePipePropostaItem() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (item: PipePropostaItemInsert) => {
      const { data, error } = await supabase
        .from("pipe_proposta_items")
        .insert(item)
        .select(`
          *,
          product:products(id, name, type, ticket, ticket_minimo)
        `)
        .single();
      
      if (error) throw error;
      return data as PipePropostaItem;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["pipe_proposta_items", data.pipe_proposta_id] });
      queryClient.invalidateQueries({ queryKey: ["pipe_propostas"] });
    },
  });
}

export function useCreateManyPipePropostaItems() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (items: PipePropostaItemInsert[]) => {
      if (items.length === 0) return [];
      
      const { data, error } = await supabase
        .from("pipe_proposta_items")
        .insert(items)
        .select(`
          *,
          product:products(id, name, type, ticket, ticket_minimo)
        `);
      
      if (error) throw error;
      return data as PipePropostaItem[];
    },
    onSuccess: (data) => {
      if (data.length > 0) {
        queryClient.invalidateQueries({ queryKey: ["pipe_proposta_items", data[0].pipe_proposta_id] });
        queryClient.invalidateQueries({ queryKey: ["pipe_propostas"] });
      }
    },
  });
}

export function useUpdatePipePropostaItem() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; product_id?: string | null; sale_value?: number | null }) => {
      const { data, error } = await supabase
        .from("pipe_proposta_items")
        .update(updates)
        .eq("id", id)
        .select(`
          *,
          product:products(id, name, type, ticket, ticket_minimo)
        `)
        .single();
      
      if (error) throw error;
      return data as PipePropostaItem;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["pipe_proposta_items", data.pipe_proposta_id] });
      queryClient.invalidateQueries({ queryKey: ["pipe_propostas"] });
    },
  });
}

export function useDeletePipePropostaItem() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, propostaId }: { id: string; propostaId: string }) => {
      const { error } = await supabase
        .from("pipe_proposta_items")
        .delete()
        .eq("id", id);
      
      if (error) throw error;
      return { propostaId };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["pipe_proposta_items", data.propostaId] });
      queryClient.invalidateQueries({ queryKey: ["pipe_propostas"] });
    },
  });
}
