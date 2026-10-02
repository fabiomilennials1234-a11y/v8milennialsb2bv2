/**
 * DisparoWizard — the Wizard Linear shell (#904, real wiring #910).
 *
 * Promotes the winning "Variant A" prototype (calm Stripe/Linear, one decision
 * per screen, top step rail, Voltar/Continuar) to production. The shell owns
 * navigation chrome only; each step is its own component and all gating logic
 * lives in the pure `wizard-machine`.
 *
 * This file is a thin LOADER that resolves the org's connected WhatsApp numbers
 * (#908) before mounting the inner wizard with them seeded; the inner shell
 * wires RELEASE → `useCreateBlastPlan` (#910) and hands the new plan id to the
 * monitor for the live feed.
 */
import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Loader2, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";
import { useWhatsAppInstances } from "@/modules/communication";
import { useCreateBlastPlan } from "@/modules/campaigns/hooks/useBlastPlans";
import { useDisparoWizard } from "./useDisparoWizard";
import { WizardProgress } from "./WizardProgress";
import { StepAudience } from "./StepAudience";
import { StepMessage } from "./StepMessage";
import { StepPostSend } from "./StepPostSend";
import { StepSpeed } from "./StepSpeed";
import { StepReview } from "./StepReview";
import { StepMonitor } from "./StepMonitor";
import { instancesToNumbers } from "@/shared/disparo/disparo-numbers";
import { DISPARO_STEPS, type DisparoNumber } from "./wizard-machine";
import { DisparoPreview } from "./DisparoPreview";
import { DisparosTabs } from "../DisparosTabs";

/** Today as a Sao Paulo calendar date (YYYY-MM-DD) — the plan's clock-free anchor. */
function todayInSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

interface DisparoWizardProps {
  onClose: () => void;
  onFinish: () => void;
}

/** Loader: resolve real numbers, then mount the inner wizard with them seeded. */
export function DisparoWizard({ onClose, onFinish }: DisparoWizardProps) {
  const { data: instances = [], isLoading } = useWhatsAppInstances();
  const numbers = useMemo(
    () => instancesToNumbers(instances, Date.now()),
    [instances],
  );

  if (isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <DisparoWizardInner numbers={numbers} onClose={onClose} onFinish={onFinish} />;
}

interface DisparoWizardInnerProps extends DisparoWizardProps {
  numbers: DisparoNumber[];
}

function DisparoWizardInner({ numbers, onClose, onFinish }: DisparoWizardInnerProps) {
  const wiz = useDisparoWizard(todayInSaoPaulo(), numbers);
  const createPlan = useCreateBlastPlan();
  const [planId, setPlanId] = useState<string | null>(null);

  // RELEASE — freeze the audience into a Blast Plan and fire lot 1 (#910). The
  // pure machine still flips `released`/advances to the monitor; the real plan
  // id is what powers the live feed there.
  const handleRelease = async () => {
    const draft = wiz.draft;
    const selected = draft.numbers.filter((n) => n.selected);
    if (selected.length === 0) {
      toast.error("Selecione ao menos um número.");
      return;
    }
    if (draft.leadIds.length === 0) {
      toast.error("Nenhum contato no público selecionado.");
      return;
    }

    // ADR-0015 #901: send EVERY selected number + its effective Number Daily Cap.
    // The backend distributes the audience round-robin across them via planBlast,
    // each number bounded by its own cap.
    const instanceIds = selected.map((n) => n.id);
    const caps: Record<string, number> = {};
    for (const n of selected) caps[n.id] = Math.max(0, Math.floor(n.cap));
    // Anti-ban widens the inter-send jitter; off keeps a tighter cadence.
    const [delayMin, delayMax] = draft.antiBan ? [5000, 30000] : [1000, 4000];
    const imageUrl =
      draft.media?.type === "image" && draft.media.url ? draft.media.url : undefined;

    // Post-send destination: each lead is moved when ITS message is sent (per
    // lot, over the plan's days). Validated fail-closed by blast-plan-create.
    // Shape canônico da Fatia B: {pipelineId, stageId, label} — o servidor
    // valida fail-closed e persiste id-first; os shapes legados seguem aceitos
    // na leitura pelos planos antigos.
    const postSendTarget =
      draft.postSendMode === "move" && draft.postSendStageId && draft.postSendPipelineId
        ? {
            pipelineId: draft.postSendPipelineId,
            stageId: draft.postSendStageId,
            label: draft.postSendLabel,
          }
        : undefined;

    try {
      const res = await createPlan.mutateAsync({
        instance_ids: instanceIds,
        caps,
        // Send window left to the server default (Mon–Sat 08–20) for now — the
        // wizard does not yet expose a window picker.
        lead_ids: draft.leadIds,
        // No Canal Oficial o conteúdo é o Template aprovado, e `message` carrega
        // o corpo dele — é o texto que a pessoa recebe, e é o que a Revisão e o
        // histórico mostram (#1722).
        message: draft.template
          ? draft.template.previewText
          : draft.message.trim(),
        template: draft.template ?? null,
        delay_min_ms: delayMin,
        delay_max_ms: delayMax,
        image_url: imageUrl,
        source: draft.audienceSource ?? undefined,
        post_send_target: postSendTarget,
      });
      setPlanId(res.plan_id);
      wiz.release();
    } catch (e) {
      toast.error((e as Error).message ?? "Falha ao iniciar o disparo.");
    }
  };

  const renderStep = () => {
    switch (wiz.stepId) {
      case "audience":
        return <StepAudience draft={wiz.draft} patch={wiz.patch} />;
      case "message":
        return <StepMessage draft={wiz.draft} patch={wiz.patch} />;
      case "postsend":
        return <StepPostSend draft={wiz.draft} patch={wiz.patch} />;
      case "speed":
        return <StepSpeed draft={wiz.draft} patch={wiz.patch} />;
      case "review":
        return (
          <StepReview
            draft={wiz.draft}
            onEdit={(id) => wiz.goTo(DISPARO_STEPS.findIndex((s) => s.id === id))}
          />
        );
      case "monitor":
        return <StepMonitor draft={wiz.draft} planId={planId} />;
    }
  };

  const nextLabel = DISPARO_STEPS[wiz.index + 1]?.label;
  const showPreview = !wiz.isMonitor;

  return (
    <div className="flex w-full flex-col gap-5">
      {/* Mesmo cabeçalho do Painel, com a aba "Novo disparo" ativa. O
          "Cancelar" some no acompanhamento — ali a saída é "Acompanhar
          disparos", no rodapé do passo. */}
      <PageHeader
        title="Disparos"
        subtitle="Acompanhe e controle os disparos em massa ao longo dos dias."
        tabs={<DisparosTabs active="novo" />}
        actions={
          !wiz.isMonitor ? (
            <Button type="button" variant="outline" onClick={onClose} disabled={createPlan.isPending}>
              <X className="h-4 w-4" />
              Cancelar
            </Button>
          ) : undefined
        }
      />

      <Card className="p-2.5 sm:p-3">
        <WizardProgress index={wiz.index} furthest={wiz.furthest} onJump={wiz.goTo} />
      </Card>

      <div className={cn("grid items-start gap-5", showPreview && "lg:grid-cols-[minmax(0,1fr)_360px]")}>
        {/* Passo atual — conteúdo + rodapé Voltar / Próximo no próprio cartão */}
        <Card className="min-w-0 px-5 py-6 sm:px-7 sm:py-7">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={wiz.stepId}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            >
              {renderStep()}
            </motion.div>
          </AnimatePresence>

          <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-5">
            {wiz.isMonitor ? (
              <Button onClick={onFinish} variant="ink" className="ml-auto gap-2">
                Acompanhar disparos
                <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <>
                <Button
                  variant="ghost"
                  onClick={wiz.isFirst ? onClose : wiz.back}
                  disabled={createPlan.isPending}
                  className="gap-2 text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeft className="h-4 w-4" />
                  {wiz.isFirst ? "Cancelar" : "Voltar"}
                </Button>

                <div className="flex min-w-0 flex-wrap items-center justify-end gap-3">
                  {wiz.blockReason && (
                    <span className="hidden text-xs text-muted-foreground sm:inline">{wiz.blockReason}</span>
                  )}
                  {wiz.isReview ? (
                    <Button size="lg" onClick={handleRelease} disabled={createPlan.isPending} className="gap-2">
                      {createPlan.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                      {createPlan.isPending ? "Iniciando…" : "Enviar disparo"}
                    </Button>
                  ) : (
                    <Button
                      variant="ink"
                      onClick={wiz.next}
                      disabled={!wiz.canAdvance}
                      className={cn("gap-2", !wiz.canAdvance && "opacity-60")}
                    >
                      {nextLabel ? `Próximo: ${nextLabel}` : "Continuar"}
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        </Card>

        {showPreview && (
          <aside className="min-w-0 lg:sticky lg:top-4">
            <DisparoPreview draft={wiz.draft} />
          </aside>
        )}
      </div>
    </div>
  );
}
