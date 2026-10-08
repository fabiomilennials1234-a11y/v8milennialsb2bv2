import * as React from "react";
import { ArrowDown, ArrowUp, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Vocabulário de composição do V5 — o "bento".
 *
 *  KpiTile    cartão de número: rótulo, valor grande, ícone tintado, delta e
 *             um pequeno gráfico/conteúdo embaixo (`children`).
 *  InkPanel   o painel-herói em tinta: UM por tela, para o que pede ação agora.
 *  InkRow     linha de lista dentro do InkPanel; a selecionada vira ouro.
 *  FocusCard  o cartão de ouro: o detalhe do item selecionado no InkPanel.
 *  FocusTile  sub-cartão translúcido dentro do FocusCard.
 *
 * Regra de uso: ouro é escasso — um FocusCard por vista, um botão primário
 * por cabeçalho. O resto é cartão branco, tinta e cor semântica.
 */

export type Tone = "gold" | "good" | "warn" | "bad" | "info" | "neutral";

const toneChip: Record<Tone, string> = {
  gold: "bg-primary-soft text-primary-soft-foreground",
  good: "bg-success/10 text-success-strong",
  warn: "bg-warning/15 text-warning-strong",
  bad: "bg-destructive/10 text-destructive",
  info: "bg-insights/10 text-insights",
  neutral: "bg-muted text-foreground/70",
};

const chipSize = {
  /** KpiTile. */
  sm: "h-[30px] w-[30px]",
  /** Título de diálogo, cabeçalho de seção, linha de lista. */
  md: "h-8 w-8",
} as const;

/**
 * O quadradinho tintado com ícone — no KpiTile, no título dos diálogos, nos
 * cabeçalhos de seção. Era copiado à mão em ~25 lugares, cada um com uma
 * variação (`/60` vs `/70`, `rounded-xl` vs `[10px]`, verde que não passava
 * AA). O tom diz o que o ícone significa; ouro só quando é a ação/identidade.
 */
export function IconChip({
  icon: Icon,
  tone = "neutral",
  size = "md",
  className,
  iconClassName,
}: {
  /** Lucide ou qualquer componente que aceite `className`. */
  icon: React.ElementType;
  tone?: Tone;
  size?: keyof typeof chipSize;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <span className={cn("grid shrink-0 place-items-center rounded-[10px]", chipSize[size], toneChip[tone], className)}>
      <Icon className={cn("h-4 w-4", iconClassName)} aria-hidden />
    </span>
  );
}

export function DeltaChip({
  value,
  label,
  invert = false,
  format = (v: number) => `${Math.abs(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`,
  className,
}: {
  value: number;
  label?: React.ReactNode;
  /** Quando cair é bom (tempo de resposta, atrasos). */
  invert?: boolean;
  format?: (v: number) => string;
  className?: string;
}) {
  const good = invert ? value <= 0 : value >= 0;
  const Icon = value >= 0 ? ArrowUp : ArrowDown;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-bold tabular-nums", good ? "text-success-strong" : "text-destructive", className)}>
      <Icon className="h-3 w-3" aria-hidden />
      {format(value)}
      {label && <span className="font-medium text-muted-foreground">{label}</span>}
    </span>
  );
}

interface KpiTileProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  label: React.ReactNode;
  value: React.ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  delta?: number;
  deltaLabel?: React.ReactNode;
  invertDelta?: boolean;
  note?: React.ReactNode;
  loading?: boolean;
}

export const KpiTile = React.forwardRef<HTMLDivElement, KpiTileProps>(
  ({ label, value, icon: Icon, tone = "neutral", delta, deltaLabel, invertDelta, note, loading, children, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex min-w-0 flex-col gap-1.5 rounded-card border border-card-border bg-card p-[18px] text-card-foreground shadow-relevo",
        "transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-relevo-alto motion-reduce:transition-none",
        className,
      )}
      {...props}
    >
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground/80">{label}</span>
        {Icon && <IconChip icon={Icon} tone={tone} size="sm" />}
      </div>
      <div className={cn("text-[1.65rem] font-extrabold leading-[1.05] tracking-[-0.04em] tabular-nums", loading && "animate-pulse text-muted-foreground")}>
        {value}
      </div>
      {typeof delta === "number" ? (
        <DeltaChip value={delta} label={deltaLabel} invert={invertDelta} />
      ) : note ? (
        <span className="truncate text-xs text-muted-foreground">{note}</span>
      ) : null}
      {children && <div className="mt-auto pt-1.5">{children}</div>}
    </div>
  ),
);
KpiTile.displayName = "KpiTile";

/** Pedaço pequeno do valor (centavos, unidade) — fica menor e mais claro. */
export function ValueUnit({ children, className }: { children: React.ReactNode; className?: string }) {
  return <small className={cn("ml-0.5 text-[0.55em] font-bold tracking-normal text-muted-foreground", className)}>{children}</small>;
}

interface InkPanelProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  title?: React.ReactNode;
  count?: React.ReactNode;
  actions?: React.ReactNode;
}

export const InkPanel = React.forwardRef<HTMLElement, InkPanelProps>(
  ({ title, count, actions, children, className, ...props }, ref) => (
    <section
      ref={ref}
      className={cn(
        "min-w-0 rounded-panel border border-tinta-line/60 bg-tinta p-3.5 text-tinta-foreground shadow-relevo-tinta",
        className,
      )}
      {...props}
    >
      {(title || actions) && (
        <div className="flex flex-wrap items-center gap-2 px-1.5 pb-3 pt-1">
          {title && <h2 className="text-base font-bold tracking-tight text-tinta-foreground">{title}</h2>}
          {count != null && (
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-bold text-tinta-foreground">{count}</span>
          )}
          <span className="flex-1" />
          {actions}
        </div>
      )}
      {children}
    </section>
  ),
);
InkPanel.displayName = "InkPanel";

interface InkRowProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
}

/**
 * O herói "fila + foco" do V5: painel de tinta com a lista à esquerda (340 px)
 * e o cartão de ouro do item selecionado à direita. É a composição que o
 * mockup repete em quase toda tela (Comando, Disparos, Automações, Copilot,
 * Carteira, Comissões…) — uma só implementação para todas.
 *
 * No celular o foco vem primeiro e a lista embaixo: quem abre a tela quer o
 * item da vez, não a fila.
 */
export function InkSplit({
  title,
  count,
  actions,
  list,
  detail,
  className,
  listClassName,
}: {
  title?: React.ReactNode;
  count?: React.ReactNode;
  actions?: React.ReactNode;
  /** Linhas — normalmente `<InkRow>`. */
  list: React.ReactNode;
  /** Normalmente `<FocusCard>`; `null` quando não há item selecionado. */
  detail: React.ReactNode;
  className?: string;
  /** Ex.: altura máxima com rolagem própria para filas longas. */
  listClassName?: string;
}) {
  return (
    <InkPanel title={title} count={count} actions={actions} className={className}>
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <div className={cn("order-2 flex min-w-0 flex-col gap-0.5 lg:order-1", listClassName)}>{list}</div>
        <div className="order-1 min-w-0 lg:order-2">{detail}</div>
      </div>
    </InkPanel>
  );
}

export const InkRow = React.forwardRef<HTMLButtonElement, InkRowProps>(
  ({ selected = false, className, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      data-selected={selected}
      aria-pressed={selected}
      className={cn(
        "group flex w-full min-w-0 items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors",
        "hover:bg-white/[.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        "data-[selected=true]:bg-primary data-[selected=true]:text-primary-foreground data-[selected=true]:shadow-brilho-ouro",
        className,
      )}
      {...props}
    />
  ),
);
InkRow.displayName = "InkRow";

export const FocusCard = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex min-w-0 flex-col gap-4 rounded-card bg-primary p-5 text-primary-foreground shadow-brilho-ouro", className)}
      {...props}
    />
  ),
);
FocusCard.displayName = "FocusCard";

export const FocusTile = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("min-w-0 rounded-2xl border border-primary-foreground/10 bg-primary-foreground/[.07] p-3", className)}
      {...props}
    />
  ),
);
FocusTile.displayName = "FocusTile";

/**
 * Fileira de KPIs. No desktop é grade; no celular vira carrossel com snap —
 * três ou quatro cartões empilhados ocupavam a tela inteira antes do conteúdo.
 * O sangramento lateral (`-mx-4 px-4`) casa com o padding do <main> no celular.
 */
const kpiCols = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
  5: "sm:grid-cols-3 lg:grid-cols-5",
} as const;

export function KpiRow({
  cols = 3,
  className,
  children,
}: {
  cols?: keyof typeof kpiCols;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 scrollbar-hide",
        "[&>*]:min-w-[78%] [&>*]:snap-start",
        "sm:mx-0 sm:grid sm:scroll-px-0 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0 sm:[&>*]:min-w-0",
        kpiCols[cols],
        className,
      )}
    >
      {children}
    </div>
  );
}
