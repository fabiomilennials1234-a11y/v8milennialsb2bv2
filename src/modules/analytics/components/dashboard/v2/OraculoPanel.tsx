import { memo } from "react";
import { Sparkles } from "lucide-react";

export interface OraculoInsight {
  tone: "attention" | "opportunity" | "highlight";
  tag: string;
  /** Texto com <b> embutido — renderizado como nós React. */
  content: React.ReactNode;
}

interface OraculoPanelProps {
  insights: OraculoInsight[];
  onAsk: () => void;
}

const TONE_CLASS: Record<OraculoInsight["tone"], string> = {
  attention: "text-destructive bg-destructive/10",
  opportunity: "text-primary bg-primary/15",
  highlight: "text-success bg-success/10",
};

/**
 * Painel do Oráculo — insights derivados das métricas do período + input que
 * abre o chat (⌘J). Substitui o FAB flutuante na Central de Comando.
 */
function OraculoPanelBase({ insights, onAsk }: OraculoPanelProps) {
  return (
    <div className="cmd-cell cmd-rise p-5" style={{ animationDelay: ".54s", backgroundColor: "hsl(var(--card))" }}>
      <div className="mb-3.5 flex items-center gap-2.5">
        <span className="cmd-sparkpulse flex h-6 w-6 items-center justify-center rounded-[7px] bg-gradient-to-br from-primary to-[hsl(36_100%_60%)]">
          <Sparkles className="h-3 w-3 text-background" fill="currentColor" />
        </span>
        <b className="text-[13px] font-bold">Oráculo</b>
      </div>

      {insights.length === 0 && (
        <p className="mb-2 text-[12px] text-muted-foreground/70">
          Sem insights no período — pergunte algo ao Oráculo.
        </p>
      )}
      {insights.map((insight, i) => (
        <button
          key={i}
          type="button"
          onClick={onAsk}
          className="cmd-slidein mb-2 block w-full cursor-pointer rounded-[10px] border border-border/70 bg-card p-[11px] px-3 text-left transition-colors hover:border-primary/50"
          style={{ animationDelay: `${0.8 + i * 0.15}s` }}
        >
          <span className={`mb-[5px] inline-block rounded-[5px] px-1.5 py-[2px] text-[10px] font-extrabold uppercase tracking-[.08em] ${TONE_CLASS[insight.tone]}`}>
            {insight.tag}
          </span>
          <p className="text-[12px] leading-[1.45] [&_b]:font-bold">{insight.content}</p>
        </button>
      ))}

      <button
        type="button"
        onClick={onAsk}
        className="flex w-full cursor-text items-center gap-2 rounded-[9px] border border-border bg-background px-[11px] py-[9px] text-left transition-all hover:border-primary/60 hover:shadow-[0_0_0_3px_hsl(var(--primary)/.15)]"
      >
        <span className="text-[12px] text-muted-foreground/60">Perguntar ao Oráculo...</span>
        <kbd className="ml-auto rounded border border-border bg-card px-[5px] py-[2px] font-sans text-[10px] font-bold text-muted-foreground">
          ⌘ J
        </kbd>
      </button>
    </div>
  );
}

export const OraculoPanel = memo(OraculoPanelBase);
