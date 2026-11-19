import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useIdentity,useOrganization } from '@/modules/identity';
import { Button } from '@/components/ui/button';
import { Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { notifyError } from '@/shared/errors';
import { taskRpc } from '../../lib/task-api';
import type { PendingStageTask } from '../../lib/task-types';
import { TaskMoveContext,type RequestTaskMove } from './task-move-context';

/**
 * Prazo de cada ida ao servidor da checagem. Sem ele, um RPC pendurado segura
 * a FILA para sempre (todo move seguinte espera) e o card otimista do Funil
 * fica no destino. Estourou: o move é recusado com aviso (fail closed) e a
 * fila anda. O modal de pendências NÃO tem prazo — é decisão de gente.
 */
const PRAZO_DA_CHECAGEM_MS = 10_000;

const MENSAGEM_PRAZO_DA_CHECAGEM = 'A conferência das atividades obrigatórias demorou demais. Tente mover de novo.';

class PrazoDaChecagemEsgotado extends Error {
  constructor(){super(MENSAGEM_PRAZO_DA_CHECAGEM);this.name='PrazoDaChecagemEsgotado';}
}

function comPrazo<T>(p:Promise<T>):Promise<T> {
  let timer:ReturnType<typeof setTimeout>|undefined;
  const prazo=new Promise<never>((_,rejeitar)=>{timer=setTimeout(()=>rejeitar(new PrazoDaChecagemEsgotado()),PRAZO_DA_CHECAGEM_MS);});
  return Promise.race([p,prazo]).finally(()=>clearTimeout(timer));
}

export function TaskMoveGateProvider({children}:{children:ReactNode}) {
  const {organizationId}=useOrganization();
  const {userId}=useIdentity();
  const scopeKey=`${organizationId}:${userId}`;
  const pending=useRef<{resolve:(allowed:boolean)=>void;scope:string}|null>(null);
  // Checagens em FILA, uma por vez. Antes, um 2º pedido durante a checagem
  // (ou o modal) do 1º recebia `false` na hora: com o card já movido de forma
  // otimista no Funil, ele ia ao destino e voltava sem aviso. Agora o 2º
  // espera a vez e recebe a resposta DELE.
  const fila=useRef<Promise<unknown>>(Promise.resolve());
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
  const checar=useCallback<RequestTaskMove>(async(id)=>{
    // Na vez deste pedido a org/usuário pode ter mudado: decide pelo escopo do pedido.
    if (pending.current || !organizationId || scope.current!==scopeKey) return false;
    try {
      const ids=typeof id==='object' && !Array.isArray(id)?await comPrazo(taskRpc<string[]>('task_open_entries_for_leads',{p_pipeline:id.pipelineId,p_leads:id.leadIds})):
        Array.isArray(id)?[...new Set(id)]:[id];
      if (scope.current!==scopeKey) return false;
      if (!ids.length) return true;
      const rows=await comPrazo(ids.length===1?taskRpc<PendingStageTask[]>('task_pending_for_move',{p_entry:ids[0]}):
        taskRpc<PendingStageTask[]>('task_pending_for_moves',{p_entries:ids}));
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
      if (error instanceof PrazoDaChecagemEsgotado) { notifyError(error,{fallback:MENSAGEM_PRAZO_DA_CHECAGEM}); return false; }
      notifyError(error,{fallback:'Não foi possível conferir as atividades obrigatórias.'});
      return false;
    }
  },[organizationId,scopeKey]);
  const request=useCallback<RequestTaskMove>((id)=>{
    const vez=fila.current.then(()=>checar(id));
    fila.current=vez.catch(()=>{});
    return vez;
  },[checar]);
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
