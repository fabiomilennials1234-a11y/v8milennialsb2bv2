import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WEEKDAY_OPTIONS } from "@/types/workflow";
import type { WaitBusinessWindowNodeData } from "@/types/workflow";
import { cn } from "@/lib/utils";

interface WaitBusinessWindowPanelProps {
  data: WaitBusinessWindowNodeData;
  onUpdate: (updates: Partial<WaitBusinessWindowNodeData>) => void;
}

const TIMEZONE_OPTIONS = [
  { value: "America/Sao_Paulo", label: "Brasília (GMT-3)" },
  { value: "America/Manaus", label: "Manaus (GMT-4)" },
  { value: "America/Belem", label: "Belém (GMT-3)" },
  { value: "America/Fortaleza", label: "Fortaleza (GMT-3)" },
  { value: "America/Recife", label: "Recife (GMT-3)" },
  { value: "America/Cuiaba", label: "Cuiabá (GMT-4)" },
  { value: "America/Rio_Branco", label: "Rio Branco (GMT-5)" },
  { value: "America/Noronha", label: "Noronha (GMT-2)" },
];

export function WaitBusinessWindowPanel({ data, onUpdate }: WaitBusinessWindowPanelProps) {
  const days = data.days || ["seg", "ter", "qua", "qui", "sex"];

  const toggleDay = (day: string) => {
    const updated = days.includes(day)
      ? days.filter(d => d !== day)
      : [...days, day];
    if (updated.length === 0) return;
    onUpdate({ days: updated });
  };

  return (
    <div className="space-y-4">
      {/* Label */}
      <div className="space-y-2">
        <Label>Nome</Label>
        <Input
          value={data.label || ""}
          onChange={(e) => onUpdate({ label: e.target.value })}
          placeholder="Ex: Horário comercial"
        />
      </div>

      {/* Days */}
      <div className="space-y-2">
        <Label>Dias ativos</Label>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAY_OPTIONS.map((d) => (
            <Badge
              key={d.value}
              variant={days.includes(d.value) ? "default" : "outline"}
              className={cn(
                "cursor-pointer select-none px-2.5 py-1 text-xs",
                days.includes(d.value)
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              )}
              onClick={() => toggleDay(d.value)}
            >
              {d.label}
            </Badge>
          ))}
        </div>
      </div>

      {/* Time range */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>Início</Label>
          <Input
            type="time"
            value={data.startTime || "08:00"}
            onChange={(e) => onUpdate({ startTime: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label>Fim</Label>
          <Input
            type="time"
            value={data.endTime || "18:00"}
            onChange={(e) => onUpdate({ endTime: e.target.value })}
          />
        </div>
      </div>

      {/* Timezone */}
      <div className="space-y-2">
        <Label>Timezone</Label>
        <Select
          value={data.timezone || "America/Sao_Paulo"}
          onValueChange={(v) => onUpdate({ timezone: v })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIMEZONE_OPTIONS.map((tz) => (
              <SelectItem key={tz.value} value={tz.value}>
                {tz.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Behavior note */}
      <div className="rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 p-3">
        <p className="text-xs text-amber-700 dark:text-amber-400">
          O fluxo só avança dentro da janela configurada. Fora dela, aguarda automaticamente até o próximo horário permitido.
        </p>
      </div>
    </div>
  );
}
