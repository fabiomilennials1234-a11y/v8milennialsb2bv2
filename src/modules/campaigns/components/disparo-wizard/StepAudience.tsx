/**
 * StepAudience — "Pra quem" (#902, real wiring).
 *
 * One decision, three controls: pick a funnel (a system pipe or a custom
 * pipeline), pick a stage inside it, and optionally narrow with conditions
 * (tags / qualification / origin). The selection resolves LIVE to a frozen set
 * of lead ids via `useAudienceResolve` (the org-scoped get_*_lead_ids RPCs); the
 * resolved count + ids + provenance are written back onto the draft so the rest
 * of the wizard (Velocidade pace, Review, dispatch) reads real numbers.
 *
 * The audience is frozen at creation (ADR-0003): whoever matches now receives
 * the blast; later entrants do not.
 */
import { useEffect, useMemo } from "react";
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
  useCustomPipelines,
  useCustomPipelineStages,
  usePipelineStages,
  type SystemPipelineType,
} from "@/modules/pipelines";
import { useTags } from "@/modules/leads";
import { useAudienceResolve } from "@/modules/campaigns/hooks/useAudienceResolve";
import { StepHeader } from "./StepHeader";
import {
  SYSTEM_FUNNELS,
  emptyConditions,
  buildAudienceSource,
  type AudienceSelection,
} from "./audience-resolve";
import type { DisparoDraft } from "./wizard-machine";

interface StepAudienceProps {
  draft: DisparoDraft;
  patch: (p: Partial<DisparoDraft>) => void;
}

/** Funnel picker value encoding — keeps system pipes and custom ids in one Select. */
function funnelValue(sel: AudienceSelection): string {
  return sel.funnelKind === "system" ? `system:${sel.pipelineType}` : `custom:${sel.pipelineId ?? ""}`;
}

export function StepAudience({ draft, patch }: StepAudienceProps) {
  const sel = draft.audience;
  const isSystem = sel.funnelKind === "system";

  const { data: customPipelines = [] } = useCustomPipelines();
  const { data: systemStages = [], isLoading: systemStagesLoading } = usePipelineStages(
    isSystem ? sel.pipelineType : ("whatsapp" as SystemPipelineType),
  );
  const { data: customStages = [], isLoading: customStagesLoading } = useCustomPipelineStages(
    !isSystem ? (sel.pipelineId ?? undefined) : undefined,
  );
  const { data: tags = [] } = useTags();

  // Unified stage list for the picker: system → stage_key slug; custom → stage_id uuid.
  const stages = useMemo<{ key: string; name: string }[]>(() => {
    if (isSystem) return systemStages.map((s) => ({ key: s.stage_key, name: s.name }));
    return customStages.map((s) => ({ key: s.id, name: s.name }));
  }, [isSystem, systemStages, customStages]);
  const stagesLoading = isSystem ? systemStagesLoading : customStagesLoading;

  const funnelLabel = isSystem
    ? SYSTEM_FUNNELS.find((f) => f.value === sel.pipelineType)?.label ?? "Funil"
    : customPipelines.find((p) => p.id === sel.pipelineId)?.name ?? "Funil";
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
      <StepHeader
        kicker="Passo 1 de 5"
        title="Pra quem você vai enviar?"
        subtitle="Escolha um funil e uma etapa. O grupo é congelado agora — quem entrar depois não recebe este disparo."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Funnel */}
        <div className="space-y-1.5">
          <Label className="text-sm">Funil</Label>
          <Select value={funnelValue(sel)} onValueChange={onFunnelChange}>
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
