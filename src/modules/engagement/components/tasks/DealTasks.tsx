import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useIdentity,useOrganization } from '@/modules/identity';
import { Button } from '@/components/ui/button';
import { taskRpc } from '../../lib/task-api';
import { useTaskQueue,useTaskWrite } from '../../hooks/useTaskWorkspace';
import type { TaskStageException,WorkItem } from '../../lib/task-types';
import { TaskList } from './TaskList';
import { TaskDetails } from './TaskDetails';

export function DealTasks({entryId}:{entryId:string}) {
  const {teamMemberId,userId}=useIdentity();const {organizationId,timezone}=useOrganization();
  const [history,setHistory]=useState(false);const [selected,setSelected]=useState<WorkItem|null>(null);
  const queue=useTaskQueue({entryId,history});const write=useTaskWrite();
  const events=useQuery({queryKey:['task-entry-history',organizationId,userId,entryId],
    queryFn:()=>taskRpc<TaskStageException[]>('task_entry_history',{p_entry:entryId}),enabled:!!organizationId,staleTime:30_000});
  const action=async(item:WorkItem,type:'start'|'complete',result?:string)=>{
    try{await write.mutateAsync({rpc:'task_transition',args:{p_id:item.id,p_action:type,p_result:result}});setSelected(type==='start'?{...item,status:'in_progress'}:null);}catch{/* onError reports the failure */}
  };
  if(queue.isError) return <p className="text-sm text-muted-foreground">Não foi possível carregar as atividades. <button className="text-primary" onClick={()=>void queue.refetch()}>Tentar novamente</button></p>;
  return <section className="space-y-3" aria-label="Atividades do playbook">
    <header className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">Atividades do playbook</h3><Button variant="ghost" size="sm" onClick={()=>setHistory(v=>!v)}>{history?'Ver pendentes':'Ver concluídas'}</Button></header>
    {queue.isLoading?<p className="text-xs text-muted-foreground">Carregando…</p>:queue.data?.items.length?
      <TaskList items={queue.data.items} myMemberId={teamMemberId} timezone={timezone??'America/Sao_Paulo'} busy={write.isPending} onSelect={setSelected} onAction={(item,type)=>type==='complete'?setSelected(item):void action(item,type)}/>:
      <p className="text-xs text-muted-foreground">{history?'Nenhuma atividade concluída.':'Nenhuma atividade pendente deste playbook.'}</p>}
    {!!events.data?.length && <div className="space-y-2 border-t pt-3"><h4 className="text-xs font-semibold">Avançou com pendência</h4>{events.data.map(e=><article key={e.id} className="rounded-lg bg-amber-500/5 p-3 text-xs">
      <p className="font-semibold">{e.actor_name} · {e.source_stage??'Etapa anterior'} → {e.target_stage??'Etapa seguinte'}</p>
      <p className="mt-1 whitespace-pre-wrap">{e.reason}</p><p className="mt-1 text-muted-foreground">{e.pending_titles?.join(' · ')}</p>
    </article>)}</div>}
    {selected && <TaskDetails key={selected.id} item={selected} timezone={timezone??'America/Sao_Paulo'} busy={write.isPending}
      canComplete={selected.assignee_id===teamMemberId && ['pending','in_progress'].includes(selected.status)} onClose={()=>setSelected(null)} onComplete={result=>void action(selected,'complete',result)}/>}
  </section>;
}
