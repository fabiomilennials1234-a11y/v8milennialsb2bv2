import { memo, type ReactNode } from "react";
import { Building2, Check, Clock, MoreVertical } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
// `Strict` e não `formatDistanceToNow`: a versão frouxa devolve "há cerca de
// 4 horas", e o "cerca de" sozinho estoura a linha dos badges — o card passa
// a ter 112px em vez de 98px. O protótipo escreve "há 2 horas".
import { formatDistanceToNowStrict } from "date-fns";
import { ptBR } from "date-fns/locale";
import { formatFaturamento } from "@/lib/format/faturamento";

/**
 * Card compacto do funil — a tradução 1:1 do `.cd` do protótipo
 * `.specs/mockups/funis-redesign/` (styles.css:383-457, app.js:220-323).
 *
 * O card confortável empilha seis blocos e mede ~250px, então cabem duas
 * fichas por coluna. Aqui o MESMO conteúdo vira três linhas de ~100px:
 *
 *   1. nome + empresa · avatares dos responsáveis · menu
 *   2. marcadores de tag · origem · potencial · tempo parado · idade
 *   3. telefone · valor
 *
 * O que economiza altura não é cortar informação, é parar de dar linha
 * própria a cada dado: os avatares sobem pra linha do nome, as tags viram
 * marcador vertical de 3px em vez de tarja horizontal, e o tempo — que era
 * um rodapé inteiro — vira badge.
 *
 * O nome trunca em UMA linha de propósito. Com `line-clamp-2` um nome longo
 * empurra o card pra 115px e a coluna perde uma ficha inteira; a altura do
 * card passa a depender do cadastro, não do layout.
 */

interface Responsavel {
  name: string | null;
  avatar_url?: string | null;
}

interface Tag {
  name: string;
  color: string;
}

interface LeadCardCompactProps {
  lead: {
    id: string;
    name: string;
    company?: string | null;
    phone?: string | null;
    email?: string | null;
    rating?: number;
    tags?: Tag[] | null;
    value?: number | null;
    faturamento?: string | number | null;
    notes?: string | null;
    /** Rótulo do compromisso ("Reunião", "Entrega"). Prefixa o badge de data. */
    dateLabel?: string | null;
    meetLink?: string | null;
    products?: Array<{ name: string; type?: string; value: number }>;
    createdAt?: string | null;
    stageEnteredAt?: string | null;
    isInactive?: boolean;
    potencial?: string | null;
    preSaleResponsible?: Responsavel | null;
    saleResponsible?: Responsavel | null;
  };
  config: {
    showContact: boolean; showValue: boolean; showDate: boolean;
    showProducts: boolean; showMeetLink: boolean; showNotes: boolean;
  };
  origin: { bg: string; text: string; label: string };
  urgency: { label: string; className: string } | null;
  dateIndicator: { label: string; className: string } | null;
  parsedDate: Date | null;
  selected?: boolean;
  onSelect?: (e: React.MouseEvent) => void;
  onClick?: () => void;
  menuItems: ReactNode;
  /**
   * Slot de domínio (ex.: confirmar reunião no funil mergeado). Continua
   * existindo no compacto — tirar o botão em nome da altura trocaria um
   * problema por outro.
   */
  extraActions?: ReactNode;
}

function iniciais(nome?: string | null): string {
  if (!nome) return "?";
  return nome.split(" ").filter(Boolean).map((n) => n[0]).slice(0, 2).join("").toUpperCase();
}

function corDoNome(nome?: string | null): string {
  if (!nome) return "hsl(0, 0%, 40%)";
  const hash = Array.from(nome).reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return `hsl(${hash % 360}, 60%, 45%)`;
}

function formatCurrency(value: number): string {
  if (value >= 1_000_000) {
    return `R$ ${(value / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}M`;
  }
  return new Intl.NumberFormat("pt-BR", {
    style: "currency", currency: "BRL", minimumFractionDigits: 0,
  }).format(value);
}

/**
 * `12/08 · 14:00` — o formato do protótipo. Ano fica de fora (compromisso de
 * funil é sempre perto) e a hora só aparece quando existe: data sem hora vem
 * como meia-noite, e "· 00:00" leria como reunião de madrugada.
 */
function formatarCompromisso(d: Date): string {
  const dia = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  if (d.getHours() === 0 && d.getMinutes() === 0) return dia;
  return `${dia} · ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

/** Badge de 16px — o `.bdg` do protótipo. */
function Badge({ children, className, style }: {
  children: ReactNode; className?: string; style?: React.CSSProperties;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[3px] rounded border border-transparent",
        "px-[5px] text-[9px] font-semibold leading-[1.65] tracking-[0.01em]",
        className,
      )}
      style={style}
    >
      {children}
    </span>
  );
}

export const LeadCardCompact = memo(function LeadCardCompact({
  lead, config, origin, urgency, dateIndicator, parsedDate,
  selected, onSelect, onClick, menuItems, extraActions,
}: LeadCardCompactProps) {
  const responsaveis = [lead.preSaleResponsible, lead.saleResponsible].filter(
    (r): r is Responsavel => !!r?.name,
  );

  const diasParado = lead.stageEnteredAt
    ? Math.floor((Date.now() - new Date(lead.stageEnteredAt).getTime()) / 86400000)
    : null;

  const valorExibido = config.showValue
    ? lead.value != null
      ? formatCurrency(lead.value)
      : lead.faturamento
      ? formatFaturamento(lead.faturamento)
      : null
    : null;

  const tags = lead.tags ?? [];
  const tagsVisiveis = tags.slice(0, 3);

  // Linha 3 só existe se houver o que pôr nela.
  const temLinhaInfo = (config.showContact && lead.phone) || valorExibido;

  return (
    <TooltipProvider delayDuration={200}>
      <div
        data-lead-id={lead.id}
        onClick={onClick}
        className={cn(
          // `p-0` anula o `p-4` que `.kanban-card` aplica no CSS global — o
          // recheio aqui é do wrapper interno, 8×10px como no protótipo.
          "kanban-card group relative cursor-pointer p-0",
          "flex flex-col rounded-[10px]",
          lead.isInactive && "opacity-60",
          selected && "ring-2 ring-primary/50",
        )}
      >
        <div className="flex flex-col gap-1.5 px-2.5 py-2">

          {/* ── 1. nome + empresa · avatares · menu ── */}
          <div className="flex items-start gap-2">
            {onSelect && (
              <button
                type="button"
                role="checkbox"
                aria-checked={!!selected}
                aria-label={`Selecionar ${lead.name}`}
                onClick={(e) => { e.stopPropagation(); onSelect(e); }}
                className={cn(
                  // No fluxo, não `absolute`: sobreposto ele cobriria o nome
                  // num card que agora tem 100px, não 250px.
                  "mt-px flex size-[15px] shrink-0 items-center justify-center rounded border transition-all",
                  selected
                    ? "border-primary bg-primary text-primary-foreground opacity-100"
                    : "border-muted-foreground/40 bg-background/80 opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                )}
              >
                {selected && <Check className="size-[9px]" />}
              </button>
            )}

            <div className="min-w-0 flex-1">
              <h4 className="truncate text-[12.5px] font-semibold leading-[1.18] tracking-[-0.012em] transition-colors group-hover:text-primary">
                {lead.name}
              </h4>
              {lead.company && (
                <div className="mt-px flex min-w-0 items-center gap-1 text-[10.5px] leading-[1.3] text-muted-foreground">
                  <Building2 className="size-[10px] shrink-0 opacity-60" />
                  <span className="truncate">{lead.company}</span>
                </div>
              )}
            </div>

            {responsaveis.length > 0 && (
              <div className="flex shrink-0 -space-x-[5px] pt-px">
                {responsaveis.map((r, i) => (
                  <Tooltip key={i}>
                    <TooltipTrigger asChild>
                      <span
                        className="grid size-[17px] place-items-center rounded-full border-[1.5px] border-card text-[7.5px] font-bold text-white"
                        style={{ backgroundColor: corDoNome(r.name) }}
                      >
                        {r.avatar_url
                          ? <img src={r.avatar_url} alt={r.name ?? ""} className="size-full rounded-full object-cover" />
                          : iniciais(r.name)}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-[10px]">{r.name}</TooltipContent>
                  </Tooltip>
                ))}
              </div>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  aria-label={`Ações de ${lead.name}`}
                  className="-mt-px shrink-0 rounded p-px text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <MoreVertical className="size-[14px]" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">{menuItems}</DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* ── 2. marcadores de tag · badges ── */}
          <div className="flex flex-wrap items-center gap-1">
            {tagsVisiveis.length > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="mr-px inline-flex items-center gap-[3px]">
                    {tagsVisiveis.map((t, i) => (
                      <i
                        key={i}
                        aria-hidden
                        className="block h-[13px] w-[3px] rounded-sm"
                        style={{ backgroundColor: t.color || "#888" }}
                      />
                    ))}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-[10px]">
                  {tags.map((t) => t.name).join(" · ")}
                </TooltipContent>
              </Tooltip>
            )}

            <Badge style={{ backgroundColor: origin.bg, color: origin.text, borderColor: `${origin.text}40` }}>
              {origin.label}
            </Badge>

            {/* Como o protótipo devolve o calor ao card: sem a pílula de chama
                de 1 a 10, só o corte que muda a ação de quem lê a coluna. */}
            {lead.rating != null && lead.rating >= 8 && (
              <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-500">Alto potencial</Badge>
            )}

            {urgency && <Badge className={urgency.className}>{urgency.label}</Badge>}

            {lead.potencial && (
              <Badge className="border-primary/25 bg-primary/10 text-primary">
                {lead.potencial.charAt(0).toUpperCase() + lead.potencial.slice(1)}
              </Badge>
            )}

            {lead.isInactive && (
              <Badge className="border-destructive/30 bg-destructive/10 text-destructive">Inativo</Badge>
            )}

            {dateIndicator && <Badge className={dateIndicator.className}>{dateIndicator.label}</Badge>}

            {diasParado != null && diasParado >= 3 && (
              <Badge
                className={cn(
                  diasParado >= 14 ? "border-red-500/30 bg-red-500/10 text-red-500"
                    : diasParado >= 7 ? "border-amber-500/30 bg-amber-500/10 text-amber-500"
                    : "border-blue-500/30 bg-blue-500/10 text-blue-500",
                )}
              >
                {diasParado}d parado
              </Badge>
            )}

            {lead.createdAt && (
              <Badge className="border-muted-foreground/20 bg-muted-foreground/10 font-medium text-muted-foreground">
                <Clock className="size-[9px]" />
                {formatDistanceToNowStrict(new Date(lead.createdAt), { addSuffix: true, locale: ptBR })}
              </Badge>
            )}
          </div>

          {/* ── 3. telefone · valor ── */}
          {temLinhaInfo && (
            <div className="flex items-baseline justify-between gap-2 border-l-2 border-primary/50 pl-2 text-[11px] leading-[1.35]">
              {/* Sem espaçador quando não há telefone: `justify-between` com um
                  filho só empurraria o valor pra direita e deixaria um vão ao
                  lado da barra — nos funis de confirmação e propostas, que não
                  mostram contato, a linha parecia quebrada. */}
              {config.showContact && lead.phone && (
                <span className="truncate tabular-nums text-muted-foreground">{lead.phone}</span>
              )}
              {valorExibido && (
                <span className="shrink-0 font-bold tabular-nums text-emerald-500">{valorExibido}</span>
              )}
            </div>
          )}

          {/* Data da reunião, Meet, produtos e notas viram chips — só aparecem
              nos funis cujo `variant` os liga, e nunca ganham bloco próprio. */}
          {(config.showDate && parsedDate) || (config.showMeetLink && lead.meetLink) ||
           (config.showProducts && lead.products?.length) || (config.showNotes && lead.notes) ? (
            <div className="flex flex-wrap items-center gap-1">
              {config.showDate && parsedDate && (
                <Badge className="border-white/[0.07] bg-white/[0.05] text-muted-foreground">
                  {lead.dateLabel && <b className="font-semibold text-foreground">{lead.dateLabel}</b>}
                  {formatarCompromisso(parsedDate)}
                </Badge>
              )}
              {config.showMeetLink && lead.meetLink && (
                <a
                  href={lead.meetLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-[9px] font-semibold leading-[1.65] text-primary hover:underline"
                >
                  Entrar no Meet
                </a>
              )}
              {config.showProducts && lead.products && lead.products.length > 0 && (
                <Badge className="border-white/[0.07] bg-white/[0.05] text-muted-foreground">
                  {lead.products.length} produto{lead.products.length > 1 ? "s" : ""}
                </Badge>
              )}
              {config.showNotes && lead.notes && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="max-w-full truncate text-[10px] leading-[1.4] text-muted-foreground">
                      {lead.notes}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs text-[10px]">{lead.notes}</TooltipContent>
                </Tooltip>
              )}
            </div>
          ) : null}

          {extraActions}
        </div>
      </div>
    </TooltipProvider>
  );
});
