import { useState } from "react";
import { toast } from "sonner";
import { Loader2, AlertTriangle, LifeBuoy, MessageCircleQuestion, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useCreateSupportTicket } from "@/modules/platform/hooks/useSupportTickets";
import { useCaptureSupportContext } from "@/modules/platform/hooks/useSupportContext";
import { parseRateLimitError, rateLimitMessage } from "@/modules/platform/lib/support-rate-limit";
import {
  DRAFT_ERROR_LABELS,
  IMPACTO_LABELS,
  TIPO_LABELS,
  TITLE_MAX,
  emptyTicketDraft,
  ticketDraftErrors,
  type TicketDraft,
  type TicketImpacto,
  type TicketTipo,
} from "@/modules/platform/lib/support-ticket-draft";

const TIPO_ICONS: Record<TicketTipo, typeof AlertTriangle> = {
  bug: AlertTriangle,
  duvida: MessageCircleQuestion,
  solicitacao: Sparkles,
};

interface Props {
  onCreated: (ticketId: string) => void;
  onCancel: () => void;
}

export function NewTicketForm({ onCreated, onCancel }: Props) {
  const [draft, setDraft] = useState<TicketDraft>(emptyTicketDraft());
  const [submitted, setSubmitted] = useState(false);
  const createTicket = useCreateSupportTicket();
  const captureSupportContext = useCaptureSupportContext();

  const errors = ticketDraftErrors(draft);
  // Erros só aparecem depois da primeira tentativa. Gritar com quem ainda não
  // terminou de digitar é hostil.
  const visibleErrors = submitted ? errors : [];
  const has = (e: (typeof errors)[number]) => visibleErrors.includes(e);

  const patch = (p: Partial<TicketDraft>) => setDraft((d) => ({ ...d, ...p }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (errors.length > 0) return;

    try {
      // Silencioso: rota sanitizada, versao, browser, session_id e os ultimos
      // erros deste browser. Nada aqui expoe conteudo. (Screenshot e outra
      // conversa, com aviso explicito — fatia #1025.)
      const ticket = await createTicket.mutateAsync({
        draft,
        supportContext: captureSupportContext(),
      });
      toast.success("Chamado aberto. A gente te responde por aqui.");
      onCreated(ticket.id);
    } catch (err) {
      // O trigger no banco recusa a sexta abertura da hora. A mensagem oferece a
      // saída — responder no chamado existente — em vez de acusar.
      const limit = parseRateLimitError(err);
      if (limit.limited) {
        toast.error(rateLimitMessage(limit.nextAt), { duration: 8000 });
        return;
      }
      toast.error(err instanceof Error ? err.message : "Não deu para abrir o chamado.");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
      <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
        <fieldset className="space-y-2.5">
          <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            O que aconteceu?
          </Label>
          <div className="grid gap-2">
            {(Object.keys(TIPO_LABELS) as TicketTipo[]).map((tipo) => {
              const Icon = TIPO_ICONS[tipo];
              const active = draft.tipo === tipo;
              return (
                <button
                  key={tipo}
                  type="button"
                  onClick={() => patch({ tipo })}
                  aria-pressed={active}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border px-3.5 py-2.5 text-left text-sm transition-colors",
                    active
                      ? "border-primary/50 bg-primary/10 text-foreground"
                      : "border-border/60 text-muted-foreground hover:bg-muted/40",
                  )}
                >
                  <Icon className={cn("h-4 w-4 shrink-0", active && "text-primary")} aria-hidden />
                  {TIPO_LABELS[tipo]}
                </button>
              );
            })}
          </div>
          {has("tipo_missing") && <FieldError>{DRAFT_ERROR_LABELS.tipo_missing}</FieldError>}
        </fieldset>

        <fieldset className="space-y-2.5">
          <Label htmlFor="ticket-title" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Assunto
          </Label>
          <Input
            id="ticket-title"
            value={draft.title}
            maxLength={TITLE_MAX}
            onChange={(e) => patch({ title: e.target.value })}
            placeholder="Kanban trava ao arrastar um card"
            aria-invalid={has("title_too_short") || has("title_too_long")}
          />
          {has("title_too_short") && <FieldError>{DRAFT_ERROR_LABELS.title_too_short}</FieldError>}
          {has("title_too_long") && <FieldError>{DRAFT_ERROR_LABELS.title_too_long}</FieldError>}
        </fieldset>

        <fieldset className="space-y-2.5">
          <Label htmlFor="ticket-description" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Detalhes <span className="normal-case tracking-normal text-muted-foreground/60">(opcional)</span>
          </Label>
          <Textarea
            id="ticket-description"
            value={draft.description}
            onChange={(e) => patch({ description: e.target.value })}
            rows={4}
            placeholder="O que você estava fazendo quando aconteceu?"
            className="resize-none"
          />
        </fieldset>

        {/*
          Pergunta factual: o usuário sabe se está parado. Ele não sabe se o
          defeito é crítico — isso depende de quantas outras empresas foram
          atingidas, e só o suporte enxerga isso. Daí não existir um seletor de
          severidade aqui.
        */}
        <fieldset className="space-y-2.5">
          <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Isso te impede de trabalhar agora?
          </Label>
          <div className="grid gap-2">
            {(Object.keys(IMPACTO_LABELS) as TicketImpacto[]).map((impacto) => {
              const active = draft.impacto === impacto;
              return (
                <button
                  key={impacto}
                  type="button"
                  onClick={() => patch({ impacto })}
                  aria-pressed={active}
                  className={cn(
                    "flex items-center gap-3 rounded-lg border px-3.5 py-2.5 text-left text-sm transition-colors",
                    active
                      ? "border-primary/50 bg-primary/10 text-foreground"
                      : "border-border/60 text-muted-foreground hover:bg-muted/40",
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      active ? "bg-primary" : "bg-muted-foreground/40",
                    )}
                    aria-hidden
                  />
                  {IMPACTO_LABELS[impacto]}
                </button>
              );
            })}
          </div>
          {has("impacto_missing") && <FieldError>{DRAFT_ERROR_LABELS.impacto_missing}</FieldError>}
        </fieldset>
      </div>

      <div className="flex items-center gap-2 border-t border-border/50 bg-muted/20 px-6 py-4">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={createTicket.isPending}>
          Cancelar
        </Button>
        <Button type="submit" className="flex-1 gap-2" disabled={createTicket.isPending}>
          {createTicket.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <LifeBuoy className="h-4 w-4" aria-hidden />
          )}
          Abrir chamado
        </Button>
      </div>
    </form>
  );
}

function FieldError({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="text-xs text-destructive">
      {children}
    </p>
  );
}
