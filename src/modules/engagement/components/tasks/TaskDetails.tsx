import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { TASK_KIND_LABELS,TASK_STATUS_LABELS,TASK_PRIORITY_LABELS,type WorkItem } from '../../lib/task-types';

export function TaskDetails({item,timezone,canComplete,busy,onClose,onComplete,onOpenDeal,onReopen,recordResult=true}: {
  item:WorkItem;timezone:string;canComplete:boolean;busy:boolean;
  onClose:()=>void;onComplete:(result:string)=>void;onOpenDeal?:()=>void;
  onReopen?:()=>void;recordResult?:boolean;
}) {
  const [result,setResult]=useState('');
  const copyMessage=async()=>{
    try{await navigator.clipboard.writeText(item.message_template);toast.success('Mensagem copiada.');}
    catch{toast.error('Não foi possível copiar. Selecione o texto da mensagem.');}
  };
  return <Dialog open onOpenChange={(open)=>{if(!open && !busy)onClose();}}>
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
      <DialogHeader><DialogTitle>{item.title}</DialogTitle><DialogDescription>
        {TASK_KIND_LABELS[item.kind]} · {TASK_STATUS_LABELS[item.status]} · {item.assignee_name ?? 'Sem responsável'}
      </DialogDescription></DialogHeader>
      <p className="text-sm text-muted-foreground">Prazo: {new Intl.DateTimeFormat('pt-BR',{timeZone:timezone,dateStyle:'short',timeStyle:'short'}).format(new Date(item.due_at))}</p>
      <p className="text-sm text-muted-foreground">Prioridade: {TASK_PRIORITY_LABELS[item.priority]}</p>
      {item.lead_name && <p className="text-sm font-medium">{[item.lead_name,item.pipeline_name,item.stage_name].filter(Boolean).join(' · ')}</p>}
      {item.instructions && <section><h3 className="mb-2 text-sm font-semibold">Orientação</h3><p className="whitespace-pre-wrap text-sm">{item.instructions}</p></section>}
      {item.message_template && <section className="space-y-2 rounded-xl bg-muted p-3"><h3 className="text-sm font-semibold">Mensagem preparada</h3>
        <p className="select-text whitespace-pre-wrap text-sm">{item.message_template}</p><Button variant="outline" size="sm" onClick={()=>void copyMessage()}>Copiar mensagem</Button></section>}
      {item.advanced_with_pending && <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">O negócio avançou com esta atividade pendente. O motivo está registrado no histórico do negócio.</p>}
      {item.result && <section><h3 className="text-sm font-semibold">Resultado registrado</h3><p className="whitespace-pre-wrap text-sm">{item.result}</p></section>}
      {canComplete && recordResult && <label className="space-y-2 text-sm font-medium">Resultado (opcional)
        <Textarea value={result} maxLength={10000} onChange={e=>setResult(e.target.value)} placeholder="Registre o que foi feito ou combinado." disabled={busy}/></label>}
      <DialogFooter>{onOpenDeal && <Button variant="outline" onClick={onOpenDeal}>Abrir negócio</Button>}
        <Button variant="outline" onClick={onClose} disabled={busy}>Fechar</Button>
        {onReopen && <Button disabled={busy} onClick={onReopen}>Reabrir tarefa</Button>}
        {canComplete && <Button disabled={busy} onClick={()=>onComplete(result)}>{busy?'Salvando…':'Concluir tarefa'}</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
