/**
 * StepPostSend — "Destino" (post-send lead move).
 *
 * Optional step between Mensagem and Velocidade: keep contacts where they are
 * (default) or move each one to a chosen funnel stage AT THE MOMENT its message
 * is sent. Blast Plans drain over days, so the move is per-lot/per-lead — never
 * all at once. The destination is validated fail-closed by blast-plan-create;
 * here we only capture funnel + stage and the human label shown downstream
 * (Review / Monitor).
 *
 * Fatia B (Funil é Funil): o seletor lista os funis REAIS da org — sistema e
 * custom juntos, num Select só, por `pipelines.id`. Etapa por
 * `pipeline_stages.id` (uuid canônico de qualquer funil).
 */
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, MapPin, MoveRight } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useFunnelStageOptions } from "./use-funnel-stage-options";
import { StepHeader } from "./StepHeader";
import type { DisparoDraft } from "./wizard-machine";
import { kickerDoPasso } from "./wizard-machine";

interface StepPostSendProps {
  draft: DisparoDraft;
  patch: (p: Partial<DisparoDraft>) => void;
}

function ChoiceCard({
  active,
  icon: Icon,
  title,
  description,
  onSelect,
}: {
  active: boolean;
  icon: React.ElementType;
  title: string;
  description: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-4 rounded-xl border p-4 text-left transition-all duration-200",
        active
          ? "border-primary/60 bg-primary/[0.06] shadow-[0_0_0_1px_hsl(var(--primary)/0.3)]"
          : "border-border/70 bg-card hover:border-border hover:bg-muted/30",
      )}
    >
      <div
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors",
          active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <div
        className={cn(
          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-all",
          active ? "border-primary" : "border-border",
        )}
      >
        {active && <div className="h-2.5 w-2.5 rounded-full bg-primary" />}
      </div>
    </button>
  );
}

export function StepPostSend({ draft, patch }: StepPostSendProps) {
  const reduced = useReducedMotion();
  const isMove = draft.postSendMode === "move";

  const { funnels, stages, stagesLoading, funnelLabel, hasFunnel } =
    useFunnelStageOptions({
      funnelScope: "one",
      pipelineId: draft.postSendPipelineId,
    });

  const hasDestination = isMove && hasFunnel && draft.postSendStageId !== "";

  // Craft: warn (without blocking) when the destination equals the audience's
  // own source funnel+stage — the contacts would not actually change stage.
  const audience = draft.audience;
  const sameAsOrigin =
    hasDestination &&
    draft.audienceSourceType === "estagio" &&
    audience.funnelScope === "one" &&
    audience.pipelineId === draft.postSendPipelineId &&
    audience.stageId === draft.postSendStageId;

  const keepHere = () =>
    patch({
      postSendMode: "none",
      postSendPipelineId: null,
      postSendStageId: "",
      postSendLabel: "",
    });

  const onFunnelChange = (pipelineId: string) => {
    patch({
      postSendPipelineId: pipelineId,
      postSendStageId: "",
      postSendLabel: "",
    });
  };

  const onStageChange = (stageId: string) => {
    const stageName = stages.find((s) => s.key === stageId)?.name ?? "";
    patch({
      postSendStageId: stageId,
      postSendLabel: stageName ? `${funnelLabel} · ${stageName}` : funnelLabel,
    });
  };

  return (
    <div className="space-y-7">
      <StepHeader
        kicker={kickerDoPasso("postsend")}
        title="E depois do envio?"
        subtitle="Se quiser, mova cada contato pra uma etapa do funil assim que a mensagem dele for enviada. O disparo pode levar dias — o contato só muda de etapa na vez dele."
      />

      <div role="radiogroup" aria-label="Depois do envio" className="space-y-2.5">
        <ChoiceCard
          active={!isMove}
          icon={MapPin}
          title="Manter onde estão"
          description="Os contatos continuam nas etapas em que já estão. Nada muda."
          onSelect={keepHere}
        />
        <ChoiceCard
          active={isMove}
          icon={MoveRight}
          title="Mover para uma etapa"
          description="Cada contato vai pra etapa escolhida quando a mensagem dele for enviada — não tudo de uma vez."
          onSelect={() => patch({ postSendMode: "move" })}
        />
      </div>

      {/* Destination picker — sibling of the cards, never nested in a button. */}
      <AnimatePresence initial={false}>
        {isMove && (
          <motion.div
            key="postsend-picker"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="ml-0 space-y-4 pt-1 sm:ml-[52px]">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-sm">Funil de destino</Label>
                  <Select
                    value={draft.postSendPipelineId ?? ""}
                    onValueChange={onFunnelChange}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Escolha um funil" />
                    </SelectTrigger>
                    <SelectContent>
                      {funnels.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-sm">Etapa de destino</Label>
                  <Select
                    value={draft.postSendStageId}
                    onValueChange={onStageChange}
                    disabled={stagesLoading || stages.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={
                          stagesLoading
                            ? "Carregando etapas…"
                            : hasFunnel && stages.length === 0
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

              {hasFunnel && !stagesLoading && stages.length === 0 && (
                <p className="text-[11px] text-muted-foreground/70">
                  Este funil ainda não tem etapas. Crie etapas nele ou escolha outro funil.
                </p>
              )}

              {/* Confirmation — what will happen, in one calm line. */}
              <div aria-live="polite">
                <AnimatePresence initial={false}>
                  {hasDestination && (
                    <motion.div
                      key="postsend-confirm"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: reduced ? 0 : 0.2 }}
                      className="flex items-center gap-3 rounded-xl border border-border/70 bg-card p-4"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                        <MoveRight className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">{draft.postSendLabel}</p>
                        {sameAsOrigin ? (
                          <p className="flex items-center gap-1.5 text-xs text-amber-500">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                            Este é o mesmo lugar de onde o público saiu — os contatos não vão mudar de etapa.
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            Cada contato é movido pra cá no momento em que a mensagem dele for enviada.
                          </p>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
