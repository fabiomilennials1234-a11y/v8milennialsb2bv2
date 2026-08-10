import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ChartNoAxesCombined, CircleUser, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { ACTION_LANES, URGENCY_META, type ActionLane } from "@/modules/analytics/lib/proximos-passos-sample";

/**
 * Comando como fila de trabalho, não como painel de contemplação.
 *
 * A pergunta que a aba responde é "o que eu faço agora", em ordem: cada faixa
 * tem um critério de entrada explícito e uma ação única. O número grande some;
 * quem manda é a lista.
 *
 * ⚠ Prévia — as linhas vêm de `proximos-passos-sample`. Cada faixa declara em
 * `wiring` a fonte real que a alimentaria.
 */
export function TabProximosPassos() {
  const [laneId, setLaneId] = useState<string>(ACTION_LANES[0].id);

  const lane = useMemo(
    () => ACTION_LANES.find((l) => l.id === laneId) ?? ACTION_LANES[0],
    [laneId],
  );

  const totalCritico = ACTION_LANES.filter((l) => l.urgency === "critica").reduce(
    (acc, l) => acc + l.total,
    0,
  );
  const total = ACTION_LANES.reduce((acc, l) => acc + l.total, 0);

  return (
    <div className="space-y-5 pt-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[22px] font-extrabold leading-tight tracking-[-0.03em]">
            {total} ações esperando você
          </h2>
          <p className="text-[12px] text-muted-foreground/70">
            {totalCritico > 0
              ? `${totalCritico} não podem esperar o fim do dia.`
              : "Nada crítico na fila."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Comando é operação; análise vive no Estúdio. O par precisa de uma
              porta explícita, senão a separação vira dois produtos. */}
          <Link
            to="/metricas"
            className="inline-flex items-center gap-1.5 rounded-[9px] border border-border bg-card px-3 py-[7px] text-[12px] font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <ChartNoAxesCombined className="h-3.5 w-3.5" />
            Ver métricas
          </Link>
          <span className="rounded-full border border-border/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/60">
            Prévia
          </span>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
        {/* Faixas — a ordem é a prioridade. */}
        <nav className="space-y-1.5" aria-label="Faixas de ação">
          {ACTION_LANES.map((entry) => (
            <LaneButton
              key={entry.id}
              lane={entry}
              active={entry.id === lane.id}
              onSelect={() => setLaneId(entry.id)}
            />
          ))}
        </nav>

        {/* Fila da faixa selecionada */}
        <section className="rounded-xl border border-border/70 bg-card/60">
          <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-4 py-3">
            <div className="min-w-0">
              <h3 className="text-[14px] font-bold tracking-[-0.02em]">{lane.label}</h3>
              <p className="text-[11px] text-muted-foreground/70">{lane.criterion}</p>
            </div>
            <span className="ml-auto text-[11px] tabular-nums text-muted-foreground/60">
              mostrando {lane.items.length} de {lane.total}
            </span>
          </div>

          <ul className="divide-y divide-border/50">
            {lane.items.map((item) => (
              <li
                key={item.id}
                className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold">{item.title}</p>
                  <p className="truncate text-[11px] text-muted-foreground/70">{item.reason}</p>
                </div>

                <span className="hidden items-center gap-1 text-[11px] text-muted-foreground/60 sm:inline-flex">
                  <Clock className="h-3 w-3" />
                  {item.age}
                </span>

                <span className="hidden w-[92px] items-center gap-1 text-[11px] text-muted-foreground/60 md:inline-flex">
                  <CircleUser className="h-3 w-3 shrink-0" />
                  <span className="truncate">{item.owner ?? "sem dono"}</span>
                </span>

                <button
                  type="button"
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground opacity-0 transition-all hover:border-primary/40 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                >
                  {lane.cta}
                  <ArrowRight className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>

          <p className="border-t border-border/50 px-4 py-2 text-[10px] text-muted-foreground/45">
            Fonte real: {lane.wiring}
          </p>
        </section>
      </div>
    </div>
  );
}

function LaneButton({
  lane,
  active,
  onSelect,
}: {
  lane: ActionLane;
  active: boolean;
  onSelect: () => void;
}) {
  const urgency = URGENCY_META[lane.urgency];

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors",
        active
          ? "border-primary/40 bg-primary/[0.06]"
          : "border-border/70 bg-card/40 hover:border-border hover:bg-muted/40",
      )}
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", urgency.dot)} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold">{lane.label}</span>
        <span className="block truncate text-[11px] text-muted-foreground/60">{lane.criterion}</span>
      </span>
      <span
        className={cn(
          "shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold tabular-nums",
          active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
        )}
      >
        {lane.total}
      </span>
    </button>
  );
}
