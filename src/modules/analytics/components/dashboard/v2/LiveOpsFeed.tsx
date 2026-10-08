import { memo } from "react";
import { useRecentActivity } from "@/modules/engagement";

const DOT_COLOR: Record<string, string> = {
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  muted: "bg-muted-foreground",
};

/**
 * Feed "Agora na operação" — últimos eventos com dot colorido por tipo e
 * indicador ao vivo pulsando.
 */
function LiveOpsFeedBase() {
  const { data: activities, isLoading } = useRecentActivity(4);
  const items = activities ?? [];

  return (
    // Corpo da janela "Operação ao vivo" — o título mora na moldura.
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-end">
        <span className="flex items-center gap-1.5 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-bold text-success">
          <i className="cmd-livepulse h-[7px] w-[7px] rounded-full bg-success" />
          ao vivo
        </span>
      </div>
      <div className="mt-2 flex min-h-0 flex-1 flex-col overflow-y-auto">
        {items.length === 0 && !isLoading && (
          <p className="py-6 text-center text-[13px] text-muted-foreground">Nenhuma atividade recente.</p>
        )}
        {items.map((item, i) => (
          <div
            key={item.id}
            className="cmd-rise grid grid-cols-[14px_1fr] items-start gap-2.5 border-b border-border/60 py-2.5 last:border-b-0"
            style={{ animationDelay: `${0.9 + i * 0.15}s`, opacity: 0 }}
          >
            <span className={`mt-1 h-2 w-2 rounded-full ${DOT_COLOR[item.color] ?? "bg-muted-foreground"}`} />
            <p className="text-[12.5px] leading-[1.45] text-muted-foreground">
              <b className="font-semibold text-foreground">{item.title}</b>
              {item.description ? <> — {item.description}</> : null}
              <time className="mt-[1px] block text-[11px] font-semibold text-muted-foreground/80">
                {item.relativeTime}
              </time>
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export const LiveOpsFeed = memo(LiveOpsFeedBase);
