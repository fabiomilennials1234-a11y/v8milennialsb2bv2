/**
 * OnboardingHub — página dedicada de onboarding (rota /onboarding).
 *
 * Surface full-page do mesmo estado do pill (OnboardingChecklist): lê
 * `org_onboarding_progress` via useOnboardingChecklist e compartilha o config
 * ONBOARDING_STEPS. Estilo getting-started (Stripe / Linear), dark-first.
 *
 * Passos com trigger server-side marcam sozinhos; os demais podem ser marcados
 * manualmente ("Já fiz isso") via useCompleteOnboardingStep — é o caminho de
 * auto-configuração do CTO/admin.
 *
 * Visível só para admin + master (gate na page wrapper).
 */

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Check, ArrowRight, Rocket, PartyPopper, Loader2, Youtube } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import {
  useOnboardingChecklist,
  useCompleteOnboardingStep,
  type OnboardingProgress,
  type OnboardingStepKey,
} from "@/modules/platform/hooks/onboarding/useOnboardingChecklist";
import { usePrimeOnboardingProgress } from "@/modules/platform/hooks/onboarding/usePrimeOnboardingProgress";
import {
  ONBOARDING_STEPS,
  ONBOARDING_SECTIONS,
  type OnboardingStepConfig,
} from "@/modules/platform/lib/onboarding-steps";

// ─── Tutorial (YouTube) link ──────────────────────────────────────────────────

function TutorialLink({ url, label }: { url: string; label: string }) {
  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-red-500 transition-colors hover:bg-red-500/10 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title={`Ver tutorial: ${label}`}
        aria-label={`Ver tutorial em vídeo: ${label}`}
      >
        <Youtube className="h-5 w-5" />
      </a>
    );
  }
  return (
    <span
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground/30"
      title="Sem tutorial ainda"
      aria-hidden
    >
      <Youtube className="h-5 w-5" />
    </span>
  );
}

// ─── Task card ──────────────────────────────────────────────────────────────

function TaskCard({
  step,
  index,
  done,
  onComplete,
  isCompleting,
}: {
  step: OnboardingStepConfig;
  index: number;
  done: boolean;
  onComplete: () => void;
  isCompleting: boolean;
}) {
  const Icon = step.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: index * 0.04, ease: "easeOut" }}
      className={cn(
        "group flex items-center gap-4 rounded-xl border p-4 transition-colors",
        done
          ? "border-border/50 bg-card/40"
          : "border-border bg-card hover:border-primary/40",
      )}
    >
      {/* Status / icon tile */}
      <div
        className={cn(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border transition-colors",
          done
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border bg-background text-muted-foreground group-hover:text-primary group-hover:border-primary/40",
        )}
        aria-hidden
      >
        {done ? (
          <Check className="h-5 w-5" strokeWidth={3} />
        ) : (
          <Icon className="h-5 w-5" />
        )}
      </div>

      {/* Text */}
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-sm font-semibold leading-none",
            done ? "text-muted-foreground line-through" : "text-foreground",
          )}
        >
          {step.label}
        </p>
        <p className="mt-1 text-xs leading-snug text-muted-foreground">
          {step.hint}
        </p>
      </div>

      {/* Right cluster: tutorial + actions */}
      <div className="flex shrink-0 items-center gap-2">
        <TutorialLink url={step.tutorialUrl} label={step.label} />

        {done ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
            <Check className="h-3.5 w-3.5" strokeWidth={3} />
            Concluído
          </span>
        ) : (
          <div className="flex items-center gap-3">
            <Button asChild size="sm" className="h-8 gap-1.5">
              <Link to={step.href}>
                Configurar
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
            <label
              className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              title="Marcar este passo como concluído manualmente"
            >
              {isCompleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Checkbox
                  checked={false}
                  onCheckedChange={() => onComplete()}
                  aria-label={`Marcar "${step.label}" como concluído`}
                />
              )}
              <span>Já fiz</span>
            </label>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── Page view ────────────────────────────────────────────────────────────────

/**
 * View pura — sem hooks de dados. Recebe progress + handlers por prop.
 * Permite preview/teste isolado (ver pages/OnboardingHubPreview, dev-only).
 */
export function OnboardingHubView({
  progress,
  onComplete,
  completingKey,
}: {
  progress: OnboardingProgress | null | undefined;
  onComplete: (key: OnboardingStepKey) => void;
  completingKey?: OnboardingStepKey | null;
}) {
  const { done, total, pct, allDone } = useMemo(() => {
    const total = ONBOARDING_STEPS.length;
    const completed = progress
      ? ONBOARDING_STEPS.filter((s) => progress[s.key]).length
      : 0;
    return {
      done: completed,
      total,
      pct: Math.round((completed / total) * 100),
      allDone: completed === total,
    };
  }, [progress]);

  return (
    <div className="mx-auto w-full max-w-2xl">
      {/* Header */}
      <header className="mb-8">
        <div className="mb-3 inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-primary">
          <Rocket className="h-3.5 w-3.5" />
          Primeiros passos
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          Configure seu Torque
        </h1>
        <p className="mt-2 max-w-prose text-sm text-muted-foreground">
          Complete os passos abaixo para deixar seu CRM pronto para vender.
          Cada passo leva você direto à tela certa.
        </p>

        {/* Progress */}
        <div className="mt-6">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-sm font-medium text-foreground">
              <span className="tabular-nums">{done}</span> de{" "}
              <span className="tabular-nums">{total}</span> concluídos
            </span>
            <span className="text-sm font-semibold tabular-nums text-primary">
              {pct}%
            </span>
          </div>
          <Progress value={pct} className="h-2" aria-label={`${pct}% concluído`} />
        </div>
      </header>

      {/* All-done banner */}
      {allDone && (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="mb-6 flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <PartyPopper className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">
              Tudo pronto! Seu Torque está configurado.
            </p>
            <p className="text-xs text-muted-foreground">
              Você concluiu todos os passos. Agora é só vender.
            </p>
          </div>
        </motion.div>
      )}

      {/* Task list — agrupado por seção */}
      <div className="space-y-8">
        {ONBOARDING_SECTIONS.map((section) => {
          const steps = ONBOARDING_STEPS.filter((s) => s.section === section.key);
          if (steps.length === 0) return null;
          const sectionDone = steps.filter((s) => progress?.[s.key]).length;

          return (
            <section key={section.key}>
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-foreground">
                    {section.label}
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {section.description}
                  </p>
                </div>
                <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
                  {sectionDone}/{steps.length}
                </span>
              </div>

              <div className="space-y-3">
                {steps.map((step, i) => (
                  <TaskCard
                    key={step.key}
                    step={step}
                    index={i}
                    done={!!progress?.[step.key]}
                    onComplete={() => onComplete(step.key)}
                    isCompleting={completingKey === step.key}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ─── Connected ─────────────────────────────────────────────────────────────

export function OnboardingHub() {
  const { data: progress, isLoading } = useOnboardingChecklist();
  const complete = useCompleteOnboardingStep();

  // Backfill client-side para orgs existentes (idempotente, 1×/sessão).
  usePrimeOnboardingProgress();

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <OnboardingHubView
      progress={progress}
      onComplete={(key) => complete.mutate(key)}
      completingKey={complete.isPending ? complete.variables : null}
    />
  );
}
