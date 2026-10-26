import { useMemo, useState } from "react";
import { CircleDashed, CircleCheck, Hand, Loader2, Plus, RotateCw, Search, ArrowUpRight, CheckCheck, CalendarDays, Clock3 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KpiRow, KpiTile } from "@/components/ui/bento";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { notifyError } from "@/shared/errors";
import { cn } from "@/lib/utils";
import { MasterPageHeader } from "../components/MasterPageHeader";
import { MasterKanban, type KanbanColumnDef } from "../components/MasterKanban";
import { MasterTaskEditor } from "../components/tasks/MasterTaskEditor";
import { useMasterAuth, type MasterUser } from "../hooks/useMasterAuth";
import { useMasterTaskOwners, useMasterTasks, useMasterTaskMutations } from "../hooks/useMasterTasks";
import { groupMasterTasks, formatTaskDueDate, formatTaskEstimate, isMasterTaskOverdue, TASK_LABELS, type MasterTask, type MasterTaskInput, type MasterTaskStatus } from "../lib/master-tasks";

const COLUMNS: KanbanColumnDef<MasterTaskStatus>[] = [
  { id: "a_fazer", label: "A fazer", hint: "Trabalho que ainda vai começar." },
  { id: "fazendo", label: "Fazendo", hint: "Tarefas em andamento." },
  { id: "feito", label: "Feito", hint: "Entregas concluídas." },
];
const NO_TASKS: MasterTask[] = [];

export default function MasterTasks() {
  const { masterUser, isFullMaster, isLoading } = useMasterAuth();
  if (isLoading || !isFullMaster || !masterUser) return (
    <div className="space-y-5">
      <MasterPageHeader title="Tarefas" subtitle="O trabalho da equipe, do início à entrega." />
      {isLoading ? <Loader2 className="mx-auto h-6 w-6 animate-spin" aria-label="Carregando perfil" />
        : <p role="alert" className="text-sm text-muted-foreground">As tarefas internas estão disponíveis apenas para masters com acesso completo.</p>}
    </div>
  );
  // Mudança de conta remonta o quadro e nunca herda a seleção da conta anterior.
  return <TaskBoard key={masterUser.id} masterUser={masterUser} />;
}

function TaskBoard({ masterUser }: { masterUser: MasterUser }) {
  const ownersQuery = useMasterTaskOwners();
  const owners = ownersQuery.data ?? [];
  // Sem localStorage/URL: toda entrada na aba começa nas tarefas do usuário conectado.
  const [selectedOwnerId, setSelectedOwnerId] = useState(masterUser.id);
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<{ task?: MasterTask } | null>(null);
  const tasksQuery = useMasterTasks(selectedOwnerId);
  const { save, move, remove } = useMasterTaskMutations();
  const tasks = tasksQuery.data ?? NO_TASKS;
  const selectedOwner = owners.find(owner => owner.id === selectedOwnerId);
  const busy = save.isPending || move.isPending || remove.isPending;
  const loading = ownersQuery.isLoading || tasksQuery.isLoading;
  const error = ownersQuery.isError || tasksQuery.isError;
  const grouped = useMemo(() => groupMasterTasks(tasks, search), [tasks, search]);
  const totals = useMemo(() => groupMasterTasks(tasks), [tasks]);

  function saveTask(input: MasterTaskInput) {
    save.mutate({ task: editor?.task, input }, {
      onSuccess: () => {
        setEditor(null);
        const reassigned = editor?.task && input.owner_master_user_id !== editor.task.owner_master_user_id;
        toast.success(reassigned ? input.owner_master_user_id === masterUser.id ? "Tarefa atribuída a você." : `Tarefa encaminhada para ${owners.find(owner => owner.id === input.owner_master_user_id)?.name ?? "o responsável"}.` : editor?.task ? "Tarefa atualizada." : "Tarefa criada.");
        // Se a tarefa foi atribuída a outro master, acompanhe o destino dela.
        setSelectedOwnerId(input.owner_master_user_id);
        setSearch("");
      },
      onError: err => notifyError(err, { fallback: "Não foi possível salvar a tarefa." }),
    });
  }

  function moveTask(task: MasterTask, status: MasterTaskStatus) {
    if (busy || task.status === status) return;
    move.mutate({ task, status }, {
      onSuccess: () => toast.success(`Tarefa movida para ${TASK_LABELS[status]}.`),
      onError: err => notifyError(err, { fallback: "Não foi possível mover a tarefa." }),
    });
  }

  function deleteTask() {
    if (!editor?.task || busy) return;
    remove.mutate(editor.task, {
      onSuccess: () => { setEditor(null); toast.success("Tarefa excluída."); },
      onError: err => notifyError(err, { fallback: "Não foi possível excluir a tarefa." }),
    });
  }

  return (
    <div className="space-y-5">
      <MasterPageHeader title="Tarefas" subtitle="O trabalho da equipe, do início à entrega."
        actions={<Button onClick={() => setEditor({})} disabled={loading || error || !selectedOwner || busy}><Plus className="h-4 w-4" />Nova tarefa</Button>} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <span id="task-owner-label" className="text-sm font-semibold">Tarefas de</span>
          <Select value={selectedOwnerId} disabled={ownersQuery.isLoading || ownersQuery.isError || busy}
            onValueChange={id => { setSelectedOwnerId(id); setSearch(""); setEditor(null); }}>
            <SelectTrigger aria-labelledby="task-owner-label" className="w-[200px] max-w-full"><SelectValue placeholder="Selecione o master" /></SelectTrigger>
            <SelectContent>{owners.map(owner => <SelectItem key={owner.id} value={owner.id}>{owner.name}{owner.id === masterUser.id ? " (você)" : ""}</SelectItem>)}</SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">Todos os masters podem acompanhar as tarefas de cada um.</span>
        </div>
        <Button variant="outline" size="sm" disabled={tasksQuery.isFetching || ownersQuery.isFetching || busy}
          onClick={() => { void tasksQuery.refetch(); void ownersQuery.refetch(); }}><RotateCw className={cn("h-4 w-4", tasksQuery.isFetching && "animate-spin")} />Atualizar</Button>
      </div>

      <KpiRow cols={3}>
        <KpiTile label="A fazer" value={error ? "—" : totals.a_fazer.length} icon={CircleDashed} tone="neutral" loading={loading} />
        <KpiTile label="Fazendo" value={error ? "—" : totals.fazendo.length} icon={Hand} tone="info" loading={loading} />
        <KpiTile label="Feito" value={error ? "—" : totals.feito.length} icon={CircleCheck} tone="good" loading={loading} />
      </KpiRow>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Buscar tarefa" placeholder="Buscar tarefa…" className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <p className="text-xs text-muted-foreground">Arraste os cartões ou abra para editar.</p>
      </div>

      {loading ? <div className="grid place-items-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Carregando tarefas" /></div>
        : error ? <div role="alert" className="rounded-card border border-destructive/20 bg-destructive/5 p-6 text-sm">Não foi possível carregar as tarefas. Use Atualizar para tentar novamente.</div>
          : <>
            <p className="text-sm font-semibold" role="status">{selectedOwnerId === masterUser.id ? "Minhas tarefas" : `Tarefas de ${selectedOwner?.name ?? "master"}`}</p>
            <MasterKanban label={`Tarefas de ${selectedOwner?.name ?? "master"} por status`} columns={COLUMNS} items={grouped}
              getId={task => task.id} onOpen={task => !busy && setEditor({ task })} onMove={moveTask}
              canDrop={() => busy ? { ok: false, reason: "Aguarde a alteração em andamento." } : { ok: true }}
              columnLimit={{ feito: 12 }}
              emptyLabel={status => search.trim() ? "Nenhuma tarefa encontrada." : status === "a_fazer" ? "Nenhuma tarefa a fazer." : status === "fazendo" ? "Nenhuma tarefa em andamento." : "As tarefas concluídas aparecerão aqui."}
              renderCard={task => <div className="rounded-2xl border border-card-border bg-card p-4 shadow-relevo">
                <h3 className="break-words text-sm font-bold leading-snug">{task.title}</h3>
                {task.description && <p className="mt-2 line-clamp-2 break-words text-xs text-muted-foreground">{task.description}</p>}
                <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className={cn("flex items-center gap-1", isMasterTaskOverdue(task) && "font-semibold text-destructive")}>
                    <CalendarDays className="h-3.5 w-3.5" />Até {formatTaskDueDate(task.due_date)}{isMasterTaskOverdue(task) && " · Atrasada"}
                  </span>
                  <span className="flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />Estimativa: {formatTaskEstimate(task.estimated_minutes)}</span>
                </div>
                <div className="mt-4 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span>{selectedOwner?.name}</span><span className="flex items-center gap-1">{task.status === "feito" ? <><CheckCheck className="h-3.5 w-3.5" />Concluída</> : <><ArrowUpRight className="h-3.5 w-3.5" />Ver detalhes</>}</span>
                </div>
              </div>} />
          </>}

      <Sheet open={editor !== null} onOpenChange={open => !open && !busy && setEditor(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg" onEscapeKeyDown={e => busy && e.preventDefault()} onInteractOutside={e => busy && e.preventDefault()}>
          {editor && <MasterTaskEditor key={editor.task?.id ?? "new"} task={editor.task} ownerId={selectedOwnerId} owners={owners}
            currentMasterId={masterUser.id}
            busy={busy} onSave={saveTask} onDelete={deleteTask} onClose={() => setEditor(null)} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}
