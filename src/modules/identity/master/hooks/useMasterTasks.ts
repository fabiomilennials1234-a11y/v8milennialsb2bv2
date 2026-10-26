import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMasterAuth } from "./useMasterAuth";
import { masterTaskSchema, selectTaskOwners, type MasterTask, type MasterTaskInput, type MasterTaskOwner, type MasterTaskStatus } from "../lib/master-tasks";

const KEY = "master-tasks";

export function useMasterTaskOwners() {
  const { masterUser, isFullMaster } = useMasterAuth();
  return useQuery({
    queryKey: ["master-task-owners", masterUser?.user_id],
    enabled: isFullMaster,
    staleTime: 60_000,
    queryFn: async (): Promise<MasterTaskOwner[]> => {
      const [staff, masters] = await Promise.all([
        supabase.rpc("master_list_staff"),
        supabase.from("master_users").select("id, user_id, permissions").eq("is_active", true),
      ]);
      if (staff.error) throw staff.error;
      if (masters.error) throw masters.error;
      const byId = new Map(masters.data
        .filter(m => m.permissions && typeof m.permissions === "object" && !Array.isArray(m.permissions) && m.permissions.all === true)
        .map(m => [m.id, m.user_id]));
      return selectTaskOwners(staff.data.filter(m => byId.has(m.master_user_id)).map(m => ({
        id: m.master_user_id, userId: byId.get(m.master_user_id)!, name: m.name,
      })));
    },
  });
}

export function useMasterTasks(ownerId: string | null) {
  const { masterUser, isFullMaster } = useMasterAuth();
  return useQuery({
    queryKey: [KEY, masterUser?.user_id, ownerId],
    enabled: isFullMaster && !!ownerId,
    staleTime: 15_000,
    refetchInterval: 30_000,
    queryFn: async (): Promise<MasterTask[]> => {
      if (!ownerId) return [];
      const tasks: MasterTask[] = [];
      const pageSize = 500;
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await supabase.from("master_tasks").select("*")
          .eq("owner_master_user_id", ownerId)
          .order("updated_at", { ascending: false }).order("id").range(offset, offset + pageSize - 1);
        if (error) throw error;
        tasks.push(...(data as MasterTask[]));
        if (data.length < pageSize) return tasks;
      }
    },
  });
}

export function useMasterTaskMutations() {
  const { isFullMaster } = useMasterAuth();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: [KEY] });
  const assertAccess = () => {
    if (!isFullMaster) throw new Error("Você não tem permissão para gerenciar tarefas.");
  };
  const save = useMutation({
    mutationFn: async ({ task, input }: { task?: MasterTask; input: MasterTaskInput }) => {
      assertAccess();
      const values = masterTaskSchema.parse(input);
      const request = task
        ? supabase.from("master_tasks").update(values).eq("id", task.id).eq("updated_at", task.updated_at)
        : supabase.from("master_tasks").insert(values);
      const { data, error } = await request.select("*").single();
      if (error) throw writeError(error);
      return data as MasterTask;
    },
    onSuccess: refresh,
  });
  const move = useMutation({
    mutationFn: async ({ task, status }: { task: MasterTask; status: MasterTaskStatus }) => {
      assertAccess();
      const { error } = await supabase.from("master_tasks").update({ status })
        .eq("id", task.id).eq("updated_at", task.updated_at).select("id").single();
      if (error) throw writeError(error);
    },
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: async (task: MasterTask) => {
      assertAccess();
      const { error } = await supabase.from("master_tasks").delete()
        .eq("id", task.id).eq("updated_at", task.updated_at).select("id").single();
      if (error) throw writeError(error);
    },
    onSuccess: refresh,
  });
  return { save, move, remove };
}

function writeError(error: { code: string; message: string }) {
  return error.code === "PGRST116"
    ? new Error("Esta tarefa mudou ou foi excluída. Atualize o quadro e abra a tarefa novamente.")
    : error;
}
