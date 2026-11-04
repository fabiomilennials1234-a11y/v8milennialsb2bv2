import { useState } from 'react';
import { useIdentity,useOrganization } from '@/modules/identity';
import { Button } from '@/components/ui/button';
import { Tabs,TabsList,TabsTrigger } from '@/components/ui/tabs';
import { Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription } from '@/components/ui/dialog';
import { useTaskConfiguration,useTaskQueue } from '../../hooks/useTaskWorkspace';
import { PlaybookConfiguration,RoutineConfiguration } from './TaskConfiguration';
import { TaskAssignmentEditor } from './TaskAssignmentEditor';
import { TaskDetails } from './TaskDetails';
import { TASK_PRIORITY_LABELS,TASK_STATUS_LABELS,type WorkItem } from '../../lib/task-types';

type ManagementTab='assigned'|'playbooks'|'routines';

/** Admin tools open over the existing Comando, without a separate page. */
export function TaskManagementDialog({initialTab='assigned',initialStage='',onClose}:{initialTab?:ManagementTab;initialStage?:string;onClose:()=>void}) {
  const {isAdmin,isReady,userId}=useIdentity();const {organizationId}=useOrganization();
  if(!isReady || !isAdmin)return null;
  return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent className="max-h-[90dvh] max-w-5xl overflow-y-auto">
    <DialogHeader><DialogTitle>Gerenciar tarefas</DialogTitle><DialogDescription>Defina atividades, destinatários e prioridades da sua organização.</DialogDescription></DialogHeader>
    <TaskAdministration key={`${organizationId}:${userId}:${initialTab}:${initialStage}`} initialTab={initialTab} initialStage={initialStage}/>
  </DialogContent></Dialog>;
}
function TaskAdministration({initialTab,initialStage}:{initialTab:ManagementTab;initialStage:string}) {
  const {timezone}=useOrganization();const tz=timezone??'America/Sao_Paulo';
  const [tab,setTab]=useState<ManagementTab>(initialTab);
  const [editor,setEditor]=useState(false);const [member,setMember]=useState('');const [history,setHistory]=useState(false);const [page,setPage]=useState(0);
  const [selected,setSelected]=useState<WorkItem|null>(null);
  const configuration=useTaskConfiguration();
  const queue=useTaskQueue({team:true,assigneeId:member||null,history,page,enabled:tab==='assigned'});
  return <div className="space-y-5"><div className="flex flex-wrap items-center justify-between gap-3">
    <Tabs value={tab} onValueChange={value=>setTab(value as ManagementTab)}><TabsList variant="pill" aria-label="Gestão de tarefas"><TabsTrigger value="assigned">Atividades atribuídas</TabsTrigger><TabsTrigger value="playbooks">Playbooks</TabsTrigger><TabsTrigger value="routines">Rotinas</TabsTrigger></TabsList></Tabs>
    <Button disabled={!configuration.data?.members.length} onClick={()=>setEditor(true)}>Atribuir atividade</Button>
  </div>
    {configuration.isError?<div role="alert" className="rounded-xl border p-6"><p>Não foi possível carregar a configuração.</p><Button variant="outline" onClick={()=>void configuration.refetch()}>Tentar novamente</Button></div>:
      configuration.isLoading?<p role="status">Carregando configuração…</p>:configuration.data && <>
        {tab==='playbooks' && <PlaybookConfiguration configuration={configuration.data} initialStage={initialStage}/>}
        {tab==='routines' && <RoutineConfiguration configuration={configuration.data}/>}
        {tab==='assigned' && <>
          <div className="flex flex-wrap items-center justify-between gap-3"><label className="text-sm">Responsável <select className="ml-2 rounded-md border bg-background px-3 py-2" value={member} onChange={e=>{setMember(e.target.value);setPage(0);}}><option value="">Toda a equipe</option>{configuration.data.members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label><Button variant="outline" size="sm" onClick={()=>{setHistory(v=>!v);setPage(0);}}>{history?'Ver pendentes':'Ver histórico'}</Button></div>
          {queue.isLoading?<p role="status">Carregando atividades…</p>:queue.isError?<div role="alert"><p>Não foi possível carregar as atividades.</p><Button variant="outline" onClick={()=>void queue.refetch()}>Tentar novamente</Button></div>:
            <section className="overflow-hidden rounded-card border border-card-border bg-card shadow-relevo"><header className="border-b px-4 py-3 text-sm font-semibold">{history?'Histórico de execução':'Atividades da equipe'} · {queue.data?.total??0}</header>
              <ul className="divide-y" aria-label="Atividades atribuídas">{queue.data?.items.map(item=><li key={item.id}><button type="button" className="flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left hover:bg-muted/40" onClick={()=>setSelected(item)}><span><span className="block text-sm font-semibold">{item.title}</span><span className="mt-1 block text-xs text-muted-foreground">{item.assignee_name??'Sem responsável'} · {new Intl.DateTimeFormat('pt-BR',{timeZone:tz,dateStyle:'short'}).format(new Date(item.due_at))}</span></span><span className="text-xs text-muted-foreground">Prioridade {TASK_PRIORITY_LABELS[item.priority].toLowerCase()} · {item.overdue?'Atrasada':TASK_STATUS_LABELS[item.status]}</span></button></li>)}</ul>
              {!queue.data?.items.length && <p className="p-8 text-center text-sm text-muted-foreground">Nenhuma atividade nesta seleção.</p>}
              {(queue.data?.total??0)>100 && <footer className="flex items-center justify-between border-t p-3"><Button variant="outline" size="sm" disabled={!page} onClick={()=>setPage(p=>p-1)}>Anterior</Button><span className="text-xs">Página {page+1}</span><Button variant="outline" size="sm" disabled={(page+1)*100>=(queue.data?.total??0)} onClick={()=>setPage(p=>p+1)}>Próxima</Button></footer>}
            </section>}
        </>}
        {editor && <TaskAssignmentEditor members={configuration.data.members} timezone={tz} onClose={()=>setEditor(false)}/>}
      </>}
    {selected && <TaskDetails item={selected} timezone={tz} canComplete={false} busy={false} onClose={()=>setSelected(null)} onComplete={()=>{}}/>}
  </div>;
}
