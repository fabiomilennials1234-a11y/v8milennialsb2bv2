import { useState } from "react";
import { Plus, Timer, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useSlaConfigs, useCreateSlaConfig, useUpdateSlaConfig, useDeleteSlaConfig, SlaConfig } from "@/modules/platform/hooks/useSlaConfigs";
import { useAllPipelineStages, usePipelineDisplayConfig } from "@/modules/pipelines";

const ESCALATION_ACTIONS = [
  { value: "notify", label: "Notificar responsavel" },
  { value: "escalate", label: "Escalar para gestor" },
  { value: "auto_move", label: "Mover automaticamente" },
  { value: "create_followup", label: "Criar follow-up" },
];

/**
 * `sla_configs` é chaveada por `pipeline_type` TEXT (sem `pipeline_id`) e tem
 * 0 linhas em prod (medido 2026-09-02) — o painel só alcança o trio de fábrica
 * até a tabela ganhar FK de funil (W6). O rótulo, ao menos, sai do display
 * config real da org (rename prevalece) em vez do nome hardcoded.
 */
const PIPELINE_TYPES = ["whatsapp", "confirmacao", "propostas"] as const;
const FALLBACK_TYPE_NAME: Record<string, string> = {
  whatsapp: "Qualificação",
  confirmacao: "Confirmação",
  propostas: "Propostas",
};

export function SlaConfigPanel() {
  const { data: configs = [], isLoading } = useSlaConfigs();
  const { data: allStages = [] } = useAllPipelineStages();
  const { data: displayConfig = [] } = usePipelineDisplayConfig();

  function pipeName(type: string): string {
    return (
      displayConfig.find((c) => c.pipe_type === type)?.display_name ??
      FALLBACK_TYPE_NAME[type] ??
      type
    );
  }
  const createSla = useCreateSlaConfig();
  const updateSla = useUpdateSlaConfig();
  const deleteSla = useDeleteSlaConfig();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({
    pipeline_type: "whatsapp" as string,
    stage_id: "",
    max_hours: "24",
    escalation_action: "notify",
  });

  function stagesForPipe(pipe: string) {
    return allStages.filter((s) => s.pipeline_type === pipe);
  }

  function getStageName(stageId: string | null) {
    if (!stageId) return "Todos";
    const stage = allStages.find((s) => s.id === stageId);
    return stage?.name ?? stageId.slice(0, 8);
  }

  function handleCreate() {
    const hours = parseInt(form.max_hours);
    if (!hours || hours < 1) return;

    createSla.mutate({
      pipeline_type: form.pipeline_type,
      stage_id: form.stage_id || undefined,
      max_hours: hours,
      escalation_action: form.escalation_action,
    });
    setDialogOpen(false);
  }

  function handleToggle(config: SlaConfig) {
    updateSla.mutate({ id: config.id, is_active: !config.is_active });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium flex items-center gap-2">
            <Timer className="h-5 w-5 text-primary" />
            SLA por etapa
          </h3>
          <p className="text-sm text-muted-foreground">
            Defina prazos maximos por etapa do pipeline e acoes em caso de atraso
          </p>
        </div>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="mr-1 h-4 w-4" /> Novo SLA
        </Button>
      </div>

      {configs.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Timer className="h-8 w-8 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">Nenhum SLA configurado</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {configs.map((config) => (
            <Card key={config.id} className={!config.is_active ? "opacity-50" : ""}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-sm">
                      {pipeName(config.pipeline_type)} — {getStageName(config.stage_id)}
                    </CardTitle>
                    <Badge variant="outline" className="text-xs tabular-nums">
                      {config.max_hours}h
                    </Badge>
                    <Badge variant="secondary" className="text-[10px]">
                      {ESCALATION_ACTIONS.find((a) => a.value === config.escalation_action)?.label ?? config.escalation_action}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={config.is_active}
                      onCheckedChange={() => handleToggle(config)}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteSla.mutate(config.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Novo SLA</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Pipeline</Label>
              <Select
                value={form.pipeline_type}
                onValueChange={(v) => setForm({ ...form, pipeline_type: v, stage_id: "" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PIPELINE_TYPES.map((p) => (
                    <SelectItem key={p} value={p}>{pipeName(p)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Etapa (opcional — vazio = todas)</Label>
              <Select
                value={form.stage_id || "all"}
                onValueChange={(v) => setForm({ ...form, stage_id: v === "all" ? "" : v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as etapas</SelectItem>
                  {stagesForPipe(form.pipeline_type).map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Tempo maximo (horas)</Label>
              <Input
                type="number"
                min={1}
                value={form.max_hours}
                onChange={(e) => setForm({ ...form, max_hours: e.target.value })}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Acao ao estourar</Label>
              <Select
                value={form.escalation_action}
                onValueChange={(v) => setForm({ ...form, escalation_action: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ESCALATION_ACTIONS.map((a) => (
                    <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={createSla.isPending}>
              {createSla.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Criar SLA
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
