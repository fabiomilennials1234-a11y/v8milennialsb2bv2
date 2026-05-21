import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";
import { isVirtualTeamMember } from "./useTeamMembers";
import { useRealtimeSubscription } from "./useRealtimeSubscription";
import { toast } from "sonner";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

export type Checklist = Tables<"checklists">;
export type ChecklistInsert = TablesInsert<"checklists">;
export type ChecklistUpdate = TablesUpdate<"checklists">;
export type ChecklistItem = Tables<"checklist_items">;
export type ChecklistItemInsert = TablesInsert<"checklist_items">;
export type ChecklistItemUpdate = TablesUpdate<"checklist_items">;

export interface ChecklistWithCounts extends Checklist {
  total_items: number;
  completed_items: number;
}

// ─── Queries ─────────────────────────────────────────────

export function useChecklists() {
  const { organizationId, isReady } = useOrganization();
  useRealtimeSubscription("checklists", ["checklists"]);

  return useQuery({
    queryKey: ["checklists", organizationId],
    queryFn: async (): Promise<ChecklistWithCounts[]> => {
      if (!organizationId) return [];

      const { data, error } = await supabase
        .from("checklists")
        .select(`*, checklist_items(id, is_completed)`)
        .eq("organization_id", organizationId)
        .is("lead_id", null)
        .order("created_at", { ascending: false });

      if (error) throw error;

      return (data ?? []).map((c: any) => {
        const items = c.checklist_items ?? [];
        return {
          ...c,
          checklist_items: undefined,
          total_items: items.length,
          completed_items: items.filter((i: any) => i.is_completed).length,
        };
      });
    },
    enabled: isReady && !!organizationId,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

export function useChecklistItems(checklistId: string | null) {
  useRealtimeSubscription("checklist_items", ["checklist_items"]);

  return useQuery({
    queryKey: ["checklist_items", checklistId],
    queryFn: async (): Promise<ChecklistItem[]> => {
      if (!checklistId) return [];

      const { data, error } = await supabase
        .from("checklist_items")
        .select("*")
        .eq("checklist_id", checklistId)
        .order("position", { ascending: true });

      if (error) throw error;
      return data ?? [];
    },
    enabled: !!checklistId,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

// ─── Checklist Mutations ─────────────────────────────────

export function useCreateChecklist() {
  const queryClient = useQueryClient();
  const { organizationId, teamMemberId } = useOrganization();

  return useMutation({
    mutationFn: async (input: { title: string; description?: string; lead_id?: string }) => {
      if (!organizationId) throw new Error("Organização não disponível");

      const { data, error } = await supabase
        .from("checklists")
        .insert({
          organization_id: organizationId,
          created_by: teamMemberId && !isVirtualTeamMember(teamMemberId) ? teamMemberId : null,
          title: input.title,
          description: input.description ?? null,
          lead_id: input.lead_id ?? null,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklists"] });
      toast.success("Checklist criado!");
    },
    onError: (error) => {
      toast.error("Erro ao criar checklist", { description: error.message });
    },
  });
}

export function useUpdateChecklist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; title?: string; description?: string; is_completed?: boolean }) => {
      const { data, error } = await supabase
        .from("checklists")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklists"] });
    },
    onError: (error) => {
      toast.error("Erro ao atualizar checklist", { description: error.message });
    },
  });
}

export function useDeleteChecklist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("checklists").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklists"] });
      toast.success("Checklist removido");
    },
    onError: (error) => {
      toast.error("Erro ao remover checklist", { description: error.message });
    },
  });
}

// ─── Item Mutations ──────────────────────────────────────

export function useCreateChecklistItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { checklist_id: string; title: string; position: number }) => {
      const { data, error } = await supabase
        .from("checklist_items")
        .insert({
          checklist_id: input.checklist_id,
          title: input.title,
          position: input.position,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklist_items"] });
      queryClient.invalidateQueries({ queryKey: ["checklists"] });
    },
    onError: (error) => {
      toast.error("Erro ao adicionar item", { description: error.message });
    },
  });
}

export function useToggleChecklistItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      is_completed,
    }: {
      id: string;
      checklist_id: string;
      is_completed: boolean;
    }) => {
      const { error } = await supabase
        .from("checklist_items")
        .update({
          is_completed,
          completed_at: is_completed ? new Date().toISOString() : null,
        })
        .eq("id", id);

      if (error) throw error;
    },
    onMutate: async ({ id, checklist_id, is_completed }) => {
      await queryClient.cancelQueries({ queryKey: ["checklist_items", checklist_id] });

      const prevItems = queryClient.getQueryData<ChecklistItem[]>([
        "checklist_items",
        checklist_id,
      ]);

      const nowIso = new Date().toISOString();
      queryClient.setQueryData<ChecklistItem[]>(
        ["checklist_items", checklist_id],
        (old) =>
          (old ?? []).map((i) =>
            i.id === id
              ? { ...i, is_completed, completed_at: is_completed ? nowIso : null }
              : i,
          ),
      );

      const delta = is_completed ? 1 : -1;
      const patchCounts = (
        old: ChecklistWithCounts[] | undefined,
      ): ChecklistWithCounts[] | undefined =>
        old?.map((c) =>
          c.id === checklist_id
            ? {
                ...c,
                completed_items: Math.max(
                  0,
                  Math.min(c.total_items, c.completed_items + delta),
                ),
              }
            : c,
        );
      queryClient.setQueriesData<ChecklistWithCounts[]>(
        { queryKey: ["checklists"] },
        patchCounts,
      );

      return { prevItems, checklist_id };
    },
    onError: (error, _vars, ctx) => {
      if (ctx?.prevItems) {
        queryClient.setQueryData(
          ["checklist_items", ctx.checklist_id],
          ctx.prevItems,
        );
      }
      queryClient.invalidateQueries({ queryKey: ["checklists"] });
      toast.error("Erro ao atualizar item", { description: error.message });
    },
    onSettled: (_d, _e, vars) => {
      queryClient.invalidateQueries({ queryKey: ["checklist_items", vars.checklist_id] });
      queryClient.invalidateQueries({ queryKey: ["checklists"] });
    },
  });
}

export function useUpdateChecklistItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      const { data, error } = await supabase
        .from("checklist_items")
        .update({ title })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklist_items"] });
    },
    onError: (error) => {
      toast.error("Erro ao editar item", { description: error.message });
    },
  });
}

export function useDeleteChecklistItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("checklist_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklist_items"] });
      queryClient.invalidateQueries({ queryKey: ["checklists"] });
    },
    onError: (error) => {
      toast.error("Erro ao remover item", { description: error.message });
    },
  });
}

export function useReorderChecklistItems() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (items: { id: string; position: number }[]) => {
      const updates = items.map(({ id, position }) =>
        supabase.from("checklist_items").update({ position }).eq("id", id)
      );
      const results = await Promise.all(updates);
      const firstError = results.find((r) => r.error);
      if (firstError?.error) throw firstError.error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checklist_items"] });
    },
    onError: (error) => {
      toast.error("Erro ao reordenar itens", { description: error.message });
    },
  });
}
