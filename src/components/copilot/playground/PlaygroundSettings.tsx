/**
 * PlaygroundSettings — Painel colapsavel de Settings
 *
 * Contem:
 * - Toggle Agente Proativo + config de gatilhos/disparos/audios
 * - Audiencia (atender contatos sem lead)
 *
 * NOTE: Disponibilidade, delay, temperatura e behavior windows foram movidos
 * para a tab Comportamento (PlaygroundComportamento).
 */

import { useState } from "react";
import {
  Radio,
  Mic,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import type { PlaygroundData } from "./types";

interface PlaygroundSettingsProps {
  data: PlaygroundData;
  onChange: (updates: Partial<PlaygroundData>) => void;
}

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
  const [selectedTriggers, setSelectedTriggers] = useState<string[]>([]);
  const [noResponseMinutes, setNoResponseMinutes] = useState(60);

  return (
    <div className="border rounded-lg divide-y">
      {/* ===== Audiencia ===== */}
      <div className="border-b border-border/40">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            <Users className="w-4 h-4 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium">Atender contatos sem lead</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {data.attendUnknownContacts
                  ? "IA responde qualquer numero que mandar mensagem"
                  : "IA so responde numeros que ja sao lead no sistema"}
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
