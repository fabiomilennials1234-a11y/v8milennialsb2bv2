import { memo, useEffect, useState } from "react";
import { useRecentActivity } from "@/modules/engagement";

const ROTATE_MS = 4200;

/**
 * Ticker de telemetria — barra fina abaixo do header rotacionando os eventos
 * mais recentes da operação (vendas, reuniões, leads novos).
 */
function TelemetryTickerBase() {
  const { data: activities } = useRecentActivity(5);
  const [index, setIndex] = useState(0);

  const items = activities ?? [];

  useEffect(() => {
    if (items.length <= 1) return;
    const id = setInterval(() => {
      if (document.hidden) return;
      setIndex((i) => (i + 1) % items.length);
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, [items.length]);

  if (items.length === 0) return null;

  return (
    <div className="cmd-rise mt-4 flex items-center gap-3.5 overflow-hidden rounded-[11px] border border-border/70 bg-card px-4 py-[9px]" style={{ animationDelay: ".05s" }}>
      <span className="flex flex-none items-center gap-[7px] text-[10px] font-extrabold uppercase tracking-[.1em] text-primary">
        <i className="cmd-livepulse h-1.5 w-1.5 rounded-full bg-success" />
        Telemetria
      </span>
      <div className="relative h-[18px] flex-1 overflow-hidden">
        {items.map((item, i) => (
          <div
            key={item.id}
            className={`absolute inset-0 whitespace-nowrap text-[12.5px] text-muted-foreground transition-all duration-[400ms] ${
              i === index ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
            }`}
          >
            <b className="font-semibold text-foreground">{item.title}</b>
            {item.description ? <> — {item.description}</> : null}
            {item.relativeTime ? <> · {item.relativeTime}</> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export const TelemetryTicker = memo(TelemetryTickerBase);
