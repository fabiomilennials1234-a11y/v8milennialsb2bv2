/**
 * Disponibilidade + Comportamento por horário (Time-Aware Behavior).
 *
 * Estrutura:
 *   1. Modo de atendimento legacy (mantido para retrocompat de prompt clássico)
 *   2. Comportamento por janela — até 6 janelas customizáveis
 *      - Toggle global hard/soft (canned vs LLM contextual)
 *      - Cada janela: nome + dias + horário + behavior textarea
 *      - Validação cobertura 24/7 obrigatória (visualização timeline 7×24)
 *      - Preview janela ativa neste momento
 *   3. Tempo de resposta (delay artificial)
 */

import { useMemo } from "react";
import { useFormContext } from "react-hook-form";
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock, Plus, Trash2, AlertTriangle, CheckCircle2, Zap, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CopilotWizardData } from "@/types/copilot";

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

const WINDOW_COLORS = [
  "bg-emerald-500/70",
  "bg-blue-500/70",
  "bg-violet-500/70",
  "bg-amber-500/70",
  "bg-rose-500/70",
  "bg-cyan-500/70",
] as const;

interface BehaviorWindow {
  id: string;
  name: string;
  days: DayKey[];
  start: string;
  end: string;
  behavior: string;
}

function parseHHMM(s: string): number {
  const [h, m] = s.split(":").map((x) => parseInt(x, 10));
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
}

/** Marca minutos cobertos do dia (1440 slots). Wrap midnight: end <= start cobre overnight. */
function buildDayCoverage(windows: BehaviorWindow[], dayKey: DayKey): Array<number | null> {
  const slots: Array<number | null> = new Array(1440).fill(null);
  windows.forEach((w, idx) => {
    const startMin = parseHHMM(w.start);
    const endMin = parseHHMM(w.end);
    const days = w.days || [];

    if (endMin > startMin) {
      if (days.includes(dayKey)) {
        for (let i = startMin; i <= endMin && i < 1440; i++) if (slots[i] === null) slots[i] = idx;
      }
    } else {
      // wrap midnight: cobre [start..1440) hoje + [0..end] amanhã (vem do dia anterior)
      if (days.includes(dayKey)) {
        for (let i = startMin; i < 1440; i++) if (slots[i] === null) slots[i] = idx;
      }
      const prevIdx = (DAYS.findIndex((d) => d.value === dayKey) + 6) % 7;
      const prevDay = DAYS[prevIdx].value;
      if (days.includes(prevDay)) {
        for (let i = 0; i <= endMin && i < 1440; i++) if (slots[i] === null) slots[i] = idx;
      }
    }
  });
  return slots;
}

function computeCoverageGaps(windows: BehaviorWindow[]): Array<{ day: DayKey; from: string; to: string }> {
  const gaps: Array<{ day: DayKey; from: string; to: string }> = [];
  for (const day of DAYS) {
    const slots = buildDayCoverage(windows, day.value);
    let gapStart = -1;
    for (let i = 0; i < 1440; i++) {
      if (slots[i] === null && gapStart === -1) gapStart = i;
      if (slots[i] !== null && gapStart !== -1) {
        gaps.push({ day: day.value, from: minToHHMM(gapStart), to: minToHHMM(i - 1) });
        gapStart = -1;
      }
    }
    if (gapStart !== -1) {
      gaps.push({ day: day.value, from: minToHHMM(gapStart), to: "23:59" });
    }
  }
  return gaps;
}

function minToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function dayLabel(d: DayKey): string {
  return DAYS.find((x) => x.value === d)?.label ?? d;
}

function getNowDayMinutes(tz: string): { day: DayKey; minutes: number; formatted: string } {
  const now = new Date();
  const weekdayShort = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(now).toLowerCase();
  const map: Record<string, DayKey> = { sun: "sun", mon: "mon", tue: "tue", wed: "wed", thu: "thu", fri: "fri", sat: "sat" };
  const day = map[weekdayShort] ?? "mon";
  const hour = parseInt(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", hour12: false }).format(now), 10);
  const minute = parseInt(new Intl.DateTimeFormat("en-US", { timeZone: tz, minute: "2-digit" }).format(now), 10) || 0;
  const formatted = new Intl.DateTimeFormat("pt-BR", {
    timeZone: tz, weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(now);
  return { day, minutes: hour * 60 + minute, formatted };
}

function findActiveWindow(windows: BehaviorWindow[], day: DayKey, minutes: number): BehaviorWindow | null {
  for (const w of windows) {
    const slots = buildDayCoverage([w], day);
    if (slots[minutes] !== null) return w;
  }
  return null;
}

export function AvailabilityStep() {
  const { control, watch, setValue, formState } = useFormContext<CopilotWizardData>();
  const mode = watch("availability.mode");
  const days = watch("availability.days") as DayKey[];
  const timezone = watch("availability.timezone") || "America/Sao_Paulo";
  const behaviorWindows = (watch("behaviorWindows") as BehaviorWindow[] | undefined) || [];
  const enforcement = watch("behaviorEnforcement") || "hard";

  const gaps = useMemo(() => computeCoverageGaps(behaviorWindows), [behaviorWindows]);
  const hasFullCoverage = gaps.length === 0;

  const nowCtx = useMemo(() => getNowDayMinutes(timezone), [timezone]);
  const activeWindow = useMemo(
    () => findActiveWindow(behaviorWindows, nowCtx.day, nowCtx.minutes),
    [behaviorWindows, nowCtx],
  );

  const toggleDay = (value: string) => {
    const next = days.includes(value as DayKey) ? days.filter((d) => d !== value) : [...days, value as DayKey];
    setValue("availability.days", next, { shouldValidate: true, shouldDirty: true });
  };

  const updateWindow = (idx: number, patch: Partial<BehaviorWindow>) => {
    const next = behaviorWindows.map((w, i) => (i === idx ? { ...w, ...patch } : w));
    setValue("behaviorWindows", next, { shouldValidate: true, shouldDirty: true });
  };

  const toggleWindowDay = (idx: number, day: DayKey) => {
    const cur = behaviorWindows[idx]?.days ?? [];
    const next = cur.includes(day) ? cur.filter((d) => d !== day) : [...cur, day];
    updateWindow(idx, { days: next });
  };

  const addWindow = () => {
    if (behaviorWindows.length >= 6) return;
    const id = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `w-${Date.now()}`;
    const next = [
      ...behaviorWindows,
      { id, name: `Janela ${behaviorWindows.length + 1}`, days: [] as DayKey[], start: "09:00", end: "18:00", behavior: "" },
    ];
    setValue("behaviorWindows", next, { shouldValidate: true, shouldDirty: true });
  };

  const removeWindow = (idx: number) => {
    if (behaviorWindows.length <= 1) return;
    const next = behaviorWindows.filter((_, i) => i !== idx);
    setValue("behaviorWindows", next, { shouldValidate: true, shouldDirty: true });
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
          <Clock className="w-6 h-6 text-primary" />
          Disponibilidade e comportamento por horário
        </h2>
        <p className="text-muted-foreground">
          Modo de atendimento clássico + janelas customizáveis com instrução textual por horário.
        </p>
      </div>

      <section className="space-y-4 rounded-lg border bg-card p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">Atendimento — visão simples (legacy)</h3>
          <Badge variant="secondary">Retrocompatível</Badge>
        </div>

        <div className="grid gap-4">
          <FormField
            control={control}
            name="availability.mode"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Modo de atendimento</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="always">24 horas</SelectItem>
                    <SelectItem value="scheduled">Horário específico</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={control}
            name="availability.timezone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Fuso horário</FormLabel>
                <FormControl>
                  <Input placeholder="Ex: America/Sao_Paulo" {...field} />
                </FormControl>
                <FormDescription>IANA. Aplica também ao bloco de janelas abaixo.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          {mode === "scheduled" && (
            <>
              <FormField
                control={control}
                name="availability.days"
                render={() => (
                  <FormItem>
                    <FormLabel>Dias de atendimento</FormLabel>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {DAYS.map((day) => (
                        <label
                          key={day.value}
                          className="flex items-center gap-2 border rounded-md px-3 py-2 cursor-pointer hover:bg-muted/40"
                        >
                          <Checkbox
                            checked={days.includes(day.value)}
                            onCheckedChange={() => toggleDay(day.value)}
                          />
                          <span className="text-sm">{day.label}</span>
                        </label>
                      ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={control}
                  name="availability.start"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Início</FormLabel>
                      <FormControl>
                        <Input type="time" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={control}
                  name="availability.end"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Fim</FormLabel>
                      <FormControl>
                        <Input type="time" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </>
          )}
        </div>
      </section>

      <section className="space-y-4 rounded-lg border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              Comportamento por horário (Time-Aware)
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Defina até 6 janelas. Cada janela tem dias, horário e instrução textual injetada no prompt durante esse intervalo.
            </p>
          </div>
          <Badge variant={hasFullCoverage ? "default" : "destructive"}>
            {hasFullCoverage ? "Cobertura 24/7" : `${gaps.length} buraco(s)`}
          </Badge>
        </div>

        <div className="grid gap-2">
          <FormLabel className="flex items-center gap-2">
            <Zap className="w-4 h-4" />
            Aplicação fora de janela com instrução
          </FormLabel>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setValue("behaviorEnforcement", "hard", { shouldDirty: true })}
              className={cn(
                "rounded-md border p-3 text-left transition",
                enforcement === "hard" ? "border-primary bg-primary/5" : "hover:bg-muted/30",
              )}
            >
              <div className="text-sm font-semibold">Hard — mensagem fixa</div>
              <div className="text-xs text-muted-foreground mt-1">
                Janela sem instrução = resposta canned (não chama IA). Zero custo, zero variabilidade.
              </div>
            </button>
            <button
              type="button"
              onClick={() => setValue("behaviorEnforcement", "soft", { shouldDirty: true })}
              className={cn(
                "rounded-md border p-3 text-left transition",
                enforcement === "soft" ? "border-primary bg-primary/5" : "hover:bg-muted/30",
              )}
            >
              <div className="text-sm font-semibold">Soft — IA sempre responde</div>
              <div className="text-xs text-muted-foreground mt-1">
                IA é chamada em qualquer horário com contexto temporal. Resposta natural, custa tokens.
              </div>
            </button>
          </div>
        </div>

        <div className="space-y-3">
          {behaviorWindows.map((win, idx) => (
            <div key={win.id} className="rounded-md border p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className={cn("h-3 w-3 rounded-full", WINDOW_COLORS[idx % WINDOW_COLORS.length])} />
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
                  disabled={behaviorWindows.length <= 1}
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
                  <FormLabel className="text-xs">Início</FormLabel>
                  <Input
                    type="time"
                    value={win.start}
                    onChange={(e) => updateWindow(idx, { start: e.target.value })}
                  />
                </div>
                <div>
                  <FormLabel className="text-xs">Fim</FormLabel>
                  <Input
                    type="time"
                    value={win.end}
                    onChange={(e) => updateWindow(idx, { end: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <FormLabel className="text-xs">Comportamento (instrução pra IA nesta janela)</FormLabel>
                <Textarea
                  value={win.behavior}
                  onChange={(e) => updateWindow(idx, { behavior: e.target.value })}
                  placeholder="Ex: Tom casual, fim de semana. Avise que retorna segunda 9h pra dar mais detalhes."
                  rows={3}
                />
                <FormDescription className="text-xs mt-1">
                  Vazio + Hard = resposta canned. Vazio + Soft = IA usa comportamento padrão do agente.
                </FormDescription>
              </div>
            </div>
          ))}
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={addWindow}
          disabled={behaviorWindows.length >= 6}
          className="w-full"
        >
          <Plus className="w-4 h-4 mr-2" />
          Adicionar janela ({behaviorWindows.length}/6)
        </Button>

        <div className="space-y-2">
          <div className="text-sm font-medium">Cobertura semanal</div>
          <div className="rounded-md border bg-muted/20 p-3">
            <div className="grid grid-cols-[60px_1fr] gap-1 text-xs">
              {DAYS.map((day) => {
                const slots = buildDayCoverage(behaviorWindows, day.value);
                return (
                  <div key={day.value} className="contents">
                    <div className="flex items-center pr-2 text-muted-foreground font-medium">{day.label}</div>
                    <div className="flex h-5 rounded overflow-hidden border">
                      {slots.map((wIdx, m) => (
                        <div
                          key={m}
                          className={cn(
                            "flex-1",
                            wIdx === null ? "bg-rose-500/40" : WINDOW_COLORS[wIdx % WINDOW_COLORS.length],
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
                <div className="font-medium text-rose-500">Cobertura 24/7 incompleta — não é possível salvar</div>
                <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                  {gaps.slice(0, 5).map((g, i) => (
                    <li key={i}>
                      {dayLabel(g.day)}: {g.from} – {g.to}
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
              <span className="text-emerald-700 dark:text-emerald-300">Todos os horários cobertos.</span>
            </div>
          )}
        </div>

        <div className="rounded-md border bg-muted/30 p-3 text-sm">
          <div className="text-xs uppercase text-muted-foreground tracking-wide mb-1">Preview — agora</div>
          <div className="font-medium">{nowCtx.formatted}</div>
          <div className="mt-2">
            {activeWindow ? (
              <>
                <div>
                  Janela ativa: <strong>{activeWindow.name}</strong>{" "}
                  {activeWindow.behavior?.trim() ? (
                    <Badge variant="secondary" className="ml-1">com instrução</Badge>
                  ) : (
                    <Badge variant="outline" className="ml-1">sem instrução</Badge>
                  )}
                </div>
                {activeWindow.behavior?.trim() && (
                  <div className="text-muted-foreground text-xs mt-1 italic">"{activeWindow.behavior}"</div>
                )}
              </>
            ) : (
              <div className="text-rose-500">Nenhuma janela cobre este momento.</div>
            )}
          </div>
        </div>
      </section>

      <FormField
        control={control}
        name="responseDelaySeconds"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Tempo de resposta (segundos)</FormLabel>
            <FormControl>
              <Input
                type="number"
                min={0}
                max={30}
                placeholder="Ex: 3"
                value={field.value}
                onChange={(e) => field.onChange(Number(e.target.value))}
              />
            </FormControl>
            <FormDescription>Atraso humano artificial antes de responder (0–30s).</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}
