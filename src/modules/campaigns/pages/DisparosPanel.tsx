/**
 * /disparos — the canonical Disparos home (#904).
 *
 * The single front door to mass-sending, open to any member. Two faces:
 *
 *   - First time (zero blasts): a guided 3-step recipe (Escolha pra quem →
 *     Escreva → Revise e envie) + a single prominent "Novo disparo" CTA.
 *   - Recurring (≥1 blast): the operational history — live plans grouped by
 *     lifecycle (Ativos / Pausados / Concluídos) + "Novo disparo" in the header.
 *
 * Creation runs through the Wizard Linear at /disparos/novo. Each plan card owns
 * its own progress query (BlastPlanCard). `useBlastPlans` is the real source.
 *
 * Drill-down (#944): clicking a plan card opens BlastPlanRecipientsSheet (the
 * frozen audience — Enviados / Pulados / Aguardando); clicking a lead there
 * closes the sheet and opens the LeadDetailSheet (same mechanics as TabSaude).
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  useBlastPlans,
  type BlastPlan,
  type BlastPlanStatus,
} from "@/modules/campaigns/hooks/useBlastPlans";
import { useOrganization } from "@/modules/identity";
import { LeadPanelProvider, LeadDetailSheet, useLeadSheet } from "@/modules/leads";
import { trackModuleVisit } from "@/lib/analytics";
import { BlastPlanCard } from "@/modules/campaigns/components/BlastPlanCard";
import { BlastPlanRecipientsSheet } from "@/modules/campaigns/components/BlastPlanRecipientsSheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Send,
  Loader2,
  AlertTriangle,
  Plus,
  Users,
  MessageSquare,
  CheckCircle2,
} from "lucide-react";

// Concluídos groups both terminal states — operator reads them the same way.
const GROUPS: { key: string; title: string; match: (s: BlastPlanStatus) => boolean }[] = [
  { key: "active", title: "Ativos", match: (s) => s === "active" },
  { key: "paused", title: "Pausados", match: (s) => s === "paused" },
  { key: "done", title: "Concluídos", match: (s) => s === "completed" || s === "cancelled" },
];

const RECIPE: { icon: React.ElementType; title: string; body: string }[] = [
  {
    icon: Users,
    title: "Escolha pra quem",
    body: "Selecione um público — um estágio do funil, uma tag ou a carteira.",
  },
  {
    icon: MessageSquare,
    title: "Escreva a mensagem",
    body: "Personalize pelo nome ou empresa e anexe imagem, áudio ou PDF.",
  },
  {
    icon: CheckCircle2,
    title: "Revise e envie",
    body: "Confira o resumo. O envio se espalha pelos dias, sem queimar números.",
  },
];

function DisparosPanelBase() {
  const navigate = useNavigate();
  const { organizationId } = useOrganization();
  const { openLead } = useLeadSheet();
  useEffect(() => {
    trackModuleVisit("disparos", organizationId);
  }, [organizationId]);

  const { data: plans, isLoading, isError, refetch } = useBlastPlans();
  const hasBlasts = (plans?.length ?? 0) > 0;
  // Drill-down aberto — o plano vem SEMPRE do useBlastPlans (org-filtrado),
  // pré-condição multi-tenancy do useBlastPlanRecipients (policy master-ghost).
  const [openPlan, setOpenPlan] = useState<BlastPlan | null>(null);

  const grouped = useMemo(() => {
    const list = plans ?? [];
    return GROUPS.map((g) => ({
      ...g,
      items: list.filter((p: BlastPlan) => g.match(p.status)),
    })).filter((g) => g.items.length > 0);
  }, [plans]);

  const startNew = () => navigate("/disparos/novo");

  // ── Loading ──────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <div className="flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 py-12 text-center">
          <AlertTriangle className="h-8 w-8 text-destructive" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              Não foi possível carregar os disparos
            </p>
            <p className="text-sm text-muted-foreground">Tente novamente em alguns instantes.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="mt-1">
            Tentar de novo
          </Button>
        </div>
      </div>
    );
  }

  // ── First time — guided recipe ───────────────────────────────────────
  if (!hasBlasts) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-2xl flex-col items-center justify-center px-6 py-12 text-center">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary"
        >
          <Send className="h-6 w-6" />
        </motion.div>

        <h1 className="mt-6 text-3xl font-semibold tracking-tight text-foreground">
          Fale com muita gente de uma vez
        </h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
          Um disparo envia a mesma mensagem para um grupo de contatos, no seu ritmo, ao longo dos
          dias. Veja como funciona:
        </p>

        <div className="mt-10 grid w-full gap-3 sm:grid-cols-3">
          {RECIPE.map((step, i) => (
            <motion.div
              key={step.title}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.1 + i * 0.08, ease: [0.22, 1, 0.36, 1] }}
              className="rounded-xl border border-border/70 bg-card p-5 text-left"
            >
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold tabular-nums text-primary">
                  {i + 1}
                </span>
                <step.icon className="h-4 w-4 text-muted-foreground" />
              </div>
              <p className="mt-3 text-sm font-semibold text-foreground">{step.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.body}</p>
            </motion.div>
          ))}
        </div>

        <Button size="lg" onClick={startNew} className="mt-10 gap-2 px-6">
          <Plus className="h-4 w-4" />
          Novo disparo
        </Button>
      </div>
    );
  }

  // ── Recurring — operational history ──────────────────────────────────
  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight">
            <Send className="h-6 w-6 text-primary" />
            Disparos
          </h1>
          <p className="text-sm text-muted-foreground">
            Acompanhe e controle os disparos em massa ao longo dos dias.
          </p>
        </div>
        <Button onClick={startNew} className="shrink-0 gap-2">
          <Plus className="h-4 w-4" />
          Novo disparo
        </Button>
      </header>

      <div className="space-y-8">
        {grouped.map((group) => (
          <section key={group.key} className="space-y-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {group.title}
              </h2>
              <span
                className={cn(
                  "rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground",
                )}
              >
                {group.items.length}
              </span>
            </div>
            <div className="space-y-3">
              {group.items.map((plan) => (
                <BlastPlanCard key={plan.id} plan={plan} onOpen={() => setOpenPlan(plan)} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <BlastPlanRecipientsSheet
        plan={openPlan}
        onClose={() => setOpenPlan(null)}
        onOpenLead={(id) => {
          // Mesma mecânica do drill-down da aba Saúde: fecha o sheet do disparo
          // e abre a ficha completa do lead por cima.
          setOpenPlan(null);
          openLead(id);
        }}
      />
    </div>
  );
}

export default function DisparosPanel() {
  return (
    <LeadPanelProvider>
      <DisparosPanelBase />
      <LeadDetailSheet />
    </LeadPanelProvider>
  );
}
