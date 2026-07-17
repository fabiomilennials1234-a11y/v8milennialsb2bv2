import { useEffect, useState, type ReactNode } from "react";

/**
 * Uma amostra viva da conversa: a mensagem do cliente já está lá, o suporte
 * "digita" e responde na hora. É a tese da feature mostrada, não descrita.
 * Respeita prefers-reduced-motion — sem movimento, entrega o estado final.
 */
export function SupportRealtimeChatDemo({ compact = false }: { compact?: boolean }) {
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const [phase, setPhase] = useState<0 | 1 | 2>(reduced ? 2 : 0);

  useEffect(() => {
    if (reduced) return;
    const a = setTimeout(() => setPhase(1), 900);
    const b = setTimeout(() => setPhase(2), 2100);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [reduced]);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-muted/40">
      <div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5 text-xs text-muted-foreground">
        <span>Chamado #251</span>
        <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-500">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500 [animation-duration:1.4s]" />
          ao vivo
        </span>
      </div>
      <div
        className={
          "flex flex-col gap-2.5 p-3.5 " + (compact ? "min-h-[150px]" : "min-h-[190px]")
        }
      >
        <Bubble side="out">Consigo integrar o WhatsApp em qual plano?</Bubble>

        {phase === 1 && (
          <div className="inline-flex w-fit items-center gap-1 rounded-xl rounded-bl-sm border border-border bg-card px-3 py-2.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60"
                style={{ animationDelay: `${i * 0.15}s`, animationDuration: "1s" }}
              />
            ))}
          </div>
        )}

        {phase === 2 && (
          <>
            <Bubble side="in" who="Suporte">
              No seu plano já dá! Te mando o passo a passo agora.
            </Bubble>
          </>
        )}
      </div>
    </div>
  );
}

function Bubble({
  side,
  who,
  children,
}: {
  side: "in" | "out";
  who?: string;
  children: ReactNode;
}) {
  const out = side === "out";
  return (
    <div
      className={
        "max-w-[85%] rounded-2xl px-3 py-2 text-[13px] leading-snug " +
        (out
          ? "self-end rounded-br-sm border border-primary/30 bg-primary/15 text-foreground"
          : "self-start rounded-bl-sm border border-border bg-card text-foreground")
      }
    >
      {who && (
        <div className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          {who}
        </div>
      )}
      {children}
    </div>
  );
}
