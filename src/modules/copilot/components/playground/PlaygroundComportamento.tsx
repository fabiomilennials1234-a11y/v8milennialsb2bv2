/**
 * PlaygroundComportamento — Tab "Comportamento" do Playground
 *
 * Sections:
 * 1. Disponibilidade (always vs scheduled)
 * 2. Response delay (0-45s slider)
 * 3. Temperatura LLM (criativo/balanceado/preciso)
 * 4. Behavior Windows (time-aware rules editor)
 * 5. Behavior Enforcement (hard/soft)
 */

import { useState } from "react";
import {
  Clock,
  Timer,
  Thermometer,
  Sparkles,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BehaviorWindowsEditor,
  hasFullBehaviorCoverage,
} from "@/modules/copilot/components/BehaviorWindowsEditor";

import type { ComportamentoState } from "./conexao-comportamento-mapping";
import { IconChip } from "@/components/ui/bento";

interface PlaygroundComportamentoProps {
  state: ComportamentoState;
  onChange: (updates: Partial<ComportamentoState>) => void;
}

const TEMP_MODES = [
  {
    value: "criativo" as const,
    label: "Criativo",
    desc: "Respostas variadas e expressivas",
    color: "bg-insights/10 text-insights",
  },
  {
    value: "balanceado" as const,
    label: "Balanceado",
    desc: "Equilíbrio entre criatividade e precisão",
    color: "bg-primary-soft text-primary-soft-foreground",
  },
  {
    value: "preciso" as const,
    label: "Preciso",
    desc: "Respostas consistentes e diretas",
    color: "bg-success/10 text-success",
  },
];

const DAYS = [
  { value: "mon", label: "Seg" },
  { value: "tue", label: "Ter" },
  { value: "wed", label: "Qua" },
  { value: "thu", label: "Qui" },
  { value: "fri", label: "Sex" },
  { value: "sat", label: "Sáb" },
  { value: "sun", label: "Dom" },
];

export function PlaygroundComportamento({
  state,
  onChange,
}: PlaygroundComportamentoProps) {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    availability: true,
    response: false,
    behavior: false,
  });

  const toggleSection = (id: string) =>
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));

  const SectionHeader = ({
    id,
    icon: Icon,
    title,
    badge,
  }: {
    id: string;
    icon: any;
    title: string;
    badge?: string;
  }) => (
    <button
      type="button"
      className="flex w-full items-center justify-between px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      aria-expanded={!!openSections[id]}
      onClick={() => toggleSection(id)}
    >
      <div className="flex items-center gap-2.5">
        <IconChip icon={Icon} />
        <span className="text-sm font-bold tracking-tight">{title}</span>
        {badge && (
          <Badge variant="soft" className="text-[11px]">
            {badge}
          </Badge>
        )}
      </div>
      {openSections[id] ? (
        <ChevronUp className="w-4 h-4 text-muted-foreground" />
      ) : (
        <ChevronDown className="w-4 h-4 text-muted-foreground" />
      )}
    </button>
  );

  return (
    <div className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/70">
      {/* ===== Disponibilidade ===== */}
      <div>
        <SectionHeader
          id="availability"
          icon={Clock}
          title="Disponibilidade"
          badge={
            state.availability.mode === "always"
              ? "Sempre ativo"
              : "Horário programado"
          }
        />
        {openSections.availability && (
          <div className="px-4 pb-4 space-y-3">
            <div className="flex items-center gap-3">
              <Label className="text-sm">Modo</Label>
              <Select
                value={state.availability.mode}
                onValueChange={(v) =>
                  onChange({
                    availability: {
                      ...state.availability,
                      mode: v as "always" | "scheduled",
                    },
                  })
                }
              >
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="always">Sempre ativo</SelectItem>
                  <SelectItem value="scheduled">Horário programado</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {state.availability.mode === "scheduled" && (
              <>
                <div className="flex flex-wrap gap-2">
                  {DAYS.map((day) => (
                    <button
                      key={day.value}
                      type="button"
                      aria-pressed={state.availability.days.includes(day.value)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                        state.availability.days.includes(day.value)
                          ? "border-tinta bg-tinta text-tinta-foreground"
                          : "border-border bg-card hover:border-foreground/20"
                      }`}
                      onClick={() => {
                        const days = state.availability.days.includes(day.value)
                          ? state.availability.days.filter(
                              (d) => d !== day.value
                            )
                          : [...state.availability.days, day.value];
                        onChange({
                          availability: { ...state.availability, days },
                        });
                      }}
                    >
                      {day.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs">De</Label>
                    <Input
                      type="time"
                      value={state.availability.start}
                      onChange={(e) =>
                        onChange({
                          availability: {
                            ...state.availability,
                            start: e.target.value,
                          },
                        })
                      }
                      className="w-28 h-8 text-xs"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs">Até</Label>
                    <Input
                      type="time"
                      value={state.availability.end}
                      onChange={(e) =>
                        onChange({
                          availability: {
                            ...state.availability,
                            end: e.target.value,
                          },
                        })
                      }
                      className="w-28 h-8 text-xs"
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ===== Delay + Temperature ===== */}
      <div>
        <SectionHeader
          id="response"
          icon={Timer}
          title="Resposta"
          badge={`${(state.responseDelayMs / 1000).toFixed(1)}s delay`}
        />
        {openSections.response && (
          <div className="px-4 pb-4 space-y-4">
            {/* Delay */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm flex items-center gap-1.5">
                  <Timer className="w-3.5 h-3.5" />
                  Delay de resposta
                </Label>
                <span className="text-xs font-bold tabular-nums text-foreground/80">
                  {(state.responseDelayMs / 1000).toFixed(1)}s
                </span>
              </div>
              <Slider
                value={[state.responseDelayMs]}
                onValueChange={([v]) => onChange({ responseDelayMs: v })}
                min={0}
                max={45000}
                step={500}
                className="w-full"
              />
            </div>

            {/* Temperature */}
            <div className="space-y-2">
              <Label className="text-sm flex items-center gap-1.5">
                <Thermometer className="w-3.5 h-3.5" />
                Temperatura do LLM
              </Label>
              <div className="grid grid-cols-3 gap-2">
                {TEMP_MODES.map((mode) => (
                  <button
                    key={mode.value}
                    type="button"
                    aria-pressed={state.llmTemperatureMode === mode.value}
                    className={`rounded-xl border p-2.5 text-center transition-all ${
                      state.llmTemperatureMode === mode.value
                        ? `${mode.color} border-current ring-1 ring-current`
                        : "border-border hover:bg-muted"
                    }`}
                    onClick={() =>
                      onChange({ llmTemperatureMode: mode.value })
                    }
                  >
                    <p className="text-xs font-bold">{mode.label}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {mode.desc}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ===== Behavior Windows ===== */}
      <div>
        <SectionHeader
          id="behavior"
          icon={Sparkles}
          title="Comportamento por horário (Time-Aware)"
          badge={
            hasFullBehaviorCoverage(state.behaviorWindows)
              ? `${state.behaviorWindows.length} janela(s) - 24/7`
              : "Cobertura incompleta"
          }
        />
        {openSections.behavior && (
          <div className="px-4 pb-4">
            <BehaviorWindowsEditor
              windows={state.behaviorWindows}
              enforcement={state.behaviorEnforcement}
              timezone={state.availability.timezone}
              onWindowsChange={(behaviorWindows) =>
                onChange({ behaviorWindows })
              }
              onEnforcementChange={(behaviorEnforcement) =>
                onChange({ behaviorEnforcement })
              }
              hideHeader
            />
          </div>
        )}
      </div>
    </div>
  );
}
