import {
  MoreHorizontal,
  CalendarDays,
  ChevronRight,
  Crown,
  Plus,
  ShoppingCart,
  BriefcaseBusiness,
  X,
} from "lucide-react";
import { ClientPurchaseHistory } from "./ClientPurchaseHistory";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import type { LeadDeal } from "../../hooks/useLeadsDeals";
import {
  cycleDate,
  portfolioDate,
  reorderLabel,
  reorderStatus,
  SEGMENTS,
  type PortfolioClient,
  type PortfolioPurchase,
} from "./portfolio-model";

export function ClientTier({ segment }: { segment?: string | null }) {
  const tier = segment ? SEGMENTS[segment] : undefined;
  if (!tier)
    return <span className="text-xs text-muted-foreground">Sem faixa</span>;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-1 text-[11px] font-medium",
        tier.tone,
      )}
    >
      <Crown className="size-3" aria-hidden="true" />
      {tier.label}
    </span>
  );
}
export function ClientAvatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-muted/50 text-xs font-semibold text-foreground"
    >
      {name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((s) => s[0])
        .join("")
        .toUpperCase()}
    </span>
  );
}
export function ReorderCaption({ client }: { client: PortfolioClient }) {
  const status = reorderStatus(client.cycle);
  return (
    <span
      className={cn(
        "text-[11px]",
        status === "late"
          ? "text-destructive"
          : status === "soon"
            ? "text-warning-strong"
            : "text-muted-foreground",
      )}
    >
      {reorderLabel(client.cycle)}
    </span>
  );
}
interface Props {
  client: PortfolioClient;
  now: number;
  canCreate: boolean;
  purchases?: PortfolioPurchase[];
  purchasesLoading?: boolean;
  purchasesError?: boolean;
  onRetryPurchases?: () => void;
  onNewDeal: (id: string) => void;
  onOpenLead: (id: string) => void;
  onOpenDeal: (deal: LeadDeal) => void;
  onClose?: () => void;
}
export function Client360({
  client,
  now,
  canCreate,
  purchases,
  purchasesLoading,
  purchasesError,
  onRetryPurchases,
  onNewDeal,
  onOpenLead,
  onOpenDeal,
  onClose,
}: Props) {
  const cycle = client.cycle;
  const last =
    client.lastPurchaseAt ??
    cycleDate(
      cycle?.diasDesdeUltima == null ? null : -cycle.diasDesdeUltima,
      now,
    );
  const next = client.nextPurchaseAt ?? cycleDate(cycle?.diasRestantes, now);
  const openDeals = client.deals.filter((d) => d.outcome === "open");
  const late = reorderStatus(cycle) === "late";
  return (
    <aside
      aria-label={`Cliente 360: ${client.company || client.name}`}
      className="min-w-0 rounded-xl border border-border bg-card p-4 lg:sticky lg:top-4"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.24em]">
          Cliente 360
        </h2>
        <Button variant="ghost" size="icon" className="size-7" aria-label="Abrir cadastro completo" onClick={() => onOpenLead(client.id)}><MoreHorizontal className="size-4" /></Button>
        {onClose && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="Fechar visão 360"
            onClick={onClose}
          >
            <X className="size-4" />
          </Button>
        )}
      </div>
      <div className="flex items-start gap-3">
        <ClientAvatar name={client.company || client.name} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold leading-tight">{client.company || client.name}</h3>
            <ClientTier segment={client.metrics?.segment} />
            {late && <span className="rounded-md border border-destructive/30 px-2 py-1 text-[10px] text-destructive">Recompra atrasada</span>}
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {client.firstPurchaseAt
              ? `Cliente desde ${new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(client.firstPurchaseAt)).replace(" de ", " ").replace(".", "")}`
              : client.identity || client.name}
          </p>
        </div>
      </div>
      <div className="my-4 grid grid-cols-2 divide-x divide-border">
        <div>
          <p className="text-xl font-semibold tabular-nums tracking-tight">
            {client.metrics ? formatBRL(client.metrics.lifetimeValue) : "—"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Total comprado</p>
        </div>
        <div className="pl-5">
          <p className="text-xl font-semibold tabular-nums">
            {client.metrics?.orderCount ?? "—"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Pedidos
          </p>
        </div>
      </div>
      <section
        className="border-t border-border py-3"
        aria-label="Previsão de recompra"
      >
        <h4 className="mb-3 flex items-center gap-2 text-sm font-medium">
          <CalendarDays className="size-4 text-muted-foreground" />
          Próxima recompra
        </h4>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-2xl font-semibold tracking-tight">
              {next ? <>{portfolioDate(next)} <span className="text-base font-normal text-muted-foreground">{next.slice(0, 4)}</span></> : "Sem previsão"}
            </p>
            <ReorderCaption client={client} />
          </div>
          <p className="max-w-32 text-right text-[11px] leading-relaxed text-muted-foreground">
            {cycle?.mediaDias ? (
              <>
                Ciclo médio: {cycle.mediaDias} dias
                <br />
                Baseado em {cycle.compras} dias de compra
              </>
            ) : (
              "Previsão disponível após compras em duas datas distintas."
            )}
          </p>
        </div>
        {next && (
          <div className="mt-5">
            <div className="relative mx-1 h-3">
              <div className="absolute inset-x-0 top-1 h-px bg-border" />
              <div
                className={cn(
                  "absolute left-0 top-1 h-px",
                  late ? "w-1/2 bg-primary" : "bg-primary",
                )}
                style={
                  late
                    ? undefined
                    : { width: `${(cycle?.progresso ?? 0) * 100}%` }
                }
              />
              {late && <span className="absolute left-1/2 right-0 top-1 border-t border-dashed border-destructive" />}
              <span className="absolute left-0 top-0 size-2.5 rounded-full bg-primary" />
              {late && (
                <span className="absolute left-1/2 top-0 size-2.5 rounded-full bg-primary" />
              )}
              <span
                className={cn(
                  "absolute right-0 top-0 size-2.5 rounded-full",
                  late ? "bg-destructive" : "bg-primary",
                )}
              />
            </div>
            <div className="mt-1 flex justify-between text-[10px] leading-relaxed text-muted-foreground">
              <span>
                {portfolioDate(last)}
                <br />
                Última compra
              </span>
              {late && (
                <span className="text-center">
                  {portfolioDate(next)}
                  <br />
                  Previsão
                </span>
              )}
              <span className="text-right">
                {portfolioDate(late ? new Date(now).toISOString() : next)}
                <br />
                {late ? "Hoje" : "Previsão"}
              </span>
            </div>
          </div>
        )}
      </section>
      <section className="border-t border-border py-3">
        <h4 className="mb-3 flex items-center gap-2 text-sm font-medium">
          <BriefcaseBusiness className="size-4 text-muted-foreground" />
          Negócios em andamento{" "}
          <span className="ml-auto text-xs text-muted-foreground">
            {openDeals.length}
          </span>
        </h4>
        <div className="max-h-52 space-y-2 overflow-y-auto">
          {openDeals.length ? (
            openDeals.map((deal) => (
              <button
                type="button"
                key={deal.id}
                onClick={() => onOpenDeal(deal)}
                className="w-full rounded-lg border border-border bg-background/40 p-3 text-left transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex items-center justify-between gap-2 text-xs font-medium">
                  {deal.title}
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                </span>
                <span className="mt-1 block text-[11px] text-muted-foreground">
                  {formatBRL(deal.value)} · {deal.stageName}
                </span>
                {deal.stageIndex != null && deal.stageCount > 0 && (
                  <div aria-label={`Etapa ${deal.stageIndex + 1} de ${deal.stageCount}`} className="mt-4 flex overflow-x-auto pb-1">
                    {Array.from({ length: deal.stageCount }, (_, i) => (
                      <span key={deal.stages?.[i]?.id ?? i} className="relative min-w-16 flex-1 text-center">
                        {i < deal.stageCount - 1 && <span className={cn("absolute left-1/2 right-[-50%] top-1 h-0.5", i < deal.stageIndex! ? "bg-primary" : "bg-muted-foreground/40")} />}
                        <span className={cn("relative mx-auto block size-2.5 rounded-full border-2", i < deal.stageIndex! ? "border-primary bg-primary" : i === deal.stageIndex ? "border-primary bg-card" : "border-muted-foreground/50 bg-muted-foreground/50")} />
                        <span className={cn("mt-2 block px-1 text-[9px]", i === deal.stageIndex ? "text-primary" : "text-muted-foreground")}>{deal.stages?.[i]?.name ?? (i === deal.stageIndex ? deal.stageName : `Etapa ${i + 1}`)}</span>
                      </span>
                    ))}
                  </div>
                )}
              </button>
            ))
          ) : (
            <p className="py-2 text-xs text-muted-foreground">
              Nenhum negócio aberto. Comece a próxima compra.
            </p>
          )}
        </div>
        <Button
          className="mt-4 w-full gap-2 font-semibold"
          disabled={!canCreate}
          onClick={() => onNewDeal(client.id)}
        >
          <Plus className="size-4" />
          Novo negócio
        </Button>
        <p className="mt-2 text-center text-[10px] text-muted-foreground">
          {canCreate
            ? "Vinculado a este cliente"
            : "Sem permissão para abrir negócios"}
        </p>
      </section>
      <section className="border-t border-border pt-3">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="flex items-center gap-2 text-sm font-medium">
            <ShoppingCart className="size-4 text-muted-foreground" />
            Últimas compras
          </h4>
          {!!purchases?.length && !purchasesLoading && !purchasesError && <ClientPurchaseHistory name={client.company || client.name} purchases={purchases} />}
        </div>
        {purchasesLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : purchasesError ? (
          <div role="status" className="text-xs text-destructive">
            Não foi possível carregar compras.
            <button className="ml-1 underline" onClick={onRetryPurchases}>
              Tentar novamente
            </button>
          </div>
        ) : purchases?.length ? (
          <div className="divide-y divide-border rounded-lg border border-border">
            {purchases.slice(0, 3).map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-2 px-3 py-3 text-xs"
              >
                <span className="text-muted-foreground">
                  {portfolioDate(p.date)}{" "}
                  <span className="text-[9px]">· {p.source}</span>
                </span>
                <span className="font-medium tabular-nums">
                  {formatBRL(p.value)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Nenhuma compra registrada.
          </p>
        )}

      </section>
    </aside>
  );
}
