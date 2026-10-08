import { isPipelineVisible } from "@/modules/pipelines";
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
import { AlertTriangle, KanbanSquare, Layers, Loader2, Lock, Users } from "lucide-react";
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

  const stageValue = stageSelectValue(sel);
  const funnelValue = funnelSelectValue(sel);

  return (
    <div className="space-y-6">
      {/* Funil — "Todos os funis" é um ESCOPO, não mais um funil: vem primeiro,
          separado dos funis da org. */}
      <div className="space-y-2">
        <p id="funil-label" className="text-[11px] font-bold uppercase tracking-[.08em] text-muted-foreground">
          Funil
        </p>
        <div role="radiogroup" aria-labelledby="funil-label" className="flex flex-wrap gap-2">
          <FunnelChip
            active={funnelValue === ALL_FUNNELS_VALUE}
            onSelect={() => onFunnelChange(ALL_FUNNELS_VALUE)}
            icon={Layers}
          >
            {ALL_FUNNELS_LABEL}
            <span className="text-[11px] font-semibold tabular-nums opacity-60">
              {totalFunis} {plural(totalFunis, "funil", "funis")}
            </span>
          </FunnelChip>
          {funnels.map((p) => (
            <FunnelChip
              key={p.id}
              active={funnelValue === p.id}
              disabled={!isPipelineVisible(p)}
              onSelect={() => onFunnelChange(p.id)}
              icon={KanbanSquare}
            >
              {p.label}
            </FunnelChip>
          ))}
        </div>
      </div>

      {/* Etapa — travada (nunca em branco) enquanto o funil cobre tudo. */}
      <div className="space-y-2">
        <p id="etapa-label" className="text-[11px] font-bold uppercase tracking-[.08em] text-muted-foreground">
          Etapa
        </p>
        {allFunnels ? (
          // Texto visível, não tooltip: o motivo da trava precisa ser lido.
          <div
            id="etapa-travada-hint"
            className="flex items-center gap-2.5 rounded-2xl border border-border/60 bg-muted/40 px-4 py-3 text-[13px] text-muted-foreground"
          >
            <Lock className="h-3.5 w-3.5 shrink-0" />
            <span>
              <span className="font-semibold text-foreground">{ALL_STAGES_LABEL}</span> — com todos os funis, não dá
              pra escolher etapa: cada funil tem as suas.
            </span>
          </div>
        ) : stagesLoading ? (
          <div className="flex items-center gap-2 rounded-2xl border border-border/60 px-4 py-3 text-[13px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Carregando etapas…
          </div>
        ) : (
          <div
            role="radiogroup"
            aria-labelledby="etapa-label"
            className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/70 bg-card"
          >
            <StageOption
              active={stageValue === ALL_STAGES_VALUE}
              onSelect={() => onStageChange(ALL_STAGES_VALUE)}
              label={ALL_STAGES_LABEL}
              meta={`${stages.length} ${plural(stages.length, "etapa", "etapas")}`}
              strong
            />
            {stages.map((s) => (
              <StageOption
                key={s.key}
                active={stageValue === `stage:${s.key}`}
                onSelect={() => onStageChange(`stage:${s.key}`)}
                label={s.name}
              />
            ))}
            {stages.length === 0 && (
              <p className="px-4 py-3 text-[13px] text-muted-foreground">Este funil ainda não tem etapas.</p>
            )}
          </div>
        )}
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

      {/* Público do disparo — o retorno que sustenta este passo. O aviso de
          amplitude é o CABEÇALHO do número: uma peça, um foco. */}
      <div
        className={cn(
          "overflow-hidden rounded-[18px] border transition-colors duration-200",
          broad ? "border-warning/45 bg-card" : "border-transparent bg-muted/50",
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

        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 px-5 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[.08em] text-muted-foreground">Público do disparo</p>
            <div className="mt-1 flex items-baseline gap-1.5">
              {resolved.isError ? (
                <AlertTriangle className="h-6 w-6 text-destructive" />
              ) : resolved.isLoading ? (
                <>
                  <span
                    className={cn(
                      "text-[2.2rem] font-extrabold leading-none tracking-[-0.045em] tabular-nums",
                      lastCount === null ? "text-muted-foreground" : "text-foreground opacity-40",
                    )}
                  >
                    {lastCount === null ? "—" : lastCount.toLocaleString("pt-BR")}
                  </span>
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </>
              ) : (
                <>
                  <span
                    className={cn(
                      "text-[2.2rem] font-extrabold leading-none tracking-[-0.045em] tabular-nums",
                      resolved.count === 0 ? "text-muted-foreground" : "text-foreground",
                    )}
                  >
                    {resolved.count.toLocaleString("pt-BR")}
                  </span>
                  <span className="text-sm font-semibold text-muted-foreground">
                    {plural(resolved.count, "contato", "contatos")}
                  </span>
                </>
              )}
            </div>
          </div>
          <div className="min-w-0 max-w-[340px] text-right max-sm:text-left">
            <p className="flex items-center justify-end gap-1.5 text-[13px] font-semibold text-foreground max-sm:justify-start">
              <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{ready ? audienceLabel : "Escolha uma etapa"}</span>
            </p>
            <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{subtitle}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function FunnelChip({
  active,
  disabled,
  onSelect,
  icon: Icon,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onSelect: () => void;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-[13px] font-semibold transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40",
        active
          ? "border-tinta bg-tinta text-tinta-foreground shadow-relevo-tinta"
          : "border-input bg-card text-foreground/80 hover:border-foreground/20 hover:text-foreground",
      )}
    >
      <Icon className={cn("h-3.5 w-3.5 shrink-0", active ? "text-primary" : "text-muted-foreground")} aria-hidden />
      {children}
    </button>
  );
}

function StageOption({
  active,
  onSelect,
  label,
  meta,
  strong,
}: {
  active: boolean;
  onSelect: () => void;
  label: string;
  meta?: string;
  strong?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-3 px-4 py-3 text-left text-[13.5px] transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        active ? "bg-primary-soft/60" : "hover:bg-muted/40",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border-2",
          active ? "border-primary-soft-foreground" : "border-border",
        )}
      >
        {active && <span className="h-2 w-2 rounded-full bg-primary-soft-foreground" />}
      </span>
      <span className={cn("min-w-0 flex-1 truncate", strong || active ? "font-semibold text-foreground" : "text-foreground/85")}>
        {label}
      </span>
      {meta && <span className="shrink-0 text-[11px] font-semibold tabular-nums text-muted-foreground">{meta}</span>}
    </button>
  );
}
