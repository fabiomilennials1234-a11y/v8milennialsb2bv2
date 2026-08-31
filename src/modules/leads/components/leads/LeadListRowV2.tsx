import type { ReactNode } from "react";
import { Phone, Mail } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { LeadEtiquetasPopover } from "../etiquetas/LeadEtiquetasPopover";
import {
  LeadAvatar,
  RelacaoCell,
  SituacaoCell,
  SortableLabel,
  type LeadListItem,
  type LeadTagRef,
  type LeadDealRef,
} from "./LeadListRow";
import type { LeadListSort, LeadSortKey } from "../../lib/lead-list-sort";
import type { LeadStanding } from "../../lib/lead-relacao-situacao";
import type { LeadCarteiraMetrics } from "../../hooks/useLeadsCarteiraMetrics";

/**
 * Lista de leads — versão "Depois".
 *
 * A versão anterior desenha cada lead como um cartão solto: borda, sombra,
 * raio e 10px de ar entre um e outro. Em 50 linhas isso vira 50 caixas — o
 * olho lê moldura, não dado. Aqui a lista é uma **tabela** no sentido Stripe:
 * um contêiner só, cabeçalho preso no topo, linhas separadas por hairline,
 * hover como superfície e não como elevação. A densidade sobe (~56px por
 * linha contra ~80px) sem apertar a tipografia.
 *
 * As colunas, a grade, a ordenação e a seleção são as MESMAS do `LeadListRow`
 * — só a pele muda. Se a grade divergir, o cabeçalho e a linha desencontram.
 */
const GRID_COLS =
  // Situação e Negócios em duas linhas pedem menos largura que a versão de
  // uma linha — a sobra vai pra Nome e Tags, que são as que truncam.
  "grid items-center gap-x-4 grid-cols-[34px_minmax(220px,1.6fr)_minmax(150px,0.9fr)_minmax(150px,1.1fr)_minmax(84px,0.45fr)_minmax(140px,0.9fr)_minmax(170px,1.2fr)_minmax(104px,0.7fr)_minmax(96px,0.6fr)_40px]";

/** Acima disso a coluna Negócios vira lista e a linha deixa de ser linha. */
const MAX_DEALS_VISIVEIS = 2;

/**
 * "hoje" · "ontem" · "há 3 dias" · "há 2 sem." · "há 4 meses" · null (>1 ano —
 * aí a data absoluta diz mais). O corte de dia é o do navegador; a data exata
 * fica no `title` cortada no fuso da org, como o resto da página.
 */
function relativeDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const dias = Math.floor((Date.now() - t) / 86_400_000);
  if (dias < 0) return null;
  if (dias === 0) return "hoje";
  if (dias === 1) return "ontem";
  if (dias < 14) return `há ${dias} dias`;
  if (dias < 60) return `há ${Math.floor(dias / 7)} sem.`;
  if (dias < 365) return `há ${Math.floor(dias / 30)} meses`;
  return null;
}

/**
 * A cor da origem chega como classe de badge ("bg-x/10 text-x border-x/20").
 * Na linha do nome só a tinta interessa — extrai o `text-*`.
 */
function originTextClass(badgeClass: string): string {
  return badgeClass.split(/\s+/).filter((c) => c.startsWith("text-")).join(" ") || "text-muted-foreground";
}

export function LeadListHeaderV2({
  selectAll,
  sort,
  onSortChange,
}: {
  selectAll?: ReactNode;
  sort?: LeadListSort;
  onSortChange?: (key: LeadSortKey) => void;
}) {
  const sortable = (label: string, column: LeadSortKey) =>
    onSortChange ? (
      <SortableLabel label={label} column={column} sort={sort} onSortChange={onSortChange} />
    ) : (
      <span>{label}</span>
    );

  return (
    <div
      className={cn(
        GRID_COLS,
        "sticky top-0 z-10 h-10 border-b border-border bg-card/95 px-4 backdrop-blur",
        "text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground",
      )}
    >
      <span>{selectAll}</span>
      {sortable("Nome", "name")}
      <span>Contatos</span>
      <span>Tags</span>
      <span>Relação</span>
      <span>Situação</span>
      <span>Negócios</span>
      <span>Dono da conta</span>
      {sortable("Criado em", "created_at")}
      <span />
    </div>
  );
}

interface LeadListRowV2Props {
  lead: LeadListItem;
  metrics?: LeadCarteiraMetrics;
  deals?: LeadDealRef[];
  standing?: LeadStanding;
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  createdLabel: string;
  originLabel: string;
  originClassName: string;
  actions?: ReactNode;
}

export function LeadListRowV2({
  lead,
  metrics,
  deals = [],
  standing,
  selected,
  onToggleSelect,
  onOpen,
  createdLabel,
  originLabel,
  originClassName,
  actions,
}: LeadListRowV2Props) {
  const tags = (lead.lead_tags ?? []).map((t) => t.tag).filter((t): t is LeadTagRef => Boolean(t));
  const owner =
    lead.sale_responsible?.name ?? lead.pre_sale_responsible?.name ?? lead.responsible?.name ?? null;
  const avgTicket = metrics?.avgTicket ?? 0;

  const ganhos = deals.filter((d) => d.outcome === "won");
  const emAndamento = deals.filter((d) => d.outcome !== "won");
  const valorGanho = ganhos.reduce((soma, d) => soma + d.value, 0);

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
      aria-selected={selected}
      className={cn(
        GRID_COLS,
        "group relative min-h-[56px] cursor-pointer border-b border-border/70 px-4 py-2.5 last:border-b-0",
        "transition-[background-color] duration-100 ease-[cubic-bezier(0.2,0,0,1)] hover:bg-muted/40",
        "focus-visible:outline-none focus-visible:bg-muted/40 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
        selected && "bg-primary/[0.06] hover:bg-primary/[0.09]",
      )}
    >
      {/* trilho de seleção — a cor vai só onde há sinal */}
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-y-0 left-0 w-0.5 bg-primary transition-opacity duration-100",
          selected ? "opacity-100" : "opacity-0",
        )}
      />

      <div onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={selected} onCheckedChange={onToggleSelect} aria-label={`Selecionar ${lead.name}`} />
      </div>

      {/* nome — empresa e origem na segunda linha. A origem saiu da coluna Tags:
          lá ela competia com etiqueta, segmento e botão, e virava sopa de badge. */}
      <div className="flex min-w-0 items-center gap-3">
        <LeadAvatar name={lead.name} size="sm" />
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[13.5px] font-semibold tracking-[-0.01em] text-foreground">{lead.name}</p>
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            {lead.company && <span className="truncate">{lead.company}</span>}
            {lead.company && <span aria-hidden="true" className="shrink-0 opacity-50">·</span>}
            <span className={cn("shrink-0 inline-flex items-center gap-1", originTextClass(originClassName))}>
              <span className="size-1.5 rounded-full bg-current opacity-80" />
              {originLabel}
            </span>
            {avgTicket > 0 && (
              <>
                <span aria-hidden="true" className="shrink-0 opacity-50">·</span>
                <span className="shrink-0 font-medium tabular-nums text-success">{formatBRL(avgTicket, 0)}</span>
              </>
            )}
          </p>
        </div>
      </div>

      {/* contatos */}
      <div className="flex min-w-0 flex-col gap-0.5 text-[12.5px] text-muted-foreground">
        {lead.phone && (
          <span className="flex items-center gap-1.5">
            <Phone className="size-3 shrink-0 opacity-70" />
            <span className="truncate tabular-nums">{lead.phone}</span>
          </span>
        )}
        {lead.email && (
          <span className="flex items-center gap-1.5">
            <Mail className="size-3 shrink-0 opacity-70" />
            <span className="truncate">{lead.email}</span>
          </span>
        )}
        {!lead.phone && !lead.email && <span className="text-muted-foreground/60">—</span>}
      </div>

      {/* tags — só etiquetas; origem foi pra linha do nome */}
      <div className="flex flex-wrap items-center gap-1">
        {tags.slice(0, 2).map((tag) => (
          <Badge key={tag.id} variant="secondary" className="h-5 px-1.5 text-[11px] font-medium">
            {tag.name}
          </Badge>
        ))}
        {tags.length > 2 && (
          <Badge variant="outline" className="h-5 px-1.5 text-[11px] text-muted-foreground">
            +{tags.length - 2}
          </Badge>
        )}
        <LeadEtiquetasPopover leadId={lead.id} quantidade={tags.length} rotulo={tags.length ? undefined : "etiqueta"} />
        {metrics?.segment && (
          <Badge variant="outline" className="h-5 gap-1 px-1.5 text-[11px] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-success" />
            {metrics.segment}
          </Badge>
        )}
      </div>

      <div>
        <RelacaoCell standing={standing} />
      </div>

      {/* situação — duas linhas, como Contatos: o que está acontecendo / onde */}
      <div className="min-w-0 leading-tight">
        {standing?.emNegociacao ? (
          <>
            <p className="truncate text-[13px] text-foreground/90">Em negociação</p>
            {standing.maisAvancado && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ background: standing.maisAvancado.funnelColor ?? "hsl(var(--muted-foreground))" }}
                />
                <span className="truncate" title={standing.maisAvancado.funnelName}>
                  {standing.maisAvancado.funnelName}
                </span>
              </p>
            )}
          </>
        ) : (
          <SituacaoCell standing={standing} />
        )}
      </div>

      {/* negócios — duas linhas por negócio: título / etapa · valor */}
      <div className="min-w-0 leading-tight">
        {deals.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {emAndamento.slice(0, MAX_DEALS_VISIVEIS).map((deal) => (
              <div key={deal.id} className="min-w-0">
                <p className="truncate text-[13px] text-foreground/90" title={deal.title}>
                  {deal.title}
                </p>
                <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="size-1.5 shrink-0 rounded-full" style={{ background: deal.funnelColor }} />
                  <span className={cn("truncate", deal.outcome === "lost" && "text-destructive/80")}>
                    {deal.stageName}
                  </span>
                  {deal.value > 0 && (
                    <span className="shrink-0 font-medium tabular-nums text-foreground/80">· {formatBRL(deal.value)}</span>
                  )}
                </p>
              </div>
            ))}
            {emAndamento.length > MAX_DEALS_VISIVEIS && (
              <p className="text-xs text-muted-foreground">
                +{emAndamento.length - MAX_DEALS_VISIVEIS} em andamento
              </p>
            )}
            {ganhos.length > 0 && emAndamento.length < MAX_DEALS_VISIVEIS && (
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-success">
                  Negócio fechado{ganhos.length > 1 && <span className="tabular-nums text-success/70"> ×{ganhos.length}</span>}
                </p>
                {valorGanho > 0 && (
                  <p className="text-xs tabular-nums text-muted-foreground">{formatBRL(valorGanho)}</p>
                )}
              </div>
            )}
            {ganhos.length > 0 && emAndamento.length >= MAX_DEALS_VISIVEIS && (
              <p className="text-xs font-medium text-success">
                {ganhos.length} fechado{ganhos.length > 1 ? "s" : ""}
                {valorGanho > 0 && <span className="tabular-nums text-success/70"> · {formatBRL(valorGanho)}</span>}
              </p>
            )}
          </div>
        ) : (
          <span className="inline-block rounded-md border border-dashed border-border px-2 py-px text-[12px] text-muted-foreground">
            sem negócio
          </span>
        )}
      </div>

      {/* dono */}
      <div>
        {owner ? (
          <span className="inline-flex items-center gap-1.5 text-[12.5px] text-foreground/90">
            <span className="size-1.5 rounded-full bg-success" />
            {owner.split(" ")[0]}
          </span>
        ) : (
          <span className="inline-block rounded-full border border-dashed border-border px-2 py-px text-[12px] text-muted-foreground">
            sem dono
          </span>
        )}
      </div>

      {/* criado em — relativo na lista (o que se lê é recência), absoluto no title */}
      <span className="text-[12.5px] tabular-nums text-muted-foreground" title={`Criado em ${createdLabel}`}>
        {relativeDay(lead.created_at) ?? createdLabel}
      </span>

      <div
        onClick={(e) => e.stopPropagation()}
        className="opacity-60 transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {actions}
      </div>
    </div>
  );
}
