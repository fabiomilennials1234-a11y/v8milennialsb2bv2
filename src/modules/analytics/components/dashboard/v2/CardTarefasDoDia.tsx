import { useState,type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ListChecks,Plus } from 'lucide-react';
import { useCreateAcaoDoDia,useCompleteAcaoDoDia,useUncompleteAcaoDoDia,useDeleteAcaoDoDia } from '@/modules/engagement';
import { TaskList,TaskDetails,useTaskWrite,type WorkItem } from '@/modules/engagement/tasks';
import { useOrganization,useIdentity } from '@/modules/identity';
import { Button } from '@/components/ui/button';
import { useComandoTasks } from '@/modules/analytics/hooks/useComandoTasks';
import { ComandoCard } from './ComandoCard';

export function CardTarefasDoDia() {
  const {organizationId}=useOrganization();const {userId}=useIdentity();
  return <PersonalTasks key={`${organizationId}:${userId}`}/>;
}
function PersonalTasks() {
  const {timezone}=useOrganization();const {isAdmin}=useIdentity();const navigate=useNavigate();
  const [tab,setTab]=useState<'today'|'future'|'history'>('today');const [page,setPage]=useState(0);
  const [selected,setSelected]=useState<WorkItem|null>(null);const [title,setTitle]=useState('');
  const queue=useComandoTasks({history:tab==='history',future:tab==='future',page});
  const create=useCreateAcaoDoDia();const complete=useCompleteAcaoDoDia();const reopen=useUncompleteAcaoDoDia();const remove=useDeleteAcaoDoDia();const write=useTaskWrite();
  const busy=create.isPending || complete.isPending || reopen.isPending || remove.isPending || write.isPending;
  const openBusiness=(item:WorkItem)=>{if(item.lead_id){setSelected(null);navigate(`/leads?lead=${item.lead_id}`);}};
  const action=async(item:WorkItem,kind:'start'|'complete',result?:string)=>{
    try{
      if(item.daily_action_id){if(kind==='start'){setSelected(item);return;}await complete.mutateAsync(item.daily_action_id);}
      else await write.mutateAsync({rpc:'task_transition',args:{p_id:item.id,p_action:kind,p_result:result}});
      setSelected(kind==='start'?{...item,status:'in_progress'}:null);
    }catch{/* each mutation reports its error */}
  };
  const add=async(e:FormEvent)=>{e.preventDefault();if(!title.trim() || busy)return;try{await create.mutateAsync({title:title.trim()});setTitle('');}catch{/* mutation reports the error */}};
  return <ComandoCard icon={ListChecks} title="Tarefas do dia" count={queue.total} tone={queue.overdue?'urgent':'default'}
    action={isAdmin?{label:'Gerenciar',to:'/tarefas'}:undefined} isLoading={queue.isCardLoading} isError={queue.isBlockingError} onRetry={()=>void queue.refetch()} isEmpty={false}
    notice={queue.unavailableSource && <div role="alert" className="mx-4 mb-3 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs text-muted-foreground"><p className="min-w-0 flex-1">{queue.unavailableSource==='assigned'?'Não foi possível carregar as atividades atribuídas pelo admin. Suas tarefas pessoais continuam disponíveis.':'Não foi possível carregar suas tarefas pessoais. As atividades atribuídas continuam disponíveis.'}</p><Button variant="ghost" size="sm" onClick={()=>void queue.refetch()}>Tentar novamente</Button></div>}>
    <div className="flex gap-1 border-b px-4 pb-3" role="group" aria-label="Período das tarefas">{([['today','Hoje'],['future','Próximas'],['history','Histórico']] as const).map(([value,label])=><Button key={value} variant={tab===value?'secondary':'ghost'} size="sm" onClick={()=>{setTab(value);setPage(0);}}>{label}</Button>)}</div>
    {!queue.items.length?<p className="px-4 py-7 text-center text-xs text-muted-foreground">{tab==='history'?'Nenhuma execução neste histórico.':tab==='future'?'Nenhuma atividade futura.':'Nenhuma tarefa pendente. Crie a sua abaixo.'}</p>:
      <TaskList items={queue.items} myMemberId={queue.myMemberId} timezone={timezone??'America/Sao_Paulo'} busy={busy} onSelect={setSelected}
        onAction={(item,kind)=>kind==='complete'?setSelected(item):void action(item,kind)} onOpenDeal={openBusiness}
        onRemove={item=>{if(item.daily_action_id)remove.mutate(item.daily_action_id);}}/>}
    {queue.assignedTotal>100 && <div className="flex items-center justify-between border-t p-3"><Button variant="outline" size="sm" disabled={!page} onClick={()=>setPage(p=>p-1)}>Anterior</Button><span className="text-xs">Página {page+1}</span><Button variant="outline" size="sm" disabled={(page+1)*100>=queue.assignedTotal} onClick={()=>setPage(p=>p+1)}>Próxima</Button></div>}
    <form onSubmit={add} className="m-4 flex items-center gap-2 rounded-xl border bg-background/60 px-3 py-2"><Plus className="size-4 shrink-0 text-muted-foreground"/><input aria-label="Nova tarefa do dia" className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="Adicionar uma tarefa sua…" value={title} onChange={e=>setTitle(e.target.value)} maxLength={300} disabled={busy}/><Button type="submit" size="sm" disabled={busy || !title.trim()}>Adicionar</Button></form>
    {selected && <TaskDetails key={selected.id} item={selected} timezone={timezone??'America/Sao_Paulo'} canComplete={selected.assignee_id===queue.myMemberId && ['pending','in_progress'].includes(selected.status)} busy={busy}
      recordResult={!selected.daily_action_id} onClose={()=>setSelected(null)} onComplete={result=>void action(selected,'complete',result)} onOpenDeal={selected.lead_id?()=>openBusiness(selected):undefined}
      onReopen={selected.daily_action_id && selected.status==='completed'?()=>{reopen.mutate(selected.daily_action_id!,{onSuccess:()=>setSelected(null)});}:undefined}/>}
  </ComandoCard>;
}
