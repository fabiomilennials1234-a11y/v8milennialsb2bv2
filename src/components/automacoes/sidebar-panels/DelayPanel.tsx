import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DelayNodeData, DelayUnit } from "@/types/workflow";

interface DelayPanelProps {
  data: DelayNodeData;
  onUpdate: (updates: Partial<DelayNodeData>) => void;
}

export function DelayPanel({ data, onUpdate }: DelayPanelProps) {
  const isRandom = data.randomized || false;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Nome</Label>
        <Input
          value={data.label || ""}
          onChange={(e) => onUpdate({ label: e.target.value })}
          placeholder="Ex: Esperar 24 horas"
        />
      </div>

      <div className="flex items-center justify-between">
        <Label htmlFor="delay-random" className="cursor-pointer">Tempo aleatório</Label>
        <Switch
          id="delay-random"
          checked={isRandom}
          onCheckedChange={(v) => {
            onUpdate({
              randomized: v,
              ...(v
                ? { amountMin: data.amount || 1, amountMax: (data.amount || 1) * 2 }
                : { amount: data.amountMin || data.amount || 1 }),
            });
          }}
        />
      </div>

      {isRandom ? (
        <>
          <p className="text-xs text-muted-foreground">
            O delay será um valor aleatório entre o mínimo e o máximo configurados.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Mínimo</Label>
              <Input
                type="number"
                min={1}
                value={data.amountMin ?? ""}
                onChange={(e) => onUpdate({ amountMin: Number(e.target.value) })}
                placeholder="1"
              />
            </div>
            <div className="space-y-2">
              <Label>Máximo</Label>
              <Input
                type="number"
                min={1}
                value={data.amountMax ?? ""}
                onChange={(e) => onUpdate({ amountMax: Number(e.target.value) })}
                placeholder="5"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Unidade</Label>
            <Select
              value={data.unit || "hours"}
              onValueChange={(v) => onUpdate({ unit: v as DelayUnit })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="seconds">Segundos</SelectItem>
                <SelectItem value="minutes">Minutos</SelectItem>
                <SelectItem value="hours">Horas</SelectItem>
                <SelectItem value="days">Dias</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>Quantidade</Label>
            <Input
              type="number"
              min={1}
              value={data.amount || ""}
              onChange={(e) => onUpdate({ amount: Number(e.target.value) })}
              placeholder="1"
            />
          </div>
          <div className="space-y-2">
            <Label>Unidade</Label>
            <Select
              value={data.unit || "hours"}
              onValueChange={(v) => onUpdate({ unit: v as DelayUnit })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="seconds">Segundos</SelectItem>
                <SelectItem value="minutes">Minutos</SelectItem>
                <SelectItem value="hours">Horas</SelectItem>
                <SelectItem value="days">Dias</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  );
}
