import type { ReactNode } from "react";
import { Mail, UserRound } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { LeadEtiquetasPopover } from "../etiquetas/LeadEtiquetasPopover";
import type { CicloDeRecompra } from "../../lib/reorder-cycle";
import { erpLabel } from "@/shared/format/erp-code";
import { nomesDosDonos, resolveLeadOwners } from "../../lib/lead-owners";
import { QUALIFICATION_TIER_CONFIG } from "../lead-detail/modal/qualification-config";
import type { QualificationTier } from "../lead-detail/modal/types";
import {
  LeadAvatar,
  SortableLabel,
  type LeadListItem,
  type LeadTagRef,
  type LeadDealRef,
} from "./LeadListRow";
import type { LeadListSort, LeadSortKey } from "../../lib/lead-list-sort";
import type { LeadStanding } from "../../lib/lead-relacao-situacao";
import type { LeadCarteiraMetrics } from "../../hooks/useLeadsCarteiraMetrics";

/**
 * Lista de leads — V5, na composição do mockup: **uma linha por lead**.
 *
 * Cada coluna cabe numa linha só e diz uma coisa: contatos viram dois ícones
 * (o número e o e-mail no `title`), Situação é relação + qualificação em
 * pílula, Negócios é contagem + a etapa do negócio aberto mais avançado +
 * valor, Recompra é a data esperada + o ciclo, Dono é o avatar. A versão
 * anterior empilhava até três negócios e duas tags por linha — a lista virava
 * colunas de alturas diferentes e o olho perdia a fileira.
 *
 * Nada aqui é dado novo: tudo sai dos mesmos lotes que a página já carrega
 * (`useLeadsDeals`, `useLeadsReorderCycle`, `deriveLeadStandings`).
 */
const GRID_COLS =
  // Sem rolagem lateral: mínimos + gaps ≈ 1.000 px; o resto é fr com truncate.
  "grid items-center gap-x-3 grid-cols-[24px_minmax(170px,1.25fr)_72px_minmax(150px,1.05fr)_minmax(120px,0.85fr)_minmax(190px,1.35fr)_minmax(76px,0.5fr)_32px_44px_32px]";

/** "hoje" · "ontem" · "há 3 dias" · "há 2 sem." · "há 4 meses" — vai no `title`. */
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
 * "dd/mm/aaaa" (já no fuso da org) → "dd/mm" no ano corrente, "dd/mm/aa" fora
 * dele. A data exata segue inteira no `title`.
 */
function shortDay(label: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(label);
  if (!m) return label;
  return m[3] === String(new Date().getFullYear()) ? `${m[1]}/${m[2]}` : `${m[1]}/${m[2]}/${m[3].slice(2)}`;
}

/** A cor da origem chega como classe de badge — na linha só a tinta interessa. */
function originTextClass(badgeClass: string): string {
  return badgeClass.split(/\s+/).filter((c) => c.startsWith("text-")).join(" ") || "text-muted-foreground";
}

const brlCompact = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});

/** "R$ 48 mil" — a coluna é estreita; o valor exato vai no `title`. */
function compactBRL(value: number): string {
  return value >= 10_000 ? brlCompact.format(value) : formatBRL(value);
}

/** Pílula 22 px do mockup (`.pill`). */
const PILL = "inline-flex h-[22px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-[11px] font-bold";

/** O glifo do WhatsApp — o telefone do lead é o número de WhatsApp. */
function WhatsAppGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.08-.3-.15-1.26-.46-2.39-1.48-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.88 1.21 3.07.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.7.63.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2-1.41.25-.7.25-1.29.18-1.41-.08-.13-.28-.2-.57-.35m-5.42 7.4h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.89-9.88 2.64 0 5.12 1.03 6.99 2.9a9.82 9.82 0 0 1 2.89 6.99c0 5.45-4.44 9.88-9.88 9.88m8.41-18.3A11.82 11.82 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.68 1.45h.01c6.55 0 11.89-5.34 11.89-11.89 0-3.18-1.24-6.17-3.48-8.41z" />
    </svg>
  );
}

/** Ícone de contato 28 px: vivo quando há o dado, apagado quando falta. */
function ContactIcon({ present, label, children, tone }: { present: boolean; label: string; children: ReactNode; tone?: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-[9px] border border-input bg-card shadow-relevo",
        present ? tone ?? "text-foreground/70" : "text-muted-foreground/40 shadow-none",
      )}
    >
      {children}
    </span>
  );
}

/** Recompra em texto: data esperada + ciclo, ou o atraso. */
function RecompraCell({ ciclo }: { ciclo?: CicloDeRecompra }) {
  if (!ciclo || ciclo.estado === "sem-compra") {
    return <span className="text-[13px] text-muted-foreground/60" title="Sem compra registrada">—</span>;
  }
  if (ciclo.estado === "uma-compra" || ciclo.mediaDias == null || ciclo.diasRestantes == null) {
    return (
      <span
        className="text-[11px] text-muted-foreground"
        title="Uma compra registrada — ainda não há intervalo para calcular o ciclo"
      >
        1 compra
      </span>
    );
  }
  const atrasada = ciclo.diasRestantes < 0;
  const esperada = new Date(Date.now() + ciclo.diasRestantes * 86_400_000);
  const data = esperada.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const titulo = `Recompra a cada ${ciclo.mediaDias} dias · última há ${ciclo.diasDesdeUltima} dias`;
  return (
    <div className="min-w-0 leading-tight" title={titulo}>
      <p
        className={cn(
          "truncate text-[12.5px] font-semibold tabular-nums",
          atrasada ? "text-destructive" : ciclo.emEpoca ? "text-success-strong" : "text-foreground",
        )}
      >
        {atrasada ? `atrasada ${Math.abs(ciclo.diasRestantes)} d` : data}
      </p>
      <p className="truncate text-[11px] tabular-nums text-muted-foreground">ciclo {ciclo.mediaDias} dias</p>
    </div>
  );
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
        "sticky top-0 z-10 h-11 border-b border-border bg-card/95 px-4 backdrop-blur [&_button]:uppercase",
        "text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground",
      )}
    >
      <span>{selectAll}</span>
      {sortable("Nome", "name")}
      <span>Contatos</span>
      <span>Tags</span>
      <span>Situação</span>
      <span>Negócios</span>
      <span>Recompra</span>
      <span>Dono</span>
      {sortable("Criado", "created_at")}
      <span aria-hidden="true" />
    </div>
  );
}

interface LeadListRowV2Props {
  lead: LeadListItem;
  metrics?: LeadCarteiraMetrics;
  deals?: LeadDealRef[];
  standing?: LeadStanding;
  /** No piloto, Cliente comprova cadastro, não necessariamente compra. */
  relacaoPorCadastroErp?: boolean;
  /** Tempo médio de recompra — ver `lib/reorder-cycle`. */
  ciclo?: CicloDeRecompra;
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  createdLabel: string;
  originLabel: string;
  originClassName: string;
  /** Menu contextual da linha (Editar, Classificação e Excluir). */
  actions?: ReactNode;
}

export function LeadListRowV2({
  lead,
  metrics,
  deals = [],
  standing,
  relacaoPorCadastroErp,
  ciclo,
  selected,
  onToggleSelect,
  onOpen,
  createdLabel,
  originLabel,
  originClassName,
  actions,
}: LeadListRowV2Props) {
  const tags = (lead.lead_tags ?? []).map((t) => t.tag).filter((t): t is LeadTagRef => Boolean(t));
  // Sem o embed (org sem N donos) é o dono único de sempre: venda → pré-venda → responsável.
  const owners = resolveLeadOwners(lead);
  const owner = owners[0]?.name ?? null;
  const avgTicket = metrics?.avgTicket ?? 0;
  const tier = (lead.qualification_tier ?? null) as QualificationTier | null;
  const tierCfg = tier ? QUALIFICATION_TIER_CONFIG[tier] : null;

  // Negócio em destaque: o aberto mais avançado; sem aberto, o último ganho;
  // só perdidos, o perdido. A contagem ao lado diz que há outros.
  const ganhos = deals.filter((d) => d.outcome === "won");
  const destaque = standing?.maisAvancado ?? ganhos[0] ?? deals[0] ?? null;
  const relativo = relativeDay(lead.created_at);

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
        "group relative h-[57px] cursor-pointer border-b border-border/70 px-4 last:border-b-0",
        "transition-[background-color] duration-100 ease-standard hover:bg-muted/40",
        "focus-visible:outline-none focus-visible:bg-muted/40 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
        // Época de recompra: a linha esverdeia (decisão do CTO) — quem varre a
        // lista procurando quem ligar enxerga a faixa.
        ciclo?.emEpoca && "bg-success/[0.05] hover:bg-success/[0.08]",
        selected && "bg-primary-soft/60 hover:bg-primary-soft",
      )}
    >
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

      {/* nome — empresa e origem na segunda linha */}
      <div className="flex min-w-0 items-center gap-2.5">
        <LeadAvatar name={lead.name} size="sm" />
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[13px] font-bold tracking-[-0.01em] text-foreground">{erpLabel(lead)}</p>
          <p className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
            {lead.company && <span className="truncate">{lead.company}</span>}
            {lead.company && <span aria-hidden="true" className="shrink-0 opacity-50">·</span>}
            <span className={cn("shrink-0", originTextClass(originClassName))}>{originLabel}</span>
            {avgTicket > 0 && (
              <>
                <span aria-hidden="true" className="shrink-0 opacity-50">·</span>
                <span className="shrink-0 font-medium tabular-nums text-success-strong" title="Ticket médio">
                  {formatBRL(avgTicket, 0)}
                </span>
              </>
            )}
          </p>
        </div>
      </div>

      {/* contatos — o dado mora no title; a linha abre o lead */}
      <div className="flex items-center gap-1">
        <ContactIcon
          present={!!lead.phone}
          label={lead.phone ? `WhatsApp: ${lead.phone}` : "Sem telefone"}
          tone="text-success-strong"
        >
          <WhatsAppGlyph className="size-3.5" />
        </ContactIcon>
        <ContactIcon present={!!lead.email} label={lead.email ? `E-mail: ${lead.email}` : "Sem e-mail"}>
          <Mail className="size-3.5" aria-hidden />
        </ContactIcon>
      </div>

      {/* tags — até duas em linha; o resto vira "+N" */}
      <div className="relative flex min-w-0 items-center gap-1 overflow-hidden">
        {tags.slice(0, 2).map((tag) => (
          <span
            key={tag.id}
            title={tag.name}
            className="inline-flex h-[22px] min-w-0 max-w-[112px] shrink items-center gap-1.5 rounded-[7px] bg-muted px-2 text-[11px] font-bold text-foreground/75"
          >
            <span
              aria-hidden
              className="size-[7px] shrink-0 rounded-[2px] bg-muted-foreground/50"
              style={tag.color ? { background: tag.color } : undefined}
            />
            <span className="truncate">{tag.name}</span>
          </span>
        ))}
        {tags.length > 2 && (
          <span className={cn(PILL, "bg-muted px-1.5 text-muted-foreground")} title={tags.slice(2).map((t) => t.name).join(", ")}>
            +{tags.length - 2}
          </span>
        )}
        {tags.length < 2 && metrics?.segment && (
          <span className={cn(PILL, "border border-border bg-transparent font-semibold text-muted-foreground")}>
            <span className="size-1.5 rounded-full bg-success" />
            {metrics.segment}
          </span>
        )}
        {/* Com tags, a porta de editar só aparece no hover — por cima, sem
            roubar largura das tags. Sem tags, ela é o conteúdo da célula. */}
        <LeadEtiquetasPopover
          leadId={lead.id}
          quantidade={tags.length}
          rotulo={tags.length ? undefined : "etiqueta"}
          className={cn(
            tags.length > 0 &&
              "absolute right-0 top-1/2 h-[22px] -translate-y-1/2 border-solid bg-card px-2 opacity-0 shadow-relevo transition-opacity group-hover:opacity-100 focus-visible:opacity-100",
          )}
        />
      </div>

      {/* situação — relação (só quando diz algo) + qualificação */}
      <div className="flex min-w-0 items-center gap-1 overflow-hidden">
        {standing?.relacao === "cliente" && (
          <span
            className={cn(PILL, "bg-success/10 text-success-strong")}
            title={
              relacaoPorCadastroErp
                ? "Cadastrado no ERP"
                : standing.prova === "ambas"
                  ? "Comprou pelo funil e tem pedido no ERP"
                  : standing.prova === "erp"
                    ? "Tem pedido no ERP"
                    : "Fechou negócio no funil"
            }
          >
            Cliente
          </span>
        )}
        {standing?.relacao === "perdido" && (
          <span className={cn(PILL, "bg-destructive/10 text-destructive")}>Perdido</span>
        )}
        {tierCfg ? (
          <span className={cn(PILL, "min-w-0 shrink", tierCfg.bgClass, tierCfg.colorClass)} title={`Qualificação: ${tierCfg.label}`}>
            <tierCfg.icon className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{tierCfg.label}</span>
          </span>
        ) : (
          standing?.relacao !== "cliente" &&
          standing?.relacao !== "perdido" && <span className="text-[13px] text-muted-foreground/60">—</span>
        )}
      </div>

      {/* negócios — contagem + etapa do negócio em destaque + valor */}
      <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
        {destaque ? (
          <>
            <span
              className="inline-grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-muted px-1.5 text-[10.5px] font-extrabold tabular-nums text-foreground"
              title={`${deals.length} ${deals.length === 1 ? "negócio" : "negócios"}`}
            >
              {deals.length}
            </span>
            <span
              className={cn(
                PILL,
                "min-w-0 shrink",
                destaque.outcome === "won"
                  ? "bg-success/10 text-success-strong"
                  : destaque.outcome === "lost"
                    ? "bg-destructive/10 text-destructive"
                    : "bg-muted text-foreground/80",
              )}
              title={destaque.funnelName ? `${destaque.funnelName} · ${destaque.stageName}` : destaque.stageName}
            >
              <span
                aria-hidden
                className="size-1.5 shrink-0 rounded-full"
                style={destaque.outcome === "open" ? { background: destaque.funnelColor } : { background: "currentColor" }}
              />
              <span className="truncate">{destaque.stageName}</span>
            </span>
            {destaque.value > 0 && (
              <b className="shrink-0 text-[12.5px] font-bold tabular-nums text-foreground" title={formatBRL(destaque.value)}>
                {compactBRL(destaque.value)}
              </b>
            )}
          </>
        ) : (
          <span className="text-[12px] text-muted-foreground/70">sem negócio</span>
        )}
      </div>

      <RecompraCell ciclo={ciclo} />

      {/* dono — só o avatar; o nome no title */}
      <div>
        {owners.length > 1 ? (
          <div
            title={nomesDosDonos(owners)}
            aria-label={`Donos: ${nomesDosDonos(owners)}`}
            role="img"
            className="flex w-fit items-center -space-x-2"
          >
            {owners.slice(0, 2).map((o) => (
              <div key={o.id} className="rounded-full ring-2 ring-card">
                <LeadAvatar name={o.name} size="xs" />
              </div>
            ))}
            {owners.length > 2 && (
              <span className="grid size-7 place-items-center rounded-full bg-muted text-[11px] font-semibold tabular-nums text-muted-foreground ring-2 ring-card">
                +{owners.length - 2}
              </span>
            )}
          </div>
        ) : owner ? (
          <div title={owner} aria-label={`Dono: ${owner}`} role="img" className="w-fit">
            <LeadAvatar name={owner} size="xs" />
          </div>
        ) : (
          <span
            role="img"
            aria-label="Sem dono"
            title="Sem dono"
            className="grid size-7 place-items-center rounded-full border border-dashed border-border text-muted-foreground/60"
          >
            <UserRound className="size-3.5" aria-hidden />
          </span>
        )}
      </div>

      <span
        className="text-[12px] tabular-nums text-muted-foreground"
        title={`Criado em ${createdLabel}${relativo ? ` · ${relativo}` : ""}`}
      >
        {shortDay(createdLabel)}
      </span>

      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        className="opacity-70 transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {actions}
      </div>
    </div>
  );
}
