import { useState,type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle } from '@/components/ui/dialog';
import { useTaskWrite } from '../../hooks/useTaskWorkspace';
import type { TaskConfiguration,TaskPriority } from '../../lib/task-types';
import { PriorityField,RecipientFields } from './TaskAssignmentFields';

export function TaskAssignmentEditor({members,timezone,onClose}:{members:TaskConfiguration['members'];timezone:string;onClose:()=>void}) {
  const write=useTaskWrite();
  const [title,setTitle]=useState('');const [instructions,setInstructions]=useState('');
  const [audience,setAudience]=useState<''|'team'|'members'>('');const [memberIds,setMemberIds]=useState<string[]>([]);
  const [priority,setPriority]=useState<TaskPriority>('medium');
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const part=(name:string)=>parts.find(p=>p.type===name)?.value;
  const [date,setDate]=useState(`${part('year')}-${part('month')}-${part('day')}`);
  const valid=title.trim() && date && audience && members.length && (audience!=='members' || memberIds.length);
  const submit=async(e:FormEvent)=>{e.preventDefault();if(!valid)return;try{await write.mutateAsync({rpc:'task_assign',args:{p_title:title,p_due_date:date,p_audience:audience,p_members:memberIds,p_priority:priority,p_instructions:instructions}});onClose();}catch{/* mutation reports the error */}};
  return <Dialog open onOpenChange={open=>{if(!open && !write.isPending)onClose();}}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
    <DialogHeader><DialogTitle>Atribuir atividade</DialogTitle><DialogDescription>A atividade aparece no Comando de cada destinatário da sua organização. Cada pessoa registra a própria execução.</DialogDescription></DialogHeader>
    <form className="space-y-4" onSubmit={submit}>
      <label className="grid gap-1.5 text-sm font-medium">Título<Input required maxLength={300} value={title} onChange={e=>setTitle(e.target.value)}/></label>
      <RecipientFields audience={audience} memberIds={memberIds} members={members} onChange={(value,ids)=>{setAudience(value as ''|'team'|'members');setMemberIds(ids);}}/>
      <div className="grid grid-cols-2 gap-3"><label className="grid gap-1.5 text-sm font-medium">Prazo<Input required type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><PriorityField value={priority} onChange={setPriority}/></div>
      <label className="grid gap-1.5 text-sm font-medium">Orientação<Textarea maxLength={10000} value={instructions} onChange={e=>setInstructions(e.target.value)}/></label>
      <DialogFooter><Button type="button" variant="outline" disabled={write.isPending} onClick={onClose}>Cancelar</Button><Button disabled={write.isPending || !valid}>{write.isPending?'Atribuindo…':'Atribuir atividade'}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
