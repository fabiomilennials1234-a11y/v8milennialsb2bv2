import { memo, useState } from "react";
import { motion } from "framer-motion";
import {
  Building2,
  Flame,
  Clock,
  MoreVertical,
  Trash2,
  MessageCircle,
  Target,
  Video,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { ScheduleMessageModal } from "@/components/chat/ScheduleMessageModal";
import { useOpenWhatsAppChat, formatPhoneForWhatsApp } from "@/lib/whatsapp";
import { formatDistanceToNow, isToday, isTomorrow, isPast, differenceInDays, differenceInHours } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DraggableItem } from "@/components/kanban/DraggableKanbanBoard";

// ─── Origin Colors (unified across all funnels) ──────────

export const ORIGIN_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  whatsapp:   { bg: "#E1F5EE", text: "#0F6E56", label: "WhatsApp" },
  meta_ads:   { bg: "#EEEDFE", text: "#534AB7", label: "Meta Ads" },
  google_ads: { bg: "#FCEBEB", text: "#A32D2D", label: "Google Ads" },
  site:       { bg: "#E6F1FB", text: "#185FA5", label: "Site" },
  remarketing:{ bg: "#FFF3E0", text: "#B35C00", label: "Remarketing" },
  cal:        { bg: "#F3E8FF", text: "#7C3AED", label: "Cal.com" },
  indicacao:  { bg: "#EAF3DE", text: "#3B6D11", label: "Indicação" },
  outro:      { bg: "#F1EFE8", text: "#5F5E5A", label: "Outros" },
};

// ─── Urgency Config ──────────────────────────────────────

const URGENCY_COLORS: Record<string, { label: string; className: string }> = {
  imediato:    { label: "Imediato",   className: "bg-red-500/10 text-red-600 border-red-500/30" },
  "1-mes":     { label: "1 mês",      className: "bg-orange-500/10 text-orange-600 border-orange-500/30" },
  "2-3-meses": { label: "2-3 meses",  className: "bg-yellow-500/10 text-yellow-600 border-yellow-500/30" },
  "6-meses":   { label: "6+ meses",   className: "bg-muted text-muted-foreground border-border" },
};

// ─── Variant Config ──────────────────────────────────────

export type LeadCardVariant =
  | "whatsapp"
  | "confirmacao"
  | "propostas"
  | "followup"
  | "custom"
  | "upsell_client"
  | "upsell_campanha";

const VARIANT_CONFIG: Record<LeadCardVariant, {
  showContact: boolean;
  showValue: boolean;
  showDate: boolean;
  showProducts: boolean;
  showMeetLink: boolean;
  showNotes: boolean;
}> = {
  whatsapp:        { showContact: true,  showValue: true,  showDate: false, showProducts: false, showMeetLink: false, showNotes: false },
  confirmacao:     { showContact: false, showValue: true,  showDate: true,  showProducts: false, showMeetLink: true,  showNotes: false },
  propostas:       { showContact: false, showValue: true,  showDate: true,  showProducts: true,  showMeetLink: false, showNotes: false },
  followup:        { showContact: false, showValue: false, showDate: true,  showProducts: false, showMeetLink: false, showNotes: true  },
  custom:          { showContact: true,  showValue: false, showDate: false, showProducts: false, showMeetLink: false, showNotes: true  },
  upsell_client:   { showContact: true,  showValue: true,  showDate: false, showProducts: false, showMeetLink: false, showNotes: false },
  upsell_campanha: { showContact: false, showValue: true,  showDate: true,  showProducts: false, showMeetLink: false, showNotes: false },
};

// ─── Types ───────────────────────────────────────────────

export interface LeadCardData extends DraggableItem {
  id: string;
  name: string;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  rating?: number;
  origin?: string;
  urgency?: string | null;
  tags?: Array<{ name: string; color: string }>;
  responsible?: string | null;
  createdAt?: string | null;
  // Value fields
  faturamento?: string | number | null;
  value?: number | null;
  valueLabel?: string | null;
  // Date fields
  date?: Date | string | null;
  dateLabel?: string | null;
  meetLink?: string | null;
  // Propostas-specific
  calor?: number;
  products?: Array<{ name: string; type?: string; value: number }>;
  contractDuration?: number;
  // Notes
  notes?: string | null;
  // Custom/follow-up
  leadId?: string;
  // Upsell
  potencial?: string | null;
  isInactive?: boolean;
}

export interface LeadCardProps {
  lead: LeadCardData;
  variant: LeadCardVariant;
  // Override defaults from VARIANT_CONFIG
  showContact?: boolean;
  showValue?: boolean;
  showDate?: boolean;
  showProducts?: boolean;
  showMeetLink?: boolean;
  showNotes?: boolean;
  // Callbacks
  onClick?: () => void;
  onRemove?: () => void;
  onCalorChange?: (calor: number) => void;
  onQuickAction?: (title: string) => void;
}

// ─── Date Indicator ──────────────────────────────────────

function getDateIndicator(date: Date | null) {
  if (!date) return null;
  const now = new Date();
  const hours = differenceInHours(date, now);
  const days = differenceInDays(date, now);

  if (isPast(date) && !isToday(date)) {
    return { label: "Atrasado", className: "bg-destructive/15 text-destructive border-destructive/30" };
  }
  if (isToday(date)) {
    if (hours <= 2 && hours > 0) {
      return { label: `Em ${hours}h`, className: "bg-destructive/15 text-destructive border-destructive/30 animate-pulse" };
    }
    return { label: "Hoje", className: "bg-orange-500/15 text-orange-600 border-orange-500/30" };
  }
  if (isTomorrow(date)) {
    return { label: "Amanhã", className: "bg-yellow-500/15 text-yellow-600 border-yellow-500/30" };
  }
  if (days <= 3) {
    return { label: `D-${days}`, className: "bg-yellow-500/15 text-yellow-600 border-yellow-500/30" };
  }
  if (days <= 7) {
    return { label: `${days} dias`, className: "bg-blue-500/15 text-blue-600 border-blue-500/30" };
  }
  return { label: `${days} dias`, className: "bg-muted text-muted-foreground border-border" };
}

// ─── Calor Popover (fire badge + slider) ─────────────────

function getCalorInfo(calor: number) {
  if (calor >= 8) return { label: "Quente", color: "text-red-500", bg: "bg-red-500/10 border-red-500/30", trackColor: "bg-red-500" };
  if (calor >= 4) return { label: "Morno", color: "text-amber-500", bg: "bg-amber-500/10 border-amber-500/30", trackColor: "bg-amber-500" };
  return { label: "Frio", color: "text-blue-500", bg: "bg-blue-500/10 border-blue-500/30", trackColor: "bg-blue-500" };
}

function CalorPopover({ calor, onChange }: { calor: number; onChange?: (value: number) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(calor);
  const info = getCalorInfo(calor);
  const previewInfo = getCalorInfo(value);

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (v) setValue(calor); }}>
      <PopoverTrigger asChild>
        <button
          onClick={(e) => e.stopPropagation()}
          className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold transition-colors", info.bg)}
        >
          <Flame className={cn("w-3 h-3", info.color)} />
          <span className={info.color}>{calor}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-4" align="start" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3">
          <Flame className={cn("w-5 h-5", previewInfo.color)} />
          <span className="font-semibold text-sm">Calor do Lead</span>
          <span className={cn("ml-auto text-lg font-bold", previewInfo.color)}>{value}</span>
        </div>
        <Slider
          min={1}
          max={10}
          step={1}
          value={[value]}
          onValueChange={([v]) => setValue(v)}
          className="mb-2"
        />
        <div className="flex justify-between text-[10px] text-muted-foreground mb-3">
          <span className={value <= 3 ? "text-blue-500 font-semibold" : ""}>Frio</span>
          <span className={value >= 4 && value <= 7 ? "text-amber-500 font-semibold" : ""}>Morno</span>
          <span className={value >= 8 ? "text-red-500 font-semibold" : ""}>Quente</span>
        </div>
        <p className="text-[11px] text-muted-foreground mb-3">
          Probabilidade de fechar este mês. Leads com maior calor aparecem primeiro.
        </p>
        <Button
          size="sm"
          className="w-full"
          onClick={() => {
            onChange?.(value);
            setOpen(false);
          }}
        >
          Salvar
        </Button>
      </PopoverContent>
    </Popover>
  );
}

// ─── Quick Action Popover ────────────────────────────────

function QuickActionPopover({ onAction }: { onAction: (title: string) => void }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");

  const actions = [
    { emoji: "📞", label: "Ligar" },
    { emoji: "💬", label: "WhatsApp" },
    { emoji: "✅", label: "Confirmar interesse" },
    { emoji: "📅", label: "Agendar reunião" },
  ];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          onClick={(e) => e.stopPropagation()}
          className="p-1.5 rounded-md bg-muted hover:bg-muted-foreground/10 text-muted-foreground transition-colors"
          title="Ação do dia"
        >
          <Target className="w-3.5 h-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="end" onClick={(e) => e.stopPropagation()}>
        <p className="text-xs font-medium text-muted-foreground mb-1 px-1">Ação do dia</p>
        {actions.map((a) => (
          <button
            key={a.label}
            className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-muted transition-colors"
            onClick={() => { onAction(a.label); setOpen(false); }}
          >
            {a.emoji} {a.label}
          </button>
        ))}
        <div className="flex gap-1 mt-1 pt-1 border-t">
          <Input
            placeholder="Ação personalizada..."
            className="h-7 text-xs"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && custom.trim()) {
                onAction(custom.trim());
                setCustom("");
                setOpen(false);
              }
            }}
          />
          <Button
            size="sm"
            className="h-7 px-2"
            disabled={!custom.trim()}
            onClick={() => { onAction(custom.trim()); setCustom(""); setOpen(false); }}
          >
            +
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── Format Currency ─────────────────────────────────────

function formatCurrency(value: number): string {
  if (value >= 1_000_000) {
    return `R$ ${(value / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}M`;
  }
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
  }).format(value);
}

// ─── Main Component ──────────────────────────────────────

export const LeadCard = memo(function LeadCard({
  lead,
  variant,
  onClick,
  onRemove,
  onCalorChange,
  onQuickAction,
  ...overrides
}: LeadCardProps) {
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const config = { ...VARIANT_CONFIG[variant], ...pickDefined(overrides) };
  const origin = ORIGIN_COLORS[lead.origin || "outro"] || ORIGIN_COLORS.outro;
  const urgency = lead.urgency ? URGENCY_COLORS[lead.urgency] : null;
  const hasPhone = !!formatPhoneForWhatsApp(lead.phone ?? undefined);
  const openWhatsApp = useOpenWhatsAppChat();
  const parsedDate = lead.date
    ? (lead.date instanceof Date ? lead.date : new Date(lead.date))
    : null;
  const dateIndicator = config.showDate ? getDateIndicator(parsedDate) : null;

  // Decide which data rows to show
  const hasContactData = (config.showContact && (lead.phone || lead.email)) ||
    (config.showValue && (lead.faturamento || lead.value != null)) ||
    (config.showDate && parsedDate);

  return (
    <>
    <motion.div
      whileHover={{ scale: 1.01, y: -1 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className={cn(
        "kanban-card group cursor-pointer relative",
        lead.isInactive && "opacity-60"
      )}
      style={{
        '--card-accent': lead.calor != null && lead.calor >= 8
          ? 'hsl(0 80% 55%)'
          : lead.calor != null && lead.calor >= 4
            ? 'hsl(38 92% 50%)'
            : lead.calor != null && lead.calor > 0
              ? 'hsl(210 80% 55%)'
              : undefined,
      } as React.CSSProperties}
      onClick={onClick}
    >
      {/* ── Row 1: Name + ⋮ Menu ── */}
      <div className="flex items-start justify-between gap-2 mb-0.5">
        <h4 className="font-semibold text-[13px] leading-tight line-clamp-2 group-hover:text-primary transition-colors flex-1 min-w-0">
          {lead.name}
        </h4>
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <button className="p-0.5 rounded hover:bg-muted text-muted-foreground shrink-0">
              <MoreVertical className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {hasPhone && (
              <DropdownMenuItem onClick={(e) => openWhatsApp(lead.phone ?? undefined, e)}>
                <MessageCircle className="w-4 h-4 mr-2 text-[#25D366]" />
                WhatsApp
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setScheduleOpen(true); }}>
              <Clock className="w-4 h-4 mr-2" />
              Agendar mensagem
            </DropdownMenuItem>
            {onRemove && (
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={(e) => { e.stopPropagation(); onRemove(); }}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Remover do funil
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* ── Row 2: Company ── */}
      {lead.company && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5">
          <Building2 className="w-3.5 h-3.5 shrink-0 opacity-60" />
          <span className="truncate">{lead.company}</span>
        </div>
      )}

      {/* ── Row 3: Badges (Origin + Urgency + Tags + Date + Potencial) ── */}
      <div className="flex flex-wrap gap-1 mb-2">
        <Badge
          variant="outline"
          className="text-[10px] px-1.5 py-0 h-[18px] border font-medium"
          style={{ backgroundColor: origin.bg, color: origin.text, borderColor: `${origin.text}30` }}
        >
          {origin.label}
        </Badge>
        {urgency && (
          <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 h-[18px] font-medium", urgency.className)}>
            {urgency.label}
          </Badge>
        )}
        {lead.tags && lead.tags.length > 0 && lead.tags.slice(0, 3).map((tag) => (
          <Badge
            key={tag.name}
            variant="secondary"
            className="text-[10px] px-1.5 py-0 h-[18px] font-medium"
            style={{ backgroundColor: `${tag.color}20`, color: tag.color }}
          >
            {tag.name}
          </Badge>
        ))}
        {lead.tags && lead.tags.length > 3 && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-[18px]">
            +{lead.tags.length - 3}
          </Badge>
        )}
        {lead.potencial && (
          <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 h-[18px] font-medium", getPotencialClass(lead.potencial))}>
            {lead.potencial.charAt(0).toUpperCase() + lead.potencial.slice(1)}
          </Badge>
        )}
        {lead.isInactive && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-[18px] font-medium bg-destructive/10 text-destructive border-destructive/30">
            Inativo
          </Badge>
        )}
        {dateIndicator && (
          <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 h-[18px] font-medium", dateIndicator.className)}>
            {dateIndicator.label}
          </Badge>
        )}
        {lead.rating != null && lead.rating > 0 && (
          <CalorPopover calor={lead.rating} onChange={onCalorChange} />
        )}
      </div>

      {/* ── Row 5: Contact data with LEFT BORDER accent ── */}
      {hasContactData && (
        <div className="border-l-2 border-primary/60 pl-3 py-1 space-y-1 mb-2">
          {config.showContact && lead.phone && (
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">Telefone</span>
              <span className="font-medium">{lead.phone}</span>
            </div>
          )}
          {config.showContact && lead.email && (
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">Email</span>
              <span className="font-medium truncate max-w-[160px]">{lead.email}</span>
            </div>
          )}
          {config.showValue && (lead.faturamento || lead.value != null) && (
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">
                {lead.value != null ? "Valor" : "Faturamento"}
              </span>
              <span className="font-semibold text-emerald-500">
                {lead.value != null
                  ? formatCurrency(lead.value)
                  : typeof lead.faturamento === "number"
                    ? formatCurrency(lead.faturamento)
                    : `R$ ${lead.faturamento}`}
              </span>
            </div>
          )}
          {config.showDate && parsedDate && (
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">{lead.dateLabel || "Data"}</span>
              <span className="font-medium">{parsedDate.toLocaleDateString("pt-BR")}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Meet link ── */}
      {config.showMeetLink && lead.meetLink && (
        <a
          href={lead.meetLink}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-1.5 text-[11px] text-primary hover:underline mb-2"
        >
          <Video className="w-3 h-3 shrink-0" />
          Entrar no Google Meet
        </a>
      )}

      {/* ── Products (max 3) ── */}
      {config.showProducts && lead.products && lead.products.length > 0 && (
        <div className="space-y-1 mb-2">
          {lead.products.slice(0, 3).map((p, i) => (
            <div key={i} className="flex items-center justify-between gap-2 p-1.5 rounded bg-muted/50 text-xs">
              <div className="flex items-center gap-1 min-w-0">
                {p.type && (
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[9px] px-1 py-0 h-4 shrink-0",
                      p.type === "mrr" ? "bg-blue-500/10 text-blue-600 border-blue-500/20" :
                      p.type === "unitario" ? "bg-amber-500/10 text-amber-600 border-amber-500/20" :
                      "bg-primary/10 text-primary border-primary/20"
                    )}
                  >
                    {p.type === "mrr" ? "Rec." : p.type === "unitario" ? "Unit" : "Proj"}
                  </Badge>
                )}
                <span className="truncate">{p.name}</span>
              </div>
              <span className="font-medium text-emerald-500 shrink-0">{formatCurrency(p.value)}</span>
            </div>
          ))}
          {lead.products.length > 3 && (
            <p className="text-[10px] text-muted-foreground text-center">
              +{lead.products.length - 3} produto(s)
            </p>
          )}
        </div>
      )}

      {/* ── Notes ── */}
      {config.showNotes && lead.notes && (
        <p className="text-xs text-muted-foreground line-clamp-2 mb-2 p-1.5 rounded bg-muted/30 border border-border/50">
          {lead.notes}
        </p>
      )}

      {/* ── Quick Actions Row: WhatsApp (filled green) + Ação do Dia ── */}
      {(hasPhone || !!onQuickAction) && (
        <div className="flex items-center gap-1.5 mb-2">
          {hasPhone && (
            <button
              onClick={(e) => openWhatsApp(lead.phone ?? undefined, e)}
              className="flex items-center gap-1.5 flex-1 justify-center px-2 py-1.5 rounded-md bg-[#25D366] hover:bg-[#1da851] text-white text-xs font-medium transition-colors"
              title="Abrir WhatsApp"
            >
              <MessageCircle className="w-3.5 h-3.5" />
              WhatsApp
            </button>
          )}
          {onQuickAction && (
            <QuickActionPopover onAction={onQuickAction} />
          )}
        </div>
      )}

      {/* ── Footer: Responsible avatar+name + Clock time ── */}
      <div className="flex items-center justify-between pt-2 border-t border-border/60 mt-auto">
        {lead.responsible ? (
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="w-5 h-5 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
              <span className="text-[9px] font-bold text-primary leading-none">
                {lead.responsible.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
              </span>
            </div>
            <span className="text-[11px] text-muted-foreground truncate max-w-[90px]">
              {lead.responsible}
            </span>
          </div>
        ) : (
          <span />
        )}
        {lead.createdAt && (
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
            <Clock className="w-3 h-3" />
            <span>{formatDistanceToNow(new Date(lead.createdAt), { addSuffix: true, locale: ptBR })}</span>
          </div>
        )}
      </div>
    </motion.div>

    {scheduleOpen && (
      <ScheduleMessageModal
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        leadId={lead.leadId || ""}
        leadName={lead.name}
        phoneNumber={lead.phone || ""}
      />
    )}
    </>
  );
});

// ─── Helpers ─────────────────────────────────────────────

function getPotencialClass(potencial: string): string {
  switch (potencial) {
    case "baixo": return "bg-muted text-muted-foreground border-border";
    case "medio": return "bg-primary/10 text-primary border-primary/20";
    case "alto": return "bg-green-500/10 text-green-600 border-green-500/20";
    case "estrategico": return "bg-purple-500/10 text-purple-600 border-purple-500/20";
    default: return "bg-muted text-muted-foreground border-border";
  }
}

function pickDefined(obj: Record<string, unknown>): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === "boolean") result[key] = val;
  }
  return result;
}
