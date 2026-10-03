/**
 * Coluna direita da Agenda (V5, mockup): o PRÓXIMO compromisso em destaque,
 * os cinco seguintes e o estado do Google Agenda.
 *
 * Tudo sai do que a tela já carregou (`allEvents`, `useGoogleCalendarStatus`):
 * nenhuma consulta nova. O que o mockup punha a mais no cartão — valor do
 * negócio, score, pauta do Copilot — não existe no evento e não entra.
 */
import { Link } from "react-router-dom";
import { formatDistanceToNowStrict, format, isToday, isTomorrow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarCheck2, ExternalLink, MapPin, User, Video } from "lucide-react";

import { FocusCard, FocusTile, InkPanel } from "@/components/ui/bento";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { UnifiedEvent } from "./agenda-helpers";

const GOOGLE_SETTINGS_PATH = "/configuracoes/integracoes";

function quando(d: Date) {
  if (isToday(d)) return format(d, "HH:mm");
  if (isTomorrow(d)) return `amanhã ${format(d, "HH:mm")}`;
  return format(d, "EEE dd/MM HH:mm", { locale: ptBR });
}

export function AgendaProximo({
  events,
  onEventClick,
  googleConnected,
  googleEmail,
  className,
}: {
  /** Eventos já filtrados pela tela (status, tipo, dono). */
  events: UnifiedEvent[];
  onEventClick: (e: React.MouseEvent, event: UnifiedEvent) => void;
  googleConnected: boolean;
  googleEmail?: string | null;
  className?: string;
}) {
  const agora = Date.now();
  const proximos = events
    .filter((e) => !e.allDay && e.end.getTime() >= agora && !/cancel/i.test(e.status ?? ""))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const proximo = proximos[0];
  const seguintes = proximos.slice(1, 6);

  return (
    <div className={cn("flex min-w-0 flex-col gap-4", className)}>
      <InkPanel title="Próximo compromisso" count={proximos.length > 0 ? `${proximos.length} à frente` : undefined}>
        {proximo ? (
          <div className="flex flex-col gap-3">
            <FocusCard className="gap-3 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="rounded-full bg-tinta px-2.5 py-1 text-[11px] font-bold text-tinta-foreground">
                  {proximo.start.getTime() <= agora
                    ? "Acontecendo agora"
                    : `Em ${formatDistanceToNowStrict(proximo.start, { locale: ptBR })}`}
                </span>
                <span className="font-mono text-[13px] font-bold tabular-nums">{quando(proximo.start)}</span>
              </div>
              <div className="min-w-0">
                <p className="line-clamp-2 text-[1.3rem] font-extrabold leading-tight tracking-[-0.03em]">
                  {proximo.title || "Compromisso"}
                </p>
                {(proximo.leadName || proximo.leadCompany) && (
                  <p className="mt-1 truncate text-[12.5px] text-primary-foreground/70">
                    {[proximo.leadName, proximo.leadCompany].filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <FocusTile className="flex items-center gap-2">
                  <User className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-bold">{proximo.creatorName ?? "Sem responsável"}</span>
                    <span className="block text-[10.5px] text-primary-foreground/65">Responsável</span>
                  </span>
                </FocusTile>
                <FocusTile className="flex items-center gap-2">
                  {proximo.meetLink ? <Video className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />}
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-bold">
                      {proximo.meetLink ? "Online" : proximo.location ?? "Sem local"}
                    </span>
                    <span className="block text-[10.5px] text-primary-foreground/65">Onde</span>
                  </span>
                </FocusTile>
              </div>
              <div className="flex items-center gap-2">
                {proximo.meetLink ? (
                  <Button asChild variant="on-gold" className="flex-1">
                    <a href={proximo.meetLink} target="_blank" rel="noreferrer">
                      Entrar na reunião
                      <ExternalLink aria-hidden />
                    </a>
                  </Button>
                ) : (
                  <Button type="button" variant="on-gold" className="flex-1" onClick={(e) => onEventClick(e, proximo)}>
                    Ver detalhes
                  </Button>
                )}
              </div>
            </FocusCard>

            {seguintes.length > 0 && (
              <ul className="flex flex-col gap-0.5" aria-label="Próximos compromissos">
                {seguintes.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={(ev) => onEventClick(ev, e)}
                      className="flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left transition-colors hover:bg-white/[.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <span className="w-[64px] shrink-0 font-mono text-[11.5px] tabular-nums text-tinta-muted">{quando(e.start)}</span>
                      <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: e.color }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-semibold text-tinta-foreground">{e.title || "Compromisso"}</span>
                        {e.leadName && <span className="block truncate text-[11px] text-tinta-muted">{e.leadName}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5 px-4 py-8 text-center">
            <CalendarCheck2 className="h-6 w-6 text-primary" aria-hidden />
            <p className="text-[14px] font-bold">Nada à frente</p>
            <p className="max-w-[260px] text-[12px] text-tinta-muted">Nenhum compromisso daqui para a frente com os filtros atuais.</p>
          </div>
        )}
      </InkPanel>

      <section className="flex items-center gap-3 rounded-card border border-card-border bg-card p-4 shadow-relevo">
        <span
          aria-hidden
          className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-xl",
            googleConnected ? "bg-success/10 text-success-strong" : "bg-muted text-foreground/70",
          )}
        >
          <CalendarCheck2 className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold">Google Agenda</p>
          <p className="truncate text-[11.5px] text-muted-foreground">
            {googleConnected ? googleEmail ?? "Conectada" : "Não conectada — os eventos do Google não aparecem aqui"}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to={GOOGLE_SETTINGS_PATH}>{googleConnected ? "Gerenciar" : "Conectar"}</Link>
        </Button>
      </section>
    </div>
  );
}
