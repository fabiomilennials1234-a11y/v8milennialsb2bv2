import { useEffect, useRef, useState, type FormEvent } from "react";
import { Loader2, Trash2, Sparkles, UserRoundCheck, Send } from "lucide-react";
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
import { masterTaskSchema, PROMPT_COMPLEXITIES, TASK_LABELS, TASK_STATUSES, type PromptComplexity, type MasterTask, type MasterTaskInput, type MasterTaskOwner, type MasterTaskStatus } from "../../lib/master-tasks";
import type { DescriptionRequest, DescriptionResult } from "../../hooks/useMasterTaskDescription";
import { COMPLEXITY_LABELS } from "../../lib/master-task-prompts";
import { MasterTaskPromptOptions } from "./MasterTaskPromptOptions";

interface Props {
  task?: MasterTask;
  ownerId: string;
  currentMasterId: string;
  owners: MasterTaskOwner[];
  busy: boolean;
  generating: boolean;
  onGenerate: (input: DescriptionRequest) => Promise<DescriptionResult>;
  onSave: (input: MasterTaskInput) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function MasterTaskEditor({ task, ownerId, currentMasterId, owners, busy, generating, onGenerate, onSave, onDelete, onClose }: Props) {
  const [input, setInput] = useState<MasterTaskInput>(() => ({
    title: task?.title ?? "", description: task?.description ?? "",
    context: task?.context ?? "",
    prompt_complexity: task?.prompt_complexity ?? "media",
    status: task?.status ?? "a_fazer", owner_master_user_id: task?.owner_master_user_id ?? ownerId,
  }));
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  const [generationFailed, setGenerationFailed] = useState(false);
  const submitting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const change = (patch: Partial<MasterTaskInput>) => { setInput(current => ({ ...current, ...patch })); setError(""); };
  const forwarding = !!task && input.owner_master_user_id !== task.owner_master_user_id;
  const ownerName = owners.find(owner => owner.id === input.owner_master_user_id)?.name;

  function validated(values: MasterTaskInput) {
    const result = masterTaskSchema.safeParse(values);
    if (!result.success) { setError(result.error.issues[0].message); return null; }
    if (!owners.some(owner => owner.id === values.owner_master_user_id)) {
      setError("Selecione um responsável ativo."); return null;
    }
    return result.data;
  }

  async function generate(values: MasterTaskInput) {
    try {
      const result = await onGenerate({ title: values.title, context: values.context });
      if (!mounted.current) return null;
      setInput(current => ({ ...current, description: result.description, prompt_complexity: result.complexity }));
      setGenerationFailed(false);
      return result;
    } catch {
      if (!mounted.current) return null;
      setGenerationFailed(true);
      setError(`Não foi possível gerar a descrição. Seus dados foram mantidos. ${task ? "Tente novamente ou edite a descrição manualmente." : "Tente novamente, escreva a descrição ou crie a tarefa sem ela."}`);
      return null;
    }
  }

  async function save(values = input, skipGeneration = false) {
    if (busy || submitting.current) return;
    const data = validated(values);
    if (!data) return;
    submitting.current = true;
    setError("");
    try {
      if (!task && !data.description && !skipGeneration) {
        const description = await generate(data);
        if (description === null) return;
        data.description = description.description;
        data.prompt_complexity = description.complexity;
      }
      onSave(data);
    } finally { submitting.current = false; }
  }

  async function previewDescription() {
    if (busy || submitting.current) return;
    const data = validated(input);
    if (!data) return;
    submitting.current = true;
    setError("");
    try { await generate(data); } finally { submitting.current = false; }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void save();
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>{task ? "Detalhes da tarefa" : "Nova tarefa"}</SheetTitle>
        <SheetDescription>{task ? "Edite, pegue para você ou encaminhe a outro master." : "Defina o trabalho. O agente prepara um prompt para colar no Codex ou Claude Code ao criar."}</SheetDescription>
      </SheetHeader>
      <form onSubmit={submit} className="mt-6 space-y-5">
        <fieldset disabled={busy} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="master-task-title">Título</Label>
            <Input id="master-task-title" value={input.title} onChange={e => change({ title: e.target.value })}
              maxLength={200} required placeholder="O que precisa ser feito?" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="master-task-context">Contexto para o prompt</Label>
            <Textarea id="master-task-context" value={input.context} onChange={e => change({ context: e.target.value })}
              maxLength={5000} rows={3} placeholder="Explique o que o Codex ou Claude Code precisa saber: situação atual, resultado esperado e restrições." />
            <p className="text-xs text-muted-foreground">Essas informações serão usadas para montar o prompt de execução da tarefa.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="master-task-owner">Responsável</Label>
            <Select value={input.owner_master_user_id} onValueChange={owner_master_user_id => change({ owner_master_user_id })} disabled={busy}>
              <SelectTrigger id="master-task-owner"><SelectValue placeholder="Selecione o responsável" /></SelectTrigger>
              <SelectContent>{owners.map(owner => <SelectItem key={owner.id} value={owner.id}>{owner.name}</SelectItem>)}</SelectContent>
            </Select>
            {task && task.owner_master_user_id !== currentMasterId && owners.some(owner => owner.id === currentMasterId) && (
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void save({ ...input, owner_master_user_id: currentMasterId })}>
                <UserRoundCheck className="h-4 w-4" />Pegar para mim
              </Button>
            )}
            {forwarding && <p className="text-xs text-muted-foreground">Ao salvar, a tarefa passa para o quadro de {ownerName}, mantendo seu andamento.</p>}
            {task && !forwarding && <p className="text-xs text-muted-foreground">Para encaminhar, escolha outro responsável e salve.</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="master-task-status">Status</Label>
            <Select value={input.status} onValueChange={status => change({ status: status as MasterTaskStatus })} disabled={busy}>
              <SelectTrigger id="master-task-status"><SelectValue /></SelectTrigger>
              <SelectContent>{TASK_STATUSES.map(status => <SelectItem key={status} value={status}>{TASK_LABELS[status]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <section className="space-y-2 rounded-xl border border-primary/20 bg-primary/[0.03] p-3" aria-label="Descrição da tarefa">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="master-task-description">Descrição</Label>
              <Button type="button" variant="ghost" size="sm" disabled={busy || !input.title.trim()}
                onClick={() => input.description.trim() ? setConfirmGenerate(true) : void previewDescription()}>
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {generating ? "Gerando descrição…" : input.description.trim() ? "Gerar novamente" : "Gerar descrição"}
              </Button>
            </div>
            <Textarea id="master-task-description" value={input.description} onChange={e => change({ description: e.target.value })}
              maxLength={10000} rows={9} placeholder="Prompt com objetivo, passos e critérios de conclusão, pronto para copiar para o Codex ou Claude Code." />
            <p className="text-xs text-muted-foreground">Descrição em formato de prompt. Revise antes de copiar; gerar aqui não executa a tarefa.</p>
            <Label htmlFor="master-task-complexity">Complexidade do trabalho</Label>
            <Select value={input.prompt_complexity} onValueChange={value => change({ prompt_complexity: value as PromptComplexity })} disabled={busy}>
              <SelectTrigger id="master-task-complexity"><SelectValue /></SelectTrigger>
              <SelectContent>{PROMPT_COMPLEXITIES.map(value => <SelectItem key={value} value={value}>{COMPLEXITY_LABELS[value]}</SelectItem>)}</SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">O agente sugere a complexidade. Você pode ajustar para mudar as recomendações abaixo.</p>
            <MasterTaskPromptOptions input={input} disabled={busy} />
          </section>
        </fieldset>
        {generating && <p role="status" className="text-sm text-muted-foreground">Preparando o objetivo e os passos para concluir a tarefa…</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {!task && generationFailed && !input.description.trim() && <Button type="button" variant="outline" disabled={busy} onClick={() => void save(input, true)}>Criar sem descrição</Button>}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
          {task && <Button type="button" variant="ghost" className="mr-auto text-destructive" disabled={busy} onClick={() => setConfirmDelete(true)}><Trash2 className="h-4 w-4" />Excluir</Button>}
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : forwarding ? <Send className="h-4 w-4" /> : null}{generating ? "Preparando descrição…" : forwarding ? "Encaminhar tarefa" : task ? "Salvar alterações" : "Criar tarefa"}</Button>
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
      <AlertDialog open={confirmGenerate} onOpenChange={setConfirmGenerate}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Gerar uma nova descrição?</AlertDialogTitle><AlertDialogDescription>A descrição atual será substituída usando o título e o contexto. A mudança só é gravada quando você salvar.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void previewDescription()}>Gerar nova descrição</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
