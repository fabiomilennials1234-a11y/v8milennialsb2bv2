/**
 * PlaygroundSettings — Painel colapsavel de Settings
 *
 * Contem:
 * - Horario de funcionamento
 * - Delay de resposta + Temperature LLM
 * - Toggle Agente Proativo + config de gatilhos/disparos/audios
 */

import { useState } from "react";
import {
  Clock,
  Zap,
  Radio,
  ChevronDown,
  ChevronUp,
  Thermometer,
  Timer,
  Mic,
  Plus,
  X,
  Sparkles,
  Users,
} from "lucide-react";
import {
  BehaviorWindowsEditor,
  hasFullBehaviorCoverage,
} from "@/components/copilot/BehaviorWindowsEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PlaygroundData } from "./types";

interface PlaygroundSettingsProps {
  data: PlaygroundData;
  onChange: (updates: Partial<PlaygroundData>) => void;
}

const TEMP_MODES = [
  { value: "criativo", label: "Criativo", desc: "Respostas variadas e expressivas", temp: "0.9", color: "bg-purple-500/10 text-purple-600 border-purple-300" },
  { value: "balanceado", label: "Balanceado", desc: "Equilibrio entre criatividade e precisao", temp: "0.7", color: "bg-blue-500/10 text-blue-600 border-blue-300" },
  { value: "preciso", label: "Preciso", desc: "Respostas consistentes e diretas", temp: "0.2", color: "bg-green-500/10 text-green-600 border-green-300" },
] as const;

const DAYS = [
  { value: "mon", label: "Seg" },
  { value: "tue", label: "Ter" },
  { value: "wed", label: "Qua" },
  { value: "thu", label: "Qui" },
  { value: "fri", label: "Sex" },
  { value: "sat", label: "Sab" },
  { value: "sun", label: "Dom" },
];

const TRIGGER_OPTIONS = [
  { id: "lead_added", label: "Lead adicionado ao sistema" },
  { id: "stage_change", label: "Mudanca de etapa do lead" },
  { id: "no_response", label: "Tempo sem resposta do cliente" },
  { id: "tag_added", label: "Tag especifica adicionada" },
  { id: "specific_origin", label: "Origem especifica" },
];

const ORIGIN_OPTIONS = [
  "meta_ads", "google_ads", "linkedin", "site", "indicacao", "evento", "outbound", "outro",
];

const AVAILABLE_VARIABLES = ["nome", "empresa", "email", "telefone", "origem", "interesse", "segmento", "campanha"];

export function PlaygroundSettings({ data, onChange }: PlaygroundSettingsProps) {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [selectedTriggers, setSelectedTriggers] = useState<string[]>([]);
  const [noResponseMinutes, setNoResponseMinutes] = useState(60);

  const toggleSection = (section: string) => {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const SectionHeader = ({ id, icon: Icon, title, badge }: { id: string; icon: any; title: string; badge?: string }) => (
    <button
      type="button"
      className="flex items-center justify-between w-full px-4 py-3 hover:bg-muted/50 transition-colors"
      onClick={() => toggleSection(id)}
    >
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-medium">{title}</span>
        {badge && (
          <Badge variant="secondary" className="text-xs px-1.5 py-0">
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
    <div className="border rounded-lg divide-y">
      {/* ===== Horario de Funcionamento ===== */}
      <div>
        <SectionHeader
          id="hours"
          icon={Clock}
          title="Horario de Funcionamento"
          badge={data.availability.mode === "always" ? "Sempre ativo" : "Horario definido"}
        />
        {openSections.hours && (
          <div className="px-4 pb-4 space-y-3">
            <div className="flex items-center gap-3">
              <Label className="text-sm">Modo</Label>
              <Select
                value={data.availability.mode}
                onValueChange={(v) =>
                  onChange({ availability: { ...data.availability, mode: v as "always" | "scheduled" } })
                }
              >
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="always">Sempre ativo</SelectItem>
                  <SelectItem value="scheduled">Horario definido</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {data.availability.mode === "scheduled" && (
              <>
                <div className="flex flex-wrap gap-2">
                  {DAYS.map((day) => (
                    <button
                      key={day.value}
                      type="button"
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                        data.availability.days.includes(day.value)
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background hover:bg-muted border-border"
                      }`}
                      onClick={() => {
                        const days = data.availability.days.includes(day.value)
                          ? data.availability.days.filter((d) => d !== day.value)
                          : [...data.availability.days, day.value];
                        onChange({ availability: { ...data.availability, days } });
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
                      value={data.availability.start}
                      onChange={(e) => onChange({ availability: { ...data.availability, start: e.target.value } })}
                      className="w-28 h-8 text-xs"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs">Ate</Label>
                    <Input
                      type="time"
                      value={data.availability.end}
                      onChange={(e) => onChange({ availability: { ...data.availability, end: e.target.value } })}
                      className="w-28 h-8 text-xs"
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ===== Time-Aware Behavior (janelas customizáveis) ===== */}
      <div>
        <SectionHeader
          id="time-aware"
          icon={Sparkles}
          title="Comportamento por horario (Time-Aware)"
          badge={
            hasFullBehaviorCoverage(data.behaviorWindows)
              ? `${data.behaviorWindows.length} janela(s) - 24/7`
              : "Cobertura incompleta"
          }
        />
        {openSections["time-aware"] && (
          <div className="px-4 pb-4">
            <BehaviorWindowsEditor
              windows={data.behaviorWindows}
              enforcement={data.behaviorEnforcement}
              timezone={data.availability.timezone}
              onWindowsChange={(behaviorWindows) => onChange({ behaviorWindows })}
              onEnforcementChange={(behaviorEnforcement) =>
                onChange({ behaviorEnforcement })
              }
              hideHeader
            />
          </div>
        )}
      </div>

      {/* ===== Comportamento de Resposta ===== */}
      <div>
        <SectionHeader id="behavior" icon={Zap} title="Comportamento de Resposta" />
        {openSections.behavior && (
          <div className="px-4 pb-4 space-y-4">
            {/* Delay */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm flex items-center gap-1.5">
                  <Timer className="w-3.5 h-3.5" />
                  Delay de resposta
                </Label>
                <span className="text-xs text-muted-foreground">
                  {(data.responseDelayMs / 1000).toFixed(1)}s
                </span>
              </div>
              <Slider
                value={[data.responseDelayMs]}
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
                    className={`p-2 rounded-lg border text-center transition-all ${
                      data.llmTemperatureMode === mode.value
                        ? `${mode.color} border-current ring-1 ring-current`
                        : "border-border hover:bg-muted"
                    }`}
                    onClick={() => onChange({ llmTemperatureMode: mode.value })}
                  >
                    <p className="text-xs font-medium">{mode.label}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{mode.desc}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ===== Audiência ===== */}
      <div className="border-b border-border/40">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            <Users className="w-4 h-4 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium">Atender contatos sem lead</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {data.attendUnknownContacts
                  ? "IA responde qualquer número que mandar mensagem"
                  : "IA só responde números que já são lead no sistema"}
              </p>
            </div>
          </div>
          <Switch
            checked={data.attendUnknownContacts}
            onCheckedChange={(v) => onChange({ attendUnknownContacts: v })}
          />
        </div>
      </div>

      {/* ===== Agente Proativo ===== */}
      <div>
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">Agente Proativo</span>
            {data.isProactive && (
              <Badge variant="secondary" className="text-xs px-1.5 py-0">
                Ativo
              </Badge>
            )}
          </div>
          <Switch
            checked={data.isProactive}
            onCheckedChange={(v) =>
              onChange({
                isProactive: v,
                operationMode: v ? "hybrid" : "inbound",
              })
            }
          />
        </div>

        {data.isProactive && (
          <div className="px-4 pb-4 space-y-4">
            {/* Modo de operacao */}
            <div className="space-y-2">
              <Label className="text-sm">Modo de operacao</Label>
              <div className="flex gap-2">
                {(["hybrid", "outbound"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                      data.operationMode === mode
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border hover:bg-muted"
                    }`}
                    onClick={() => onChange({ operationMode: mode })}
                  >
                    {mode === "hybrid" ? "Hibrido (Inbound + Outbound)" : "Somente Outbound"}
                  </button>
                ))}
              </div>
            </div>

            {/* Gatilhos */}
            <div className="space-y-2">
              <Label className="text-sm">Gatilhos de ativacao</Label>
              <div className="space-y-2">
                {TRIGGER_OPTIONS.map((trigger) => (
                  <div key={trigger.id} className="flex items-start gap-2">
                    <Checkbox
                      id={`trigger-${trigger.id}`}
                      checked={selectedTriggers.includes(trigger.id)}
                      onCheckedChange={(checked) => {
                        setSelectedTriggers((prev) =>
                          checked ? [...prev, trigger.id] : prev.filter((t) => t !== trigger.id)
                        );
                      }}
                    />
                    <Label htmlFor={`trigger-${trigger.id}`} className="text-xs font-normal cursor-pointer">
                      {trigger.label}
                    </Label>
                  </div>
                ))}

                {selectedTriggers.includes("no_response") && (
                  <div className="ml-6 flex items-center gap-2">
                    <Input
                      type="number"
                      value={noResponseMinutes}
                      onChange={(e) => setNoResponseMinutes(Number(e.target.value))}
                      className="w-20 h-7 text-xs"
                    />
                    <span className="text-xs text-muted-foreground">minutos</span>
                  </div>
                )}

                {selectedTriggers.includes("tag_added") && (
                  <div className="ml-6">
                    <Input
                      placeholder="Tags (separadas por virgula)"
                      value={data.activationTriggers.required.tags.join(", ")}
                      onChange={(e) =>
                        onChange({
                          activationTriggers: {
                            ...data.activationTriggers,
                            required: {
                              ...data.activationTriggers.required,
                              tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean),
                            },
                          },
                        })
                      }
                      className="h-7 text-xs"
                    />
                  </div>
                )}

                {selectedTriggers.includes("specific_origin") && (
                  <div className="ml-6 flex flex-wrap gap-1.5">
                    {ORIGIN_OPTIONS.map((origin) => (
                      <button
                        key={origin}
                        type="button"
                        className={`px-2 py-1 rounded text-xs border transition-colors ${
                          data.activationTriggers.required.origins.includes(origin)
                            ? "bg-primary text-primary-foreground border-primary"
                            : "border-border hover:bg-muted"
                        }`}
                        onClick={() => {
                          const origins = data.activationTriggers.required.origins.includes(origin)
                            ? data.activationTriggers.required.origins.filter((o) => o !== origin)
                            : [...data.activationTriggers.required.origins, origin];
                          onChange({
                            activationTriggers: {
                              ...data.activationTriggers,
                              required: { ...data.activationTriggers.required, origins },
                            },
                          });
                        }}
                      >
                        {origin}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Config de disparo */}
            <div className="space-y-3 border-t pt-3">
              <Label className="text-sm font-medium">Configuracao de disparo</Label>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Delay (min)</Label>
                  <Input
                    type="number"
                    value={data.outboundConfig.delayMinutes}
                    onChange={(e) =>
                      onChange({
                        outboundConfig: { ...data.outboundConfig, delayMinutes: Number(e.target.value) },
                      })
                    }
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Max tentativas</Label>
                  <Input
                    type="number"
                    value={data.outboundConfig.maxRetries}
                    onChange={(e) =>
                      onChange({
                        outboundConfig: { ...data.outboundConfig, maxRetries: Number(e.target.value) },
                      })
                    }
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Intervalo (min)</Label>
                  <Input
                    type="number"
                    value={data.outboundConfig.retryIntervalMinutes}
                    onChange={(e) =>
                      onChange({
                        outboundConfig: { ...data.outboundConfig, retryIntervalMinutes: Number(e.target.value) },
                      })
                    }
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              {/* Mensagem inicial */}
              <div className="space-y-1">
                <Label className="text-xs">Mensagem inicial (opcional)</Label>
                <Textarea
                  value={data.outboundConfig.firstMessageTemplate}
                  onChange={(e) =>
                    onChange({
                      outboundConfig: { ...data.outboundConfig, firstMessageTemplate: e.target.value },
                    })
                  }
                  placeholder="Deixe vazio para o agente gerar automaticamente com base no prompt. Ou use variaveis: Oi {nome}! Vi que voce demonstrou interesse em {interesse}..."
                  className="text-xs min-h-[60px]"
                />
                <div className="flex flex-wrap gap-1 mt-1">
                  {AVAILABLE_VARIABLES.map((v) => (
                    <button
                      key={v}
                      type="button"
                      className="text-[10px] px-1.5 py-0.5 rounded bg-muted hover:bg-muted/80 text-muted-foreground"
                      onClick={() => {
                        const tmpl = data.outboundConfig.firstMessageTemplate;
                        onChange({
                          outboundConfig: { ...data.outboundConfig, firstMessageTemplate: `${tmpl}{${v}}` },
                        });
                      }}
                    >
                      {`{${v}}`}
                    </button>
                  ))}
                </div>
              </div>

              {/* Audio */}
              <div className="flex items-center justify-between pt-2 border-t">
                <div className="flex items-center gap-2">
                  <Mic className="w-3.5 h-3.5 text-muted-foreground" />
                  <Label className="text-xs">Enviar audio</Label>
                </div>
                <Switch
                  checked={data.audioEnabled}
                  onCheckedChange={(v) => onChange({ audioEnabled: v })}
                />
              </div>

              {data.audioEnabled && (
                <div className="flex gap-2">
                  {(["text_first", "audio_first"] as const).map((order) => (
                    <button
                      key={order}
                      type="button"
                      className={`px-3 py-1.5 rounded border text-xs transition-colors ${
                        data.audioSendOrder === order
                          ? "bg-primary text-primary-foreground border-primary"
                          : "border-border hover:bg-muted"
                      }`}
                      onClick={() => onChange({ audioSendOrder: order })}
                    >
                      {order === "text_first" ? "Texto primeiro" : "Audio primeiro"}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
