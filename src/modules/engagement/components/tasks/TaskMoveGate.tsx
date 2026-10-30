import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useIdentity,useOrganization } from '@/modules/identity';
import { Button } from '@/components/ui/button';
import { Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { notifyError } from '@/shared/errors';
import { taskRpc } from '../../lib/task-api';
import type { PendingStageTask } from '../../lib/task-types';
import { TaskMoveContext,type RequestTaskMove } from './task-move-context';

export function TaskMoveGateProvider({children}:{children:ReactNode}) {
  const {organizationId}=useOrganization();
  const {userId}=useIdentity();
  const scopeKey=`${organizationId}:${userId}`;
  const pending=useRef<{resolve:(allowed:boolean)=>void;scope:string}|null>(null);
  const checking=useRef(false);
  const scope=useRef(scopeKey);
  scope.current=scopeKey;
  const [entries,setEntries]=useState<string[]>([]);
  const [tasks,setTasks]=useState<PendingStageTask[]>([]);
  const [reason,setReason]=useState('');
  const [saving,setSaving]=useState(false);
  const finish=useCallback((allowed:boolean)=>{
    pending.current?.resolve(allowed); pending.current=null; setEntries([]); setReason(''); setTasks([]);
  },[]);
  useEffect(()=>()=>{pending.current?.resolve(false);pending.current=null;},[scopeKey]);
  const request=useCallback<RequestTaskMove>(async(id)=>{
    if (pending.current || checking.current || !organizationId) return false;
    checking.current=true;
    try {
      const ids=typeof id==='object' && !Array.isArray(id)?await taskRpc<string[]>('task_open_entries_for_leads',{p_pipeline:id.pipelineId,p_leads:id.leadIds}):
        Array.isArray(id)?[...new Set(id)]:[id];
      if (scope.current!==scopeKey) return false;
      if (!ids.length) return true;
      const rows=ids.length===1?await taskRpc<PendingStageTask[]>('task_pending_for_move',{p_entry:ids[0]}):
        await taskRpc<PendingStageTask[]>('task_pending_for_moves',{p_entries:ids});
      if (scope.current!==scopeKey) return false;
      if (!rows.length) return true;
      return await new Promise<boolean>((resolve)=>{
        pending.current={resolve,scope:scopeKey};setTasks(rows);setReason('');setEntries(ids);
      });
    } catch(error) {
      if (scope.current!==scopeKey) return false;
      // Safe deploy ordering: absence of the whole feature means no playbook
      // tasks can exist yet. Network/permission/other errors fail closed.
      const code=(error as {code?:string})?.code;
      if (code==='PGRST202' || code==='42883') return true;
      notifyError(error,{fallback:'Não foi possível conferir as atividades obrigatórias.'});
      return false;
    } finally {checking.current=false;}
  },[organizationId,scopeKey]);
  const confirm=async()=>{
    const decision=pending.current;
    if (!entries.length || !decision || decision.scope!==scopeKey || reason.trim().length<3 || saving) return;
    setSaving(true);
    try {
      if (entries.length===1) await taskRpc('task_authorize_move',{p_entry:entries[0],p_reason:reason.trim()});
      else await taskRpc('task_authorize_moves',{p_entries:entries,p_reason:reason.trim()});
      if (pending.current===decision && scope.current===decision.scope) finish(true);
    }
    catch(error){notifyError(error,{fallback:'Não foi possível registrar o motivo.'});}
    finally{setSaving(false);}
  };
  return <TaskMoveContext.Provider value={request}>
    {children}
    <Dialog open={entries.length>0 && pending.current?.scope===scopeKey} onOpenChange={(open)=>{if(!open && !saving)finish(false);}}>
      <DialogContent className="z-[90]">
        <DialogHeader><DialogTitle>Avançar com pendências</DialogTitle>
          <DialogDescription>Você pode avançar. Registre por que estas atividades obrigatórias ficaram pendentes.</DialogDescription></DialogHeader>
        <ul className="max-h-40 list-disc overflow-y-auto pl-5 text-sm">{tasks.map(t=><li key={t.id}>{t.title}{t.lead_name?` · ${t.lead_name}`:''}</li>)}</ul>
        <label className="space-y-2 text-sm font-medium">Motivo
          <Textarea value={reason} maxLength={2000} onChange={e=>setReason(e.target.value)} placeholder="Ex.: o cliente pediu para negociar antes da ligação." disabled={saving}/></label>
        <p className="text-xs text-muted-foreground">O motivo fica no histórico. As tarefas continuam abertas.</p>
        <DialogFooter><Button variant="outline" disabled={saving} onClick={()=>finish(false)}>Voltar</Button>
          <Button disabled={saving || reason.trim().length<3} onClick={()=>void confirm()}>{saving?'Registrando…':'Registrar e avançar'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </TaskMoveContext.Provider>;
}
