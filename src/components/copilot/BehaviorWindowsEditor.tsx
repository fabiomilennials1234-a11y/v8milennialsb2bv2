/**
 * Editor de janelas de comportamento (Time-Aware Behavior).
 *
 * Standalone, props-based. Usado por:
 *  - PlaygroundSettings (criacao + edicao via /copilot/novo e /copilot/:id/editar)
 *  - PlaygroundComportamento (tab Comportamento no Playground)
 *
 * Modelo:
 *  - Até 6 janelas { id, name, days, start, end, behavior }
 *  - Toggle global enforcement: hard (canned) | soft (LLM contextual)
 *  - Validação 24/7 com timeline 7×24
 *  - Preview da janela ativa agora
 */

import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Plus,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Zap,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type BehaviorEnforcement = "hard" | "soft";

export type BehaviorDayKey =
  | "mon"
  | "tue"
  | "wed"
  | "thu"
  | "fri"
  | "sat"
  | "sun";

export interface BehaviorWindow {
  id: string;
  name: string;
  days: BehaviorDayKey[];
  start: string;
  end: string;
  behavior: string;
}

interface BehaviorWindowsEditorProps {
  windows: BehaviorWindow[];
  enforcement: BehaviorEnforcement;
  timezone: string;
  onWindowsChange: (next: BehaviorWindow[]) => void;
  onEnforcementChange: (next: BehaviorEnforcement) => void;
  /** Esconde o cabeçalho (quando o componente já vem dentro de um painel). */
  hideHeader?: boolean;
}

const DAYS: ReadonlyArray<{ value: BehaviorDayKey; label: string }> = [
  { value: "mon", label: "Seg" },
  { value: "tue", label: "Ter" },
  { value: "wed", label: "Qua" },
  { value: "thu", label: "Qui" },
  { value: "fri", label: "Sex" },
  { value: "sat", label: "Sab" },
  { value: "sun", label: "Dom" },
];

const WINDOW_COLORS = [
  "bg-emerald-500/70",
  "bg-blue-500/70",
  "bg-violet-500/70",
  "bg-amber-500/70",
  "bg-rose-500/70",
  "bg-cyan-500/70",
] as const;

function parseHHMM(s: string): number {
  const [h, m] = (s || "00:00").split(":").map((x) => parseInt(x, 10));
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
}

function minToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function dayLabel(d: BehaviorDayKey): string {
  return DAYS.find((x) => x.value === d)?.label ?? d;
}

function buildDayCoverage(
  windows: BehaviorWindow[],
  dayKey: BehaviorDayKey,
): Array<number | null> {
  const slots: Array<number | null> = new Array(1440).fill(null);
  windows.forEach((w, idx) => {
    const startMin = parseHHMM(w.start);
    const endMin = parseHHMM(w.end);
    const days = w.days || [];

    if (endMin > startMin) {
      if (days.includes(dayKey)) {
        for (let i = startMin; i <= endMin && i < 1440; i++) {
          if (slots[i] === null) slots[i] = idx;
        }
      }
    } else {
      if (days.includes(dayKey)) {
        for (let i = startMin; i < 1440; i++) {
          if (slots[i] === null) slots[i] = idx;
        }
      }
      const prevIdx = (DAYS.findIndex((d) => d.value === dayKey) + 6) % 7;
      const prevDay = DAYS[prevIdx].value;
      if (days.includes(prevDay)) {
        for (let i = 0; i <= endMin && i < 1440; i++) {
          if (slots[i] === null) slots[i] = idx;
        }
      }
    }
  });
  return slots;
}

function computeCoverageGaps(
  windows: BehaviorWindow[],
): Array<{ day: BehaviorDayKey; from: string; to: string }> {
  const gaps: Array<{ day: BehaviorDayKey; from: string; to: string }> = [];
  for (const day of DAYS) {
    const slots = buildDayCoverage(windows, day.value);
    let gapStart = -1;
    for (let i = 0; i < 1440; i++) {
      if (slots[i] === null && gapStart === -1) gapStart = i;
      if (slots[i] !== null && gapStart !== -1) {
        gaps.push({
          day: day.value,
          from: minToHHMM(gapStart),
          to: minToHHMM(i - 1),
        });
        gapStart = -1;
      }
    }
    if (gapStart !== -1) {
      gaps.push({ day: day.value, from: minToHHMM(gapStart), to: "23:59" });
    }
  }
  return gaps;
}

function getNowDayMinutes(tz: string): {
  day: BehaviorDayKey;
  minutes: number;
  formatted: string;
} {
  const now = new Date();
  const weekdayShort = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  })
    .format(now)
    .toLowerCase();
  const map: Record<string, BehaviorDayKey> = {
    sun: "sun",
    mon: "mon",
    tue: "tue",
    wed: "wed",
    thu: "thu",
    fri: "fri",
    sat: "sat",
  };
  const day = map[weekdayShort] ?? "mon";
  const hour = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      hour12: false,
    }).format(now),
    10,
  );
  const minute =
    parseInt(
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        minute: "2-digit",
      }).format(now),
      10,
    ) || 0;
  const formatted = new Intl.DateTimeFormat("pt-BR", {
    timeZone: tz,
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  return { day, minutes: hour * 60 + minute, formatted };
}

function findActiveWindow(
  windows: BehaviorWindow[],
  day: BehaviorDayKey,
  minutes: number,
): BehaviorWindow | null {
  for (const w of windows) {
    const slots = buildDayCoverage([w], day);
    if (slots[minutes] !== null) return w;
  }
  return null;
}

function makeId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `w-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createDefaultBehaviorWindow(idx = 0): BehaviorWindow {
  return {
    id: makeId(),
    name: `Janela ${idx + 1}`,
    days: ["mon", "tue", "wed", "thu", "fri"] as BehaviorDayKey[],
    start: "09:00",
    end: "18:00",
    behavior: "",
  };
}

export function BehaviorWindowsEditor({
  windows,
  enforcement,
  timezone,
  onWindowsChange,
  onEnforcementChange,
  hideHeader,
}: BehaviorWindowsEditorProps) {
  const tz = timezone || "America/Sao_Paulo";

  const gaps = useMemo(() => computeCoverageGaps(windows), [windows]);
  const hasFullCoverage = gaps.length === 0;
  const nowCtx = useMemo(() => getNowDayMinutes(tz), [tz]);
  const activeWindow = useMemo(
    () => findActiveWindow(windows, nowCtx.day, nowCtx.minutes),
    [windows, nowCtx],
  );

  const updateWindow = (idx: number, patch: Partial<BehaviorWindow>) => {
    onWindowsChange(
      windows.map((w, i) => (i === idx ? { ...w, ...patch } : w)),
    );
  };

  const toggleWindowDay = (idx: number, day: BehaviorDayKey) => {
    const cur = windows[idx]?.days ?? [];
    const next = cur.includes(day)
      ? cur.filter((d) => d !== day)
      : [...cur, day];
    updateWindow(idx, { days: next });
  };

  const addWindow = () => {
    if (windows.length >= 6) return;
    onWindowsChange([...windows, createDefaultBehaviorWindow(windows.length)]);
  };

  const removeWindow = (idx: number) => {
    if (windows.length <= 1) return;
    onWindowsChange(windows.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-4">
      {!hideHeader && (
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              Comportamento por horario (Time-Aware)
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Defina ate 6 janelas. Cada janela tem dias, horario e instrucao
              textual injetada no prompt durante esse intervalo.
            </p>
          </div>
          <Badge variant={hasFullCoverage ? "default" : "destructive"}>
            {hasFullCoverage ? "Cobertura 24/7" : `${gaps.length} buraco(s)`}
          </Badge>
        </div>
      )}

      <div className="grid gap-2">
        <Label className="flex items-center gap-2 text-sm">
          <Zap className="w-4 h-4" />
          Aplicacao fora de janela com instrucao
        </Label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => onEnforcementChange("hard")}
            className={cn(
              "rounded-md border p-3 text-left transition",
              enforcement === "hard"
                ? "border-primary bg-primary/5"
                : "hover:bg-muted/30",
            )}
          >
            <div className="text-sm font-semibold">Hard - mensagem fixa</div>
            <div className="text-xs text-muted-foreground mt-1">
              Janela sem instrucao = resposta canned (nao chama IA). Zero
              custo, zero variabilidade.
            </div>
          </button>
          <button
            type="button"
            onClick={() => onEnforcementChange("soft")}
            className={cn(
              "rounded-md border p-3 text-left transition",
              enforcement === "soft"
                ? "border-primary bg-primary/5"
                : "hover:bg-muted/30",
            )}
          >
            <div className="text-sm font-semibold">
              Soft - IA sempre responde
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              IA e chamada em qualquer horario com contexto temporal. Resposta
              natural, custa tokens.
            </div>
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {windows.map((win, idx) => (
          <div key={win.id} className="rounded-md border p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "h-3 w-3 rounded-full",
                    WINDOW_COLORS[idx % WINDOW_COLORS.length],
                  )}
                />
                <Input
                  value={win.name}
                  onChange={(e) => updateWindow(idx, { name: e.target.value })}
                  className="h-8 w-56"
                  placeholder="Nome da janela"
                />
              </div>
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

            <div className="flex flex-wrap gap-2">
              {DAYS.map((day) => (
                <label
                  key={day.value}
                  className="flex items-center gap-2 border rounded-md px-2 py-1 cursor-pointer hover:bg-muted/40 text-sm"
                >
                  <Checkbox
                    checked={(win.days || []).includes(day.value)}
                    onCheckedChange={() => toggleWindowDay(idx, day.value)}
                  />
                  <span>{day.label}</span>
                </label>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Inicio</Label>
                <Input
                  type="time"
                  value={win.start}
                  onChange={(e) =>
                    updateWindow(idx, { start: e.target.value })
                  }
                />
              </div>
              <div>
                <Label className="text-xs">Fim</Label>
                <Input
                  type="time"
                  value={win.end}
                  onChange={(e) => updateWindow(idx, { end: e.target.value })}
                />
              </div>
            </div>

            <div>
              <Label className="text-xs">
                Comportamento (instrucao pra IA nesta janela)
              </Label>
              <Textarea
                value={win.behavior}
                onChange={(e) =>
                  updateWindow(idx, { behavior: e.target.value })
                }
                placeholder="Ex: Tom casual, fim de semana. Avise que retorna segunda 9h pra dar mais detalhes."
                rows={3}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Vazio + Hard = resposta canned. Vazio + Soft = IA usa
                comportamento padrao do agente.
              </p>
            </div>
          </div>
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        onClick={addWindow}
        disabled={windows.length >= 6}
        className="w-full"
      >
        <Plus className="w-4 h-4 mr-2" />
        Adicionar janela ({windows.length}/6)
      </Button>

      <div className="space-y-2">
        <div className="text-sm font-medium">Cobertura semanal</div>
        <div className="rounded-md border bg-muted/20 p-3">
          <div className="grid grid-cols-[60px_1fr] gap-1 text-xs">
            {DAYS.map((day) => {
              const slots = buildDayCoverage(windows, day.value);
              return (
                <div key={day.value} className="contents">
                  <div className="flex items-center pr-2 text-muted-foreground font-medium">
                    {day.label}
                  </div>
                  <div className="flex h-5 rounded overflow-hidden border">
                    {slots.map((wIdx, m) => (
                      <div
                        key={m}
                        className={cn(
                          "flex-1",
                          wIdx === null
                            ? "bg-rose-500/40"
                            : WINDOW_COLORS[wIdx % WINDOW_COLORS.length],
                        )}
                        style={{ minWidth: "1px" }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1 px-[60px]">
            <span>00h</span>
            <span>06h</span>
            <span>12h</span>
            <span>18h</span>
            <span>24h</span>
          </div>
        </div>

        {!hasFullCoverage && (
          <div className="rounded-md border border-rose-500/40 bg-rose-500/5 p-3 text-sm flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-500 mt-0.5 shrink-0" />
            <div>
              <div className="font-medium text-rose-500">
                Cobertura 24/7 incompleta - nao e possivel salvar
              </div>
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {gaps.slice(0, 5).map((g, i) => (
                  <li key={i}>
                    {dayLabel(g.day)}: {g.from} - {g.to}
                  </li>
                ))}
                {gaps.length > 5 && <li>... +{gaps.length - 5} buraco(s)</li>}
              </ul>
            </div>
          </div>
        )}

        {hasFullCoverage && (
          <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            <span className="text-emerald-700 dark:text-emerald-300">
              Todos os horarios cobertos.
            </span>
          </div>
        )}
      </div>

      <div className="rounded-md border bg-muted/30 p-3 text-sm">
        <div className="text-xs uppercase text-muted-foreground tracking-wide mb-1">
          Preview - agora ({tz})
        </div>
        <div className="font-medium">{nowCtx.formatted}</div>
        <div className="mt-2">
          {activeWindow ? (
            <>
              <div>
                Janela ativa: <strong>{activeWindow.name}</strong>{" "}
                {activeWindow.behavior?.trim() ? (
                  <Badge variant="secondary" className="ml-1">
                    com instrucao
                  </Badge>
                ) : (
                  <Badge variant="outline" className="ml-1">
                    sem instrucao
                  </Badge>
                )}
              </div>
              {activeWindow.behavior?.trim() && (
                <div className="text-muted-foreground text-xs mt-1 italic">
                  "{activeWindow.behavior}"
                </div>
              )}
            </>
          ) : (
            <div className="text-rose-500">
              Nenhuma janela cobre este momento.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function hasFullBehaviorCoverage(windows: BehaviorWindow[]): boolean {
  return computeCoverageGaps(windows).length === 0;
}
