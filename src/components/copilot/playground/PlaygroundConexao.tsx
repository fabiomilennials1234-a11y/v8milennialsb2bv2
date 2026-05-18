/**
 * PlaygroundConexao — Tab "Conexao" do Playground
 *
 * Sections:
 * 1. WhatsApp Instance — select/link/unlink
 * 2. Retencao & Carteira — gated by customer_portfolio feature
 */

import {
  Smartphone,
  Link2,
  Unlink,
  Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWhatsAppInstancesWithAgent } from "@/hooks/useWhatsAppInstances";
import { useOrgFeatures } from "@/contexts/OrgFeaturesContext";

import type { ConexaoState } from "./conexao-comportamento-mapping";

interface PlaygroundConexaoProps {
  state: ConexaoState;
  onChange: (updates: Partial<ConexaoState>) => void;
  /** Edit mode — agent already exists, link/unlink acts immediately */
  agentId?: string;
}

export function PlaygroundConexao({ state, onChange, agentId }: PlaygroundConexaoProps) {
  const { data: whatsappInstances = [], isLoading: isLoadingInstances } =
    useWhatsAppInstancesWithAgent();
  const { hasFeature } = useOrgFeatures();

  const selectedInstance = whatsappInstances.find(
    (i) => i.id === state.whatsappInstanceId
  );

  return (
    <div className="space-y-6">
      {/* ===== WhatsApp Instance ===== */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Smartphone className="w-5 h-5" />
            Instancia WhatsApp
          </CardTitle>
          <CardDescription>
            Vincule uma instancia para o agente responder automaticamente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {state.whatsappInstanceId && selectedInstance ? (
            <div className="p-4 border rounded-lg bg-green-500/10 border-green-500/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                    <Link2 className="w-5 h-5 text-green-500" />
                  </div>
                  <div>
                    <p className="font-medium">
                      {selectedInstance.instance_name}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Agente vinculado
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onChange({ whatsappInstanceId: null })}
                  className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
                >
                  <Unlink className="w-4 h-4 mr-2" />
                  Desvincular
                </Button>
              </div>
            </div>
          ) : (
            <>
              {isLoadingInstances ? (
                <p className="text-center py-4 text-muted-foreground text-sm">
                  Carregando instancias...
                </p>
              ) : whatsappInstances.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground">
                  <Smartphone className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Nenhuma instancia encontrada</p>
                  <p className="text-xs mt-1">
                    Crie uma instancia na pagina de WhatsApp
                  </p>
                </div>
              ) : (
                <Select
                  value={state.whatsappInstanceId ?? ""}
                  onValueChange={(v) =>
                    onChange({ whatsappInstanceId: v || null })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione uma instancia" />
                  </SelectTrigger>
                  <SelectContent>
                    {whatsappInstances.map((instance) => {
                      const hasOtherAgent =
                        // @ts-ignore
                        instance.copilot_agent_id &&
                        // @ts-ignore
                        instance.copilot_agent_id !== agentId;
                      return (
                        <SelectItem
                          key={instance.id}
                          value={instance.id}
                          disabled={!!hasOtherAgent}
                        >
                          <div className="flex items-center gap-2">
                            <span>{instance.instance_name}</span>
                            <Badge
                              variant={
                                instance.status === "connected"
                                  ? "default"
                                  : "secondary"
                              }
                              className="text-[10px] px-1"
                            >
                              {instance.status === "connected"
                                ? "Online"
                                : instance.status}
                            </Badge>
                            {hasOtherAgent && (
                              <span className="text-[10px] text-muted-foreground">
                                (outro agente)
                              </span>
                            )}
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ===== Retencao & Carteira ===== */}
      {hasFeature("customer_portfolio") && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary" />
              Retencao & Carteira
            </CardTitle>
            <CardDescription>
              Comportamento do agente para clientes ativos na carteira.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Toggle principal */}
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">
                  Ativar retencao de clientes
                </Label>
                <p className="text-xs text-muted-foreground">
                  Injeta contexto de carteira no prompt automaticamente.
                </p>
              </div>
              <Switch
                checked={state.retentionEnabled}
                onCheckedChange={(v) => onChange({ retentionEnabled: v })}
              />
            </div>

            {state.retentionEnabled && (
              <div className="space-y-5 pl-1 border-l-2 border-primary/30 ml-1">
                {/* Frequencia maxima */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">
                      Frequencia maxima de contato
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={3}
                        max={30}
                        value={state.retentionConfig.max_frequency_days}
                        onChange={(e) => {
                          const v = Math.min(
                            30,
                            Math.max(3, parseInt(e.target.value) || 7)
                          );
                          onChange({
                            retentionConfig: {
                              ...state.retentionConfig,
                              max_frequency_days: v,
                            },
                          });
                        }}
                        className="w-16 h-8 text-center text-sm"
                      />
                      <span className="text-xs text-muted-foreground">
                        dias
                      </span>
                    </div>
                  </div>
                  <Slider
                    min={3}
                    max={30}
                    step={1}
                    value={[state.retentionConfig.max_frequency_days]}
                    onValueChange={([v]) =>
                      onChange({
                        retentionConfig: {
                          ...state.retentionConfig,
                          max_frequency_days: v,
                        },
                      })
                    }
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>3 dias</span>
                    <span>30 dias</span>
                  </div>
                </div>

                {/* Auto-approach */}
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium">
                      Auto-approach quando ciclo vence
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Agente inicia contato proativo quando ciclo de recompra
                      vence.
                    </p>
                  </div>
                  <Switch
                    checked={state.retentionConfig.auto_approach}
                    onCheckedChange={(v) =>
                      onChange({
                        retentionConfig: {
                          ...state.retentionConfig,
                          auto_approach: v,
                        },
                      })
                    }
                  />
                </div>

                {/* Strategic alert only */}
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium">
                      Somente alertas estrategicos
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Notifica o responsavel ao inves de abordar diretamente.
                    </p>
                  </div>
                  <Switch
                    checked={state.retentionConfig.strategic_alert_only}
                    onCheckedChange={(v) =>
                      onChange({
                        retentionConfig: {
                          ...state.retentionConfig,
                          strategic_alert_only: v,
                        },
                      })
                    }
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
