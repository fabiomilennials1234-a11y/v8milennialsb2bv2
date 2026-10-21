export type TaskKind = 'task' | 'call' | 'message' | 'meeting';
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'missed';
export type TaskPriority = 'low' | 'medium' | 'high';
export type TaskAudience = 'owner' | 'team' | 'members';
export interface WorkItem {
  id: string;
  origin: 'member' | 'admin';
  priority: TaskPriority;
  daily_action_id?:string;
  title: string;
  kind: TaskKind;
  status: TaskStatus;
  assignee_id: string | null;
  assignee_name: string | null;
  pipeline_entry_id: string | null;
  routine_id: string | null;
  instructions: string;
  message_template: string;
  required: boolean;
  due_at: string;
  work_date: string;
  completed_at: string | null;
  result: string | null;
  lead_name: string | null;
  lead_id: string | null;
  stage_name: string | null;
  pipeline_name: string | null;
  advanced_with_pending: boolean;
  overdue: boolean;
}
export interface TaskOverview {
  id: string;
  name: string;
  open_count: number;
  completed_today: number;
  overdue: number;
}
export interface TaskQueue {
  items: WorkItem[];
  total: number;
  overdue: number;
  overview: TaskOverview[];
}
export interface PlaybookActivity {
  id: string;
  stage_id: string;
  title: string;
  kind: TaskKind;
  due_days: number;
  required: boolean;
  instructions: string;
  message_template: string;
  position: number;
  enabled: boolean;
  source_checklist_item_id: string | null;
  priority:TaskPriority;
  audience:TaskAudience;
  member_ids:string[];
}
export interface TaskRoutine {
  id: string;
  assignee_id: string | null;
  title: string;
  instructions: string;
  weekdays: number[];
  due_time: string;
  enabled: boolean;
  priority:TaskPriority;
  audience:'team'|'members';
  member_ids:string[];
}
export interface TaskConfiguration {
  activities: PlaybookActivity[];
  routines: TaskRoutine[];
  stages: { id: string; name: string; pipeline_id: string; pipeline_name: string }[];
  members: { id: string; name: string }[];
}
export interface PendingStageTask { id: string; title: string; entry_id?:string;lead_name?:string|null }
export interface TaskStageException {
  id:string;reason:string;created_at:string;actor_name:string;
  source_stage:string|null;target_stage:string|null;pending_titles:string[]|null;
}
export const TASK_KIND_LABELS: Record<TaskKind,string> = {
  task: 'Tarefa', call: 'Ligação', message: 'Mensagem', meeting: 'Reunião',
};
export const TASK_STATUS_LABELS: Record<TaskStatus,string> = {
  pending: 'Pendente', in_progress: 'Em andamento', completed: 'Concluída', missed: 'Não feita',
};
export const TASK_PRIORITY_LABELS:Record<TaskPriority,string>={low:'Baixa',medium:'Média',high:'Alta'};
export const audienceLabel=(audience:TaskAudience,memberIds:string[],members:TaskConfiguration['members'])=>
  audience==='owner'?'Responsável pelo negócio':audience==='team'?'Toda a equipe':memberIds.map(id=>members.find(m=>m.id===id)?.name??'Membro inativo').join(', ');
