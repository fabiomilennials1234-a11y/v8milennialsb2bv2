import { ArrowUpRight, Check, ClipboardList, MessageSquare, Phone, Play, CalendarDays } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { TASK_KIND_LABELS,TASK_STATUS_LABELS,TASK_PRIORITY_LABELS,type WorkItem } from '../../lib/task-types';

const ICONS={task:ClipboardList,call:Phone,message:MessageSquare,meeting:CalendarDays};
export function TaskList({items,myMemberId,busy=false,onSelect,onAction,onOpenDeal,onRemove,timezone='America/Sao_Paulo'}: {
  items:WorkItem[];myMemberId:string|null;busy?:boolean;timezone?:string;
  onRemove?:(item:WorkItem)=>void;
  onSelect:(item:WorkItem)=>void;
  onAction:(item:WorkItem,action:'start'|'complete')=>void;
  onOpenDeal?:(item:WorkItem)=>void;
}) {
  const groups=[{origin:'member',label:'Criadas por você'},{origin:'admin',label:'Criadas pelo admin'}] as const;
  const ordered=groups.flatMap(group=>items.filter(item=>item.origin===group.origin));
  const running=ordered.find(t=>t.assignee_id===myMemberId && t.status==='in_progress');
  const next=running ?? ordered.find(t=>t.assignee_id===myMemberId && t.status==='pending');
  return <ul className="divide-y divide-border" aria-label="Lista de tarefas">
    {groups.map(group=>{
      const rows=ordered.filter(item=>item.origin===group.origin);
      if(!rows.length)return null;
      return <li key={group.origin}>
        <h3 className="px-4 pb-1 pt-4 text-[11px] font-semibold text-muted-foreground">{group.label}</h3>
        <ul className="divide-y divide-border" aria-label={group.label}>{rows.map(item=>{
      const Icon=ICONS[item.kind];
      const mine=!!myMemberId && item.assignee_id===myMemberId;
      const open=item.status==='pending' || item.status==='in_progress';
      return <li key={item.id} className={cn('flex flex-wrap items-start gap-3 p-4',item.status==='in_progress' && 'bg-primary/5')}>
        <span className="mt-1 grid size-9 shrink-0 place-items-center rounded-xl bg-muted"><Icon className="size-4"/></span>
        <button type="button" className="min-w-0 flex-1 text-left" onClick={()=>onSelect(item)}>
          <span className="block text-sm font-semibold">{item.title}</span>
          <span className="mt-1 block text-xs text-muted-foreground">{[item.lead_name,item.pipeline_name,item.stage_name].filter(Boolean).join(' · ') || (item.routine_id?'Rotina diária':item.origin==='admin'?'Atividade definida pelo admin':'Tarefa pessoal')}</span>
          <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{TASK_KIND_LABELS[item.kind]}</span><span>{item.assignee_name ?? 'Sem responsável'}</span>
            <span>{new Intl.DateTimeFormat('pt-BR',{timeZone:timezone,dateStyle:'short',timeStyle:'short'}).format(new Date(item.due_at))}</span>
            <span className={cn(item.overdue && 'font-semibold text-destructive')}>{item.overdue?'Atrasada':TASK_STATUS_LABELS[item.status]}</span>
            <span className={cn(item.priority==='high' && 'font-semibold text-destructive')}>Prioridade {TASK_PRIORITY_LABELS[item.priority].toLowerCase()}</span>
            {item.required && <span>Obrigatória</span>}
            {item.advanced_with_pending && <span className="font-semibold text-amber-600">Avançou com pendência</span>}
          </span>
        </button>
        <div className="flex flex-wrap gap-2">
          {(item.pipeline_entry_id || item.lead_id) && onOpenDeal && <Button variant="ghost" size="sm" onClick={()=>onOpenDeal(item)} aria-label={`Abrir negócio de ${item.title}`}><ArrowUpRight className="size-4"/><span className="sr-only sm:not-sr-only">Negócio</span></Button>}
          {mine && open && <Button size="sm" variant={item.status==='in_progress'?'default':'outline'}
            disabled={busy || (!!running && running.id!==item.id)} onClick={()=>onAction(item,item.status==='in_progress'?'complete':'start')}>
            {item.status==='in_progress'?<Check className="mr-1 size-3.5"/>:<Play className="mr-1 size-3.5"/>}
            {item.status==='in_progress'?'Concluir':item.id===next?.id?'Começar':'Iniciar'}
          </Button>}
          {mine && item.daily_action_id && onRemove && <Button size="sm" variant="ghost" disabled={busy} onClick={()=>onRemove(item)} aria-label={`Remover ${item.title}`}>Remover</Button>}
        </div>
      </li>;
        })}</ul>
      </li>;
    })}
  </ul>;
}
