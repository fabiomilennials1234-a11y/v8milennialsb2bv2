/**
 * Floating popover that appears on event click.
 *
 * Source-aware: shows different information and actions
 * depending on the event source (meeting, follow_up,
 * scheduled_message, pipe_confirmacao, google).
 */

import {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
} from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { motion, AnimatePresence } from "framer-motion";
import {
  Clock,
  MapPin,
  Video,
  ExternalLink,
  User,
  X,
  Pencil,
  Trash2,
  Loader2,
  CheckCircle2,
  MessageSquare,
  GitBranch,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { AttendanceOutcome, UnifiedEvent, EventSource } from "./agenda-helpers";
import {
  SOURCE_LABELS,
  SOURCE_COLORS,
  outcomeOf,
  podeRegistrarResultado,
  posicionarPopover,
  POPOVER_ALTURA_MAXIMA,
} from "./agenda-helpers";
import { AgendaOutcomeToggle } from "./AgendaOutcomeToggle";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PopoverState {
  event: UnifiedEvent;
  x: number;
  y: number;
}

interface EventDetailPopoverProps {
  state: PopoverState;
  onClose: () => void;
  onDeleteMeeting: (eventId: string) => Promise<void>;
  onDeleteGoogleEvent: (event: UnifiedEvent) => Promise<void>;
  /**
   * Registra o resultado. Recebe `null` quando a pessoa desmarca. Ausente
   * quando o evento não é registrável — ver `podeRegistrarResultado`.
   */
  onSetOutcome?: (
    event: UnifiedEvent,
    resultado: AttendanceOutcome | null,
  ) => Promise<void>;
  /**
   * Abre a edição. Só recebe reunião de verdade (`source === "meeting"`) — as
   * outras quatro fontes da Agenda são projeções de outras tabelas
   * (`follow_ups`, `scheduled_messages`, `pipe_confirmacao`, `meeting_events`)
   * e não têm o que este formulário grava.
   */
  onEditMeeting?: (event: UnifiedEvent) => void;
}

// ─── Source icon helper ───────────────────────────────────────────────────────

function SourceIcon({ source }: { source: EventSource }) {
  switch (source) {
    case "follow_up":
      return <CheckCircle2 className="w-3 h-3" />;
    case "scheduled_message":
      return <MessageSquare className="w-3 h-3" />;
    case "pipe_confirmacao":
      return <GitBranch className="w-3 h-3" />;
    case "google":
      return <Video className="w-3 h-3" />;
    default:
      return <Clock className="w-3 h-3" />;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function EventDetailPopover({
  state,
  onClose,
  onDeleteMeeting,
  onDeleteGoogleEvent,
  onSetOutcome,
  onEditMeeting,
}: EventDetailPopoverProps) {
  const { event, x, y } = state;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x + 14, top: y - 16 });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [savingOutcome, setSavingOutcome] = useState(false);

  // Otimista: o par de botões precisa responder no clique. Sem isto o
  // selecionado só mudaria depois do refetch da agenda, e a pessoa clicaria de
  // novo achando que não pegou.
  const [outcomeLocal, setOutcomeLocal] = useState<AttendanceOutcome | null>(
    () => outcomeOf(event),
  );

  const podeRegistrar = podeRegistrarResultado(event) && !!onSetOutcome;

  const handleOutcome = async (proximo: AttendanceOutcome | null) => {
    if (!onSetOutcome) return;
    const anterior = outcomeLocal;
    setOutcomeLocal(proximo);
    setSavingOutcome(true);
    try {
      await onSetOutcome(event, proximo);
    } catch {
      // A mutation já avisa por toast; aqui só desfaz o otimismo para a tela
      // não mentir sobre o que está gravado.
      setOutcomeLocal(anterior);
    } finally {
      setSavingOutcome(false);
    }
  };

  /**
   * Recoloca o card para ele caber inteiro na janela.
   *
   * `offsetWidth`/`offsetHeight` e não `getBoundingClientRect()`: o rect vem
   * com o `scale: 0.96` da animação de entrada aplicado, e mediria ~4% a menos
   * do que o card vai realmente ocupar.
   */
  const reposicionar = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setPos(
      posicionarPopover({
        x,
        y,
        largura: el.offsetWidth,
        altura: el.offsetHeight,
        vw: window.innerWidth,
        vh: window.innerHeight,
      }),
    );
  }, [x, y]);

  /**
   * 🚨 A conta tem que refazer quando o card MUDA DE TAMANHO, não só quando o
   * clique muda de lugar.
   *
   * Antes isto era um `useEffect` com dependências `[x, y]`, e o bloco de
   * confirmação da exclusão (mais abaixo) cresce o card ~72px depois de ele já
   * estar grudado no rodapé da tela. Medido no navegador, janela de 640px,
   * clique em y=410: o botão "Excluir" nascia 19px ABAIXO da borda e o
   * Playwright não conseguia clicar nele. Para quem usa, a lixeira era um
   * botão que não fazia nada.
   *
   * Quem dispara o recálculo é o `ResizeObserver` — e não uma dependência em
   * `confirmDelete` — porque o crescimento é ANIMADO (`height: 0 → auto`, 150ms
   * em `AnimatePresence`): no instante em que o estado muda, o card ainda tem
   * a altura antiga, e medir ali leria o valor errado.
   *
   * `useLayoutEffect` para o primeiro posicionamento acontecer antes da
   * pintura — senão o card aparece no lugar errado e pula.
   */
  useLayoutEffect(() => {
    reposicionar();

    // Redimensionar a janela muda `vh` sem mudar o card — o `ResizeObserver`
    // não veria isso.
    window.addEventListener("resize", reposicionar);

    const el = ref.current;
    const observer =
      el && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => reposicionar())
        : null;
    observer?.observe(el as Element);

    return () => {
      window.removeEventListener("resize", reposicionar);
      observer?.disconnect();
    };
  }, [reposicionar]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const t = setTimeout(
      () => document.addEventListener("mousedown", handler),
      0,
    );
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", handler);
    };
  }, [onClose]);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      if (event.source === "google") {
        await onDeleteGoogleEvent(event);
      } else if (event.source === "meeting") {
        // Strip the "meeting-" prefix to get the actual DB id
        const rawId = event.id.replace(/^meeting-/, "");
        await onDeleteMeeting(rawId);
      }
      onClose();
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const color = event.color;
  const canDelete = event.source === "meeting" || event.source === "google";

  /**
   * Só reunião interna se edita por aqui. `google` fica de fora de propósito:
   * o evento vive no calendário do Google e é a API deles quem o altera —
   * gravar em `meetings` não mudaria nada lá, e a tela mentiria.
   */
  const podeEditar = event.source === "meeting" && !!onEditMeeting;

  // Delete confirmation label
  const deleteLabel =
    event.source === "google"
      ? "Excluir este evento do Google Calendar?"
      : "Excluir esta reuniao?";

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.96, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.12 }}
      // `overflow-y-auto` e não `overflow-hidden`: janela baixa (ou evento com
      // descrição longa) deixa o card mais alto que a tela, e aí não existe
      // posição boa — o conteúdo tem que rolar por dentro em vez de ser
      // cortado em silêncio, que era o que o `hidden` fazia.
      className="fixed z-50 w-72 bg-card border border-border/50 rounded-xl shadow-2xl dark:shadow-none dark:ring-1 dark:ring-border overflow-y-auto"
      style={{
        left: pos.left,
        top: pos.top,
        maxHeight: POPOVER_ALTURA_MAXIMA,
      }}
    >
      {/* Color bar — `sticky` para sobreviver à rolagem interna. */}
      <div
        className="sticky top-0 z-10 h-[3px]"
        style={{ backgroundColor: color }}
      />

      <div className="p-4 space-y-3">
        {/* Title + actions */}
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-sm leading-snug flex-1 text-foreground">
            {event.title}
          </h3>
          <div className="flex items-center gap-1 shrink-0 mt-0.5">
            {podeEditar && (
              <button
                onClick={() => onEditMeeting?.(event)}
                className="text-muted-foreground hover:text-foreground transition-colors rounded p-0.5"
                title="Editar evento"
                aria-label="Editar evento"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
            {canDelete && (
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-muted-foreground hover:text-destructive transition-colors rounded p-0.5"
                title="Excluir evento"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground transition-colors rounded p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Source badge */}
        {/* A cor da fonte fica na borda e no banho de fundo, NUNCA no texto —
            mesmo idioma de `MonthEventPill` e `DayAgendaView`, e pelo mesmo
            motivo: `SOURCE_COLORS.meeting` é o ouro da marca, e ouro como texto
            sobre `--card` dá ~1,5:1 no tema claro. DESIGN.md proíbe.

            O sufixo hexadecimal de alfa (`${cor}50`) que estava aqui também
            estava quebrado: três das cinco fontes são `hsl(...)`, e
            `"hsl(47, 100%, 50%)50"` é declaração inválida, descartada em
            silêncio. `color-mix` tolera hex E hsl, então as cinco tingem igual. */}
        <Badge
          variant="outline"
          className="h-5 gap-1 px-2 text-[10px] text-foreground"
          style={{
            borderColor: SOURCE_COLORS[event.source] ?? color,
            backgroundColor: `color-mix(in srgb, ${SOURCE_COLORS[event.source] ?? color} 16%, transparent)`,
          }}
        >
          <SourceIcon source={event.source} />
          {SOURCE_LABELS[event.source] ?? event.source}
        </Badge>

        {/* Time */}
        <div className="flex items-start gap-2 text-xs">
          <Clock className="w-3.5 h-3.5 shrink-0 mt-0.5 text-muted-foreground" />
          <div>
            <p className="text-foreground/90 capitalize">
              {format(event.start, "EEEE, d 'de' MMMM", { locale: ptBR })}
            </p>
            <p className="text-muted-foreground">
              {event.allDay
                ? "Dia todo"
                : `${format(event.start, "HH:mm")} - ${format(event.end, "HH:mm")}`}
            </p>
          </div>
        </div>

        {/* Creator / owner */}
        {event.creatorName && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <User className="w-3.5 h-3.5 shrink-0" />
            <span>{event.creatorName}</span>
          </div>
        )}

        {/* Location */}
        {event.location && (
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{event.location}</span>
          </div>
        )}

        {/* Meet / video link */}
        {event.meetLink && /^https?:\/\//i.test(event.meetLink) && (
          <a
            href={event.meetLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-xs text-primary hover:text-primary/80 transition-colors"
          >
            <Video className="w-3.5 h-3.5 shrink-0" />
            Entrar na reuniao
            <ExternalLink className="w-2.5 h-2.5" />
          </a>
        )}

        {/* Lead link */}
        {event.leadId && (
          <a
            href={`/leads?lead=${event.leadId}`}
            className="flex items-center gap-2 text-xs text-primary hover:text-primary/80 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5 shrink-0" />
            {event.leadName
              ? `${event.leadName}${event.leadCompany ? ` - ${event.leadCompany}` : ""}`
              : "Ver lead no sistema"}
          </a>
        )}

        {/* Source-specific links */}
        {event.source === "follow_up" && (
          <a
            href="/follow-ups"
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            Abrir em Follow-ups
          </a>
        )}

        {event.source === "pipe_confirmacao" && (
          <a
            href="/funil/confirmacao"
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <GitBranch className="w-3.5 h-3.5 shrink-0" />
            Abrir em Confirmacao
          </a>
        )}

        {event.source === "google" && event.googleHtmlLink && /^https?:\/\//i.test(event.googleHtmlLink) && (
          <a
            href={event.googleHtmlLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5 shrink-0" />
            Abrir no Google Calendar
          </a>
        )}

        {/* Description */}
        {event.description && (
          <p className="text-xs text-muted-foreground bg-muted/40 rounded-lg p-2.5 leading-relaxed">
            {event.description}
          </p>
        )}

        {/* Resultado — vale para os cinco tipos criados pela Agenda */}
        {podeRegistrar && (
          <AgendaOutcomeToggle
            value={outcomeLocal}
            onChange={handleOutcome}
            saving={savingOutcome}
            disabled={deleting}
          />
        )}

        {/* Delete confirm -- inline, no modal */}
        <AnimatePresence>
          {confirmDelete && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
            >
              <div className="pt-1 border-t border-border/30 space-y-2">
                <p className="text-[11px] text-destructive font-medium">
                  {deleteLabel}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirmDelete(false)}
                    disabled={deleting}
                    className="flex-1 text-[11px] py-1.5 rounded-md border border-border/50 text-muted-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="flex-1 text-[11px] py-1.5 rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    {deleting ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Trash2 className="w-3 h-3" />
                    )}
                    Excluir
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

export type { PopoverState };
