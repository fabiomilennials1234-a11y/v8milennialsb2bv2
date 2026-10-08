import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ArrowUp, ArrowDown, Trash2, Plus } from "lucide-react";
import type { QuestionButtonsNodeData } from "@/types/workflow";
import { findNodeConfigIssues } from "@/contracts/workflows/node-requirements";
import { useWhatsAppInstancesForUser } from "@/modules/communication";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QuestionButtonsImage } from "./QuestionButtonsImage";

interface Props {
  data: QuestionButtonsNodeData;
  onUpdate: (updates: Partial<QuestionButtonsNodeData>) => void;
  workflowId?: string;
}

export function QuestionButtonsPanel({ data, onUpdate, workflowId }: Props) {
  const instancesQuery = useWhatsAppInstancesForUser();
  const instances = (instancesQuery.data ?? []).filter(instance => instance.provider === "uazapi");
  const issues = findNodeConfigIssues([{ id: "question", type: "question_buttons", data }], [])
    .filter(issue => !issue.missing.startsWith("destino da saída"));
  const move = (index: number, direction: number) => {
    const buttons = [...data.buttons];
    [buttons[index], buttons[index + direction]] = [buttons[index + direction], buttons[index]];
    onUpdate({ buttons });
  };
  return <div className="space-y-6">
    <div className="space-y-2">
      <Label htmlFor="question-instance">Instância WhatsApp</Label>
      <Select value={data.instanceId === null ? "" : data.instanceId ?? "conversation"} onValueChange={value => onUpdate({ instanceId: value === "conversation" ? undefined : value })} disabled={instancesQuery.isLoading}>
        <SelectTrigger id="question-instance"><SelectValue placeholder="Escolha a instância" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="conversation">Usar instância da conversa</SelectItem>
          {instances.map(instance => <SelectItem key={instance.id} value={instance.id}>{instance.instance_name}</SelectItem>)}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">Para gatilhos sem conversa, escolha uma instância Uazapi.</p>
      {instancesQuery.isError && <p role="alert" className="text-xs text-destructive">Não foi possível carregar as instâncias. Tente abrir a configuração novamente.</p>}
      {data.instanceId && !instancesQuery.isLoading && !instancesQuery.isError && !instances.some(instance => instance.id === data.instanceId) && <p role="alert" className="text-xs text-destructive">Instância indisponível para seu acesso. Escolha outra instância.</p>}
    </div>
    {issues.length > 0 && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
      <p className="font-medium">Complete antes de ativar</p>
      <ul className="mt-1 list-inside list-disc">{issues.map(issue => <li key={issue.missing}>{issue.missing}</li>)}</ul>
    </div>}
    <div className="space-y-2">
      <Label htmlFor="question-message">Mensagem</Label>
      <Textarea id="question-message" value={data.text} rows={4}
        onChange={(event) => onUpdate({ text: event.target.value })} />
    </div>
    <div className="space-y-3">
      <QuestionButtonsImage workflowId={workflowId} image={data.image} onChange={image => onUpdate({ image })} />
      {data.buttons.map((button, index) => <div key={button.id} className="space-y-2">
        <Label htmlFor={`question-option-${button.id}`}>Botão {index + 1}</Label>
        <Input id={`question-option-${button.id}`} value={button.label}
          onChange={(event) => onUpdate({ buttons: data.buttons.map((item) =>
            item.id === button.id ? { ...item, label: event.target.value } : item) })} />
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon" disabled={index === 0} aria-label={`Mover ${button.label} para cima`} onClick={() => move(index, -1)}><ArrowUp className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" disabled={index === data.buttons.length - 1} aria-label={`Mover ${button.label} para baixo`} onClick={() => move(index, 1)}><ArrowDown className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" disabled={data.buttons.length === 1} aria-label={`Remover ${button.label}`} onClick={() => onUpdate({ buttons: data.buttons.filter((item) => item.id !== button.id) })}><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>)}
      <Button variant="outline" className="w-full" disabled={data.buttons.length >= 3}
        onClick={() => onUpdate({ buttons: [...data.buttons, { id: crypto.randomUUID(), label: `Opção ${data.buttons.length + 1}` }] })}>
        <Plus className="mr-2 h-4 w-4" />Adicionar botão
      </Button>
      <p className="text-xs text-muted-foreground">Até três botões. Ao remover um botão, a conexão dessa opção será removida.</p>
    </div>
    <div className="space-y-2">
      <Label htmlFor="question-timeout">Prazo de resposta (horas)</Label>
      <Input id="question-timeout" type="number" min={0} step="any" value={data.timeoutHours}
        onChange={(event) => onUpdate({ timeoutHours: Number(event.target.value) })} />
      <p className="text-xs text-muted-foreground">Contado a partir do aceite do envio.</p>
    </div>
  </div>;
}
