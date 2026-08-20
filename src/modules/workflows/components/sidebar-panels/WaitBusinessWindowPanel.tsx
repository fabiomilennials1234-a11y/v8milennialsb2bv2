import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, ArrowRight, Lock, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  WaitBusinessWindowNodeData,
  WorkflowBehaviorWindow,
  StoredWindowAction,
} from "@/types/workflow";

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

/** Vocabulário oferecido HOJE. `hold` saiu — nada novo nasce com `hold_until:`. */
const ACTION_LABEL: Record<"send" | "route", string> = {
  send: "Enviar nesta janela",
  route: "Desviar pela saída X",
};

/**
 * Papel da janela para EXIBIÇÃO. Espelha (só para leitura) o intérprete de
 * runtime em `supabase/functions/_shared/workflow-window-role.ts` — o executor
 * segue sendo a única autoridade sobre o comportamento.
 */
type WindowRoleView =
  | { kind: "send"; arg: ""; legacyEmptyHold: boolean }
  | { kind: "route"; arg: string; legacyEmptyHold: false }
  | { kind: "blackout"; arg: string; legacyEmptyHold: false };

function readRole(action: string): WindowRoleView {
  const raw = (action ?? "").trim();

  if (raw.startsWith("hold_until:")) {
    const target = raw.slice("hold_until:".length);
    // Alvo vazio: a UI antiga oferecia "Segurar até janela X" e nunca exigia o
    // X. Uma janela solitária com alvo vazio é a janela de trabalho — o
    // executor a lê como envio, e aqui exibimos igual.
    if (target.trim() === "") return { kind: "send", arg: "", legacyEmptyHold: true };
    return { kind: "blackout", arg: target, legacyEmptyHold: false };
  }

  if (raw.startsWith("route:")) {
    const key = raw.slice("route:".length);
    if (key.trim() === "") return { kind: "send", arg: "", legacyEmptyHold: false };
    return { kind: "route", arg: key, legacyEmptyHold: false };
  }

  return { kind: "send", arg: "", legacyEmptyHold: false };
}

function buildAction(kind: "send" | "route", arg: string): StoredWindowAction {
  return kind === "send" ? "pass" : (`route:${arg}` as StoredWindowAction);
}

function ensureDefaultWindow(data: WaitBusinessWindowNodeData): WorkflowBehaviorWindow[] {
  if (Array.isArray(data.windows) && data.windows.length > 0) return data.windows;
  // Migra legacy on-the-fly — apenas para EXIBIR. Só vira dado gravado se o
  // usuário editar alguma coisa.
  const legacyDays = (data.days || ["mon", "tue", "wed", "thu", "fri"]).map((d) => {
    const map: Record<string, string> = {
      seg: "mon", ter: "tue", qua: "wed", qui: "thu", sex: "fri", sab: "sat", dom: "sun",
    };
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

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Janelas</Label>
          <Badge variant="secondary">{windows.length}/6</Badge>
        </div>

        {windows.map((win, idx) => {
          const role = readRole(win.action);

          // ── Janela legada de BLOQUEIO (`hold_until:<Nome>`) ──────────────
          // Somente leitura, e nunca reescrita ao salvar. Converter aqui
          // inverteria a intenção do usuário no primeiro save: uma janela
          // desenhada para NÃO enviar viraria uma janela de envio.
          if (role.kind === "blackout") {
            return (
              <div
                key={win.id}
                className="rounded-md border border-dashed border-amber-400/60 bg-amber-50/60 dark:bg-amber-950/20 p-3 space-y-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Lock className="w-3.5 h-3.5 shrink-0 text-amber-600 dark:text-amber-500" />
                    <span className="text-sm font-medium truncate">{win.name}</span>
                  </div>
                  <Badge variant="outline" className="shrink-0 text-[10px]">Bloqueio (legado)</Badge>
                </div>

                <div className="text-xs text-muted-foreground">
                  {(win.days || []).length > 0
                    ? (win.days || []).map((d) => DAYS.find((x) => x.value === d)?.label ?? d).join(", ")
                    : "Nenhum dia"}
                  {" · "}
                  {win.start}–{win.end}
                </div>

                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Esta janela foi desenhada como <strong>bloqueio</strong>: o fluxo dorme durante
                  ela e só volta quando “{role.arg}” abrir. O editor não cria mais janelas assim —
                  hoje uma janela é o horário em que a mensagem <strong>dispara</strong>. Ela
                  continua funcionando como está; nada é convertido automaticamente.
                </p>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => removeWindow(idx)}
                  disabled={windows.length <= 1}
                  title={windows.length <= 1 ? "Adicione outra janela antes de remover esta" : undefined}
                >
                  <Trash2 className="w-3.5 h-3.5 mr-2" /> Remover esta janela de bloqueio
                </Button>
              </div>
            );
          }

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
                  value={role.kind}
                  onValueChange={(v) => update(idx, { action: buildAction(v as "send" | "route", role.arg) })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="send">{ACTION_LABEL.send}</SelectItem>
                    <SelectItem value="route">{ACTION_LABEL.route}</SelectItem>
                  </SelectContent>
                </Select>

                {role.kind === "route" && (
                  <Input
                    placeholder="Chave da saída (ex: weekend_branch)"
                    value={role.arg}
                    onChange={(e) => update(idx, { action: buildAction("route", e.target.value) })}
                  />
                )}

                {role.legacyEmptyHold && (
                  <p className="text-xs text-muted-foreground flex gap-1.5">
                    <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>
                      Esta janela foi salva com o modo antigo “segurar”, sem janela alvo. A
                      semântica mudou: hoje ela é lida como <strong>horário de envio</strong>.
                      Mudar dias, nome ou horário não altera isso — só trocar o campo
                      “Ação dentro desta janela” regrava o valor.
                    </span>
                  </p>
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
          <li><strong>A janela é o horário em que a mensagem dispara.</strong></li>
          <li><strong>Enviar nesta janela</strong>: dentro dela o fluxo continua na hora, pela saída padrão.</li>
          <li><strong>Desviar pela saída X</strong>: dentro dela o fluxo sai por uma seta nomeada.</li>
          <li>Fora de todas as janelas o fluxo dorme até a próxima janela de envio abrir.</li>
          <li>Primeira janela que casar (ordem da lista) vence.</li>
          <li>Resume atrasado mais de 24h expira sem enviar — mensagem fora de contexto não sai.</li>
        </ul>
      </div>
    </div>
  );
}
