import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, type LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Casca dos blocos da central de trabalho.
 *
 * Existe para que os três blocos tenham EXATAMENTE os mesmos estados — o pedido
 * lista sete (carregando, vazio, erro, com dado, atrasada, concluída, falha ao
 * gravar) e três implementações separadas divergiriam na primeira semana.
 *
 * A anatomia (cmd-cell, cabeçalho com rótulo em caixa alta, lista com divisores)
 * é a que a aba Comando já usa — nenhum token novo.
 */
interface ComandoCardProps {
  icon: LucideIcon;
  title: string;
  /** Aparece ao lado do título, em tabular-nums. */
  count?: number;
  /** `urgent` pinta o ícone e o contador com a cor de destaque. */
  tone?: "default" | "urgent";
  /** Porta para a tela completa do assunto. */
  action?: { label: string; to: string };
  isLoading?: boolean;
  isError?: boolean;
  isEmpty?: boolean;
  emptyTitle?: string;
  emptyHint?: string;
  onRetry?: () => void;
  /** Aviso persistente acima da lista (ex.: dado degradado). */
  notice?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function ComandoCard({
  icon: Icon,
  title,
  count,
  tone = "default",
  action,
  isLoading = false,
  isError = false,
  isEmpty = false,
  emptyTitle = "Nada por aqui",
  emptyHint,
  onRetry,
  notice,
  footer,
  children,
  className,
}: ComandoCardProps) {
  const urgent = tone === "urgent" && (count ?? 0) > 0;

  return (
    <section className={cn("cmd-cell flex flex-col", className)}>
      <header className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
        <Icon
          className={cn(
            "h-4 w-4 shrink-0",
            urgent ? "text-primary" : "text-muted-foreground/70",
          )}
          strokeWidth={2.2}
        />
        <h3 className="text-[14px] font-bold tracking-[-0.02em]">{title}</h3>
        {typeof count === "number" && !isLoading && !isError && (
          <span
            className={cn(
              "rounded-md px-1.5 py-0.5 text-[11px] font-bold tabular-nums",
              urgent ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
            )}
          >
            {count}
          </span>
        )}
        {action && (
          <Link
            to={action.to}
            className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
          >
            {action.label}
            <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </header>

      {notice}

      <div className="flex-1">
        {isLoading ? (
          <div className="space-y-2 px-4 py-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-9 flex-1" />
                <Skeleton className="h-3 w-10" />
              </div>
            ))}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <AlertTriangle className="h-5 w-5 text-destructive/80" />
            <p className="text-[12px] font-semibold">Não deu para carregar</p>
            <p className="max-w-[240px] text-[11px] text-muted-foreground/70">
              O dado não veio. Isso não apaga nada — é só a leitura que falhou.
            </p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="mt-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                Tentar de novo
              </button>
            )}
          </div>
        ) : isEmpty ? (
          <div className="flex flex-col items-center gap-1 px-4 py-8 text-center">
            <p className="text-[12px] font-semibold">{emptyTitle}</p>
            {emptyHint && (
              <p className="max-w-[260px] text-[11px] text-muted-foreground/70">
                {emptyHint}
              </p>
            )}
          </div>
        ) : (
          children
        )}
      </div>

      {footer && !isLoading && !isError && (
        <div className="border-t border-border/50 px-4 py-2">{footer}</div>
      )}
    </section>
  );
}
