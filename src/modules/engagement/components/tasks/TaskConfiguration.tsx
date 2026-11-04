import { useState,type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle } from '@/components/ui/dialog';
import { TASK_KIND_LABELS,TASK_PRIORITY_LABELS,audienceLabel,type PlaybookActivity,type TaskConfiguration,type TaskKind,type TaskRoutine,type TaskAudience } from '../../lib/task-types';
import { useTaskWrite } from '../../hooks/useTaskWorkspace';
import { PriorityField,RecipientFields } from './TaskAssignmentFields';

const selectClass='h-10 w-full rounded-md border border-input bg-background px-3 text-sm';
const fieldClass='grid gap-1.5 text-sm font-medium';
const activityArgs=(a:Omit<PlaybookActivity,'id'|'source_checklist_item_id'> & {id?:string})=>({
  p_id:a.id??null,p_stage:a.stage_id,p_title:a.title,p_kind:a.kind,p_due_days:a.due_days,p_required:a.required,
  p_instructions:a.instructions,p_message:a.message_template,p_position:a.position,p_enabled:a.enabled,
  p_priority:a.priority,p_audience:a.audience,p_members:a.member_ids,
});
const routineArgs=(r:Omit<TaskRoutine,'id'> & {id?:string})=>({
  p_id:r.id??null,p_assignee:r.assignee_id,p_title:r.title,p_instructions:r.instructions,
  p_weekdays:r.weekdays,p_due_time:r.due_time,p_enabled:r.enabled,
  p_priority:r.priority,p_audience:r.audience,p_members:r.member_ids,
});

export function PlaybookConfiguration({configuration,initialStage=''}:{configuration:TaskConfiguration;initialStage?:string}) {
  const write=useTaskWrite();
  const [stageFilter,setStageFilter]=useState(initialStage);
  const [editor,setEditor]=useState<PlaybookActivity|'new'|null>(null);
  const rows=configuration.activities.filter(a=>!stageFilter || a.stage_id===stageFilter);
  return <section className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <label className={fieldClass}>Etapa<select className={selectClass} value={stageFilter} onChange={e=>setStageFilter(e.target.value)}>
        <option value="">Todos os funis e etapas</option>{configuration.stages.map(s=><option key={s.id} value={s.id}>{s.pipeline_name} · {s.name}</option>)}</select></label>
      <Button disabled={!configuration.stages.length} onClick={()=>setEditor('new')}>Nova atividade</Button>
    </div>
    <p className="text-sm text-muted-foreground">As atividades nascem quando o negócio entra na etapa. Alterações valem para as próximas entradas. Voltar a uma etapa não duplica tarefas.</p>
    {rows.length===0?<p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Nenhuma atividade nesta seleção.</p>:<div className="divide-y rounded-xl border bg-card">{rows.map(a=>{
      const stage=configuration.stages.find(s=>s.id===a.stage_id);
      return <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div><h3 className="font-semibold">{a.title} {!a.enabled && <span className="text-xs text-muted-foreground">· Pausada</span>}</h3>
          <p className="text-xs text-muted-foreground">{stage?`${stage.pipeline_name} · ${stage.name}`:'Etapa inativa'} · {TASK_KIND_LABELS[a.kind]} · {a.due_days===0?'No dia da entrada':`Em ${a.due_days} dia(s)`} {a.required?'· Obrigatória':''}</p>
          {a.source_checklist_item_id && <p className="mt-1 text-xs text-muted-foreground">Convertida do checklist de etapa</p>}</div>
        <p className="text-xs text-muted-foreground">{audienceLabel(a.audience,a.member_ids,configuration.members)} · Prioridade {TASK_PRIORITY_LABELS[a.priority].toLowerCase()}</p>
        <div className="flex gap-2"><Button variant="outline" size="sm" onClick={()=>setEditor(a)}>Editar</Button>
          <Button variant="ghost" size="sm" disabled={write.isPending} onClick={()=>write.mutate({rpc:'task_save_activity',args:activityArgs({...a,enabled:!a.enabled})})}>{a.enabled?'Pausar':'Ativar'}</Button></div>
      </div>;
    })}</div>}
    {editor && <ActivityEditor key={editor==='new'?'new':editor.id} initial={editor==='new'?null:editor} configuration={configuration} preferredStage={stageFilter} onClose={()=>setEditor(null)}/>}
  </section>;
}
function ActivityEditor({initial,configuration,preferredStage,onClose}:{initial:PlaybookActivity|null;configuration:TaskConfiguration;preferredStage:string;onClose:()=>void}) {
  const write=useTaskWrite();
  const [value,setValue]=useState({id:initial?.id,stage_id:initial?.stage_id ?? preferredStage ?? '',title:initial?.title??'',
    kind:initial?.kind??'task' as TaskKind,due_days:initial?.due_days??0,required:initial?.required??false,
    instructions:initial?.instructions??'',message_template:initial?.message_template??'',position:initial?.position??configuration.activities.length,enabled:initial?.enabled??true,
    priority:initial?.priority??'medium',audience:initial?.audience??'' as TaskAudience|'',member_ids:initial?.member_ids??[]});
  const validRecipients=!!value.audience && (value.audience!=='members' || value.member_ids.length>0);
  const submit=async(e:FormEvent)=>{e.preventDefault();if(!validRecipients)return;try{await write.mutateAsync({rpc:'task_save_activity',args:activityArgs({...value,audience:value.audience as TaskAudience})});onClose();}catch{/* onError reports the failure */}};
  return <Dialog open onOpenChange={open=>{if(!open && !write.isPending)onClose();}}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
    <DialogHeader><DialogTitle>{initial?'Editar atividade':'Nova atividade do playbook'}</DialogTitle><DialogDescription>Defina o que o responsável pelo negócio deve executar nesta etapa.</DialogDescription></DialogHeader>
    <form onSubmit={submit} className="space-y-4">
      <label className={fieldClass}>Etapa<select className={selectClass} required disabled={!!initial} value={value.stage_id} onChange={e=>setValue({...value,stage_id:e.target.value})}>
        <option value="">Selecione uma etapa</option>{configuration.stages.map(s=><option key={s.id} value={s.id}>{s.pipeline_name} · {s.name}</option>)}</select></label>
      <label className={fieldClass}>Título<Input required maxLength={300} value={value.title} onChange={e=>setValue({...value,title:e.target.value})}/></label>
      <RecipientFields audience={value.audience} memberIds={value.member_ids} members={configuration.members} allowOwner onChange={(audience,member_ids)=>setValue({...value,audience,member_ids})}/>
      <PriorityField value={value.priority} onChange={priority=>setValue({...value,priority})}/>
      <div className="grid grid-cols-2 gap-3"><label className={fieldClass}>Tipo<select className={selectClass} value={value.kind} onChange={e=>setValue({...value,kind:e.target.value as TaskKind})}>
        {Object.entries(TASK_KIND_LABELS).map(([k,label])=><option key={k} value={k}>{label}</option>)}</select></label>
        <label className={fieldClass}>Prazo após a entrada (dias)<Input type="number" min={0} max={365} required value={value.due_days} onChange={e=>setValue({...value,due_days:Number(e.target.value)})}/></label></div>
      <label className={fieldClass}>Orientação<Textarea maxLength={10000} value={value.instructions} onChange={e=>setValue({...value,instructions:e.target.value})}/></label>
      <label className={fieldClass}>Ordem entre atividades com o mesmo prazo<Input type="number" min={0} required value={value.position} onChange={e=>setValue({...value,position:Number(e.target.value)})}/></label>
      <label className={fieldClass}>Mensagem preparada (opcional)<Textarea maxLength={10000} value={value.message_template} onChange={e=>setValue({...value,message_template:e.target.value})}/></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={value.required} onChange={e=>setValue({...value,required:e.target.checked})}/><span>Obrigatória: avançar sem fazer exige um motivo.</span></label>
      <DialogFooter><Button type="button" variant="outline" onClick={onClose} disabled={write.isPending}>Cancelar</Button><Button disabled={write.isPending || !value.title.trim() || !value.stage_id || !validRecipients}>{write.isPending?'Salvando…':'Salvar atividade'}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}

const DAYS=['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];
export function RoutineConfiguration({configuration}:{configuration:TaskConfiguration}) {
  const write=useTaskWrite();
  const [editor,setEditor]=useState<TaskRoutine|'new'|null>(null);
  return <section className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="max-w-2xl text-sm text-muted-foreground">Cada dia tem sua ocorrência. Uma rotina não feita encerra no fim do dia e fica no histórico; o dia seguinte começa sem acumular a anterior. Edições valem para as próximas ocorrências.</p><Button onClick={()=>setEditor('new')}>Nova rotina</Button></div>
    {configuration.routines.length===0?<p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Nenhuma rotina configurada.</p>:<div className="divide-y rounded-xl border bg-card">{configuration.routines.map(r=><div key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div><h3 className="font-semibold">{r.title} {!r.enabled && <span className="text-xs text-muted-foreground">· Pausada</span>}</h3><p className="text-xs text-muted-foreground">{audienceLabel(r.audience,r.member_ids,configuration.members)} · {r.weekdays.map(d=>DAYS[d-1]).join(', ')} · {r.due_time.slice(0,5)} · Prioridade {TASK_PRIORITY_LABELS[r.priority].toLowerCase()}</p></div>
      <div className="flex gap-2"><Button variant="outline" size="sm" onClick={()=>setEditor(r)}>Editar</Button><Button variant="ghost" size="sm" disabled={write.isPending} onClick={()=>write.mutate({rpc:'task_save_routine',args:routineArgs({...r,enabled:!r.enabled})})}>{r.enabled?'Pausar':'Ativar'}</Button></div>
    </div>)}</div>}
    {editor && <RoutineEditor key={editor==='new'?'new':editor.id} initial={editor==='new'?null:editor} configuration={configuration} onClose={()=>setEditor(null)}/>}
  </section>;
}
function RoutineEditor({initial,configuration,onClose}:{initial:TaskRoutine|null;configuration:TaskConfiguration;onClose:()=>void}) {
  const write=useTaskWrite();
  const [value,setValue]=useState({id:initial?.id,assignee_id:initial?.assignee_id??null,title:initial?.title??'',instructions:initial?.instructions??'',
    weekdays:initial?.weekdays??[1,2,3,4,5],due_time:initial?.due_time?.slice(0,5)??'18:00',enabled:initial?.enabled??true,
    priority:initial?.priority??'medium',audience:initial?.audience??'' as ''|'team'|'members',member_ids:initial?.member_ids??[]});
  const validRecipients=!!value.audience && (value.audience!=='members' || value.member_ids.length>0);
  const submit=async(e:FormEvent)=>{e.preventDefault();if(!validRecipients)return;try{await write.mutateAsync({rpc:'task_save_routine',args:routineArgs({...value,audience:value.audience as 'team'|'members'})});onClose();}catch{/* onError reports the failure */}};
  return <Dialog open onOpenChange={open=>{if(!open && !write.isPending)onClose();}}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
    <DialogHeader><DialogTitle>{initial?'Editar rotina':'Nova rotina diária'}</DialogTitle><DialogDescription>O horário segue o fuso da organização.</DialogDescription></DialogHeader>
    <form onSubmit={submit} className="space-y-4">
      <label className={fieldClass}>Título<Input required maxLength={300} value={value.title} onChange={e=>setValue({...value,title:e.target.value})}/></label>
      <RecipientFields audience={value.audience} memberIds={value.member_ids} members={configuration.members} onChange={(audience,member_ids)=>setValue({...value,assignee_id:null,audience:audience as ''|'team'|'members',member_ids})}/>
      <PriorityField value={value.priority} onChange={priority=>setValue({...value,priority})}/>
      <fieldset><legend className="mb-2 text-sm font-medium">Dias da semana</legend><div className="flex flex-wrap gap-3">{DAYS.map((label,index)=><label key={label} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={value.weekdays.includes(index+1)} onChange={e=>setValue({...value,weekdays:e.target.checked?[...value.weekdays,index+1].sort((a,b)=>a-b):value.weekdays.filter(d=>d!==index+1)})}/>{label}</label>)}</div></fieldset>
      <label className={fieldClass}>Horário limite<Input type="time" required value={value.due_time} onChange={e=>setValue({...value,due_time:e.target.value})}/></label>
      <label className={fieldClass}>Orientação<Textarea maxLength={10000} value={value.instructions} onChange={e=>setValue({...value,instructions:e.target.value})}/></label>
      <DialogFooter><Button type="button" variant="outline" disabled={write.isPending} onClick={onClose}>Cancelar</Button><Button disabled={write.isPending || !value.title.trim() || !value.weekdays.length || !validRecipients}>{write.isPending?'Salvando…':'Salvar rotina'}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
