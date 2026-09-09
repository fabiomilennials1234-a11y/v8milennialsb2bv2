import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { usePipelineDisplayConfig } from "@/modules/pipelines";
import { NOME_DE_FABRICA } from "@/contracts/pipe";
import {
  useFunnelHealthStageLeads,
  type FunnelHealthRange,
  type FunnelHealthStages,
  type FunnelStageLead,
} from "@/modules/analytics/hooks/useFunnelHealth";

interface FunnelStageLeadsSheetProps {
  stage: keyof FunnelHealthStages | null;
  label: string;
  description: string;
  count: number;
  range: FunnelHealthRange;
  origins: string[];
  periodLabel: string;
  onClose: () => void;
  onOpenLead: (leadId: string) => void;
}

const TIER_BADGE: Record<string, string> = {
  diamante: "bg-cyan-400/15 text-cyan-300",
  ouro: "bg-primary/15 text-primary",
  prata: "bg-zinc-400/15 text-zinc-300",
  bronze: "bg-orange-700/20 text-orange-400",
  desqualificado: "bg-red-500/15 text-red-400",
};

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

function humanizeStageKey(key: string) {
  const label = key.replaceAll("_", " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * "Onde está agora" — precedência: vendido > funil de fechamento > compareceu >
 * reunião > funil. `nomePropostas` é o nome que a ORG dá ao funil de
 * fechamento (SCRUM-641) — nada de "Orçamentos" cravado.
 */
function leadWhereabouts(
  l: FunnelStageLead,
  nomePropostas: string,
): { label: string; cls: string } {
  if (l.proposta_stage === "vendido") {
    return {
      label: l.sale_value ? `Vendido · ${BRL.format(l.sale_value)}` : "Vendido",
      cls: "text-primary font-semibold",
    };
  }
  if (l.proposta_stage) {
    return { label: `Em ${nomePropostas} · ${humanizeStageKey(l.proposta_stage)}`, cls: "text-primary" };
  }
  if (l.held_at) {
    return { label: `Compareceu · ${format(new Date(l.held_at), "dd/MM")}`, cls: "text-emerald-500" };
  }
  if (l.meeting_date) {
    return {
      label: `Reunião marcada · ${format(new Date(l.meeting_date), "dd/MM")}`,
      cls: "text-emerald-500",
    };
  }
  if (l.whatsapp_stage) {
    return { label: humanizeStageKey(l.whatsapp_stage), cls: "text-muted-foreground" };
  }
  return { label: "—", cls: "text-muted-foreground" };
}

export function FunnelStageLeadsSheet({
  stage,
  label,
  description,
  count,
  range,
  origins,
  periodLabel,
  onClose,
  onOpenLead,
}: FunnelStageLeadsSheetProps) {
  const { data: leads, isLoading } = useFunnelHealthStageLeads(range, stage, origins);
  // Nome do funil de fechamento como a ORG o vê (SCRUM-641).
  const { data: displayConfigs } = usePipelineDisplayConfig();
  const nomePropostas = (() => {
    const c = displayConfigs?.find((x) => x.pipe_type === "propostas");
    return c ? c.display_name || NOME_DE_FABRICA.propostas : "Funil removido";
  })();
  const [query, setQuery] = useState("");
  const [tierFilter, setTierFilter] = useState<string | null>(null);

  const tierCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const l of leads ?? []) {
      if (l.tier) counts[l.tier] = (counts[l.tier] ?? 0) + 1;
    }
    return counts;
  }, [leads]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (leads ?? []).filter(
      (l) =>
        (!tierFilter || l.tier === tierFilter) &&
        (!q || l.name?.toLowerCase().includes(q) || l.company?.toLowerCase().includes(q))
    );
  }, [leads, query, tierFilter]);

  return (
    <Sheet open={stage !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-[480px]">
        <SheetHeader className="border-b border-border px-6 pb-4 pt-6">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
            Leads da etapa
          </div>
          <SheetTitle className="flex items-baseline gap-2.5 text-[22px] font-extrabold tracking-tight">
            {label}
            <span className="text-primary tabular-nums">{count}</span>
          </SheetTitle>
          <SheetDescription className="text-xs">
            {description} Leads que entraram {periodLabel}.
          </SheetDescription>
        </SheetHeader>

        <div className="flex items-center gap-2 border-b border-border px-6 py-3">
          <Input
            placeholder="Buscar lead..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8 flex-1 text-xs"
          />
          <button
            type="button"
            onClick={() => setTierFilter(null)}
            className={cn(
              "rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold text-muted-foreground",
              tierFilter === null && "border-primary/50 bg-primary/10 text-foreground"
            )}
          >
            Todos
          </button>
          {Object.entries(tierCounts).map(([tier, n]) => (
            <button
              key={tier}
              type="button"
              onClick={() => setTierFilter(tierFilter === tier ? null : tier)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold text-muted-foreground tabular-nums",
                tierFilter === tier && "border-primary/50 bg-primary/10 text-foreground"
              )}
              title={tier}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", TIER_BADGE[tier] ?? "bg-muted")} />
              {n}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="space-y-3 p-6">
              {Array(6)
                .fill(0)
                .map((_, i) => (
                  <Skeleton key={i} className="h-12" />
                ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Nenhum lead encontrado.
            </div>
          ) : (
            filtered.map((l) => {
              const where = leadWhereabouts(l, nomePropostas);
              const initials = (l.name ?? "?")
                .split(/\s+/)
                .map((p) => p[0])
                .join("")
                .slice(0, 2)
                .toUpperCase();
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => onOpenLead(l.id)}
                  className="group flex w-full items-center gap-3 border-b border-border/40 px-6 py-3 text-left transition-colors hover:bg-primary/5"
                >
                  <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full border border-border bg-muted text-[11px] font-bold text-primary">
                    {initials}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-[13.5px] font-semibold">
                      <span className="truncate">{l.name}</span>
                      {l.tier && (
                        <span
                          className={cn(
                            "rounded-full px-2 py-px text-[9.5px] font-bold uppercase tracking-wide",
                            TIER_BADGE[l.tier]
                          )}
                        >
                          {l.tier}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
                      {[l.company, l.pre_vendas ? `Pré-vendas: ${l.pre_vendas}` : "Sem pré-vendas"]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className="flex-none text-right group-hover:hidden">
                    <span className={cn("block text-[11.5px] font-medium", where.cls)}>
                      {where.label}
                    </span>
                    <span className="mt-0.5 block text-[10.5px] text-muted-foreground tabular-nums">
                      entrou {format(new Date(l.created_at), "dd/MM")}
                    </span>
                  </span>
                  <span className="hidden flex-none rounded-full border border-primary/35 bg-primary/10 px-2.5 py-1 text-[10.5px] font-semibold text-primary group-hover:inline-flex">
                    Abrir lead ↗
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border bg-card px-6 py-3 text-xs text-muted-foreground tabular-nums">
          <span>
            {filtered.length} de {leads?.length ?? 0} leads
            {(leads?.length ?? 0) === 500 && " · mostrando os 500 mais recentes"}
          </span>
        </div>
      </SheetContent>
    </Sheet>
  );
}
