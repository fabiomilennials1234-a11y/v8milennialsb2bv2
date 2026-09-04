import { memo, useState, useRef, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Building2, Clock, MoreVertical, Trash2, MessageCircle, Target, Video, Check,
  Phone, NotebookPen, MoveRight, Users, Gem, Tag, CheckSquare, CalendarDays,
  Wallet, XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ScheduleMessageModal } from "@/modules/communication/components/chat/ScheduleMessageModal";
import { CreateMeetingDialog } from "@/modules/engagement";
import { formatPhoneForWhatsApp } from "@/modules/communication/lib/whatsapp";
import { AbrirConversaButton } from "@/modules/communication/components/chat/AbrirConversaButton";
import { AbrirConversaMenuItem } from "@/modules/communication/components/chat/AbrirConversaMenuItem";
import { formatDistanceToNow, isToday, isTomorrow, isPast, differenceInDays, differenceInHours } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DraggableItem, StageRole } from "@/contracts/pipe";
import type { QualificationTier } from "../lead-detail/modal/types";
import { LeadCardAvatar } from "./card/LeadCardAvatar";
import { LeadCardLabels } from "./card/LeadCardLabels";
import { LeadCardMetrics } from "./card/LeadCardMetrics";
import { LeadCardCompact } from "./card/LeadCardCompact";
import { LeadEtiquetasPopover } from "../etiquetas/LeadEtiquetasPopover";
import { formatFaturamento } from "@/lib/format/faturamento";
import { usePipeOpsOptional } from "../../pipe-ops";
import { useDealSheetOpcional } from "../deal-detail/deal-sheet-context";
import { AddToFunilMenuItem, AddToFunilDialog } from "./AddToFunilDialog";

// ─── Origin Colors (unified across all funnels) ──────────

/**
 * Cor da pílula de origem.
 *
 * 🔴 Era um mapa de 12 pastéis de TEMA CLARO em hex (#E1F5EE, #EEEDFE, …)
 * aplicado por `style` inline. Inline vence qualquer `dark:`, então no tema
 * escuro cada pílula virava uma ilha quase branca dentro do card — e este é
 * o card do funil, a tela em obra.
 *
 * Agora cada origem guarda só o MATIZ. O fundo é uma tinta translúcida (14%),
 * que assenta sobre qualquer superfície; a tinta do texto sai de
 * `--origin-ink-l`, um token que vale ~34% no claro e ~74% no escuro. Um
 * token, dois temas, e cada origem mantém a identidade de cor que tinha.
 */
/**
 * Cor da inicial do lead. Mesma função do resto do produto (colorFromName em
 * LeadCardMetrics): soma os charCodes e gira o matiz, para que duas pessoas
 * diferentes nunca caiam na mesma cor por acidente.
 */
const corDaInicial = (nome?: string | null): string => {
  if (!nome) return "hsl(0 0% 45%)";
  const h = Array.from(nome).reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return `hsl(${h % 360} 55% 55%)`;
};

const origem = (h: number, s: number, label: string) => ({
  bg: `hsl(${h} ${s}% 50% / 0.14)`,
  text: `hsl(${h} ${s}% var(--origin-ink-l))`,
  label,
});

export const ORIGIN_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  whatsapp:        origem(162, 60, "WhatsApp"),
  meta_ads:        origem(246, 48, "Meta Ads"),
  instagram:       origem(333, 62, "Instagram"),
  tiktok:          { bg: "hsl(var(--muted))", text: "hsl(var(--muted-foreground))", label: "Tiktok" },
  google_ads:      origem(0, 55, "Google Ads"),
  site:            origem(209, 62, "Site"),
  landing_page:    origem(201, 70, "Landing Page"),
  remarketing:     origem(31, 75, "Remarketing"),
  indicacao:       origem(89, 58, "Indicação"),
  evento:          origem(263, 62, "Evento"),
  prospeccao_ativa:origem(20, 72, "Prospecção Ativa"),
  cal:             origem(263, 70, "Cal.com"),
  outro:           origem(45, 6, "Outros"),
};

const URGENCY_COLORS: Record<string, { label: string; className: string }> = {
  imediato:    { label: "Imediato",   className: "bg-red-500/10 text-red-600 border-red-500/30" },
  "1-mes":     { label: "1 mês",      className: "bg-orange-500/10 text-orange-600 border-orange-500/30" },
  "2-3-meses": { label: "2-3 meses",  className: "bg-yellow-500/10 text-yellow-600 border-yellow-500/30" },
  "6-meses":   { label: "6+ meses",   className: "bg-muted text-muted-foreground border-border" },
};

// ─── Variant Config ──────────────────────────────────────

export type LeadCardVariant =
  | "whatsapp" | "confirmacao" | "propostas" | "followup" | "custom"
  | "upsell_client" | "upsell_campanha";

const VARIANT_CONFIG: Record<LeadCardVariant, {
  showContact: boolean; showValue: boolean; showDate: boolean;
  showProducts: boolean; showMeetLink: boolean; showNotes: boolean;
  /**
   * A linha de data aparece VAZIA (o convite azul "Sem data") quando não há
   * compromisso. Separada de `showDate` no S6: o funil custom passou a
   * DESENHAR a data que existe, mas ele é o único board que serve funil de
   * qualquer assunto — carimbar "Sem data" em card de funil que nunca terá
   * reunião pioraria a tela em vez de melhorá-la. Nos funis de sistema o
   * convite continua sendo o comportamento (é ali que a data é esperada).
   */
  showDateEmpty: boolean;
  /**
   * Se a data vira também o BADGE de urgência ("Atrasado", "Hoje", "D-2",
   * "12 dias") na faixa de badges do card.
   *
   * Separada de `showDate` no S6, e a separação é o ponto. `dateIndicator`
   * saía de `config.showDate ? getDateIndicator(parsedDate) : null` — um
   * ternário só para duas decisões diferentes. Ligar `showDate` na variante
   * `custom` para que a reunião da Agenda aparecesse no card ligava, DE
   * CARONA, o badge vermelho "Atrasado" em todo card de todo funil custom de
   * toda organização — inclusive as que não pediram nada e cuja data no
   * `metadata` nunca foi um compromisso.
   *
   * A regra que fica: a LINHA de data aparece porque EXISTE data; o BADGE é
   * uma afirmação a mais — "isto está atrasado, corra" — e quem a faz é a
   * variante, explicitamente. As cinco variantes que já tinham `showDate`
   * ligada continuam com o badge exatamente como estava; `custom` recebe a
   * linha sem o badge.
   */
  showDateBadge: boolean;
}> = {
  // `showDate`/`showProducts` ligados em 21/08: a anatomia do DataCrazy dá
  // LINHA PRÓPRIA a produto e data, e com os dois desligados o card do funil
  // principal — que é onde o cliente olha — perdia metade do desenho novo.
  // Campo vazio não some: vira o link azul "Sem produto"/"Sem data", que é o
  // convite a preencher do próprio print.
  whatsapp:        { showContact: true,  showValue: true,  showDate: true,  showProducts: true,  showMeetLink: false, showNotes: false, showDateEmpty: true,  showDateBadge: true  },
  confirmacao:     { showContact: false, showValue: true,  showDate: true,  showProducts: false, showMeetLink: true,  showNotes: false, showDateEmpty: true,  showDateBadge: true  },
  propostas:       { showContact: false, showValue: true,  showDate: true,  showProducts: true,  showMeetLink: false, showNotes: false, showDateEmpty: true,  showDateBadge: true  },
  followup:        { showContact: false, showValue: false, showDate: true,  showProducts: false, showMeetLink: false, showNotes: true,  showDateEmpty: true,  showDateBadge: true  },
  // `custom` liga `showDate` no S6 (espelho da Agenda): a reunião marcada na
  // Agenda chega ao card pelo metadata, e a data tem de aparecer porque ELA
  // EXISTE — não porque a etapa se chama "agendado" nem porque a org tem a
  // flag do funil mergeado. `showDateEmpty: false` é a metade obrigatória da
  // troca: sem ela, todo card de todo funil custom ganharia "Sem data".
  custom:          { showContact: true,  showValue: false, showDate: true,  showProducts: false, showMeetLink: false, showNotes: true,  showDateEmpty: false, showDateBadge: false },
  // `showDateBadge: false` porque `showDate` já era `false`: a carteira nunca
  // mostrou data nem badge, e a separação não pode ser desculpa para ligar
  // nada. Onde a variante não tinha badge, ela continua sem.
  upsell_client:   { showContact: true,  showValue: true,  showDate: false, showProducts: false, showMeetLink: false, showNotes: false, showDateEmpty: true,  showDateBadge: false },
  upsell_campanha: { showContact: false, showValue: true,  showDate: true,  showProducts: false, showMeetLink: false, showNotes: false, showDateEmpty: true,  showDateBadge: true  },
};

// ─── Types ───────────────────────────────────────────────

export interface LeadCardData extends DraggableItem {
  id: string;
  name: string;
  /**
   * Código do cliente no ERP, exibido como prefixo do nome: "1234 - João".
   *
   * 🔴 Campo PRÓPRIO em vez de nome já composto, por dois motivos: o `name` é
   * editável por duplo clique e salva o que estiver nele (com o código junto,
   * o vendedor gravaria "1234 - João" em `leads.name` e isso vazaria em
   * `{{nome}}` de disparo), e a inicial do avatar sai do nome — prefixado, todo
   * cliente do ERP viraria um avatar "1".
   */
  erpCode?: string | null;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  origin?: string;
  urgency?: string | null;
  tags?: Array<{ name: string; color: string }>;
  responsible?: string | null;
  assignees?: string[];
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
  products?: Array<{ name: string; type?: string; value: number }>;
  contractDuration?: number;
  // Notes
  notes?: string | null;
  // Custom/follow-up
  leadId?: string;
  // Upsell
  potencial?: string | null;
  isInactive?: boolean;
  // Aging
  stageEnteredAt?: string | null;
  // ── NOVO (Trello-style) ──
  /** Pré-qualificação tier (metade esquerda do avatar). */
  preQualTier?: QualificationTier | null;
  /** Qualificação tier (metade direita). */
  qualTier?: QualificationTier | null;
  /** Avatar URL do lead (populado por automação futura). */
  avatarUrl?: string | null;
  /** Métricas batched do lead — vindo de useBatchedLeadMetrics. */
  metrics?: {
    commentsCount: number;
    checklistsTotal: number;
    checklistsCompleted: number;
  };
  /** Responsáveis dual (pre-venda / venda) com avatar. */
  preSaleResponsible?: { name: string | null; avatar_url?: string | null } | null;
  saleResponsible?:    { name: string | null; avatar_url?: string | null } | null;
  /** Stage atual da entry (slug). Usado p/ confirmação de reunião no funil mergeado. */
  stageKey?: string | null;
  /**
   * Papel semântico da etapa (ADR-0017 §1), resolvido no CLIENTE a partir das
   * etapas que o board já carrega. É o que substitui a lista de slugs
   * chumbados: `reuniao_marcada` de uma org e `agendado` de outra são a mesma
   * coisa para o produto, e só `stage_role` sabe disso.
   */
  stageRole?: StageRole | null;
  /**
   * Funil a que a entry pertence. Semeia o `CreateMeetingDialog` aberto pelo
   * card — sem ele o vendedor reescolhe no picker o funil de onde acabou de
   * sair, e é o par (funil, lead) que resolve o negócio da reunião (S6).
   */
  pipelineId?: string | null;
  /** Data da reunião (ISO) — funil mergeado Oportunidades. */
  meetingDate?: string | null;
  /** Status de confirmação da reunião — funil mergeado (ADR-0004). */
  confirmationStatus?: "pendente" | "pre_confirmado" | "confirmado" | null;
}

export interface LeadCardProps {
  lead: LeadCardData;
  variant: LeadCardVariant;
  /** Slot de ações extra (domínio) renderizado antes do footer. Ex: botão de confirmação. */
  extraActions?: React.ReactNode;
  showContact?: boolean;
  showValue?: boolean;
  showDate?: boolean;
  /** Override do convite "Sem data" (ver `VARIANT_CONFIG.showDateEmpty`). */
  showDateEmpty?: boolean;
  /**
   * Override do badge de urgência (ver `VARIANT_CONFIG.showDateBadge`).
   *
   * Existe pelo mesmo motivo do irmão acima: uma superfície que QUEIRA o
   * badge num funil custom pede aqui, explicitamente, em vez de a decisão
   * chegar de carona junto com a linha de data.
   */
  showDateBadge?: boolean;
  showProducts?: boolean;
  showMeetLink?: boolean;
  showNotes?: boolean;
  selected?: boolean;
  onSelect?: (e: React.MouseEvent) => void;
  onClick?: () => void;
  onRemove?: () => void;
  onQuickAction?: (title: string) => void;
  onInlineEdit?: (field: string, value: string) => void;
  /**
   * Densidade do card.
   *
   * `comfortable` (default) é o card histórico: seis blocos empilhados, ~250px
   * de altura. `compact` é o do protótipo `.specs/mockups/funis-redesign/` —
   * três linhas, ~100px, com o mesmo conteúdo redistribuído (avatares sobem
   * pra linha do nome, tags viram marcador vertical, tempo vira badge,
   * telefone e valor dividem uma linha).
   *
   * Fica em prop e não em variant porque densidade é decisão da SUPERFÍCIE
   * (o board do funil quer densa; a carteira ainda não pediu), enquanto
   * `variant` decide QUAIS campos existem. São eixos independentes.
   */
  density?: "comfortable" | "compact";
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

// ─── Quick Action Popover (mantido) ──────────────────────

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
          className="flex items-center gap-1 px-2 py-1.5 rounded-md bg-primary/10 hover:bg-primary/15 text-primary text-xs font-medium transition-colors"
          title="Ação rápida"
        >
          <Target className="w-3.5 h-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="end" onClick={(e) => e.stopPropagation()}>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold px-1 pb-1.5">
          Ação do dia
        </div>
        <div className="space-y-0.5">
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={() => { onAction(a.label); setOpen(false); }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-muted text-left"
            >
              <span>{a.emoji}</span> {a.label}
            </button>
          ))}
        </div>
        <div className="mt-1.5 pt-1.5 border-t border-border/40">
          <Input
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="Outra ação..."
            className="h-7 text-xs"
            onKeyDown={(e) => {
              if (e.key === "Enter" && custom.trim()) {
                onAction(custom.trim());
                setCustom("");
                setOpen(false);
              }
            }}
          />
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
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0 }).format(value);
}

// ─── Main Component ──────────────────────────────────────

export const LeadCard = memo(function LeadCard({
  lead, variant, selected, onSelect, onClick, onRemove,
  onQuickAction, onInlineEdit, extraActions,
  density = "comfortable", ...overrides
}: LeadCardProps) {
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [reuniaoOpen, setReuniaoOpen] = useState(false);
  const [addFunilOpen, setAddFunilOpen] = useState(false);
  // Resiliente: `null` quando o card monta fora de um PipeOpsProvider — nesse
  // caso o item "Adicionar a funil" e o dialog simplesmente não aparecem.
  const pipeOps = usePipeOpsOptional();
  // `null` fora dos funis — ver `abrirChecklists` abaixo.
  const dealSheet = useDealSheetOpcional();
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const editRef = useRef<HTMLInputElement>(null);
  const config = { ...VARIANT_CONFIG[variant], ...pickDefined(overrides) };

  useEffect(() => {
    if (editingField && editRef.current) {
      editRef.current.focus();
      editRef.current.select();
    }
  }, [editingField]);

  const startEdit = useCallback((field: string, currentValue: string, e: React.MouseEvent) => {
    if (!onInlineEdit) return;
    e.stopPropagation();
    setEditingField(field);
    setEditValue(currentValue);
  }, [onInlineEdit]);

  const commitEdit = useCallback(() => {
    if (editingField && editValue.trim() && onInlineEdit) {
      const originalValue = editingField === "name" ? lead.name : (lead.company ?? "");
      if (editValue.trim() !== originalValue) {
        onInlineEdit(editingField, editValue.trim());
      }
    }
    setEditingField(null);
  }, [editingField, editValue, onInlineEdit, lead.name, lead.company]);

  const cancelEdit = useCallback(() => setEditingField(null), []);

  const origin = ORIGIN_COLORS[lead.origin || "outro"] || ORIGIN_COLORS.outro;
  const urgency = lead.urgency ? URGENCY_COLORS[lead.urgency] : null;
  const hasPhone = !!formatPhoneForWhatsApp(lead.phone ?? undefined);
  const parsedDate = lead.date ? (lead.date instanceof Date ? lead.date : new Date(lead.date)) : null;
  /**
   * O badge de urgência. Governado por `showDateBadge`, e NÃO por `showDate`:
   * são duas afirmações diferentes sobre a mesma data — "existe compromisso"
   * e "este compromisso está atrasado". Ler as duas do mesmo booleano foi o
   * que fez a variante `custom`, ao ganhar a linha de data do S6, ganhar
   * junto um "Atrasado" vermelho em todo card de todo funil custom.
   */
  const dateIndicator = config.showDateBadge ? getDateIndicator(parsedDate) : null;

  const hasContactData =
    (config.showContact && (lead.phone || lead.email)) ||
    (config.showValue && (lead.faturamento || lead.value != null)) ||
    (config.showDate && parsedDate);

  // Itens do menu `…`. Extraídos porque as duas densidades oferecem as MESMAS
  // ações — só muda o tamanho do gatilho.
  const itensDoMenu = (
    <>
      {hasPhone && (
        <AbrirConversaMenuItem leadId={lead.id} phone={lead.phone}>
          <MessageCircle className="w-4 h-4 mr-2 text-[#25D366]" /> WhatsApp
        </AbrirConversaMenuItem>
      )}
      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setScheduleOpen(true); }}>
        <Clock className="w-4 h-4 mr-2" /> Agendar mensagem
      </DropdownMenuItem>
      {pipeOps && <AddToFunilMenuItem pipeOps={pipeOps} onSelect={() => setAddFunilOpen(true)} />}
      {onRemove && (
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
        >
          <Trash2 className="w-4 h-4 mr-2" /> Remover do funil
        </DropdownMenuItem>
      )}
    </>
  );

  /**
   * O menu do "⊕" da lateral — o MESMO do protótipo `funis-datacrazy` (:8902),
   * item por item: 15 opções em 3 grupos rotulados (`dados.js:219-246`).
   *
   * Não é o menu do "⋮". O "⋮" são AÇÕES sobre o negócio; este é tudo que se
   * pendura no lead. Decisão do Lucas em 21/08: dois botões, dois assuntos.
   *
   * O selo `FICHA` marca o que HOJE só existe dentro da ficha do lead
   * (`LeadModalToolbar`, `CrossPipePanel`, o header de responsáveis/
   * qualificação/etiquetas). Esses itens ABREM a ficha em vez de fingir que
   * agem daqui — o protótipo carrega o mesmo selo pelo mesmo motivo. Item que
   * promete e não cumpre é pior do que item ausente.
   */
  const selo = (
    <span className="ml-auto pl-3 text-[9px] font-semibold tracking-wide text-muted-foreground/60">
      FICHA
    </span>
  );
  const abrirFicha = (e: React.MouseEvent) => { e.stopPropagation(); onClick?.(); };

  /**
   * "Checklists" abre o card do negócio JÁ na aba de checklists.
   *
   * Antes chamava `abrirFicha` e nada mais — o painel abria na primeira aba, que
   * nem sequer tinha checklist nenhum. Item que promete um assunto e entrega
   * outro é o que faz o menu inteiro perder a confiança.
   *
   * `onClick` continua sendo quem ABRE: cada superfície sabe quais ids passar
   * (a entrada do funil, o lead). Aqui só se diz o assunto, depois — a ordem
   * importa, porque abrir zera o pedido.
   */
  const abrirChecklists = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClick?.();
    dealSheet?.pedirAba("checklists");
  };
  const telefoneNu = (lead.phone ?? "").replace(/\D/g, "");

  const itensDoMenuAdicionar = (
    <>
      <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
        Conversa
      </DropdownMenuLabel>
      {hasPhone && (
        <AbrirConversaMenuItem leadId={lead.id} phone={lead.phone}>
          <MessageCircle className="w-4 h-4 mr-2 text-[#25D366]" /> WhatsApp
        </AbrirConversaMenuItem>
      )}
      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setScheduleOpen(true); }}>
        <Clock className="w-4 h-4 mr-2" /> Agendar mensagem
      </DropdownMenuItem>
      {/* "Ligar" é o único `real: false` do protótipo que dá para cumprir aqui
          sem a ficha: é um `tel:`, igual ao LeadModalToolbar. */}
      {telefoneNu && (
        <DropdownMenuItem asChild>
          <a href={`tel:${telefoneNu}`} onClick={(e) => e.stopPropagation()}>
            <Phone className="w-4 h-4 mr-2" /> Ligar
          </a>
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onClick={abrirFicha}>
        <NotebookPen className="w-4 h-4 mr-2" /> Registrar ligação {selo}
      </DropdownMenuItem>

      <DropdownMenuSeparator />
      <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
        Alterar o lead
      </DropdownMenuLabel>
      <DropdownMenuItem onClick={abrirFicha}>
        <MoveRight className="w-4 h-4 mr-2" /> Mover de etapa {selo}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={abrirFicha}>
        <Users className="w-4 h-4 mr-2" /> Responsáveis {selo}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={abrirFicha}>
        <Gem className="w-4 h-4 mr-2" /> Qualificação {selo}
      </DropdownMenuItem>
      <DropdownMenuItem onClick={abrirFicha}>
        <Tag className="w-4 h-4 mr-2" /> Etiquetas {selo}
      </DropdownMenuItem>
      {/* Checklists não leva selo: o slot da direita é do CONTADOR, como no
          protótipo (app.js:546). Verde quando tudo está feito. */}
      <DropdownMenuItem onClick={abrirChecklists}>
        <CheckSquare className="w-4 h-4 mr-2" /> Checklists
        {(lead.metrics?.checklistsTotal ?? 0) > 0 && (
          <span
            className={cn(
              "ml-auto pl-3 text-[10px] font-semibold tabular-nums",
              lead.metrics!.checklistsCompleted === lead.metrics!.checklistsTotal
                ? "text-emerald-500"
                : "text-muted-foreground",
            )}
          >
            {lead.metrics!.checklistsCompleted}/{lead.metrics!.checklistsTotal}
          </span>
        )}
      </DropdownMenuItem>
      {/* "Reunião" ABRE o diálogo de marcar, em vez de levar à ficha.
          Marcar reunião é a porta canônica da métrica (a agenda é a fonte),
          então o caminho tem de ser um clique — e não "abre a ficha, acha a
          aba, marca lá".

          Cai para a ficha quando não há `leadId`: `lead.id` aqui é o id da
          ENTRADA no funil, e `meetings.lead_id` é FK de `leads`. Marcar com o
          id errado gravaria reunião para um lead que não existe — o mesmo
          motivo pelo qual `LeadEtiquetasPopover` já se esconde sem `leadId`. */}
      {lead.leadId ? (
        <DropdownMenuItem
          onClick={(e) => { e.stopPropagation(); setReuniaoOpen(true); }}
        >
          <CalendarDays className="w-4 h-4 mr-2" /> Reunião
        </DropdownMenuItem>
      ) : (
        <DropdownMenuItem onClick={abrirFicha}>
          <CalendarDays className="w-4 h-4 mr-2" /> Reunião {selo}
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onClick={abrirFicha}>
        <Wallet className="w-4 h-4 mr-2" /> Orçamento {selo}
      </DropdownMenuItem>

      <DropdownMenuSeparator />
      <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
        Funil
      </DropdownMenuLabel>
      {/* Os 15 itens aparecem SEMPRE, como no protótipo. Quando a ação real
          não está disponível no contexto — `pipeOps` é null fora do
          PipeOpsProvider, `onRemove` não vem em toda superfície — o item não
          some: cai para a ficha, com o selo. Item que desaparece sem explicar
          faz o usuário procurar o que ele nunca vai achar. */}
      {/* "Adicionar a funil" tem portão PRÓPRIO e ele fica: o
          `AddToFunilMenuItem` devolve null quando a org não tem nenhum funil
          custom ativo, para não oferecer um diálogo que abriria vazio. Não
          troquei por um fallback com selo porque a ficha também não teria o
          que mostrar — seria mandar o usuário a lugar nenhum. */}
      {pipeOps && <AddToFunilMenuItem pipeOps={pipeOps} onSelect={() => setAddFunilOpen(true)} />}
      <DropdownMenuItem onClick={abrirFicha}>
        <XCircle className="w-4 h-4 mr-2" /> Marcar como perdido {selo}
      </DropdownMenuItem>
      {onRemove ? (
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
        >
          <Trash2 className="w-4 h-4 mr-2" /> Remover do funil
        </DropdownMenuItem>
      ) : (
        <DropdownMenuItem onClick={abrirFicha}>
          <Trash2 className="w-4 h-4 mr-2" /> Remover do funil {selo}
        </DropdownMenuItem>
      )}
      <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={abrirFicha}>
        <Trash2 className="w-4 h-4 mr-2" /> Excluir lead {selo}
      </DropdownMenuItem>
    </>
  );

  const modais = (
    <>
      {scheduleOpen && (
        <ScheduleMessageModal
          open={scheduleOpen}
          onOpenChange={setScheduleOpen}
          leadId={lead.leadId || ""}
          leadName={lead.name}
          phoneNumber={lead.phone || ""}
        />
      )}

      {reuniaoOpen && lead.leadId && (
        <CreateMeetingDialog
          open={reuniaoOpen}
          onOpenChange={setReuniaoOpen}
          initialLeadId={lead.leadId}
          initialLeadName={lead.name}
          /* Semeia o funil de ONDE o card está (S6): é o par (funil, lead) que
             resolve o negócio da reunião, e o vendedor não deve reescolher no
             picker o funil de que ele acabou de sair. */
          initialPipelineId={lead.pipelineId ?? null}
        />
      )}
      {pipeOps && addFunilOpen && (
        <AddToFunilDialog
          pipeOps={pipeOps}
          leadId={lead.id}
          open={addFunilOpen}
          onOpenChange={setAddFunilOpen}
        />
      )}
    </>
  );

  if (density === "compact") {
    return (
      <>
        <LeadCardCompact
          lead={lead}
          config={config}
          origin={origin}
          urgency={urgency}
          dateIndicator={dateIndicator}
          parsedDate={parsedDate}
          /* Montado AQUI e passado pronto: se o card compacto importasse
             `AbrirConversaButton`, fecharia um ciclo leads↔communication que o
             dependency-cruiser barra. Quem já tem essa dependência é este
             arquivo. `null` quando o telefone não é celular BR válido. */
          acaoWhatsapp={
            hasPhone ? (
              <AbrirConversaButton
                leadId={lead.leadId ?? lead.id}
                phone={lead.phone}
                variant="ghost"
                size="icon"
                className="size-[26px] rounded-md p-0 text-[#25D366] hover:bg-[#25D366]/15 hover:text-[#25D366]"
                title="Abrir WhatsApp"
              >
                <MessageCircle className="size-[15px]" />
              </AbrirConversaButton>
            ) : null
          }
          selected={selected}
          onSelect={onSelect}
          onClick={onClick}
          menuItems={itensDoMenu}
          menuAdicionar={itensDoMenuAdicionar}
          extraActions={extraActions}
        />
        {modais}
      </>
    );
  }

  return (
    <>
      <motion.div
        whileHover={{ scale: 1.005, y: -1 }}
        transition={{ type: "spring", stiffness: 400, damping: 30 }}
        data-lead-id={lead.id}
        className={cn(
          "kanban-card group cursor-pointer relative",
          lead.isInactive && "opacity-60",
          selected && "ring-2 ring-primary/50",
          !selected && lead.stageKey === "agendado" && lead.confirmationStatus === "confirmado" && "ring-1 ring-green-500/50",
          !selected && lead.stageKey === "agendado" && lead.confirmationStatus === "pre_confirmado" && "ring-1 ring-amber-500/50",
        )}
        onClick={onClick}
      >
        {/* ── Color stripes (Trello-style) ── */}
        <div className="p-3 pt-2.5 flex flex-col gap-2">
          {/* ── Selection checkbox ── */}
          {onSelect && (
            <button
              onClick={(e) => { e.stopPropagation(); onSelect(e); }}
              className={cn(
                "absolute top-2 left-2 z-10 w-5 h-5 rounded border flex items-center justify-center transition-all",
                selected
                  ? "bg-primary border-primary text-primary-foreground"
                  : "border-muted-foreground/40 bg-background/80 opacity-0 group-hover:opacity-100",
              )}
            >
              {selected && <Check className="w-3.5 h-3.5" />}
            </button>
          )}

          {/* ── Header: Avatar + Name + Kebab ──
               Anatomia do DataCrazy: à esquerda o "símbolo do cara" (a
               inicial, 32px); a QUALIFICAÇÃO sai daqui e vai para o canto
               superior direito, menor (22px) — é o lugar onde o concorrente
               põe o "#1".
               Ganho de brinde: hoje, quando o lead tem `avatar_url`, a foto
               COBRE as metades de qualificação e a leitura se perde. Separando
               os dois, eles passam a conviver. */}
          <div className="flex items-start gap-2.5">
            <div
              className="w-8 h-8 shrink-0 rounded-full grid place-items-center text-[12px] font-semibold overflow-hidden"
              style={{
                color: corDaInicial(lead.name),
                backgroundColor: `color-mix(in srgb, ${corDaInicial(lead.name)} 18%, transparent)`,
              }}
              aria-hidden
            >
              {lead.avatarUrl
                ? <img src={lead.avatarUrl} alt="" className="w-full h-full object-cover" />
                : (lead.name?.trim()?.[0]?.toUpperCase() ?? "?")}
            </div>
            <div className="flex-1 min-w-0">
              {editingField === "name" ? (
                <input
                  ref={editRef}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitEdit();
                    if (e.key === "Escape") cancelEdit();
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="font-semibold text-[13px] leading-tight w-full bg-transparent border-b border-primary outline-none px-0 py-0"
                />
              ) : (
                <h4
                  className={cn(
                    "font-semibold text-[13px] leading-tight line-clamp-2 group-hover:text-primary transition-colors",
                    onInlineEdit && "cursor-text",
                  )}
                  onDoubleClick={(e) => startEdit("name", lead.name, e)}
                  title={lead.erpCode ? `${lead.erpCode} - ${lead.name}` : lead.name}
                >
                  {lead.erpCode && (
                    <span className="font-normal text-muted-foreground">{lead.erpCode} - </span>
                  )}
                  {lead.name}
                </h4>
              )}
              {lead.company && (
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground mt-0.5 min-w-0">
                  <Building2 className="w-3 h-3 shrink-0 opacity-60" />
                  {editingField === "company_name" ? (
                    <input
                      ref={editRef}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitEdit();
                        if (e.key === "Escape") cancelEdit();
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="flex-1 min-w-0 bg-transparent border-b border-primary outline-none text-[11px] px-0 py-0"
                    />
                  ) : (
                    <span
                      className={cn("truncate", onInlineEdit && "cursor-text")}
                      onDoubleClick={(e) => startEdit("company_name", lead.company ?? "", e)}
                    >
                      {lead.company}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {/* A qualificação, no lugar do "#1" do DataCrazy: 22px contra os
                  32px do avatar — menor que o símbolo do cara, como pedido. */}
              <LeadCardAvatar
                preQualTier={lead.preQualTier}
                qualTier={lead.qualTier}
                name={lead.name}
                size={22}
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                  <button className="p-0.5 rounded hover:bg-muted text-muted-foreground">
                    <MoreVertical className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">{itensDoMenu}</DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* ── Badges discretos (urgência + idade no stage + date indicator + potencial) ── */}
          {(urgency || dateIndicator || lead.potencial || lead.isInactive || lead.stageEnteredAt) && (
            <div className="flex flex-wrap gap-1">
              <Badge
                variant="outline"
                className="text-[9px] px-1.5 py-0 h-[16px] border font-medium"
                style={{ backgroundColor: origin.bg, color: origin.text, borderColor: `${origin.text}30` }}
              >
                {origin.label}
              </Badge>
              {urgency && (
                <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0 h-[16px] font-medium", urgency.className)}>
                  {urgency.label}
                </Badge>
              )}
              {lead.potencial && (
                <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0 h-[16px] font-medium", getPotencialClass(lead.potencial))}>
                  {lead.potencial.charAt(0).toUpperCase() + lead.potencial.slice(1)}
                </Badge>
              )}
              {lead.isInactive && (
                <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-[16px] font-medium bg-destructive/10 text-destructive border-destructive/30">
                  Inativo
                </Badge>
              )}
              {lead.stageEnteredAt && (() => {
                const days = Math.floor((Date.now() - new Date(lead.stageEnteredAt).getTime()) / 86400000);
                if (days < 3) return null;
                const cls = days >= 14 ? "bg-red-500/10 text-red-500 border-red-500/30"
                  : days >= 7 ? "bg-amber-500/10 text-amber-500 border-amber-500/30"
                  : "bg-blue-500/10 text-blue-500 border-blue-500/30";
                return (
                  <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0 h-[16px] font-medium", cls)}>
                    {days}d
                  </Badge>
                );
              })()}
              {dateIndicator && (
                <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0 h-[16px] font-medium", dateIndicator.className)}>
                  {dateIndicator.label}
                </Badge>
              )}
            </div>
          )}

          {/* ── Contact data with left accent ── */}
          {hasContactData && (
            <div className="border-l-2 border-primary/50 pl-3 py-0.5 space-y-0.5">
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
                  <span className="text-muted-foreground">{lead.value != null ? "Valor" : "Faturamento"}</span>
                  <span className="font-semibold text-emerald-500 text-right">
                    {lead.value != null
                      ? formatCurrency(lead.value)
                      : formatFaturamento(lead.faturamento)}
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
              className="flex items-center gap-1.5 text-[11px] text-primary hover:underline"
            >
              <Video className="w-3 h-3 shrink-0" /> Entrar no Google Meet
            </a>
          )}

          {/* ── Products (max 3) ── */}
          {config.showProducts && lead.products && lead.products.length > 0 && (
            <div className="space-y-1">
              {lead.products.slice(0, 3).map((p, i) => (
                <div key={i} className="flex items-center justify-between gap-2 p-1.5 rounded bg-muted/50 text-xs">
                  <div className="flex items-center gap-1 min-w-0">
                    {p.type && (
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[9px] px-1 py-0 h-4 shrink-0",
                          p.type === "mrr" ? "bg-blue-500/10 text-blue-600 border-blue-500/20"
                            : p.type === "unitario" ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
                            : "bg-primary/10 text-primary border-primary/20",
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
            <p className="text-xs text-muted-foreground line-clamp-2 p-1.5 rounded bg-muted/30 border border-border/50">
              {lead.notes}
            </p>
          )}

          {/* ── Quick Actions Row ── */}
          {(hasPhone || !!onQuickAction) && (
            <div className="flex items-center gap-1.5">
              {hasPhone && (
                <AbrirConversaButton
                  leadId={lead.id}
                  phone={lead.phone}
                  className="flex items-center gap-1.5 flex-1 justify-center px-2 py-1.5 h-auto rounded-md bg-[#25D366] hover:bg-[#1da851] text-white text-xs font-medium transition-colors"
                  title="Abrir WhatsApp"
                >
                  <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
                </AbrirConversaButton>
              )}
              {onQuickAction && <QuickActionPopover onAction={onQuickAction} />}
            </div>
          )}

          {/* ── Extra actions slot (ex: confirmação de reunião) ── */}
          {extraActions}

          {/* ── Etiquetas, ABAIXO do negócio ──
               Saíram do topo do card (onde eram riscos de 1,5px sem rótulo) e
               vieram para cá, com o nome legível, como no card do DataCrazy.

               A porta para MEXER nelas fica ao lado, e não dentro do menu: o
               menu "Etiquetas" leva à ficha, e trocar uma etiqueta era abrir a
               ficha para cada lead. Sem `leadId` o botão não aparece — `id`
               aqui é o da ENTRADA no funil, e pendurar etiqueta nele escreveria
               num lead que não existe. */}
          {lead.leadId ? (
            <div className="flex flex-wrap items-center gap-1">
              <LeadCardLabels tags={lead.tags} />
              <LeadEtiquetasPopover
                leadId={lead.leadId}
                quantidade={lead.tags?.length ?? 0}
                rotulo={lead.tags?.length ? undefined : "etiqueta"}
              />
            </div>
          ) : (
            <LeadCardLabels tags={lead.tags} />
          )}

          {/* ── Footer: Inline metrics (Trello-style) ── */}
          <div className="flex items-center justify-between pt-2 mt-auto border-t border-border/40">
            <LeadCardMetrics
              leadId={lead.leadId}
              commentsCount={lead.metrics?.commentsCount ?? 0}
              checklistsCompleted={lead.metrics?.checklistsCompleted ?? 0}
              checklistsTotal={lead.metrics?.checklistsTotal ?? 0}
              preSaleResponsible={lead.preSaleResponsible}
              saleResponsible={lead.saleResponsible}
              className="flex-1"
            />
            {lead.createdAt && (
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0 ml-2">
                <Clock className="w-3 h-3" />
                <span>{formatDistanceToNow(new Date(lead.createdAt), { addSuffix: true, locale: ptBR })}</span>
              </div>
            )}
          </div>
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

      {reuniaoOpen && lead.leadId && (
        <CreateMeetingDialog
          open={reuniaoOpen}
          onOpenChange={setReuniaoOpen}
          initialLeadId={lead.leadId}
          initialLeadName={lead.name}
          /* Semeia o funil de ONDE o card está (S6): é o par (funil, lead) que
             resolve o negócio da reunião, e o vendedor não deve reescolher no
             picker o funil de que ele acabou de sair. */
          initialPipelineId={lead.pipelineId ?? null}
        />
      )}

      {pipeOps && addFunilOpen && (
        <AddToFunilDialog
          pipeOps={pipeOps}
          leadId={lead.id}
          open={addFunilOpen}
          onOpenChange={setAddFunilOpen}
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
