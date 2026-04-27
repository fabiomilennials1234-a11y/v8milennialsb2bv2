import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { GotoNodeData, WorkflowNode } from "@/types/workflow";

interface GotoPanelProps {
  data: GotoNodeData;
  onUpdate: (updates: Partial<GotoNodeData>) => void;
  allNodes?: WorkflowNode[];
}

export function GotoPanel({ data, onUpdate, allNodes = [] }: GotoPanelProps) {
  // Filter out the goto node itself and show only valid targets
  const targetableNodes = allNodes.filter(
    (n) => n.type !== "goto" && n.type !== "trigger"
  );

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Nome</Label>
        <Input
          value={data.label || ""}
          onChange={(e) => onUpdate({ label: e.target.value })}
          placeholder="Ex: Voltar para verificação"
        />
      </div>

      <div className="space-y-2">
        <Label>Nó destino</Label>
        {targetableNodes.length > 0 ? (
          <Select
            value={data.targetNodeId || ""}
            onValueChange={(v) => {
              const target = targetableNodes.find((n) => n.id === v);
              const targetData = target?.data as any;
              onUpdate({
                targetNodeId: v,
                targetNodeLabel: targetData?.label || target?.id || "",
              });
            }}
          >
            <SelectTrigger><SelectValue placeholder="Selecione o nó" /></SelectTrigger>
            <SelectContent>
              {targetableNodes.map((n) => {
                const nd = n.data as any;
                return (
                  <SelectItem key={n.id} value={n.id}>
                    {nd?.label || n.id} ({n.type})
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        ) : (
          <p className="text-sm text-muted-foreground">
            Adicione outros nós ao workflow primeiro.
          </p>
        )}
      </div>

      <div className="p-3 rounded-lg bg-teal-50 dark:bg-teal-950 border border-teal-200 dark:border-teal-800">
        <p className="text-xs text-teal-700 dark:text-teal-300">
          Pula a execução diretamente para o nó selecionado. Funciona como um "jump"
          no fluxo. Respeita o limite de loops configurado no workflow.
        </p>
      </div>
    </div>
  );
}
