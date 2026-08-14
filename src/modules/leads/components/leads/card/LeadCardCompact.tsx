import { memo, type ReactNode } from "react";
import { Check, MessageCircle, MessageSquare, MoreVertical } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatFaturamento } from "@/lib/format/faturamento";
import type { QualificationTier } from "../../lead-detail/modal/types";
import { QUALIFICATION_TIER_CONFIG } from "../../lead-detail/modal/qualification-config";
import { LeadCardChecklistPopover } from "./LeadCardChecklistPopover";

/**
 * Card do negócio no funil.
 *
 * ── O QUE O CARD PROMETE ──────────────────────────────────────────────────
 * Quatro perguntas, nesta ordem: **de quem é**, **quanto vale**, **está
 * atrasado** e **como falo com a pessoa agora**. Tudo que não responde a uma
 * delas foi tirado da face do card — não deletado do produto: mora no card do
 * negócio (um clique) ou nos filtros da barra.
 *
 * ── POR QUE A POLUIÇÃO ANTERIOR EXISTIA ───────────────────────────────────
 * A versão anterior podia empilhar SETE distintivos na mesma linha (origem,
 * alto potencial, urgência, potencial, inativo, indicador de data, dias
 * parado) mais um bloco rotulado "VALOR DA OPORTUNIDADE" em caixa alta. Cada
 * um nasceu de um pedido legítimo e sozinho era defensável; juntos, nenhum
 * era visível. Vinte cards assim numa coluna não têm hierarquia: o olho não
 * tem para onde ir primeiro, então lê tudo — que é o mesmo que não ler nada.
 *
 * A regra que substitui: **no máximo dois sinais de estado por card**, e o
 * card escolhe qual mostrar por severidade (desfecho > atrasado > inativo >
 * parado). Um alarme que toca sempre não é alarme.
 *
 * ── AS DUAS AÇÕES SÃO BOTÃO, O RESTO É ÍCONE ──────────────────────────────
 * Falar por WhatsApp e ligar são o trabalho do vendedor — ganham alvo de
 * clique de verdade no rodapé. Comentários e checklist são leitura: viram
 * ícone com contador, discretos, e só o checklist é clicável (o popover que
 * já existia). O telefone deixou de ser texto: com dois botões que já usam o
 * número, imprimi-lo era ocupar uma linha para repetir o que os botões fazem.
 *
 * ── ONDE CADA DADO FOI PARAR ──────────────────────────────────────────────
 * · origem      → ponto colorido de 6px na linha da empresa (rótulo no title)
 * · etiquetas   → faixa vertical na borda esquerda, uma fatia por etiqueta
 * · qualificação→ glifo do tier à esquerda do nome (mesma paleta do modal)
 * · responsáveis→ avatares no canto superior direito
 * · idade/parado→ um único distintivo, o mais severo
 *
 * ⚠ A qualificação exibida é a do LEAD (`leads.qualification_tier`), não a do
 * NEGÓCIO (`deals.qualification_tier`). Não é escolha de design: a RPC
 * `get_pipeline_page`, que alimenta o kanban, não devolve nada de `deals` —
 * conferido no schema em 14/08/2026. Quando ela passar a devolver, troca-se a
 * origem do campo e o card não muda de forma.
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
    /** Texto já formatado do compromisso; a derivação é o fallback. */
    dateLabel?: string | null;
    meetLink?: string | null;
    products?: Array<{ name: string; type?: string; value: number }>;
    createdAt?: string | null;
    stageEnteredAt?: string | null;
    isInactive?: boolean;
    /** Desfecho na etapa terminal — vira selo e desliga os sinais de ação. */
    outcome?: "won" | "lost" | null;
    /** Só rende leitura quando `outcome === "lost"`. */
    lossReason?: string | null;
    potencial?: string | null;
    preSaleResponsible?: Responsavel | null;
    saleResponsible?: Responsavel | null;
    /** uuid do lead — habilita o popover de checklist. */
    leadId?: string;
    /** Qualificação (glifo à esquerda do nome). */
    qualTier?: QualificationTier | null;
    preQualTier?: QualificationTier | null;
    /** Contadores batched — ausentes viram zero, nunca número falso. */
    metrics?: {
      commentsCount: number;
      checklistsTotal: number;
      checklistsCompleted: number;
    };
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
  /** Slot de domínio (ex.: confirmar reunião no funil mergeado). */
  extraActions?: ReactNode;
  /** Só existe quando o telefone é discável pelo WhatsApp. */
  onWhatsApp?: (e: React.MouseEvent) => void;
  onWhatsAppHover?: () => void;
  onWhatsAppPress?: () => void;
  /**
   * Botão de ligar, injetado pronto. Fica em slot porque quem sabe se a org
   * tem voz é o módulo `communication`, e o card não vai aprender isso.
   */
  callSlot?: ReactNode;
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

/** `12/08 · 14:00`. Meia-noite é ausência de hora, não reunião de madrugada. */
function formatarCompromisso(d: Date): string {
  const dia = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  if (d.getHours() === 0 && d.getMinutes() === 0) return dia;
  return `${dia} · ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

/** Distintivo de 16px. Um card mostra no máximo dois. */
function Sinal({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-[5px] px-1.5",
        "text-[9.5px] font-semibold leading-[1.7] tracking-[0.01em]",
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Escolhe UM sinal de tempo. A ordem é a da ação: reunião perdida cobra hoje,
 * lead inativo cobra esta semana, negócio parado cobra quando sobrar tempo.
 */
function sinalDeTempo(
  dateIndicator: { label: string; className: string } | null,
  isInactive: boolean | undefined,
  diasParado: number | null,
): { label: string; className: string } | null {
  if (dateIndicator && /atrasad/i.test(dateIndicator.label)) {
    return { label: "Atrasado", className: "bg-destructive/12 text-destructive" };
  }
  if (isInactive) {
    return { label: "Inativo", className: "bg-destructive/10 text-destructive/85" };
  }
  if (diasParado != null && diasParado >= 7) {
    return {
      label: `${diasParado}d parado`,
      className: diasParado >= 14
        ? "bg-destructive/12 text-destructive"
        : "bg-amber-500/12 text-amber-600 dark:text-amber-400",
    };
  }
  if (dateIndicator) {
    return { label: dateIndicator.label, className: "bg-muted text-muted-foreground" };
  }
  return null;
}

export const LeadCardCompact = memo(function LeadCardCompact({
  lead, config, origin, urgency: _urgency, dateIndicator, parsedDate,
  selected, onSelect, onClick, menuItems, extraActions,
  onWhatsApp, onWhatsAppHover, onWhatsAppPress, callSlot,
}: LeadCardCompactProps) {
  const responsaveis = [lead.preSaleResponsible, lead.saleResponsible].filter(
    (r): r is Responsavel => !!r?.name,
  );

  const diasParado = lead.stageEnteredAt
    ? Math.floor((Date.now() - new Date(lead.stageEnteredAt).getTime()) / 86400000)
    : null;

  // Zero é ausência de valor, não valor zero.
  const valorExibido = config.showValue
    ? lead.value != null && lead.value > 0
      ? formatCurrency(lead.value)
      : lead.faturamento
      ? formatFaturamento(lead.faturamento)
      : null
    : null;
  const valorEhFaturamento = !!valorExibido && !(lead.value != null && lead.value > 0);

  const tags = (lead.tags ?? []).filter((t) => !!t?.name);
  const fechado = lead.outcome === "won" || lead.outcome === "lost";

  const tempo = fechado ? null : sinalDeTempo(dateIndicator, lead.isInactive, diasParado);
  const compromisso = !fechado && config.showDate && parsedDate
    ? lead.dateLabel || formatarCompromisso(parsedDate)
    : null;

  const tier = lead.qualTier ?? lead.preQualTier ?? null;
  const tierConfig = tier ? QUALIFICATION_TIER_CONFIG[tier] : null;
  const TierIcon = tierConfig?.icon;

  const comentarios = lead.metrics?.commentsCount ?? 0;
  const checklistTotal = lead.metrics?.checklistsTotal ?? 0;
  const checklistFeitos = lead.metrics?.checklistsCompleted ?? 0;

  return (
    <TooltipProvider delayDuration={200}>
      <div
        data-lead-id={lead.id}
        onClick={onClick}
        className={cn(
          // `p-0` anula o `p-4` que `.kanban-card` aplica no CSS global.
          "kanban-card group relative cursor-pointer overflow-hidden p-0",
          "flex flex-col rounded-[10px] transition-shadow",
          "hover:shadow-[0_1px_2px_rgba(0,0,0,0.04),0_6px_16px_-8px_rgba(0,0,0,0.18)]",
          lead.isInactive && !fechado && "opacity-70",
          // Recua sem sumir: o hover devolve o card inteiro a quem for auditar.
          fechado && "bg-muted/40 opacity-[0.82] saturate-[0.45] transition-all hover:opacity-100 hover:saturate-100",
          selected && "ring-2 ring-primary/50",
        )}
      >
        {/* Etiquetas na borda esquerda: custo horizontal zero, e a cor fica no
            lugar onde o olho varre a coluna de cima a baixo. */}
        {tags.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                aria-label={`Etiquetas: ${tags.map((t) => t.name).join(", ")}`}
                className="absolute inset-y-0 left-0 flex w-[3px] flex-col overflow-hidden"
              >
                {tags.slice(0, 4).map((t, i) => (
                  <i key={i} aria-hidden className="block flex-1" style={{ backgroundColor: t.color || "#888" }} />
                ))}
              </span>
            </TooltipTrigger>
            <TooltipContent side="right" className="text-[10px]">
              {tags.map((t) => t.name).join(" · ")}
            </TooltipContent>
          </Tooltip>
        )}

        <div className={cn("flex flex-col gap-1.5 py-2 pr-2.5", tags.length > 0 ? "pl-3" : "pl-2.5")}>

          {/* ── 1. qualificação · nome · responsáveis · menu ── */}
          <div className="flex items-start gap-1.5">
            {onSelect && (
              <button
                type="button"
                role="checkbox"
                aria-checked={!!selected}
                aria-label={`Selecionar ${lead.name}`}
                onClick={(e) => { e.stopPropagation(); onSelect(e); }}
                className={cn(
                  "mt-[3px] flex size-[15px] shrink-0 items-center justify-center rounded border transition-all",
                  selected
                    ? "border-primary bg-primary text-primary-foreground opacity-100"
                    : "border-muted-foreground/40 bg-background/80 opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                )}
              >
                {selected && <Check className="size-[9px]" />}
              </button>
            )}

            {TierIcon && tierConfig && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    aria-label={`Qualificação: ${tierConfig.label}`}
                    className={cn(
                      "mt-px grid size-[18px] shrink-0 place-items-center rounded-md",
                      tierConfig.bgClass,
                    )}
                  >
                    <TierIcon className={cn("size-[11px]", tierConfig.colorClass)} />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-[10px]">
                  Qualificação: {tierConfig.label}
                </TooltipContent>
              </Tooltip>
            )}

            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <h4 className="truncate text-[12.5px] font-semibold leading-[1.25] tracking-[-0.012em] transition-colors group-hover:text-primary">
                  {lead.name}
                </h4>
                {fechado && (
                  <span
                    data-testid="selo-desfecho"
                    className={cn(
                      "shrink-0 rounded-[4px] px-1 py-px text-[8.5px] font-bold uppercase tracking-[0.06em]",
                      lead.outcome === "won"
                        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                        : "bg-muted-foreground/15 text-muted-foreground",
                    )}
                  >
                    {lead.outcome === "won" ? "Ganha" : "Perdida"}
                  </span>
                )}
              </div>

              <div className="mt-[1px] flex min-w-0 items-center gap-1.5 text-[10.5px] leading-[1.35] text-muted-foreground">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      aria-label={`Origem: ${origin.label}`}
                      className="size-[6px] shrink-0 rounded-full"
                      style={{ backgroundColor: origin.text }}
                    />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-[10px]">{origin.label}</TooltipContent>
                </Tooltip>
                {/* Sem empresa, o rótulo da origem ocupa a linha em vez de um
                    "Sem empresa" que não informa nada — 1 em cada 4 leads da
                    base não tem empresa, e a linha existiria só para dizer
                    isso. */}
                <span className="truncate">{lead.company || origin.label}</span>
              </div>
            </div>

            {responsaveis.length > 0 && (
              <div className="flex shrink-0 -space-x-[5px] pt-px">
                {responsaveis.map((r, i) => (
                  <Tooltip key={i}>
                    <TooltipTrigger asChild>
                      <span
                        aria-label={`Responsável: ${r.name}`}
                        className="grid size-[18px] place-items-center rounded-full border-[1.5px] border-card text-[7.5px] font-bold text-white"
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
                  className="-mr-1 mt-px shrink-0 rounded p-0.5 text-muted-foreground/60 opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <MoreVertical className="size-[14px]" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">{menuItems}</DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* ── 2. dinheiro · no máximo dois sinais ──
              O valor perdeu o rótulo em caixa alta: numa coluna de negócios,
              "R$ 4.800" alinhado à esquerda em peso maior não é ambíguo, e o
              rótulo custava uma linha inteira por card. Fallback de
              faturamento continua se declarando, em miúdo, porque ali o
              número muda de significado. */}
          {(valorExibido || tempo || compromisso) && (
            <div className="flex items-center justify-between gap-2">
              {valorExibido ? (
                <div className="flex min-w-0 items-baseline gap-1">
                  <span
                    data-testid="valor-negocio"
                    className={cn(
                      "text-[13.5px] font-bold tabular-nums leading-[1.2] tracking-[-0.02em]",
                      fechado && lead.outcome === "lost" ? "text-muted-foreground" : "text-foreground",
                    )}
                  >
                    {valorExibido}
                  </span>
                  {valorEhFaturamento && (
                    <span className="shrink-0 text-[8.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground/70">
                      fat.
                    </span>
                  )}
                </div>
              ) : <span />}

              <div className="flex shrink-0 items-center gap-1">
                {compromisso && <Sinal className="bg-muted text-muted-foreground">{compromisso}</Sinal>}
                {tempo && <Sinal className={tempo.className}>{tempo.label}</Sinal>}
              </div>
            </div>
          )}

          {/* Motivo da perda — a razão de a coluna "Perdido" existir. */}
          {lead.outcome === "lost" && lead.lossReason && (
            <div
              data-testid="motivo-perda"
              className="flex items-baseline gap-1 text-[10px] leading-[1.35] text-muted-foreground"
            >
              <span className="shrink-0 opacity-70">Motivo:</span>
              <span className="truncate font-medium text-foreground/80">{lead.lossReason}</span>
            </div>
          )}

          {extraActions}

          {/* ── 3. rodapé: leitura à esquerda, ação à direita ──
              Negócio fechado não ganha botão de falar: o rodapé some e o card
              vira registro. */}
          {!fechado && (
            <div className="-mb-0.5 mt-0.5 flex items-center justify-between gap-2 border-t border-border/50 pt-1.5">
              {/* Ícone só existe quando tem o que contar. Um `💬 0` em cada um
                  dos vinte cards da coluna é vinte vezes a mesma não-notícia —
                  e é assim que o vendedor aprende a não olhar para o rodapé,
                  justamente onde estão as duas ações. */}
              <div className="flex min-w-0 items-center gap-2 text-[10px] text-muted-foreground">
                {comentarios > 0 && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="flex items-center gap-1">
                        <MessageSquare className="size-[11px]" />
                        <span className="tabular-nums">{comentarios}</span>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-[10px]">
                      {`${comentarios} comentário${comentarios > 1 ? "s" : ""}`}
                    </TooltipContent>
                  </Tooltip>
                )}

                {checklistTotal > 0 && lead.leadId ? (
                  <LeadCardChecklistPopover
                    leadId={lead.leadId}
                    completed={checklistFeitos}
                    total={checklistTotal}
                  />
                ) : null}
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {callSlot}
                {onWhatsApp && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label={`Abrir WhatsApp de ${lead.name}`}
                        onClick={onWhatsApp}
                        onMouseEnter={onWhatsAppHover}
                        onFocus={onWhatsAppHover}
                        onMouseDown={onWhatsAppPress}
                        onPointerDown={(e) => e.stopPropagation()}
                        className={cn(
                          // Precisa LER como botão, não como link: o tom de 12%
                          // desaparecia sobre o card branco e o alvo mais usado
                          // do card virava texto verde.
                          "flex h-[22px] items-center gap-1 rounded-full px-2 transition-colors",
                          "border border-[#25D366]/35 bg-[#25D366]/15 text-[#0B7A3E]",
                          "hover:border-[#25D366]/60 hover:bg-[#25D366]/25",
                          "dark:border-[#25D366]/30 dark:bg-[#25D366]/12 dark:text-[#4ADE80]",
                        )}
                      >
                        <MessageCircle className="size-[12px]" />
                        <span className="text-[10px] font-semibold">WhatsApp</span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-[10px]">
                      Abrir conversa no WhatsApp
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
});
