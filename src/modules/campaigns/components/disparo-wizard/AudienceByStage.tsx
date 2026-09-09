/**
 * AudienceByStage — the "Por etapa do funil" audience source (#902).
 *
 * Extracted from StepAudience when #906 added the second source ("Subir
 * planilha"). Pick a funnel + stage (optionally narrowed by conditions); the
 * selection resolves LIVE to a frozen lead-id set via `useAudienceResolve` and
 * writes count/ids/provenance back onto the draft. Mounted only while the chosen
 * source is "estagio", so its resolve effect never fights the spreadsheet source.
 *
 * Two independent axes, each with an "all" option:
 *   - Funil: one funnel  |  "Todos os funis" (deduplicated cross-funnel union)
 *   - Etapa: one stage   |  "Todas as etapas" (the whole funnel)
 * Picking "Todos os funis" forces the stage axis to "all" (the two funnel models
 * share no stage vocabulary) — enforced by `applySelection`, not by this view.
 * The stage Select is then LOCKED, and a locked control must still show its
 * value: an empty greyed-out trigger reads as a failure, not as a constraint.
 *
 * The conditions block is gated on the selection being RESOLVABLE, not on a
 * stage being chosen: dispatching by condition alone across every funnel is the
 * point of the cross-funnel option.
 *
 * The breadth warning is the HEADER of the live counter, not a second card:
 * two large cards compete and the eye anchors on neither. Fused, the number
 * cannot be read without crossing the warning. It warns, never blocks —
 * "Continuar" stays enabled (CTO decision).
 */
import { useEffect, useState } from "react";
import { AlertTriangle, Layers, Loader2, Lock, Users } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { AudienceConditionsControls } from "@/modules/pipelines";
import { useTags } from "@/modules/leads";
import { useAudienceResolve } from "@/modules/campaigns/hooks/useAudienceResolve";
import {
  ALL_FUNNELS_LABEL,
  ALL_STAGES_LABEL,
  applySelection,
  buildAudienceLabel,
  buildAudienceSource,
  conditionsActive,
  emptyConditions,
  isBroadestSelection,
  selectionReady,
  type AudienceSelection,
} from "./audience-resolve";
import {
  ALL_FUNNELS_VALUE,
  ALL_STAGES_VALUE,
  funnelSelectValue,
  parseStageSelectValue,
  stageSelectValue,
  useFunnelStageOptions,
} from "./use-funnel-stage-options";
import type { DisparoDraft } from "./wizard-machine";

interface AudienceByStageProps {
  draft: DisparoDraft;
  patch: (p: Partial<DisparoDraft>) => void;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function AudienceByStage({ draft, patch }: AudienceByStageProps) {
  const sel = draft.audience;

  const { funnels, stages, stagesLoading, funnelLabel } = useFunnelStageOptions(sel);
  const { data: tags = [] } = useTags();

  const stageName = stages.find((s) => s.key === sel.stageId)?.name ?? "";

  const resolved = useAudienceResolve(sel);
  const ready = selectionReady(sel);
  const allFunnels = sel.funnelScope === "all";
  const totalFunis = funnels.length;

  // Semeia o primeiro funil real da org quando nada foi escolhido ainda — o
  // core puro não conhece a org, então o default vem da tela (Fatia B).
  useEffect(() => {
    if (sel.funnelScope === "one" && !sel.pipelineId && funnels.length > 0) {
      patch({ audience: applySelection(sel, { pipelineId: funnels[0].id }) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel.funnelScope, sel.pipelineId, funnels]);

  // Derived here (not read back off the draft) so the visible title never lags a
  // render behind the selection that produced it.
  const audienceLabel = ready ? buildAudienceLabel(sel, funnelLabel, stageName) : "";

  // Last settled count — a spinner replacing the number is fine, a "0" flashing
  // where "12.480" was is a momentary lie on a screen that sends real messages.
  const [lastCount, setLastCount] = useState<number | null>(null);
  useEffect(() => {
    if (!resolved.isLoading && !resolved.isError) setLastCount(resolved.count);
  }, [resolved.isLoading, resolved.isError, resolved.count]);

  // Reflect the live resolution onto the draft so downstream steps read it. The
  // label/source travel with the resolved set; an unresolved selection clears it.
  useEffect(() => {
    patch({
      audienceLabel,
      audienceCount: resolved.count,
      leadIds: resolved.leadIds,
      audienceSource: ready ? buildAudienceSource(sel) : null,
    });
    // patch is stable (useCallback); re-run when the resolved set or labels change.
    // `sel.conditions` is a dep on purpose: react-query's structural sharing can
    // hand back the SAME leadIds array when a condition change happens not to
    // move the set, and the provenance descriptor must still record it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    resolved.leadIds,
    resolved.count,
    audienceLabel,
    ready,
    sel.funnelScope,
    sel.pipelineId,
    sel.stageScope,
    sel.stageId,
    sel.conditions,
  ]);

  const setSelection = (next: Partial<AudienceSelection>) =>
    patch({ audience: applySelection(sel, next) });

  const onFunnelChange = (value: string) => {
    if (value === ALL_FUNNELS_VALUE) {
      // applySelection re-establishes the invariant (stageScope "all", no
      // stageId/pipelineId); conditions are cleared like any funnel switch.
      setSelection({ funnelScope: "all", conditions: emptyConditions() });
      return;
    }
    setSelection({
      funnelScope: "one",
      pipelineId: value,
      stageId: "",
      stageScope: "one",
      conditions: emptyConditions(),
    });
  };

  const onStageChange = (value: string) => setSelection(parseStageSelectValue(value));

  // The widest reachable target with zero narrowing. `count > 0` is CONTENT, not
  // an optimization: "todo contato entra" printed over a 0 destroys the warning's
  // credibility. `!isLoading` keeps it from blinking on every select change.
  const broad =
    isBroadestSelection(sel) &&
    !resolved.isLoading &&
    !resolved.isError &&
    resolved.count > 0;

  const hasConditions = conditionsActive(sel.conditions);
  const showZeroCopy =
    ready && !resolved.isLoading && !resolved.isError && resolved.count === 0;

  const subtitle = resolved.isError
    ? "Não foi possível calcular o público. Tente de novo em alguns segundos."
    : showZeroCopy
      ? isBroadestSelection(sel)
        ? "Nenhum contato em funil ainda. Comece cadastrando leads nos funis."
        : hasConditions
          ? "Nenhum contato com essas condições. Tente afrouxar as Condições."
          : "Ninguém nesta etapa agora."
      : allFunnels
        ? // The dedup clause is load-bearing (ADR-0003): a lead in 3 funnels counts
          // once, and without saying so the number reads as "smaller than it should".
          "Contatos congelados neste disparo · quem está em vários funis conta uma vez"
        : "Contatos congelados neste disparo";

  return (
    <div className="space-y-7">
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Funnel — "Todos os funis" is a SCOPE, not one more funnel, so it sits
            above the separator and the funnels themselves live under a label. */}
        <div className="space-y-1.5">
          <Label className="text-sm">Funil</Label>
          <Select value={funnelSelectValue(sel)} onValueChange={onFunnelChange}>
            <SelectTrigger>
              <SelectValue placeholder="Escolha um funil" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FUNNELS_VALUE} className="font-medium">
                <span className="flex w-full items-center gap-2">
                  <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span>{ALL_FUNNELS_LABEL}</span>
                  <span className="ml-auto pl-3 text-[11px] tabular-nums text-muted-foreground">
                    {totalFunis} {plural(totalFunis, "funil", "funis")}
                  </span>
                </span>
              </SelectItem>
              <SelectSeparator />
              <SelectGroup>
                {/* pl-8 is required: SelectItem reserves `left-2 w-3.5` for the
                    check mark, so a label without it sits 24px to the left. */}
                <SelectLabel className="px-2 pl-8 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Funis
                </SelectLabel>
                {funnels.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        {/* Stage — locked (never blank) while the funnel axis spans everything. */}
        <div className="space-y-1.5">
          <Label className="text-sm">Etapa</Label>
          <Select
            value={stageSelectValue(sel)}
            onValueChange={onStageChange}
            disabled={allFunnels || stagesLoading}
          >
            <SelectTrigger
              className={cn(
                allFunnels &&
                  // The primitive's `disabled:opacity-50` is exactly what makes a
                  // locked control look broken — override it and state the reason
                  // in visible text instead.
                  "disabled:cursor-default disabled:border-border/50 disabled:bg-muted/40 disabled:text-muted-foreground disabled:opacity-100",
              )}
              aria-describedby={allFunnels ? "etapa-travada-hint" : undefined}
            >
              {allFunnels ? (
                <span className="flex items-center gap-2">
                  <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  {ALL_STAGES_LABEL}
                </span>
              ) : (
                <SelectValue
                  placeholder={
                    stagesLoading
                      ? "Carregando etapas…"
                      : stages.length === 0
                        ? "Sem etapas"
                        : "Escolha uma etapa"
                  }
                />
              )}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_STAGES_VALUE} className="font-medium">
                <span className="flex w-full items-center gap-2">
                  <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span>{ALL_STAGES_LABEL}</span>
                  <span className="ml-auto pl-3 text-[11px] tabular-nums text-muted-foreground">
                    {stages.length} {plural(stages.length, "etapa", "etapas")}
                  </span>
                </span>
              </SelectItem>
              {stages.length > 0 && (
                <>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel className="px-2 pl-8 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Etapas
                    </SelectLabel>
                    {stages.map((s) => (
                      <SelectItem key={s.key} value={`stage:${s.key}`}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </>
              )}
            </SelectContent>
          </Select>
          {/* Space reserved so the grid does not jump when the funnel changes.
              Visible text, not a tooltip: Radix drops a disabled trigger from the
              tab order, so a tooltip there is unreachable by keyboard and by SR. */}
          <div className="min-h-[1.25rem]">
            {allFunnels && (
              <p
                id="etapa-travada-hint"
                className="text-[11px] leading-snug text-muted-foreground"
              >
                Com todos os funis, não dá pra escolher etapa — cada funil tem as suas.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Conditions — narrow the chosen target by tag / qualification / origin.
          Gated on the target being resolvable, NOT on a stage being picked:
          "todos os funis + uma tag" is a first-class audience. */}
      <AudienceConditionsControls
        value={sel.conditions}
        onChange={(conditions) => setSelection({ conditions })}
        tags={tags.map((t) => ({ id: t.id, name: t.name, color: t.color }))}
        disabled={!ready}
      />

      {/* Live count — the load-bearing feedback of this step. The breadth warning
          is its header, sharing one border: one piece, one focus. */}
      <div
        className={cn(
          "overflow-hidden rounded-xl border bg-card transition-colors duration-200",
          broad ? "border-warning/45" : "border-border/70",
        )}
      >
        {broad && (
          <div
            role="status"
            aria-live="polite"
            className="flex items-start gap-2.5 border-b border-warning/25 bg-warning/[0.07] px-4 py-3 animate-in fade-in-0 slide-in-from-top-1 duration-200 motion-reduce:animate-none"
          >
            <AlertTriangle className="mt-px h-4 w-4 shrink-0 text-warning-strong" />
            <div className="min-w-0 space-y-0.5">
              <p className="text-[13px] font-medium leading-snug text-foreground">
                Sem recorte: todo contato que está em algum funil entra neste disparo.
              </p>
              <p className="text-xs leading-snug text-muted-foreground">
                São{" "}
                <span className="font-medium tabular-nums text-foreground">
                  {resolved.count.toLocaleString("pt-BR")}
                </span>{" "}
                {plural(resolved.count, "pessoa", "pessoas")}. Pra reduzir, use as
                Condições acima.
              </p>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            {/* Gold leaves the piece while the warning is up, so exactly one
                meaning wears amber on this screen. */}
            <div
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-lg transition-colors duration-200",
                broad ? "bg-warning/15 text-warning-strong" : "bg-primary/15 text-primary",
              )}
            >
              <Users className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {ready ? audienceLabel : "Escolha uma etapa"}
              </p>
              <p className="text-xs leading-snug text-muted-foreground">{subtitle}</p>
            </div>
          </div>

          <div className="shrink-0 text-right">
            {resolved.isError ? (
              <AlertTriangle className="h-5 w-5 text-destructive" />
            ) : resolved.isLoading ? (
              <div className="flex items-center justify-end gap-2">
                <span
                  className={cn(
                    "block text-xl font-semibold tabular-nums",
                    lastCount === null ? "text-muted-foreground" : "text-foreground opacity-40",
                  )}
                >
                  {lastCount === null ? "—" : lastCount.toLocaleString("pt-BR")}
                </span>
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <span
                  className={cn(
                    "block text-xl font-semibold tabular-nums",
                    resolved.count === 0 ? "text-muted-foreground" : "text-foreground",
                  )}
                >
                  {resolved.count.toLocaleString("pt-BR")}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {plural(resolved.count, "contato", "contatos")}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
