/**
 * PlaygroundTools — Painel colapsavel de Tools
 *
 * Cada tool = card com toggle + mini-form de configuracao
 */

import { useState } from "react";
import { QuoteTemplateConfig } from "./QuoteTemplateConfig";
import {
  UserCheck,
  Calendar,
  ArrowRightLeft,
  ArrowUpRight,
  Headphones,
  UserPlus,
  Database,
  FileText,
  FilePlus,
  PauseCircle,
  ChevronDown,
  ChevronUp,
  Wrench,
  Lock,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
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
import type { PlaygroundToolDef, PlaygroundToolState } from "./types";
import { PLAYGROUND_TOOLS, isMoverCardAutoEnabled } from "./types";
import { usePipeTypeOptions } from "../../hooks/usePipeTypeOptions";

const ICON_MAP: Record<string, any> = {
  UserCheck,
  Calendar,
  ArrowRightLeft,
  ArrowUpRight,
  Headphones,
  UserPlus,
  Database,
  FileText,
  FilePlus,
  PauseCircle,
};

interface PlaygroundToolsProps {
  agentId?: string;
  tools: Record<string, PlaygroundToolState>;
  onChange: (tools: Record<string, PlaygroundToolState>) => void;
  /** Active pipes from agent config — drives MOVER_CARD auto-enable */
  activePipes?: string[];
}

export function PlaygroundTools({ tools, onChange, activePipes, agentId }: PlaygroundToolsProps) {
  const pipeTypeOptions = usePipeTypeOptions({ incluirCampanha: false });
  const [expandedTool, setExpandedTool] = useState<string | null>(null);

  const activeCount = Object.values(tools).filter((t) => t.enabled).length;

  const toggleTool = (toolId: string) => {
    const current = tools[toolId] || { enabled: false, config: {}, instruction: "" };
    const def = PLAYGROUND_TOOLS.find((t) => t.id === toolId);
    const wasEnabled = current.enabled;
    onChange({
      ...tools,
      [toolId]: {
        ...current,
        enabled: !wasEnabled,
        // Pre-fill instruction with default when enabling for the first time
        instruction: !wasEnabled && !current.instruction && def ? def.defaultInstruction : current.instruction,
      },
    });
  };

  const updateToolConfig = (toolId: string, key: string, value: any) => {
    const current = tools[toolId] || { enabled: true, config: {}, instruction: "" };
    onChange({
      ...tools,
      [toolId]: {
        ...current,
        config: { ...current.config, [key]: value },
      },
    });
  };

  const updateToolInstruction = (toolId: string, instruction: string) => {
    const current = tools[toolId] || { enabled: true, config: {}, instruction: "" };
    onChange({
      ...tools,
      [toolId]: { ...current, instruction },
    });
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-border/70">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-muted text-foreground/60">
            <Wrench className="w-4 h-4" />
          </span>
          <span className="text-sm font-bold tracking-tight">Tools</span>
          {activeCount > 0 && (
            <Badge variant="gold" className="text-[11px] tabular-nums">
              {activeCount} ativas
            </Badge>
          )}
        </div>
      </div>

      {/* Tool list */}
      <div className="divide-y divide-border/60">
        {PLAYGROUND_TOOLS.map((def) => {
          const isAutoEnabled = def.id === "MOVER_CARD" && isMoverCardAutoEnabled(activePipes);
          const state = tools[def.id] || { enabled: false, config: {}, instruction: "" };
          const effectiveEnabled = isAutoEnabled || state.enabled;
          const Icon = ICON_MAP[def.icon] || Wrench;
          const isExpanded = expandedTool === def.id && effectiveEnabled;

          return (
            <div key={def.id}>
              {/* Tool header */}
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {isAutoEnabled ? (
                    <div className="flex items-center gap-1" title="Autoativado (funis configurados)">
                      <Lock className="w-3.5 h-3.5 text-primary-soft-foreground" />
                    </div>
                  ) : (
                    <Switch
                      checked={state.enabled}
                      onCheckedChange={() => toggleTool(def.id)}
                    />
                  )}
                  <div
                    className={`flex items-center gap-2 flex-1 min-w-0 cursor-pointer ${
                      !effectiveEnabled ? "opacity-50" : ""
                    }`}
                    onClick={() => {
                      if (effectiveEnabled) {
                        setExpandedTool(isExpanded ? null : def.id);
                      }
                    }}
                  >
                    <span
                      className={`grid h-8 w-8 shrink-0 place-items-center rounded-[10px] ${
                        effectiveEnabled ? "bg-primary-soft text-primary-soft-foreground" : "bg-muted text-foreground/60"
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-semibold truncate">{def.name}</p>
                        {isAutoEnabled && (
                          <Badge variant="gold" className="h-4 shrink-0 px-1.5 py-0 text-[9px]">
                            auto
                          </Badge>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground truncate">{def.description}</p>
                    </div>
                  </div>
                </div>

                {effectiveEnabled && (
                  <button
                    type="button"
                    className="grid h-7 w-7 place-items-center rounded-[9px] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={isExpanded ? `Recolher ${def.name}` : `Configurar ${def.name}`}
                    aria-expanded={isExpanded}
                    onClick={() => setExpandedTool(isExpanded ? null : def.id)}
                  >
                    {isExpanded ? (
                      <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                    )}
                  </button>
                )}
              </div>

              {/* Tool config: instruction + parameters */}
              {isExpanded && (
                <div className="ml-[5.25rem] space-y-3 px-4 pb-4">
                  {/* Instruction textarea */}
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold">Instrução de uso</Label>
                    <textarea
                      value={state.instruction || ""}
                      onChange={(e) => updateToolInstruction(def.id, e.target.value)}
                      placeholder={def.defaultInstruction}
                      className="w-full resize-none rounded-xl border border-input bg-sunken p-3 text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring/40 min-h-[80px]"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Descreva quando e como o copilot deve usar esta ferramenta. Quanto mais específico, melhor.
                    </p>
                  </div>

                  {/* Parameters */}
                  {def.id === "GERAR_ORCAMENTO_PDF" && <QuoteTemplateConfig agentId={agentId} config={state.config} onChange={patch => onChange({ ...tools, [def.id]: { ...state, config: { ...state.config, ...patch } } })} />}
                  {def.parameters.length > 0 && (
                    <div className="space-y-2 border-t border-border/40 pt-2">
                      <p className="text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">Configuração</p>
                      {def.parameters.map((param) => (
                        <div key={param.key} className="space-y-1">
                          <Label className="text-xs">{param.label}</Label>
                          {param.type === "select" ? (
                            <Select
                              value={state.config[param.key] || ""}
                              onValueChange={(v) => updateToolConfig(def.id, param.key, v)}
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue placeholder="Selecione..." />
                              </SelectTrigger>
                              <SelectContent>
                                {(param.key === "pipe"
                                  ? pipeTypeOptions.filter((pipe) => pipe.isVisible !== false || pipe.value === state.config[param.key])
                                  : param.options ?? []
                                ).map((opt) => (
                                  <SelectItem key={opt.value} value={opt.value}>
                                    {opt.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : param.type === "number" ? (
                            <Input
                              type="number"
                              value={state.config[param.key] || ""}
                              onChange={(e) => updateToolConfig(def.id, param.key, Number(e.target.value))}
                              placeholder={param.placeholder}
                              className="h-8 text-xs"
                            />
                          ) : (
                            <Input
                              value={state.config[param.key] || ""}
                              onChange={(e) => updateToolConfig(def.id, param.key, e.target.value)}
                              placeholder={param.placeholder}
                              className="h-8 text-xs"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
