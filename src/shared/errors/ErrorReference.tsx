import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  reference: string;
  className?: string;
}

/**
 * O código do erro, clicável para copiar. É a ponte entre o que o cliente viu e
 * o que o suporte procura: o cliente cola "7F3A9C21" no Chamado, o suporte acha
 * o evento.
 */
export function ErrorReference({ reference, className }: Props) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      onClick={(event) => {
        // Dentro do toast, o clique não pode fechar nem disparar a ação.
        event.stopPropagation();
        navigator.clipboard?.writeText(reference).then(
          () => setCopied(true),
          () => undefined,
        );
      }}
      aria-label={copied ? "Código copiado" : `Copiar código do erro ${reference}`}
      className={cn(
        "-mx-1.5 mt-0.5 inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5",
        "font-mono text-[11px] tracking-wider text-muted-foreground",
        "transition-colors hover:bg-muted/60 hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        className,
      )}
    >
      {copied ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
      <span>{copied ? "Copiado" : `Código ${reference}`}</span>
    </button>
  );
}
