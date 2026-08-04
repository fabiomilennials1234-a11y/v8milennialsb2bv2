import type { ReactNode } from "react";
import { Phone, Mail } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import type { Lead } from "../../hooks/useLeads";
import type { LeadCarteiraMetrics } from "../../hooks/useLeadsCarteiraMetrics";
import type { LeadDeal } from "../../hooks/useLeadsDeals";

/**
 * Linha da lista de leads — cartão solto, não célula de tabela.
 *
 * A aba Leads é a fonte de verdade do lead: identidade, contato, etiquetas,
 * negócios vinculados e números de carteira. O lead **não tem etapa** — quem
 * anda no funil é o Negócio, e a coluna "Negócios" é a única ponte pra lá.
 */

/** Colunas compartilhadas entre cabeçalho e linha — precisam casar. */
const GRID_COLS =
  "grid items-center gap-x-4 grid-cols-[34px_minmax(210px,1.5fr)_minmax(140px,0.9fr)_minmax(140px,1fr)_minmax(200px,1.4fr)_minmax(104px,0.7fr)_minmax(104px,0.7fr)_40px]";

/**
 * Largura mínima da lista — abaixo disso o contêiner rola no eixo X.
 *
 * Caiu de 1240px para 950px porque o cluster "Dados" saiu daqui (ADR-0024
 * decisão 1): eram 290px de mínimo mais o `gap-x-4` da coluna. A lista passa a
 * caber sem rolagem horizontal em telas que antes rolavam.
 */
export const LEAD_LIST_MIN_WIDTH = "min-w-[950px]";

export interface LeadTagRef {
  id: string;
  name: string;
  color?: string | null;
}

/**
 * Um negócio vinculado ao lead. A fonte é `useLeadsDeals`, que lê
 * `pipeline_entries` — card de funil **é** o negócio enquanto `deals` não está
 * acesa (decisão D1). Alias mantido para os call sites antigos.
 */
export type LeadDealRef = LeadDeal;

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

// `CountRing` e `DataItem` saíram junto com o cluster "Dados" (ADR-0024 §1).

export function LeadListHeader({ selectAll }: { selectAll?: ReactNode }) {
  return (
    <div className={cn(GRID_COLS, "px-[18px] pb-2.5 text-[13px] font-medium text-muted-foreground")}>
      <span>{selectAll}</span>
      <span>Nome</span>
      <span>Contatos</span>
      <span>Tags</span>
      <span>Negócios</span>
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

  // `metrics` continua chegando por causa do ticket médio (na coluna Negócios) e
  // do selo de `segment`. Total, nº de compras, ciclo e última compra saíram com
  // o cluster "Dados" para o drawer — ADR-0024 decisão 1.
  const avgTicket = metrics?.avgTicket ?? 0;

  // Coluna "Negócios": fechado colapsa, em andamento continua detalhado.
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
            {/* Só negócio EM ANDAMENTO mostra funil e etapa — é a informação
                acionável: onde ele está e há quanto tempo. */}
            {emAndamento.map((deal) => (
              <span
                key={deal.id}
                className={cn(
                  "inline-flex max-w-full items-center gap-2 rounded-md border px-2.5 py-0.5 text-[12.5px]",
                  deal.outcome === "lost" && "border-destructive/35 bg-destructive/5",
                  deal.outcome === "open" && "border-border bg-muted/70",
                )}
              >
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ background: deal.funnelColor }}
                />
                <span className="truncate">{deal.title}</span>
                <span
                  className={cn(
                    "truncate text-muted-foreground",
                    deal.outcome === "lost" && "text-destructive/80",
                  )}
                >
                  {deal.stageName.toLowerCase()}
                </span>
                {/* Valor só aparece quando existe — a maioria dos negócios de
                    qualificação não tem `sale_value`, e "R$ 0,00" em toda linha
                    vira ruído que esconde o número que importa. */}
                {deal.value > 0 && (
                  <span className="font-semibold tabular-nums">{formatBRL(deal.value)}</span>
                )}
              </span>
            ))}

            {/* Fechados colapsam num chip só, no lugar onde as etapas ficavam.
                Um lead atravessa vários funis na mesma venda, então manter um
                chip por funil depois de fechar empilharia a coluna inteira — e
                dobraria a cada negócio novo que abrisse. O que importa depois
                de fechar é que fechou e por quanto, não por onde passou. */}
            {ganhos.length > 0 && (
              <span className="inline-flex max-w-full items-center gap-2 rounded-md border border-success/45 bg-success/10 px-2.5 py-0.5 text-[12.5px]">
                <span className="size-1.5 shrink-0 rounded-full bg-success" />
                {/* Sem `truncate`: o rótulo é curto e fixo, ao contrário do
                    nome de funil. Cortado ("2 negócios fe…") ele deixa de
                    dizer o que é, que é a única função dele. */}
                <span className="shrink-0 font-medium text-success">Negócio fechado</span>
                {ganhos.length > 1 && (
                  <span className="shrink-0 tabular-nums text-success/70">×{ganhos.length}</span>
                )}
                {valorGanho > 0 && (
                  <span className="font-semibold tabular-nums text-success">
                    {formatBRL(valorGanho)}
                  </span>
                )}
              </span>
            )}
          </div>
        ) : (
          <span className="inline-block rounded-md border border-dashed border-border px-2.5 py-0.5 text-[12.5px] text-muted-foreground">
            sem negócio
          </span>
        )}
      </div>

      {/* O cluster "Dados" (total, compras, ciclo, última compra) saiu daqui e
          vive no drawer — ADR-0024 decisão 1. Medido em prod 2026-08-04: de
          35.165 leads vivos, só 1.018 tinham algo a mostrar. A coluna estava
          vazia 97,1% do tempo e era a mais larga da lista, com 290px.
          Restringir às orgs com ERP foi descartado pelo mesmo dado: a org mais
          preenchida da base é a Basic4u, com 23,7%. */}

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
