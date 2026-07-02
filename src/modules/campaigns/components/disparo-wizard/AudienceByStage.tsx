/**
 * AudienceByStage — the "Por etapa do funil" audience source (#902).
 *
 * Extracted from StepAudience when #906 added the second source ("Subir
 * planilha"). Pick a funnel + stage (optionally narrowed by conditions); the
 * selection resolves LIVE to a frozen lead-id set via `useAudienceResolve` and
 * writes count/ids/provenance back onto the draft. Mounted only while the chosen
 * source is "estagio", so its resolve effect never fights the spreadsheet source.
 */
import { useEffect } from "react";
import { Loader2, Users, AlertTriangle } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  AudienceConditionsControls,
  type SystemPipelineType,
} from "@/modules/pipelines";
import { useTags } from "@/modules/leads";
import { useAudienceResolve } from "@/modules/campaigns/hooks/useAudienceResolve";
import {
  SYSTEM_FUNNELS,
  emptyConditions,
  buildAudienceSource,
  type AudienceSelection,
} from "./audience-resolve";
import { useFunnelStageOptions, funnelSelectValue } from "./use-funnel-stage-options";
import type { DisparoDraft } from "./wizard-machine";

interface AudienceByStageProps {
  draft: DisparoDraft;
  patch: (p: Partial<DisparoDraft>) => void;
}

export function AudienceByStage({ draft, patch }: AudienceByStageProps) {
  const sel = draft.audience;

  const { customPipelines, stages, stagesLoading, funnelLabel } = useFunnelStageOptions(sel);
  const { data: tags = [] } = useTags();

  const stageName = stages.find((s) => s.key === sel.stageKey)?.name ?? "";

  const resolved = useAudienceResolve(sel);

  // Reflect the live resolution onto the draft so downstream steps read it. The
  // label/source travel with the resolved set; an unresolved selection clears it.
  useEffect(() => {
    const label = stageName ? `${funnelLabel} · ${stageName}` : funnelLabel;
    patch({
      audienceLabel: sel.stageKey ? label : "",
      audienceCount: resolved.count,
      leadIds: resolved.leadIds,
      audienceSource: sel.stageKey ? buildAudienceSource(sel) : null,
    });
    // patch is stable (useCallback); re-run when the resolved set or labels change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved.leadIds, resolved.count, funnelLabel, stageName, sel.stageKey]);

  const setSelection = (next: Partial<AudienceSelection>) =>
    patch({ audience: { ...sel, ...next } });

  const onFunnelChange = (value: string) => {
    const [kind, id] = value.split(":");
    if (kind === "system") {
      setSelection({
        funnelKind: "system",
        pipelineType: id as SystemPipelineType,
        pipelineId: null,
        stageKey: "",
        conditions: emptyConditions(),
      });
    } else {
      setSelection({
        funnelKind: "custom",
        pipelineId: id,
        stageKey: "",
        conditions: emptyConditions(),
      });
    }
  };

  return (
    <div className="space-y-7">
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Funnel */}
        <div className="space-y-1.5">
          <Label className="text-sm">Funil</Label>
          <Select value={funnelSelectValue(sel)} onValueChange={onFunnelChange}>
            <SelectTrigger>
              <SelectValue placeholder="Escolha um funil" />
            </SelectTrigger>
            <SelectContent>
              {SYSTEM_FUNNELS.map((f) => (
                <SelectItem key={f.value} value={`system:${f.value}`}>
                  {f.label}
                </SelectItem>
              ))}
              {customPipelines.map((p) => (
                <SelectItem key={p.id} value={`custom:${p.id}`}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Stage */}
        <div className="space-y-1.5">
          <Label className="text-sm">Etapa</Label>
          <Select
            value={sel.stageKey}
            onValueChange={(v) => setSelection({ stageKey: v })}
            disabled={stagesLoading || stages.length === 0}
          >
            <SelectTrigger>
              <SelectValue
                placeholder={
                  stagesLoading
                    ? "Carregando etapas…"
                    : stages.length === 0
                      ? "Sem etapas"
                      : "Escolha uma etapa"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {stages.map((s) => (
                <SelectItem key={s.key} value={s.key}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Conditions — narrow the chosen stage by tag / qualification / origin */}
      <AudienceConditionsControls
        value={sel.conditions}
        onChange={(conditions) => setSelection({ conditions })}
        tags={tags.map((t) => ({ id: t.id, name: t.name, color: t.color }))}
        disabled={!sel.stageKey}
      />

      {/* Live count — the load-bearing feedback of this step */}
      <div className="flex items-center justify-between rounded-xl border border-border/70 bg-card p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Users className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              {sel.stageKey ? draft.audienceLabel : "Escolha um funil e uma etapa"}
            </p>
            <p className="text-xs text-muted-foreground">
              {resolved.isError
                ? "Não foi possível calcular o público"
                : "Contatos congelados neste disparo"}
            </p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          {resolved.isError ? (
            <AlertTriangle className="h-5 w-5 text-destructive" />
          ) : resolved.isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : (
            <>
              <span className="block text-xl font-semibold tabular-nums text-foreground">
                {resolved.count.toLocaleString("pt-BR")}
              </span>
              <span className="text-[11px] text-muted-foreground">contatos</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
