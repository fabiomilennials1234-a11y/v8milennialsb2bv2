/**
 * OnboardingChecklist — checklist progressivo de onboarding, estilo Vercel/Linear.
 *
 * Onda 3.2 — Sprint 3.2.3
 *
 * Estados:
 *   - Pill fechado: "{n}/6 passos" + chevron → expand ao clicar
 *   - Card expandido: 6 itens com check, label, link deep, progress bar, botão dismiss
 *   - Quando 6/6 ou dismissed_at → retorna null
 *
 * WCAG AA: focus ring, aria-expanded, aria-label, role="list".
 */

import { useState, useCallback } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  X,
  Wifi,
  Users,
  Bot,
  Workflow,
  UserPlus,
  Trophy,
  Database,
  Trash2,
  Loader2,
} from "lucide-react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  useOnboardingChecklist,
  useDismissOnboarding,
  type OnboardingProgress,
} from "@/modules/platform/hooks/onboarding/useOnboardingChecklist";
import { usePrimeOnboardingProgress } from "@/modules/platform/hooks/onboarding/usePrimeOnboardingProgress";
import { useHasDemoData, useSeedDemoData, useRemoveDemoData } from "@/modules/platform/hooks/onboarding/useDemoData";

// ─── Config dos steps ─────────────────────────────────────────────────────────

interface StepConfig {
  key: keyof Omit<OnboardingProgress, "organization_id" | "dismissed_at" | "created_at" | "updated_at">;
  label: string;
  icon: typeof Wifi;
  href: string;
  hint: string;
}

const STEPS: StepConfig[] = [
  {
    key: "step_connect_whatsapp",
    label: "Conectar WhatsApp",
    icon: Wifi,
    href: "/configuracoes?tab=whatsapp",
    hint: "Vincule sua instância WhatsApp para começar a conversar",
  },
  {
    key: "step_import_lead",
    label: "Importar primeiro lead",
    icon: Users,
    href: "/leads",
    hint: "Adicione ou importe pelo menos um lead ao sistema",
  },
  {
    key: "step_configure_copilot",
    label: "Configurar agente IA",
    icon: Bot,
    href: "/copilot",
    hint: "Crie um agente de IA para automatizar suas conversas",
  },
  {
    key: "step_create_workflow",
    label: "Criar automação",
    icon: Workflow,
    href: "/automacoes",
    hint: "Configure um fluxo de automação para seu processo de vendas",
  },
  {
    key: "step_add_member",
    label: "Adicionar membro ao time",
    icon: UserPlus,
    href: "/equipe",
    hint: "Convide um SDR ou Closer para colaborar com você",
  },
  {
    key: "step_first_sale",
    label: "Fechar primeira venda",
    icon: Trophy,
    href: "/funis",
    hint: "Mova um lead para 'Vendido' no pipe de propostas",
  },
];

// ─── StepItem ─────────────────────────────────────────────────────────────────

function StepItem({
  step,
  done,
}: {
  step: StepConfig;
  done: boolean;
}) {
  const Icon = step.icon;
  return (
    <li>
      <Link
        to={step.href}
        className={cn(
          "flex items-start gap-3 px-4 py-3 rounded-lg group",
          "transition-colors hover:bg-muted/50",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "focus-visible:outline-none",
        )}
        title={step.hint}
      >
        {/* Check icon */}
        <span
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border mt-0.5 transition-colors",
            done
              ? "bg-primary border-primary text-primary-foreground"
              : "border-border bg-background text-transparent",
          )}
          aria-hidden
        >
          <Check className="w-3 h-3" strokeWidth={3} />
        </span>

        {/* Label + hint */}
        <div className="flex-1 min-w-0">
          <p
            className={cn(
              "text-sm font-medium leading-none",
              done
                ? "text-muted-foreground line-through"
                : "text-foreground group-hover:text-primary transition-colors",
            )}
          >
            {step.label}
          </p>
          {!done && (
            <p className="mt-0.5 text-xs text-muted-foreground leading-snug">
              {step.hint}
            </p>
          )}
        </div>

        <Icon
          className={cn(
            "w-4 h-4 shrink-0 mt-0.5 transition-colors",
            done ? "text-muted-foreground/40" : "text-muted-foreground group-hover:text-primary",
          )}
          aria-hidden
        />
      </Link>
    </li>
  );
}

// ─── Card expandido ───────────────────────────────────────────────────────────

function DemoDataSection() {
  const { data: hasDemoData, isLoading: checkingDemo } = useHasDemoData();
  const seed = useSeedDemoData();
  const remove = useRemoveDemoData();

  return (
    <div className="px-4 pb-4">
      <Separator className="mb-3" />
      <p className="text-[11px] text-muted-foreground mb-2 font-medium uppercase tracking-wide">
        Testando o app?
      </p>

      {hasDemoData ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="w-full h-8 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
              disabled={remove.isPending}
            >
              {remove.isPending ? (
                <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
              ) : (
                <Trash2 className="w-3 h-3 mr-1.5" />
              )}
              Remover dados demo
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remover dados demo?</AlertDialogTitle>
              <AlertDialogDescription>
                Isso vai deletar os leads e o pipeline de demonstração.
                Dados reais ficam completamente intactos.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => remove.mutate()}
              >
                Remover
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="w-full h-8 text-xs"
          onClick={() => seed.mutate()}
          disabled={seed.isPending || checkingDemo}
        >
          {seed.isPending ? (
            <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
          ) : (
            <Database className="w-3 h-3 mr-1.5" />
          )}
          Popular com dados de exemplo
        </Button>
      )}
    </div>
  );
}

function OnboardingCard({
  progress,
  onDismiss,
  isDismissing,
}: {
  progress: OnboardingProgress;
  onDismiss: () => void;
  isDismissing: boolean;
}) {
  const completedCount = STEPS.filter((s) => progress[s.key]).length;
  const total = STEPS.length;
  const pct = Math.round((completedCount / total) * 100);

  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.97 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className={cn(
        "w-72 rounded-xl border border-border bg-card shadow-lg",
        "overflow-hidden",
      )}
      role="region"
      aria-label="Checklist de onboarding"
    >
      {/* Header */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-sm font-semibold text-foreground">
              Primeiros passos
            </p>
            <p className="text-xs text-muted-foreground">
              {completedCount}/{total} concluídos
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDismiss}
            disabled={isDismissing}
            className="h-7 w-7 p-0 rounded-full text-muted-foreground hover:text-foreground"
            aria-label="Dispensar checklist de onboarding"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
        <Progress value={pct} className="h-1.5" aria-label={`${pct}% concluído`} />
      </div>

      {/* Steps */}
      <ul role="list" className="pb-2">
        {STEPS.map((step) => (
          <StepItem
            key={step.key}
            step={step}
            done={progress[step.key]}
          />
        ))}
      </ul>

      {/* Demo data section */}
      <DemoDataSection />
    </motion.div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function OnboardingChecklist() {
  const { data: progress, isLoading } = useOnboardingChecklist();
  const dismiss = useDismissOnboarding();
  const [expanded, setExpanded] = useState(false);

  // Backfill client-side para orgs existentes (uma vez por sessão)
  usePrimeOnboardingProgress();

  const handleDismiss = useCallback(() => {
    dismiss.mutate();
    setExpanded(false);
  }, [dismiss]);

  // Não renderiza se: loading, sem dados, dismissed, ou 6/6 concluído
  if (isLoading || !progress) return null;
  if (progress.dismissed_at) return null;

  const completedCount = STEPS.filter((s) => progress[s.key]).length;
  if (completedCount === STEPS.length) return null;

  return (
    <div className="relative">
      {/* Pill trigger */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={`Onboarding: ${completedCount} de ${STEPS.length} passos concluídos`}
        className={cn(
          "flex items-center gap-1.5 h-8 px-3 rounded-full",
          "border border-border bg-card",
          "text-xs font-medium text-foreground",
          "shadow-sm hover:bg-muted/50 transition-colors",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "focus-visible:outline-none",
        )}
      >
        <span className="tabular-nums">
          {completedCount}/{STEPS.length}
        </span>
        <span className="text-muted-foreground">passos</span>
        {expanded ? (
          <ChevronUp className="w-3 h-3 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronDown className="w-3 h-3 text-muted-foreground" aria-hidden />
        )}
      </button>

      {/* Card dropdown */}
      <div className="absolute right-0 top-full mt-2 z-50">
        <AnimatePresence>
          {expanded && (
            <OnboardingCard
              progress={progress}
              onDismiss={handleDismiss}
              isDismissing={dismiss.isPending}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
