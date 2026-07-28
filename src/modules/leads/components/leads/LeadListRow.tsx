import type { ReactNode } from "react";
import { Phone, Mail } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import type { Lead } from "../../hooks/useLeads";
import type { LeadCarteiraMetrics } from "../../hooks/useLeadsCarteiraMetrics";

/**
 * Linha da lista de leads — cartão solto, não célula de tabela.
 *
 * A aba Leads é a fonte de verdade do lead: identidade, contato, etiquetas,
 * negócios vinculados e números de carteira. O lead **não tem etapa** — quem
 * anda no funil é o Negócio, e a coluna "Negócios" é a única ponte pra lá.
 */

/** Colunas compartilhadas entre cabeçalho e linha — precisam casar. */
const GRID_COLS =
  "grid items-center gap-x-4 grid-cols-[34px_minmax(210px,1.5fr)_minmax(140px,0.9fr)_minmax(140px,1fr)_minmax(200px,1.4fr)_minmax(290px,1.3fr)_minmax(104px,0.7fr)_minmax(104px,0.7fr)_40px]";

/** Largura mínima da lista — abaixo disso o contêiner rola no eixo X. */
export const LEAD_LIST_MIN_WIDTH = "min-w-[1240px]";

export interface LeadTagRef {
  id: string;
  name: string;
  color?: string | null;
}

/**
 * Um negócio vinculado ao lead. Ainda não há origem de dados — `deals` está
 * vazia em produção e a coluna renderiza o estado "sem negócio" pra todo mundo.
 * O contrato já fica de pé pra fatia 2 ligar sem mexer no layout.
 */
export interface LeadDealRef {
  id: string;
  title: string;
  funnelName: string;
  funnelColor: string;
  stageName: string;
  value: number;
  won?: boolean;
}

/** `Lead` + os joins que `useLeads` traz em runtime mas o tipo gerado não cobre. */
export type LeadListItem = Lead & {
  pre_sale_responsible?: { id: string; name: string } | null;
  sale_responsible?: { id: string; name: string } | null;
  responsible?: { id: string; name: string } | null;
  lead_tags?: { tag: LeadTagRef | null }[] | null;
};

interface LeadListRowProps {
  lead: LeadListItem;
  metrics?: LeadCarteiraMetrics;
  deals?: LeadDealRef[];
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  createdLabel: string;
  originLabel: string;
  originClassName: string;
  /** Menu "···" — reaproveita o dropdown de ações já existente na página. */
  actions?: ReactNode;
}

/** Hue estável a partir do nome — mesma inicial, mesma cor, sempre. */
function nameHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

function LeadAvatar({ name }: { name: string }) {
  const hue = nameHue(name || "?");
  return (
    <div
      style={{ "--lead-hue": hue } as React.CSSProperties}
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full text-[15px] font-semibold",
        "bg-[hsl(var(--lead-hue)_70%_92%)] text-[hsl(var(--lead-hue)_55%_34%)]",
        "dark:bg-[hsl(var(--lead-hue)_45%_24%)] dark:text-[hsl(var(--lead-hue)_55%_74%)]",
      )}
      aria-hidden="true"
    >
      {(name || "?").trim().charAt(0).toUpperCase()}
    </div>
  );
}

/** Anel com a contagem de compras — verde quando existe histórico. */
function CountRing({ value }: { value: number }) {
  const active = value > 0;
  return (
    <div className="relative grid size-[34px] place-items-center">
      <svg viewBox="0 0 34 34" className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle
          cx="17"
          cy="17"
          r="15.5"
          fill="none"
          strokeWidth="2"
          className={active ? "stroke-success" : "stroke-border"}
        />
      </svg>
      <span
        className={cn(
          "text-[13px] font-semibold tabular-nums",
          !active && "text-muted-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function DataItem({
  value,
  label,
  tone,
}: {
  value: string;
  label: string;
  tone?: "muted" | "danger";
}) {
  return (
    <div className="flex flex-col items-center gap-px text-center">
      <span
        className={cn(
          "text-sm font-semibold tabular-nums tracking-[-0.01em]",
          tone === "muted" && "text-muted-foreground",
          tone === "danger" && "text-destructive",
        )}
      >
        {value}
      </span>
      <span className="text-[10.5px] leading-tight text-muted-foreground">{label}</span>
    </div>
  );
}

export function LeadListHeader({ selectAll }: { selectAll?: ReactNode }) {
  return (
    <div className={cn(GRID_COLS, "px-[18px] pb-2.5 text-[13px] font-medium text-muted-foreground")}>
      <span>{selectAll}</span>
      <span>Nome</span>
      <span>Contatos</span>
      <span>Tags</span>
      <span>Negócios</span>
      <span>Dados</span>
      <span>Dono da conta</span>
      <span>Data de criação</span>
      <span />
    </div>
  );
}

export function LeadListRow({
  lead,
  metrics,
  deals = [],
  selected,
  onToggleSelect,
  onOpen,
  createdLabel,
  originLabel,
  originClassName,
  actions,
}: LeadListRowProps) {
  const tags = (lead.lead_tags ?? []).map((t) => t.tag).filter((t): t is LeadTagRef => Boolean(t));

  const owner =
    lead.sale_responsible?.name ?? lead.pre_sale_responsible?.name ?? lead.responsible?.name ?? null;

  const lifetimeValue = metrics?.lifetimeValue ?? 0;
  const avgTicket = metrics?.avgTicket ?? 0;
  const orderCount = metrics?.orderCount ?? 0;
  const cycleDays = metrics?.reorderCycleDays ?? null;
  const sinceLast = metrics?.daysSinceLastOrder ?? null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        GRID_COLS,
        "mb-2.5 cursor-pointer rounded-lg border border-border bg-card px-[18px] py-3.5 shadow-sm",
        "transition-[box-shadow,border-color] hover:border-muted-foreground/30 hover:shadow-md",
        selected && "border-primary/55 bg-primary/5",
      )}
    >
      {/* seleção */}
      <div onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={selected}
          onCheckedChange={onToggleSelect}
          aria-label={`Selecionar ${lead.name}`}
        />
      </div>

      {/* nome + ticket médio */}
      <div className="flex min-w-0 items-center gap-3">
        <LeadAvatar name={lead.name} />
        <div className="min-w-0">
          <p className="truncate text-[14.5px] font-semibold tracking-[-0.01em]">
            {lead.company ? `${lead.name} — ${lead.company}` : lead.name}
          </p>
          <p className="mt-px text-xs text-muted-foreground">
            Ticket médio{" "}
            <span className="font-semibold tabular-nums text-success">{formatBRL(avgTicket, 2)}</span>
          </p>
        </div>
      </div>

      {/* contatos */}
      <div className="flex min-w-0 flex-col gap-0.5 text-[13.5px] text-muted-foreground">
        {lead.phone && (
          <span className="flex items-center gap-1.5">
            <Phone className="size-3.5 shrink-0" />
            <span className="truncate">{lead.phone}</span>
          </span>
        )}
        {lead.email && (
          <span className="flex items-center gap-1.5">
            <Mail className="size-3.5 shrink-0" />
            <span className="truncate">{lead.email}</span>
          </span>
        )}
        {!lead.phone && !lead.email && <span>—</span>}
      </div>

      {/* tags */}
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="outline" className={originClassName}>
          {originLabel}
        </Badge>
        {tags.slice(0, 2).map((tag) => (
          <Badge key={tag.id} variant="secondary">
            {tag.name}
          </Badge>
        ))}
        {tags.length > 2 && (
          <Badge variant="outline" className="text-muted-foreground">
            +{tags.length - 2}
          </Badge>
        )}
        {metrics?.segment && (
          <Badge variant="outline" className="gap-1.5 text-muted-foreground">
            <span className="size-1.5 rounded-full bg-success" />
            {metrics.segment}
          </Badge>
        )}
      </div>

      {/* negócios */}
      <div>
        {deals.length > 0 ? (
          <div className="flex flex-col items-start gap-1.5">
            {deals.map((deal) => (
              <span
                key={deal.id}
                className={cn(
                  "inline-flex max-w-full items-center gap-2 rounded-md border px-2.5 py-0.5 text-[12.5px]",
                  deal.won
                    ? "border-success/45 bg-success/10"
                    : "border-border bg-muted/70",
                )}
              >
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ background: deal.funnelColor }}
                />
                <span className="truncate">{deal.title}</span>
                <span className="text-muted-foreground">
                  {deal.won ? "vendido" : deal.stageName.toLowerCase()}
                </span>
                <span className={cn("font-semibold tabular-nums", deal.won && "text-success")}>
                  {formatBRL(deal.value)}
                </span>
              </span>
            ))}
          </div>
        ) : (
          <span className="inline-block rounded-md border border-dashed border-border px-2.5 py-0.5 text-[12.5px] text-muted-foreground">
            sem negócio
          </span>
        )}
      </div>

      {/* dados de carteira */}
      <div className="flex items-center gap-[18px]">
        <div className="flex min-w-[84px] flex-col items-start gap-px">
          <span className="text-[10.5px] leading-tight text-muted-foreground">Total</span>
          <span
            className={cn(
              "text-sm font-semibold tabular-nums tracking-[-0.01em]",
              !lifetimeValue && "text-muted-foreground",
            )}
          >
            {formatBRL(lifetimeValue, 2)}
          </span>
        </div>

        <div className="flex flex-col items-center gap-px">
          <CountRing value={orderCount} />
          <span className="text-[10.5px] leading-tight text-muted-foreground">Compras</span>
        </div>

        <DataItem
          value={cycleDays ? `${cycleDays}d` : "0d"}
          label="Ciclo de compra"
          tone={cycleDays ? undefined : "muted"}
        />

        <span className="h-[30px] w-px bg-border" />

        <DataItem
          value={sinceLast === null ? "0d" : `${sinceLast}d`}
          label="Última compra"
          tone={sinceLast === null ? "muted" : sinceLast > 60 ? "danger" : undefined}
        />
      </div>

      {/* dono da conta */}
      <div>
        {owner ? (
          <Badge variant="secondary">{owner.split(" ")[0]}</Badge>
        ) : (
          <span className="inline-block rounded-full border border-dashed border-border px-2.5 py-0.5 text-[12.5px] text-muted-foreground">
            sem dono
          </span>
        )}
      </div>

      {/* criado em */}
      <span className="text-[13px] tabular-nums text-muted-foreground">{createdLabel}</span>

      {/* ações */}
      <div onClick={(e) => e.stopPropagation()}>{actions}</div>
    </div>
  );
}
