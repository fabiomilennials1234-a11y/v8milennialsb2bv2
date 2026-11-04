import { supabase } from '@/integrations/supabase/client';

type TaskRpc = 'task_sync_day' | 'task_queue' | 'task_configuration' | 'task_save_activity'
  | 'task_save_routine' | 'task_transition' | 'task_pending_for_move' | 'task_authorize_move' | 'task_pending_for_moves' | 'task_authorize_moves' | 'task_open_entries_for_leads' | 'task_create_manual' | 'task_assign' | 'task_entry_history';

// The migration has not been applied to production. Keep this narrow adapter
// until generated types can be refreshed from the deployed schema.
export async function taskRpc<T>(name: TaskRpc, args: Record<string,unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name as never,args as never);
  if (error) throw error;
  return data as T;
}
