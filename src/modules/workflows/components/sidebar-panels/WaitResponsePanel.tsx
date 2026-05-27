import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { WaitResponseNodeData } from "@/types/workflow";

interface WaitResponsePanelProps {
  data: WaitResponseNodeData;
  onUpdate: (updates: Partial<WaitResponseNodeData>) => void;
}

export function WaitResponsePanel({ data, onUpdate }: WaitResponsePanelProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Nome</Label>
        <Input
          value={data.label || ""}
          onChange={(e) => onUpdate({ label: e.target.value })}
          placeholder="Ex: Esperar resposta do lead"
        />
      </div>

      <div className="space-y-2">
        <Label>Canal</Label>
        <Select
          value={data.channel || "any"}
          onValueChange={(v) => onUpdate({ channel: v as "whatsapp" | "meta" | "any" })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Qualquer canal</SelectItem>
            <SelectItem value="whatsapp">WhatsApp</SelectItem>
            <SelectItem value="meta">Meta (IG/FB)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Timeout (horas)</Label>
          <Input
            type="number"
            min={0}
            value={data.timeoutHours ?? 24}
            onChange={(e) => onUpdate({ timeoutHours: Number(e.target.value) })}
          />
        </div>
        <div className="space-y-2">
          <Label>Timeout (minutos)</Label>
          <Input
            type="number"
            min={0}
            max={59}
            value={data.timeoutMinutes ?? 0}
            onChange={(e) => onUpdate({ timeoutMinutes: Number(e.target.value) })}
          />
        </div>
      </div>

      <div className="p-3 rounded-lg bg-orange-50 dark:bg-orange-950 border border-orange-200 dark:border-orange-800">
        <p className="text-xs text-orange-700 dark:text-orange-300">
          O workflow pausa aqui até o lead responder. Se não responder dentro do timeout,
          segue pela saída "Timeout". Se responder, segue pela saída "Respondeu".
        </p>
      </div>
    </div>
  );
}
