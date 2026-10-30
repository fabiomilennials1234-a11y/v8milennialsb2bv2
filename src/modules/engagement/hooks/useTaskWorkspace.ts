import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useIdentity, useOrganization } from '@/modules/identity';
import { notifyError } from '@/shared/errors';
import { toast } from 'sonner';
import { taskRpc } from '../lib/task-api';
import type { TaskConfiguration, TaskQueue } from '../lib/task-types';

export function useTaskQueue(options: {
  assigneeId?: string | null; history?: boolean; future?: boolean; page?: number; entryId?: string | null; enabled?: boolean;team?:boolean;
} = {}) {
  const { organizationId, isReady } = useOrganization();
  const { userId } = useIdentity();
  const { assigneeId=null,history=false,future=false,page=0,entryId=null,enabled=true,team=false } = options;
  return useQuery({
    queryKey: ['task-queue',organizationId,userId,assigneeId,history,future,page,entryId,team],
    enabled: enabled && isReady && !!organizationId && !!userId,
    queryFn: async () => {
      await taskRpc('task_sync_day',{p_org:organizationId});
      return taskRpc<TaskQueue>('task_queue',{
        p_org:organizationId,p_assignee:assigneeId,p_history:history,p_future:future,p_offset:page*100,p_entry:entryId,p_team:team,
      });
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useTaskConfiguration(enabled=true) {
  const { organizationId,isReady } = useOrganization();
  const { userId,isAdmin } = useIdentity();
  return useQuery({
    queryKey: ['task-configuration',organizationId,userId],
    enabled: enabled && isAdmin && isReady && !!organizationId,
    queryFn: async () => {
      await taskRpc('task_sync_day',{p_org:organizationId});
      return taskRpc<TaskConfiguration>('task_configuration',{p_org:organizationId});
    },
    staleTime: 30_000,
  });
}

export function useTaskWrite() {
  const queryClient=useQueryClient();
  const { organizationId }=useOrganization();
  return useMutation({
    mutationFn: async (operation:
      | { rpc:'task_save_activity' | 'task_save_routine' | 'task_create_manual' | 'task_assign'; args:Record<string,unknown> }
      | { rpc:'task_transition'; args:{p_id:string;p_action:'start'|'complete';p_result?:string} }
    ) => {
      if (!organizationId) throw new Error('Organização não disponível.');
      return taskRpc(operation.rpc,operation.rpc==='task_transition'?operation.args:{...operation.args,p_org:organizationId});
    },
    onSuccess: (_data,operation) => {
      void queryClient.invalidateQueries({queryKey:['task-queue']});
      void queryClient.invalidateQueries({queryKey:['task-configuration']});
      void queryClient.invalidateQueries({queryKey:['checklists']});
      toast.success(operation.rpc==='task_transition'?'Tarefa atualizada.':operation.rpc==='task_assign'?'Atividade atribuída.':'Configuração salva.');
    },
    onError: (error)=>notifyError(error,{fallback:'Não foi possível salvar a tarefa.'}),
  });
}
