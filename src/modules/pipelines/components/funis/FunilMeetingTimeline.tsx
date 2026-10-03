import { useMemo } from "react";
import { addDays, format, isSameDay, startOfDay } from "date-fns";
import { CalendarClock } from "lucide-react";
import { IconChip } from "@/components/ui/bento";
import { cn } from "@/lib/utils";
import type { CustomPipelineStage } from "@/contracts/pipe";

/**
 * Visão Timeline do funil — a agenda de reuniões (hoje e amanhã) na forma do
 * mockup V5: cartão branco, eixo de tempo no topo, uma linha por negócio com a
 * barra na hora da reunião, cor = etapa atual, linha vermelha em "agora".
 *
 * O dado é o MESMO de antes (decisão do CTO: a Timeline continua sendo a
 * agenda de reuniões do funil) — só que no eixo do dia em vez de lista.
 * Reunião não tem duração gravada; a barra marca o INÍCIO.
 */

interface MeetingItem {
  id: string;
  lead_id?: string | null;
  stage_key?: string | null;
  status?: string | null;
  meeting_date?: string | null;
  lead?: { name?: string | null; company?: string | null } | null;
}

interface FunilMeetingTimelineProps {
  meetings: MeetingItem[];
  stages: CustomPipelineStage[];
  onMeetingClick?: (meeting: MeetingItem) => void;
}

const FALLBACK = "#64748b";

/** Cor da etapa é dado (hex escolhido pelo usuário): o texto da barra se ajusta à luminância. */
function textOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "text-white";
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "text-black/85" : "text-white";
}

function initials(text: string): string {
  return (
    text
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?"
  );
}

export function FunilMeetingTimeline({ meetings, stages, onMeetingClick }: FunilMeetingTimelineProps) {
  const now = new Date();
  const stageByKey = useMemo(() => new Map(stages.map((s) => [s.stage_key, s])), [stages]);

  const days = useMemo(() => {
    const today = startOfDay(new Date());
    const tomorrow = addDays(today, 1);
    const withDate = meetings
      .filter((m) => m.meeting_date && !Number.isNaN(new Date(m.meeting_date).getTime()))
      .sort((a, b) => new Date(a.meeting_date!).getTime() - new Date(b.meeting_date!).getTime());
    return [
      { key: "hoje", label: "Hoje", date: today, items: withDate.filter((m) => isSameDay(new Date(m.meeting_date!), today)) },
      { key: "amanha", label: "Amanhã", date: tomorrow, items: withDate.filter((m) => isSameDay(new Date(m.meeting_date!), tomorrow)) },
    ].filter((d) => d.items.length > 0);
  }, [meetings]);

  // Eixo: 8h–19h por padrão, alargado para caber a primeira e a última reunião.
  const { startHour, endHour } = useMemo(() => {
    let min = 8;
    let max = 19;
    for (const d of days) {
      for (const m of d.items) {
        const h = new Date(m.meeting_date!).getHours();
        min = Math.min(min, h);
        max = Math.max(max, h + 1);
      }
    }
    return { startHour: min, endHour: Math.min(24, max) };
  }, [days]);
  const span = (endHour - startHour) * 60;
  const ticks = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i).filter(
    (_, i, arr) => arr.length <= 9 || i % 2 === 0,
  );
  const pos = (d: Date) => Math.min(100, Math.max(0, ((d.getHours() * 60 + d.getMinutes() - startHour * 60) / span) * 100));

  // Legenda: só as etapas que aparecem.
  const legend = useMemo(() => {
    const keys = new Set(days.flatMap((d) => d.items.map((m) => m.stage_key ?? m.status ?? "")));
    return stages.filter((s) => keys.has(s.stage_key));
  }, [days, stages]);

  return (
    <section className="rounded-card border border-card-border bg-card p-5 shadow-relevo" data-testid="funil-meeting-timeline">
      <div className="flex flex-wrap items-start gap-3">
        <IconChip icon={CalendarClock} tone="gold" />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold tracking-tight">Agenda de reuniões</h2>
          <p className="text-xs text-muted-foreground">Hoje e amanhã neste funil · a barra marca o horário · cor = etapa atual</p>
        </div>
        {legend.length > 0 && (
          <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground" aria-label="Etapas">
            {legend.map((s) => (
              <li key={s.stage_key} className="inline-flex items-center gap-1.5">
                <span aria-hidden className="size-2 rounded-[3px]" style={{ background: s.color || FALLBACK }} />
                {s.name}
              </li>
            ))}
          </ul>
        )}
      </div>

      {days.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          Nenhuma reunião marcada para hoje ou amanhã neste funil
        </p>
      ) : (
        <div className="mt-5 space-y-5">
          {days.map((day) => {
            const isToday = day.key === "hoje";
            const nowPos = isToday ? pos(now) : null;
            const showNow = nowPos != null && nowPos > 0 && nowPos < 100;
            return (
              <div key={day.key}>
                {/* Cabeçalho do dia + eixo de horas */}
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 sm:grid-cols-[220px_minmax(0,1fr)]">
                  <p className="text-[11px] font-bold uppercase tracking-[.06em] text-muted-foreground">
                    {day.label} · {format(day.date, "dd/MM")} ·{" "}
                    <span className="tabular-nums">
                      {day.items.length} {day.items.length === 1 ? "reunião" : "reuniões"}
                    </span>
                  </p>
                  <div className="relative hidden h-4 sm:block" aria-hidden>
                    {ticks.map((h) => (
                      <span
                        key={h}
                        className="absolute -translate-x-1/2 text-[11px] tabular-nums text-muted-foreground"
                        style={{ left: `${((h - startHour) / (endHour - startHour)) * 100}%` }}
                      >
                        {String(h).padStart(2, "0")}h
                      </span>
                    ))}
                  </div>
                </div>

                <ul className="mt-2 divide-y divide-border/60">
                  {day.items.map((m) => {
                    const when = new Date(m.meeting_date!);
                    const stage = stageByKey.get(m.stage_key ?? m.status ?? "");
                    const color = stage?.color || FALLBACK;
                    const titulo = m.lead?.company || m.lead?.name || "Lead";
                    const passou = when.getTime() < now.getTime();
                    const hora = format(when, "HH:mm");
                    return (
                      <li key={m.id}>
                        <button
                          type="button"
                          onClick={() => onMeetingClick?.(m)}
                          className={cn(
                            "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2 text-left transition-colors hover:bg-muted/40",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                            "sm:grid-cols-[220px_minmax(0,1fr)]",
                          )}
                          aria-label={`${titulo}, reunião ${day.label.toLowerCase()} às ${hora}${stage ? `, ${stage.name}` : ""}`}
                        >
                          <span className="flex min-w-0 items-center gap-2.5">
                            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-bold text-foreground/70">
                              {initials(titulo)}
                            </span>
                            <span className="min-w-0 leading-tight">
                              <span className="block truncate text-[13px] font-bold">{titulo}</span>
                              {m.lead?.company && m.lead?.name && (
                                <span className="block truncate text-[11px] text-muted-foreground">{m.lead.name}</span>
                              )}
                            </span>
                          </span>

                          {/* Celular: o horário vira pílula; o eixo não cabe. */}
                          <span
                            className={cn(
                              "inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-bold tabular-nums sm:hidden",
                              textOn(color),
                              passou && "opacity-50",
                            )}
                            style={{ background: color }}
                          >
                            {hora}
                          </span>

                          <span className="relative hidden h-7 sm:block" aria-hidden>
                            {ticks.map((h) => (
                              <span
                                key={h}
                                className="absolute inset-y-0 w-px bg-border/60"
                                style={{ left: `${((h - startHour) / (endHour - startHour)) * 100}%` }}
                              />
                            ))}
                            {showNow && (
                              <span className="absolute -inset-y-2 z-10 w-0.5 rounded-full bg-destructive" style={{ left: `${nowPos}%` }} />
                            )}
                            <span
                              className={cn(
                                "absolute top-1/2 inline-flex h-[22px] -translate-y-1/2 items-center whitespace-nowrap rounded-full px-2.5 text-[11px] font-bold shadow-relevo",
                                textOn(color),
                                passou && "opacity-50",
                              )}
                              style={{ left: `min(${pos(when)}%, calc(100% - 150px))`, background: color }}
                            >
                              {hora}
                              {stage ? ` · ${stage.name}` : ""}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
