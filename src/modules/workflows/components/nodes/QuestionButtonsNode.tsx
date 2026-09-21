import { memo, useEffect } from "react";
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react";
import { MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import type { QuestionButtonsNodeData } from "@/types/workflow";

function QuestionButtonsNodeComponent({ id, data, selected }: NodeProps) {
  const question = data as unknown as QuestionButtonsNodeData;
  const updateInternals = useUpdateNodeInternals();
  useEffect(() => { updateInternals(id); }, [id, question.buttons, updateInternals]);
  const outputs = [
    ...question.buttons.map((button) => ({ id: `button:${button.id}`, label: button.label || "Botão sem nome" })),
    { id: "other_response", label: "Outra resposta" },
    { id: "timeout", label: "Sem resposta" },
    { id: "send_failure", label: "Falha no envio" },
  ];
  return <div className={cn("w-[280px] rounded-xl border border-border border-l-4 border-l-primary bg-card shadow-md", selected && "ring-2 ring-primary ring-offset-2 ring-offset-background")}>
    <Handle type="target" position={Position.Top} />
    <div className="space-y-2 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold"><MessageSquare className="h-4 w-4 text-primary" />Pergunta com botões</div>
      <p className="line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">{question.text || "Escreva sua pergunta"}</p>
      <p className="text-xs text-muted-foreground">Prazo: {question.timeoutHours}h</p>
      {typeof question.__configIssue === "string" && <p role="alert" className="text-xs text-destructive">{question.__configIssue}</p>}
    </div>
    <div className="border-t border-border py-1">
      {outputs.map((output) => <div key={output.id} className="relative px-4 py-2 text-xs">
        <span className="block truncate pr-2">{output.label}</span>
        <Handle type="source" position={Position.Right} id={output.id} aria-label={`Saída ${output.label}`} className="!bg-primary" />
      </div>)}
    </div>
  </div>;
}

export const QuestionButtonsNode = memo(QuestionButtonsNodeComponent);
