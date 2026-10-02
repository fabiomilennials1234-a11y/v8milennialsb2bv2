/**
 * /disparos — the canonical Disparos home (#904).
 *
 * The single front door to mass-sending, open to any member. Composição V5
 * (mockup "Disparos"):
 *
 *   - Cabeçalho com a pílula Painel · Novo disparo e o primário "Novo disparo".
 *   - Zero disparos: a receita de 3 passos num painel em tinta.
 *   - Com disparos: filtros (status + caixa + busca) → "Em andamento" (lista em
 *     tinta + cartão de ouro do disparo em foco) → seções Ativos / Pausados /
 *     Concluídos em grade de cartões → faixa de apoio (proteção anti-bloqueio +
 *     receita).
 *
 * Creation runs through the Wizard Linear at /disparos/novo. Each plan card owns
 * its own progress query (BlastPlanCard). `useBlastPlans` is the real source.
 *
 * Drill-down (#944): "Ver leads do disparo" opens BlastPlanRecipientsSheet (the
 * frozen audience — Enviados / Pulados / Aguardando); clicking a lead there
 * closes the sheet and navigates to `/leads?lead=<id>` (same mechanics as
 * TabSaude). Desde 2026-07-29 o modal do lead só monta na aba Leads — no funil
 * o card abre o modal do negócio.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  Gauge,
  Loader2,
  MessageSquare,
  Pause,
  Plus,
  Send,
  Shield,
  Shuffle,
  Smartphone,
  Users,
} from "lucide-react";
import { useBlastPlans, type BlastPlan, type BlastPlanStatus } from "@/modules/campaigns/hooks/useBlastPlans";
import { useOrganization } from "@/modules/identity";
import { useWhatsAppInstances } from "@/modules/communication";
import { useFunisDaOrg } from "@/modules/pipelines";
import { trackModuleVisit } from "@/lib/analytics";
import { BlastPlanCard } from "@/modules/campaigns/components/BlastPlanCard";
import { BlastFocusCard } from "@/modules/campaigns/components/BlastFocusCard";
import { BlastPlanRecipientsSheet } from "@/modules/campaigns/components/BlastPlanRecipientsSheet";
import { DisparosTabs } from "@/modules/campaigns/components/DisparosTabs";
import { audienceOrigin, firstLine } from "@/modules/campaigns/components/blast-plan-ui";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { IconChip, InkRow, InkSplit, InkPanel } from "@/components/ui/bento";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FilterChip } from "@/shared/components/FilterChip";
import { FilterRow, PillSearch } from "@/shared/components/PillSearch";
import { rotuloDaInstancia } from "@/shared/disparo/disparo-numbers";
import { CAP_MAX, CAP_RECOMMENDED, NEW_NUMBER_CAP } from "@/shared/disparo/speed-safety";
import { cn } from "@/lib/utils";

type StatusFilter = "all" | "active" | "paused" | "done";

// Concluídos groups both terminal states — operator reads them the same way.
const GROUPS: {
  key: Exclude<StatusFilter, "all">;
  title: string;
  hint: string;
  match: (s: BlastPlanStatus) => boolean;
}[] = [
  { key: "active", title: "Ativos", hint: "Enviando agora, lote a lote", match: (s) => s === "active" },
  { key: "paused", title: "Pausados", hint: "Nada sai até alguém retomar", match: (s) => s === "paused" },
  {
    key: "done",
    title: "Concluídos",
    hint: "Todos os lotes liberados ou cancelados",
    match: (s) => s === "completed" || s === "cancelled",
  },
];

const RECIPE: { icon: React.ElementType; title: string; body: string }[] = [
  {
    icon: Users,
    title: "Escolha pra quem",
    body: "Etapas do funil ou uma planilha.",
  },
  {
    icon: MessageSquare,
    title: "Escreva a mensagem",
    body: "Com nome, empresa e anexo de imagem, áudio ou PDF.",
  },
  {
    icon: CheckCircle2,
    title: "Revise e envie",
    body: "O envio se espalha pelos dias, sem queimar números.",
  },
];

/** As regras que o disparo já aplica — explicativo, nada aqui é ajustável. */
const PROTECTION: { icon: React.ElementType; title: string; body: string }[] = [
  {
    icon: Gauge,
    title: "Limite por número, por dia",
    body: `Recomendado ${CAP_RECOMMENDED} envios; até ${CAP_MAX} assumindo o risco. Número recém-conectado fica em ${NEW_NUMBER_CAP}.`,
  },
  {
    icon: Shuffle,
    title: "Intervalos aleatórios",
    body: "Com a proteção ligada, cada mensagem espera de 5 a 30 s — nunca no mesmo ritmo.",
  },
  {
    icon: Clock,
    title: "Janela comercial",
    body: "Só envia de segunda a sábado, das 8h às 20h. O que sobra vai para o próximo dia útil.",
  },
  {
    icon: CalendarClock,
    title: "Lotes diários",
    body: "O público é dividido em lotes, um por dia, liberados no horário do disparo.",
  },
];

function DisparosPanelBase() {
  const navigate = useNavigate();
  const { organizationId } = useOrganization();
  useEffect(() => {
    trackModuleVisit("disparos", organizationId);
  }, [organizationId]);

  const { data: plans, isLoading, isError, refetch } = useBlastPlans();
  const { data: instances = [] } = useWhatsAppInstances();
  const { data: funis = [] } = useFunisDaOrg();
  const hasBlasts = (plans?.length ?? 0) > 0;
  // Drill-down aberto — o plano vem SEMPRE do useBlastPlans (org-filtrado),
  // pré-condição multi-tenancy do useBlastPlanRecipients (policy master-ghost).
  const [openPlan, setOpenPlan] = useState<BlastPlan | null>(null);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [inbox, setInbox] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [focusId, setFocusId] = useState<string | null>(null);

  const inboxLabel = useCallback(
    (instanceId: string) => {
      const idx = instances.findIndex((i) => i.id === instanceId);
      return idx >= 0 ? rotuloDaInstancia(instances[idx], idx) : null;
    },
    [instances],
  );
  const funnelName = useCallback((pid: string) => funis.find((f) => f.id === pid)?.label, [funis]);
  const originOf = useCallback((p: BlastPlan) => audienceOrigin(p, funnelName), [funnelName]);

  // Caixas que de fato dispararam — o filtro não oferece caixa sem disparo.
  const inboxOptions = useMemo(() => {
    const ids = [...new Set((plans ?? []).map((p) => p.instance_id).filter(Boolean))];
    return ids.map((id) => ({ id, label: inboxLabel(id) ?? "Caixa desconectada" }));
  }, [plans, inboxLabel]);

  // Caixa + busca valem para tudo; o status escolhe as seções.
  const scoped = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (plans ?? []).filter((p) => {
      if (inbox !== "all" && p.instance_id !== inbox) return false;
      if (!q) return true;
      return `${p.message} ${originOf(p) ?? ""}`.toLowerCase().includes(q);
    });
  }, [plans, inbox, query, originOf]);

  const counts = useMemo(
    () => ({
      all: scoped.length,
      active: scoped.filter((p) => p.status === "active").length,
      paused: scoped.filter((p) => p.status === "paused").length,
      done: scoped.filter((p) => p.status === "completed" || p.status === "cancelled").length,
    }),
    [scoped],
  );

  const inflight = useMemo(
    () =>
      scoped.filter((p) =>
        status === "all" ? p.status === "active" || p.status === "paused" : status === "done" ? false : p.status === status,
      ),
    [scoped, status],
  );
  const focus = inflight.find((p) => p.id === focusId) ?? inflight[0] ?? null;

  const grouped = useMemo(
    () =>
      GROUPS.filter((g) => status === "all" || g.key === status)
        .map((g) => ({ ...g, items: scoped.filter((p) => g.match(p.status)) }))
        .filter((g) => g.items.length > 0),
    [scoped, status],
  );

  const startNew = () => navigate("/disparos/novo");

  const header = (
    <PageHeader
      title="Disparos"
      subtitle="Acompanhe e controle os disparos em massa ao longo dos dias."
      tabs={<DisparosTabs active="painel" />}
      actions={
        <Button onClick={startNew} className="shrink-0">
          <Plus className="h-4 w-4" />
          Novo disparo
        </Button>
      }
    />
  );

  // ── Loading ──────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-6">
        {header}
        <div className="flex h-[50vh] items-center justify-center">
          <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div className="space-y-6">
        {header}
        <div className="flex flex-col items-center gap-3 rounded-card border border-destructive/30 bg-destructive/5 py-12 text-center">
          <AlertTriangle className="h-8 w-8 text-destructive" />
          <div className="space-y-1">
            <p className="text-sm font-bold text-foreground">Não foi possível carregar os disparos</p>
            <p className="text-sm text-muted-foreground">Tente novamente em alguns instantes.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="mt-1">
            Tentar de novo
          </Button>
        </div>
      </div>
    );
  }

  // ── First time — guided recipe in ink ────────────────────────────────
  if (!hasBlasts) {
    return (
      <div className="space-y-6">
        {header}
        <InkPanel className="p-6 sm:p-8">
          <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div>
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-brilho-ouro">
                <Send className="h-5 w-5" />
              </span>
              <h2 className="mt-5 text-[1.85rem] font-extrabold leading-[1.1] tracking-[-0.035em] text-tinta-foreground max-sm:text-[1.5rem]">
                Fale com muita gente de uma vez
              </h2>
              <p className="mt-3 max-w-md text-sm leading-relaxed text-tinta-muted">
                Um disparo envia a mesma mensagem, personalizada, para um grupo de contatos — no seu
                ritmo, ao longo dos dias, sem arriscar o número.
              </p>
              <button
                type="button"
                onClick={startNew}
                className="mt-6 inline-flex h-11 items-center gap-2 rounded-full bg-tinta-foreground px-6 text-sm font-bold text-tinta shadow-relevo transition-transform hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Plus className="h-4 w-4" />
                Começar um disparo
              </button>
            </div>
            <ol className="grid gap-2.5">
              {RECIPE.map((step, i) => (
                <li
                  key={step.title}
                  className="flex items-center gap-3.5 rounded-2xl border border-white/10 bg-white/[.05] p-4"
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-xs font-extrabold tabular-nums text-primary-foreground">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-[14px] font-bold text-tinta-foreground">
                      <step.icon className="h-4 w-4 text-primary" aria-hidden />
                      {step.title}
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-tinta-muted">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </InkPanel>
        <ProtectionCard />
      </div>
    );
  }

  const inboxActive = inbox !== "all";
  const inboxName = inboxActive ? inboxOptions.find((o) => o.id === inbox)?.label ?? "Caixa" : "Todas as caixas";

  // ── Recurring — operational history ──────────────────────────────────
  return (
    <div className="space-y-6">
      {header}

      <FilterRow>
        {(
          [
            ["all", "Todos"],
            ["active", "Ativos"],
            ["paused", "Pausados"],
            ["done", "Concluídos"],
          ] as const
        ).map(([key, label]) => (
          <FilterChip key={key} active={status === key} aria-pressed={status === key} count={counts[key]} onClick={() => setStatus(key)}>
            {label}
          </FilterChip>
        ))}
        {inboxOptions.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <FilterChip icon={Smartphone} caret active={inboxActive}>
                {inboxName}
              </FilterChip>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup value={inbox} onValueChange={setInbox}>
                <DropdownMenuRadioItem value="all">Todas as caixas</DropdownMenuRadioItem>
                {inboxOptions.map((o) => (
                  <DropdownMenuRadioItem key={o.id} value={o.id}>
                    {o.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <PillSearch
          value={query}
          onValueChange={setQuery}
          placeholder="Buscar disparo ou público"
          className="ml-auto w-56 shrink-0 sm:w-64"
        />
      </FilterRow>

      {focus && (
        <InkSplit
          title="Em andamento"
          count={[
            counts.active > 0 && status !== "paused" ? `${counts.active} ${counts.active === 1 ? "ativo" : "ativos"}` : null,
            counts.paused > 0 && status !== "active" ? `${counts.paused} ${counts.paused === 1 ? "pausado" : "pausados"}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          listClassName="lg:max-h-[640px] lg:overflow-y-auto"
          list={
            <>
              {inflight.map((p) => (
                <InflightRow
                  key={p.id}
                  plan={p}
                  origin={originOf(p)}
                  selected={p.id === focus.id}
                  onSelect={() => setFocusId(p.id)}
                />
              ))}
              <button
                type="button"
                onClick={startNew}
                className="mt-1.5 flex items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 px-3 py-3.5 text-[13px] font-semibold text-tinta-muted transition-colors hover:border-white/25 hover:text-tinta-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Plus className="h-4 w-4" />
                Novo disparo
              </button>
            </>
          }
          detail={
            <BlastFocusCard
              key={focus.id}
              plan={focus}
              origin={originOf(focus)}
              inboxLabel={inboxLabel(focus.instance_id)}
              onOpen={() => setOpenPlan(focus)}
            />
          }
        />
      )}

      {grouped.length === 0 ? (
        <div className="rounded-card border border-dashed border-border bg-card/60 px-6 py-12 text-center">
          <p className="text-sm font-bold text-foreground">Nenhum disparo com esses filtros</p>
          <p className="mt-1 text-sm text-muted-foreground">Troque o status, a caixa ou a busca.</p>
        </div>
      ) : (
        grouped.map((group) => (
          <section key={group.key} className="space-y-3">
            <div className="flex items-center gap-2.5 px-1">
              <h2 className="text-[1.1rem] font-extrabold tracking-[-0.02em] text-foreground">{group.title}</h2>
              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-tinta px-1.5 text-[10.5px] font-extrabold tabular-nums text-tinta-foreground">
                {group.items.length}
              </span>
              <span className="truncate text-xs text-muted-foreground">{group.hint}</span>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {group.items.map((plan) => (
                <BlastPlanCard
                  key={plan.id}
                  plan={plan}
                  origin={originOf(plan)}
                  inboxLabel={inboxLabel(plan.instance_id)}
                  onOpen={() => setOpenPlan(plan)}
                />
              ))}
            </div>
          </section>
        ))
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <ProtectionCard />
        <RecipeCard onStart={startNew} />
      </div>

      <BlastPlanRecipientsSheet
        plan={openPlan}
        onClose={() => setOpenPlan(null)}
        onOpenLead={(id) => {
          // Mesma mecânica do drill-down da aba Saúde: fecha o sheet do disparo
          // e abre a ficha completa do lead por cima.
          setOpenPlan(null);
          navigate(`/leads?lead=${id}`);
        }}
      />
    </div>
  );
}

function InflightRow({
  plan,
  origin,
  selected,
  onSelect,
}: {
  plan: BlastPlan;
  origin: string | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const paused = plan.status === "paused";
  const pct = plan.lots_total > 0 ? Math.round((plan.lots_released / plan.lots_total) * 100) : 0;
  return (
    <InkRow selected={selected} onClick={onSelect} className="items-start py-3">
      <span
        className={cn(
          "mt-0.5 grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[11px]",
          selected ? "bg-primary-foreground text-primary" : "bg-white/[.07] text-primary",
        )}
      >
        {paused ? <Pause className="h-4 w-4" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[13px] font-bold">{firstLine(plan.message)}</span>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold",
              selected
                ? "bg-primary-foreground text-primary"
                : paused
                  ? "bg-white/10 text-tinta-muted"
                  : "bg-primary/15 text-primary",
            )}
          >
            {paused ? "Pausado" : "Ativo"}
          </span>
        </span>
        <span
          className={cn(
            "mt-0.5 block truncate text-[11px] tabular-nums",
            selected ? "text-primary-foreground/70" : "text-tinta-muted",
          )}
        >
          Lote {Math.max(1, plan.lots_released)} de {plan.lots_total} · {plan.total_recipients.toLocaleString("pt-BR")} contatos
          {origin ? ` · ${origin}` : ""}
        </span>
        <span
          className={cn("mt-2 block h-[5px] overflow-hidden rounded-full", selected ? "bg-primary-foreground/15" : "bg-white/10")}
          aria-hidden
        >
          <span
            className={cn("block h-full rounded-full", selected ? "bg-primary-foreground" : "bg-primary")}
            style={{ width: `${pct}%` }}
          />
        </span>
      </span>
    </InkRow>
  );
}

function ProtectionCard() {
  return (
    <section className="rounded-card border border-card-border bg-card p-5 shadow-relevo">
      <div className="flex items-center gap-3">
        <IconChip icon={Shield} tone="good" />
        <div>
          <h2 className="text-base font-bold tracking-tight text-foreground">Proteção anti-bloqueio</h2>
          <p className="text-xs text-muted-foreground">Vale para todos os disparos da organização.</p>
        </div>
      </div>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {PROTECTION.map((rule) => (
          <li key={rule.title} className="flex items-start gap-3">
            <IconChip icon={rule.icon} tone="neutral" />
            <div className="min-w-0">
              <p className="text-[13px] font-bold text-foreground">{rule.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{rule.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RecipeCard({ onStart }: { onStart: () => void }) {
  return (
    <section className="flex flex-col rounded-card border border-card-border bg-card p-5 shadow-relevo">
      <div className="flex items-center gap-3">
        <IconChip icon={Send} tone="gold" />
        <div>
          <h2 className="text-base font-bold tracking-tight text-foreground">Fale com muita gente de uma vez</h2>
          <p className="text-xs text-muted-foreground">A mesma mensagem, personalizada, para centenas de leads.</p>
        </div>
      </div>
      <ol className="mt-4 grid gap-2 sm:grid-cols-3">
        {RECIPE.map((step, i) => (
          <li key={step.title} className="rounded-2xl bg-muted/50 p-3.5">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-primary text-[11px] font-extrabold tabular-nums text-primary-foreground">
              {i + 1}
            </span>
            <p className="mt-2 text-[13px] font-bold text-foreground">{step.title}</p>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">{step.body}</p>
          </li>
        ))}
      </ol>
      <Button variant="ink" className="mt-4 w-full sm:mt-auto" onClick={onStart}>
        <Plus />
        Começar um disparo
      </Button>
    </section>
  );
}

export default function DisparosPanel() {
  return <DisparosPanelBase />;
}
