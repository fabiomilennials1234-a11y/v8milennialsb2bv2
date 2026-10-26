import { useState, type FormEvent } from "react";
import { Loader2, Trash2, UserRoundCheck, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { masterTaskSchema, TASK_LABELS, TASK_STATUSES, type MasterTask, type MasterTaskInput, type MasterTaskOwner, type MasterTaskStatus } from "../../lib/master-tasks";

interface Props {
  task?: MasterTask;
  ownerId: string;
  currentMasterId: string;
  owners: MasterTaskOwner[];
  busy: boolean;
  onSave: (input: MasterTaskInput) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function MasterTaskEditor({ task, ownerId, currentMasterId, owners, busy, onSave, onDelete, onClose }: Props) {
  const [input, setInput] = useState<MasterTaskInput>(() => ({
    title: task?.title ?? "", description: task?.description ?? "",
    due_date: task?.due_date ?? "", estimated_minutes: task?.estimated_minutes ?? 0,
    status: task?.status ?? "a_fazer", owner_master_user_id: task?.owner_master_user_id ?? ownerId,
  }));
  const [duration, setDuration] = useState(() => ({
    hours: task ? String(Math.floor(task.estimated_minutes / 60)) : "",
    minutes: task ? String(task.estimated_minutes % 60) : "",
  }));
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const change = (patch: Partial<MasterTaskInput>) => { setInput(current => ({ ...current, ...patch })); setError(""); };
  const changeDuration = (patch: Partial<typeof duration>) => { setDuration(current => ({ ...current, ...patch })); setError(""); };
  const forwarding = !!task && input.owner_master_user_id !== task.owner_master_user_id;
  const ownerName = owners.find(owner => owner.id === input.owner_master_user_id)?.name;

  function save(values = input) {
    if (busy) return;
    const hours = Number(duration.hours);
    const minutes = Number(duration.minutes);
    if (!Number.isInteger(hours) || hours < 0 || !Number.isInteger(minutes) || minutes < 0 || minutes > 59) {
      setError("Informe horas inteiras e minutos entre 0 e 59."); return;
    }
    const result = masterTaskSchema.safeParse({ ...values, estimated_minutes: hours * 60 + minutes });
    if (!result.success) { setError(result.error.issues[0].message); return; }
    if (!owners.some(owner => owner.id === values.owner_master_user_id)) {
      setError("Selecione um responsável ativo."); return;
    }
    setError("");
    onSave(result.data);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    save();
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>{task ? "Detalhes da tarefa" : "Nova tarefa"}</SheetTitle>
        <SheetDescription>{task ? "Edite, pegue para você ou encaminhe a outro master." : "Defina o trabalho, o responsável, a data limite e o tempo necessário para concluir."}</SheetDescription>
      </SheetHeader>
      <form onSubmit={submit} noValidate className="mt-6 space-y-5">
        <fieldset disabled={busy} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="master-task-title">Título</Label>
            <Input id="master-task-title" value={input.title} onChange={e => change({ title: e.target.value })}
              maxLength={200} required placeholder="O que precisa ser feito?" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="master-task-description">Descrição</Label>
            <Textarea id="master-task-description" value={input.description} onChange={e => change({ description: e.target.value })}
              maxLength={10000} rows={4} placeholder="Descreva o que precisa ser feito para concluir a tarefa." />
          </div>
          <fieldset className="space-y-3 rounded-xl border border-primary/20 bg-primary/[0.03] p-3">
            <legend className="px-1 text-sm font-semibold">Prazo e tempo estimado</legend>
            <div className="space-y-2">
              <Label htmlFor="master-task-due-date">Data limite</Label>
              <Input id="master-task-due-date" type="date" min="0001-01-01" max="9999-12-31" required value={input.due_date}
                onChange={e => change({ due_date: e.target.value })} aria-describedby="master-task-due-help" />
              <p id="master-task-due-help" className="text-xs text-muted-foreground">Obrigatória. Prazo até o fim do dia, no horário de Brasília.</p>
            </div>
            <div role="group" aria-label="Tempo estimado" aria-describedby="master-task-estimate-help" className="grid grid-cols-2 gap-3">
              <div className="min-w-0 space-y-2">
                <Label htmlFor="master-task-hours">Horas</Label>
                <Input id="master-task-hours" type="number" min={0} step={1} placeholder="0" value={duration.hours}
                  onChange={e => changeDuration({ hours: e.target.value })} />
              </div>
              <div className="min-w-0 space-y-2">
                <Label htmlFor="master-task-minutes">Minutos</Label>
                <Input id="master-task-minutes" type="number" min={0} max={59} step={1} placeholder="0" value={duration.minutes}
                  onChange={e => changeDuration({ minutes: e.target.value })} />
              </div>
            </div>
            <p id="master-task-estimate-help" className="text-xs text-muted-foreground">Tempo de trabalho necessário para concluir. Obrigatório informar pelo menos 1 minuto.</p>
          </fieldset>
          <div className="space-y-2">
            <Label htmlFor="master-task-owner">Responsável</Label>
            <Select value={input.owner_master_user_id} onValueChange={owner_master_user_id => change({ owner_master_user_id })} disabled={busy}>
              <SelectTrigger id="master-task-owner"><SelectValue placeholder="Selecione o responsável" /></SelectTrigger>
              <SelectContent>{owners.map(owner => <SelectItem key={owner.id} value={owner.id}>{owner.name}</SelectItem>)}</SelectContent>
            </Select>
            {task && task.owner_master_user_id !== currentMasterId && owners.some(owner => owner.id === currentMasterId) && (
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => save({ ...input, owner_master_user_id: currentMasterId })}>
                <UserRoundCheck className="h-4 w-4" />Pegar para mim
              </Button>
            )}
            {forwarding && <p className="text-xs text-muted-foreground">Ao salvar, a tarefa passa para o quadro de {ownerName}, mantendo seu andamento e prazo.</p>}
            {task && !forwarding && <p className="text-xs text-muted-foreground">Para encaminhar, escolha outro responsável e salve.</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="master-task-status">Status</Label>
            <Select value={input.status} onValueChange={status => change({ status: status as MasterTaskStatus })} disabled={busy}>
              <SelectTrigger id="master-task-status"><SelectValue /></SelectTrigger>
              <SelectContent>{TASK_STATUSES.map(status => <SelectItem key={status} value={status}>{TASK_LABELS[status]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </fieldset>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
          {task && <Button type="button" variant="ghost" className="mr-auto text-destructive" disabled={busy} onClick={() => setConfirmDelete(true)}><Trash2 className="h-4 w-4" />Excluir</Button>}
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : forwarding ? <Send className="h-4 w-4" /> : null}{forwarding ? "Encaminhar tarefa" : task ? "Salvar alterações" : "Criar tarefa"}</Button>
        </div>
      </form>
      <AlertDialog open={confirmDelete} onOpenChange={value => !busy && setConfirmDelete(value)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Excluir tarefa?</AlertDialogTitle><AlertDialogDescription>A tarefa “{task?.title}” será removida do quadro de todos os masters.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={event => { event.preventDefault(); onDelete(); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{busy ? "Excluindo…" : "Excluir tarefa"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
