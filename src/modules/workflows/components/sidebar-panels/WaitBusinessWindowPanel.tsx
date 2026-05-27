import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WaitBusinessWindowNodeData, WorkflowBehaviorWindow, WindowAction } from "@/types/workflow";

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

const DAYS = [
  { value: "mon", label: "Seg" },
  { value: "tue", label: "Ter" },
  { value: "wed", label: "Qua" },
  { value: "thu", label: "Qui" },
  { value: "fri", label: "Sex" },
  { value: "sat", label: "Sáb" },
  { value: "sun", label: "Dom" },
] as const;

type DayKey = (typeof DAYS)[number]["value"];

const ACTION_LABEL: Record<string, string> = {
  pass: "Passar (continua o fluxo)",
  hold: "Segurar até janela X",
  route: "Desviar pela saída X",
};

function ensureDefaultWindow(data: WaitBusinessWindowNodeData): WorkflowBehaviorWindow[] {
  if (Array.isArray(data.windows) && data.windows.length > 0) return data.windows;
  // Migra legacy on-the-fly
  const legacyDays = (data.days || ["mon","tue","wed","thu","fri"]).map((d) => {
    const map: Record<string, string> = { seg: "mon", ter: "tue", qua: "wed", qui: "thu", sex: "fri", sab: "sat", dom: "sun" };
    return map[d] ?? d;
  }) as string[];
  return [
    {
      id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `w-${Date.now()}`,
      name: "Comercial",
      days: legacyDays,
      start: data.startTime ?? "09:00",
      end: data.endTime ?? "18:00",
      action: "pass",
    },
  ];
}

export function WaitBusinessWindowPanel({ data, onUpdate }: WaitBusinessWindowPanelProps) {
  const windows = useMemo(() => ensureDefaultWindow(data), [data]);
  const mode = data.mode ?? "hold";

  const update = (idx: number, patch: Partial<WorkflowBehaviorWindow>) => {
    const next = windows.map((w, i) => (i === idx ? { ...w, ...patch } : w));
    onUpdate({ windows: next });
  };

  const toggleDay = (idx: number, day: DayKey) => {
    const cur = windows[idx].days || [];
    const next = cur.includes(day) ? cur.filter((d) => d !== day) : [...cur, day];
    update(idx, { days: next });
  };

  const addWindow = () => {
    if (windows.length >= 6) return;
    const next: WorkflowBehaviorWindow[] = [
      ...windows,
      {
        id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `w-${Date.now()}`,
        name: `Janela ${windows.length + 1}`,
        days: [],
        start: "09:00",
        end: "18:00",
        action: "pass",
      },
    ];
    onUpdate({ windows: next });
  };

  const removeWindow = (idx: number) => {
    if (windows.length <= 1) return;
    onUpdate({ windows: windows.filter((_, i) => i !== idx) });
  };

  const otherWindowNames = (currentIdx: number) =>
    windows.filter((_, i) => i !== currentIdx).map((w) => w.name).filter(Boolean);

  const parseAction = (action: string): { kind: "pass" | "hold" | "route"; arg: string } => {
    if (action === "pass") return { kind: "pass", arg: "" };
    if (action.startsWith("hold_until:")) return { kind: "hold", arg: action.slice("hold_until:".length) };
    if (action.startsWith("route:")) return { kind: "route", arg: action.slice("route:".length) };
    return { kind: "pass", arg: "" };
  };

  const buildAction = (kind: "pass" | "hold" | "route", arg: string): WindowAction => {
    if (kind === "pass") return "pass";
    if (kind === "hold") return `hold_until:${arg}` as WindowAction;
    return `route:${arg}` as WindowAction;
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Nome do node</Label>
        <Input
          value={data.label || ""}
          onChange={(e) => onUpdate({ label: e.target.value })}
          placeholder="Ex: Horário comercial"
        />
      </div>

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
              <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Modo</Label>
        <Select value={mode} onValueChange={(v) => onUpdate({ mode: v as "hold" | "route" | "hybrid" })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="hold">Hold — só pausa fora janela</SelectItem>
            <SelectItem value="route">Route — desvia por saída</SelectItem>
            <SelectItem value="hybrid">Hybrid — combina pass + hold + route</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Janelas</Label>
          <Badge variant="secondary">{windows.length}/6</Badge>
        </div>

        {windows.map((win, idx) => {
          const parsed = parseAction(win.action);
          return (
            <div key={win.id} className="rounded-md border p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <Input
                  value={win.name}
                  onChange={(e) => update(idx, { name: e.target.value })}
                  placeholder="Nome da janela"
                  className="h-8"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeWindow(idx)}
                  disabled={windows.length <= 1}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>

              <div className="flex flex-wrap gap-1">
                {DAYS.map((day) => (
                  <Badge
                    key={day.value}
                    variant={win.days.includes(day.value) ? "default" : "outline"}
                    className={cn("cursor-pointer text-xs", win.days.includes(day.value) ? "bg-primary text-primary-foreground" : "")}
                    onClick={() => toggleDay(idx, day.value)}
                  >
                    {day.label}
                  </Badge>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Início</Label>
                  <Input type="time" value={win.start} onChange={(e) => update(idx, { start: e.target.value })} />
                </div>
                <div>
                  <Label className="text-xs">Fim</Label>
                  <Input type="time" value={win.end} onChange={(e) => update(idx, { end: e.target.value })} />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs flex items-center gap-1"><ArrowRight className="w-3 h-3" /> Ação dentro desta janela</Label>
                <Select
                  value={parsed.kind}
                  onValueChange={(v) => update(idx, { action: buildAction(v as "pass" | "hold" | "route", parsed.arg) })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pass">{ACTION_LABEL.pass}</SelectItem>
                    <SelectItem value="hold">{ACTION_LABEL.hold}</SelectItem>
                    <SelectItem value="route">{ACTION_LABEL.route}</SelectItem>
                  </SelectContent>
                </Select>

                {parsed.kind === "hold" && (
                  <Select
                    value={parsed.arg}
                    onValueChange={(v) => update(idx, { action: buildAction("hold", v) })}
                  >
                    <SelectTrigger><SelectValue placeholder="Selecione janela alvo" /></SelectTrigger>
                    <SelectContent>
                      {otherWindowNames(idx).map((n) => (
                        <SelectItem key={n} value={n}>{n}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {parsed.kind === "route" && (
                  <Input
                    placeholder="Chave da saída (ex: weekend_branch)"
                    value={parsed.arg}
                    onChange={(e) => update(idx, { action: buildAction("route", e.target.value) })}
                  />
                )}
              </div>
            </div>
          );
        })}

        <Button type="button" variant="outline" onClick={addWindow} disabled={windows.length >= 6} className="w-full">
          <Plus className="w-4 h-4 mr-2" /> Adicionar janela ({windows.length}/6)
        </Button>
      </div>

      <div className="rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 p-3 space-y-1">
        <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">Como funciona</p>
        <ul className="text-xs text-amber-700/80 dark:text-amber-400/80 space-y-0.5 list-disc list-inside">
          <li><strong>Passar</strong>: fluxo continua imediato pela saída padrão.</li>
          <li><strong>Segurar</strong>: fluxo dorme até a janela alvo abrir.</li>
          <li><strong>Desviar</strong>: fluxo sai por uma seta nomeada (saída múltipla no node).</li>
          <li>Primeira janela que casar (ordem da lista) vence.</li>
          <li>Sem janela ativa → fallback hold até primeira "Passar" abrir.</li>
        </ul>
      </div>
    </div>
  );
}
