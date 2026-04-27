import { useState } from "react";
import { Clock, AlertTriangle, Check, Plus, Trash2, ArrowRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type PipelineStage, useUpdatePipelineStage, usePipelineStages } from "@/hooks/usePipelineStages";
import { useUpsellGestaoRules, useSaveGestaoRules } from "@/hooks/useUpsellGestaoRules";
import { toast } from "sonner";

interface UpsellStageRulesTabProps {
  stages: PipelineStage[];
}

interface StageRule {
  id: string;
  stage_key: string;
  name: string;
  color: string | null;
  enabled: boolean;
  min_days: string;
  max_days: string;
}

interface SyncMapping {
  base_stage_key: string;
  gestao_from_stage: string;
  gestao_to_stage: string;
}

export function UpsellStageRulesTab({ stages }: UpsellStageRulesTabProps) {
  const updateStage = useUpdatePipelineStage();
  const isBase = stages.length > 0 && stages[0].pipeline_type === "upsell_base";

  // Gestao stages (for sync dropdowns) — only fetched for upsell_base
  const { data: gestaoStages = [] } = usePipelineStages("upsell_gestao");
  const { data: existingGestaoRules = [] } = useUpsellGestaoRules();
  const saveGestaoRules = useSaveGestaoRules();

  const [rules, setRules] = useState<StageRule[]>(() =>
    stages.map((s) => ({
      id: s.id,
      stage_key: s.stage_key,
      name: s.name,
      color: s.color,
      enabled: s.auto_move_min_days != null && s.auto_move_max_days != null,
      min_days: s.auto_move_min_days != null ? String(s.auto_move_min_days) : "",
      max_days: s.auto_move_max_days != null ? String(s.auto_move_max_days) : "",
    }))
  );

  const [syncMappings, setSyncMappings] = useState<SyncMapping[]>(() =>
    existingGestaoRules.map((r) => ({
      base_stage_key: r.base_stage_key,
      gestao_from_stage: r.gestao_from_stage,
      gestao_to_stage: r.gestao_to_stage,
    }))
  );

  const [saving, setSaving] = useState(false);

  const updateRule = (index: number, field: keyof StageRule, value: any) => {
    setRules((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const toggleEnabled = (index: number) => {
    setRules((prev) => {
      const next = [...prev];
      const current = next[index];
      next[index] = {
        ...current,
        enabled: !current.enabled,
        min_days: !current.enabled ? current.min_days : "",
        max_days: !current.enabled ? current.max_days : "",
      };
      return next;
    });
  };

  // Sync mapping CRUD
  const addSyncMapping = (baseStageKey: string) => {
    setSyncMappings((prev) => [
      ...prev,
      { base_stage_key: baseStageKey, gestao_from_stage: "", gestao_to_stage: "" },
    ]);
  };

  const updateSyncMapping = (index: number, field: keyof SyncMapping, value: string) => {
    setSyncMappings((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const removeSyncMapping = (index: number) => {
    setSyncMappings((prev) => prev.filter((_, i) => i !== index));
  };

  // Validate overlaps
  const getOverlaps = (): string[] => {
    const errors: string[] = [];
    const enabledRules = rules.filter((r) => r.enabled);

    for (let i = 0; i < enabledRules.length; i++) {
      const a = enabledRules[i];
      const aMin = parseInt(a.min_days);
      const aMax = parseInt(a.max_days);

      if (isNaN(aMin) || isNaN(aMax)) continue;
      if (aMin > aMax) {
        errors.push(`"${a.name}": mínimo (${aMin}) maior que máximo (${aMax})`);
        continue;
      }

      for (let j = i + 1; j < enabledRules.length; j++) {
        const b = enabledRules[j];
        const bMin = parseInt(b.min_days);
        const bMax = parseInt(b.max_days);
        if (isNaN(bMin) || isNaN(bMax)) continue;

        if (aMin <= bMax && bMin <= aMax) {
          errors.push(`"${a.name}" (${aMin}-${aMax}) sobrepõe "${b.name}" (${bMin}-${bMax})`);
        }
      }
    }

    return errors;
  };

  // Check for gaps
  const getGaps = (): string[] => {
    const enabledRules = rules
      .filter((r) => r.enabled && r.min_days && r.max_days)
      .map((r) => ({ name: r.name, min: parseInt(r.min_days), max: parseInt(r.max_days) }))
      .filter((r) => !isNaN(r.min) && !isNaN(r.max))
      .sort((a, b) => a.min - b.min);

    const gaps: string[] = [];
    for (let i = 0; i < enabledRules.length - 1; i++) {
      const currentMax = enabledRules[i].max;
      const nextMin = enabledRules[i + 1].min;
      if (nextMin > currentMax + 1) {
        gaps.push(`Dias ${currentMax + 1} a ${nextMin - 1} sem regra`);
      }
    }
    return gaps;
  };

  const handleSave = async () => {
    const overlaps = getOverlaps();
    if (overlaps.length > 0) {
      toast.error("Corrigir sobreposicoes antes de salvar");
      return;
    }

    // Validate sync mappings (no empty dropdowns)
    const incompleteMappings = syncMappings.filter(
      (m) => !m.gestao_from_stage || !m.gestao_to_stage
    );
    if (incompleteMappings.length > 0) {
      toast.error("Preencha todos os campos das regras de sincronização");
      return;
    }

    setSaving(true);
    try {
      // Save auto-move rules
      for (const rule of rules) {
        const minDays = rule.enabled && rule.min_days ? parseInt(rule.min_days) : null;
        const maxDays = rule.enabled && rule.max_days ? parseInt(rule.max_days) : null;

        const stage = stages.find((s) => s.id === rule.id);
        if (!stage) continue;

        if (stage.auto_move_min_days !== minDays || stage.auto_move_max_days !== maxDays) {
          await updateStage.mutateAsync({
            id: rule.id,
            pipeline_type: stage.pipeline_type,
            auto_move_min_days: minDays as any,
            auto_move_max_days: maxDays as any,
          } as any);
        }
      }

      // Save sync mappings (only for upsell_base)
      if (isBase) {
        const validMappings = syncMappings.filter(
          (m) => m.gestao_from_stage && m.gestao_to_stage
        );
        await saveGestaoRules.mutateAsync(
          validMappings.map((m) => ({
            base_stage_key: m.base_stage_key,
            gestao_from_stage: m.gestao_from_stage,
            gestao_to_stage: m.gestao_to_stage,
          }))
        );
      }

      toast.success("Regras salvas com sucesso!");
    } catch {
      toast.error("Erro ao salvar regras");
    } finally {
      setSaving(false);
    }
  };

  const overlaps = getOverlaps();
  const gaps = getGaps();

  // Gestao stage options for dropdowns
  const gestaoOptions = gestaoStages.map((s: any) => ({
    key: s.stage_key || s.id,
    name: s.name,
    color: s.color,
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Clock className="h-4 w-4" />
        <span>Defina regras de movimentação automática baseadas nos dias desde a última venda</span>
      </div>

      <div className="space-y-3">
        {rules.map((rule, index) => {
          const ruleSyncMappings = syncMappings
            .map((m, i) => ({ ...m, _index: i }))
            .filter((m) => m.base_stage_key === rule.stage_key);

          return (
            <div
              key={rule.id}
              className="p-4 rounded-lg border border-border bg-card"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: rule.color || "#64748b" }} />
                  <span className="font-medium text-sm">{rule.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground">Auto-mover</Label>
                  <Switch
                    checked={rule.enabled}
                    onCheckedChange={() => toggleEnabled(index)}
                  />
                </div>
              </div>

              {rule.enabled && (
                <div className="space-y-3 ml-5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground whitespace-nowrap">De</span>
                    <Input
                      type="number"
                      min="0"
                      className="w-20 h-8 text-sm"
                      value={rule.min_days}
                      onChange={(e) => updateRule(index, "min_days", e.target.value)}
                      placeholder="0"
                    />
                    <span className="text-xs text-muted-foreground whitespace-nowrap">a</span>
                    <Input
                      type="number"
                      min="0"
                      className="w-20 h-8 text-sm"
                      value={rule.max_days}
                      onChange={(e) => updateRule(index, "max_days", e.target.value)}
                      placeholder="90"
                    />
                    <span className="text-xs text-muted-foreground whitespace-nowrap">dias desde última venda</span>
                  </div>

                  {/* Sync mappings section — only for upsell_base */}
                  {isBase && gestaoOptions.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-border/50">
                      <div className="flex items-center gap-1.5 mb-2">
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs font-medium text-muted-foreground">Sincronização com Gestão</span>
                      </div>

                      {ruleSyncMappings.length > 0 && (
                        <div className="space-y-2">
                          {ruleSyncMappings.map((mapping) => (
                            <div key={mapping._index} className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground whitespace-nowrap">Se Gestão =</span>
                              <Select
                                value={mapping.gestao_from_stage}
                                onValueChange={(v) => updateSyncMapping(mapping._index, "gestao_from_stage", v)}
                              >
                                <SelectTrigger className="w-[150px] h-8 text-xs">
                                  <SelectValue placeholder="Etapa atual" />
                                </SelectTrigger>
                                <SelectContent>
                                  {gestaoOptions.map((opt) => (
                                    <SelectItem key={opt.key} value={opt.key}>
                                      <div className="flex items-center gap-1.5">
                                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: opt.color || "#64748b" }} />
                                        {opt.name}
                                      </div>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>

                              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />

                              <Select
                                value={mapping.gestao_to_stage}
                                onValueChange={(v) => updateSyncMapping(mapping._index, "gestao_to_stage", v)}
                              >
                                <SelectTrigger className="w-[150px] h-8 text-xs">
                                  <SelectValue placeholder="Mover para" />
                                </SelectTrigger>
                                <SelectContent>
                                  {gestaoOptions.map((opt) => (
                                    <SelectItem key={opt.key} value={opt.key}>
                                      <div className="flex items-center gap-1.5">
                                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: opt.color || "#64748b" }} />
                                        {opt.name}
                                      </div>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>

                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                onClick={() => removeSyncMapping(mapping._index)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}

                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-1 h-7 text-xs text-muted-foreground"
                        onClick={() => addSyncMapping(rule.stage_key)}
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        Adicionar regra
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {!rule.enabled && (
                <p className="text-xs text-muted-foreground ml-5">Movimentação manual (drag-and-drop)</p>
              )}
            </div>
          );
        })}
      </div>

      {/* Warnings */}
      {overlaps.length > 0 && (
        <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 space-y-1">
          <div className="flex items-center gap-1.5 text-sm font-medium text-destructive">
            <AlertTriangle className="h-4 w-4" />
            Sobreposicoes detectadas
          </div>
          {overlaps.map((msg, i) => (
            <p key={i} className="text-xs text-destructive/80 ml-5.5">{msg}</p>
          ))}
        </div>
      )}

      {gaps.length > 0 && overlaps.length === 0 && (
        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 space-y-1">
          <div className="flex items-center gap-1.5 text-sm font-medium text-amber-600">
            <AlertTriangle className="h-4 w-4" />
            Gaps encontrados
          </div>
          {gaps.map((msg, i) => (
            <p key={i} className="text-xs text-amber-600/80 ml-5.5">{msg}</p>
          ))}
        </div>
      )}

      {overlaps.length === 0 && gaps.length === 0 && rules.some((r) => r.enabled) && (
        <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20">
          <div className="flex items-center gap-1.5 text-sm font-medium text-green-600">
            <Check className="h-4 w-4" />
            Regras validas — sem sobreposicoes ou gaps
          </div>
        </div>
      )}

      <div className="flex justify-end pt-2">
        <Button onClick={handleSave} disabled={saving || overlaps.length > 0}>
          {saving ? "Salvando..." : "Salvar Regras"}
        </Button>
      </div>
    </div>
  );
}
