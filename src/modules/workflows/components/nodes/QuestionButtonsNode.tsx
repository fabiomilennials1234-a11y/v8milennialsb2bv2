import { memo, useEffect } from "react";
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react";
import { MessageSquare } from "lucide-react";
import type { QuestionButtonsNodeData } from "@/types/workflow";
import { NodeIconChip } from "./BaseNode";
import { nodeCardClassName } from "./node-style";

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
  return <div className={nodeCardClassName({ nodeType: "question_buttons", selected, className: "w-[280px]" })}>
    <Handle type="target" position={Position.Top} />
    <div className="space-y-2 p-3">
      <div className="flex items-center gap-2.5">
        <NodeIconChip nodeType="question_buttons"><MessageSquare /></NodeIconChip>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold tracking-[-0.01em]">{question.label || "Ação"}</p>
          <p className="text-xs text-muted-foreground">WhatsApp Menu</p>
        </div>
      </div>
      <p className="line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">{question.text || "Escreva sua pergunta"}</p>
      <p className="text-xs text-muted-foreground">Prazo: {question.timeoutHours}h</p>
      {typeof question.__configIssue === "string" && <p role="alert" className="text-xs text-destructive">{question.__configIssue}</p>}
    </div>
    <div className="border-t border-border/60 py-1">
      {outputs.map((output) => <div key={output.id} className="relative px-4 py-2 text-xs">
        <span className="block truncate pr-2">{output.label}</span>
        <Handle type="source" position={Position.Right} id={output.id} aria-label={`Saída ${output.label}`} className="!bg-primary" />
      </div>)}
    </div>
  </div>;
}

export const QuestionButtonsNode = memo(QuestionButtonsNodeComponent);
