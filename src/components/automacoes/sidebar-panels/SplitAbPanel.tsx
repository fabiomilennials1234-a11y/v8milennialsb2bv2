import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import type { SplitAbNodeData } from "@/types/workflow";

interface SplitAbPanelProps {
  data: SplitAbNodeData;
  onUpdate: (updates: Partial<SplitAbNodeData>) => void;
}

export function SplitAbPanel({ data, onUpdate }: SplitAbPanelProps) {
  const percentA = data.splitPercentA ?? 50;
  const percentB = 100 - percentA;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Nome</Label>
        <Input
          value={data.label || ""}
          onChange={(e) => onUpdate({ label: e.target.value })}
          placeholder="Ex: Teste de abordagem"
        />
      </div>

      <div className="space-y-2">
        <Label>Distribuição: {percentA}% / {percentB}%</Label>
        <Slider
          value={[percentA]}
          onValueChange={([v]) => onUpdate({ splitPercentA: v })}
          min={5}
          max={95}
          step={5}
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Variante A: {percentA}%</span>
          <span>Variante B: {percentB}%</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Label A</Label>
          <Input
            value={data.variantALabel || ""}
            onChange={(e) => onUpdate({ variantALabel: e.target.value })}
            placeholder="A"
          />
        </div>
        <div className="space-y-2">
          <Label>Label B</Label>
          <Input
            value={data.variantBLabel || ""}
            onChange={(e) => onUpdate({ variantBLabel: e.target.value })}
            placeholder="B"
          />
        </div>
      </div>

      <div className="p-3 rounded-lg bg-pink-50 dark:bg-pink-950 border border-pink-200 dark:border-pink-800">
        <p className="text-xs text-pink-700 dark:text-pink-300">
          Divide aleatoriamente os leads entre duas saídas para testar abordagens diferentes.
          Ideal para A/B testing de mensagens, fluxos ou estratégias.
        </p>
      </div>
    </div>
  );
}
