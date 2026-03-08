/**
 * PlaygroundTools — Painel colapsavel de Tools
 *
 * Cada tool = card com toggle + mini-form de configuracao
 */

import { useState } from "react";
import {
  UserCheck,
  Calendar,
  ArrowRightLeft,
  MessageSquare,
  Headphones,
  UserPlus,
  Database,
  HelpCircle,
  FilePlus,
  ChevronDown,
  ChevronUp,
  Wrench,
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
import { PLAYGROUND_TOOLS } from "./types";

const ICON_MAP: Record<string, any> = {
  UserCheck,
  Calendar,
  ArrowRightLeft,
  MessageSquare,
  Headphones,
  UserPlus,
  Database,
  HelpCircle,
  FilePlus,
};

interface PlaygroundToolsProps {
  tools: Record<string, PlaygroundToolState>;
  onChange: (tools: Record<string, PlaygroundToolState>) => void;
}

export function PlaygroundTools({ tools, onChange }: PlaygroundToolsProps) {
  const [expandedTool, setExpandedTool] = useState<string | null>(null);

  const activeCount = Object.values(tools).filter((t) => t.enabled).length;

  const toggleTool = (toolId: string) => {
    const current = tools[toolId] || { enabled: false, config: {} };
    onChange({
      ...tools,
      [toolId]: { ...current, enabled: !current.enabled },
    });
  };

  const updateToolConfig = (toolId: string, key: string, value: any) => {
    const current = tools[toolId] || { enabled: true, config: {} };
    onChange({
      ...tools,
      [toolId]: {
        ...current,
        config: { ...current.config, [key]: value },
      },
    });
  };

  return (
    <div className="border rounded-lg">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <Wrench className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">Tools</span>
          {activeCount > 0 && (
            <Badge variant="secondary" className="text-xs px-1.5 py-0">
              {activeCount} ativas
            </Badge>
          )}
        </div>
      </div>

      {/* Tool list */}
      <div className="divide-y">
        {PLAYGROUND_TOOLS.map((def) => {
          const state = tools[def.id] || { enabled: false, config: {} };
          const Icon = ICON_MAP[def.icon] || Wrench;
          const isExpanded = expandedTool === def.id && state.enabled;

          return (
            <div key={def.id}>
              {/* Tool header */}
              <div className="flex items-center justify-between px-4 py-2.5">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <Switch
                    checked={state.enabled}
                    onCheckedChange={() => toggleTool(def.id)}
                  />
                  <div
                    className={`flex items-center gap-2 flex-1 min-w-0 cursor-pointer ${
                      !state.enabled ? "opacity-50" : ""
                    }`}
                    onClick={() => {
                      if (state.enabled) {
                        setExpandedTool(isExpanded ? null : def.id);
                      }
                    }}
                  >
                    <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{def.name}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{def.description}</p>
                    </div>
                  </div>
                </div>

                {state.enabled && def.parameters.length > 0 && (
                  <button
                    type="button"
                    className="p-1 hover:bg-muted rounded"
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

              {/* Tool config form */}
              {isExpanded && def.parameters.length > 0 && (
                <div className="px-4 pb-3 ml-12 space-y-2">
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
                            {param.options?.map((opt) => (
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

                  {/* Mention hint */}
                  <p className="text-[10px] text-muted-foreground pt-1">
                    Use <span className="font-mono bg-muted px-1 rounded">@{def.id}</span> no prompt para referenciar esta tool
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
