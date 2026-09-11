/**
 * O Oráculo por cima da página, sem trocar de tela.
 *
 * Mesmo contrato da Agenda: a camada começa DEPOIS da lateral, para que o
 * primeiro clique num item do menu navegue em vez de ser consumido só para
 * fechar o painel. Quem quiser a tela cheia continua tendo `/oraculo`.
 */

import { lazy, Suspense, useEffect } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Caminho fundo e não o barril de `copilot`, pelo mesmo motivo da Agenda: o
 * barril puxaria a árvore inteira do módulo para dentro do pedaço da lateral.
 * `lazy` mantém a conversa fora do carregamento inicial — quem nunca abre o
 * Oráculo nunca paga por ele.
 */
const OraculoConversa = lazy(() =>
  import("@/modules/copilot/components/oraculo/OraculoConversa").then((m) => ({
    default: m.OraculoConversa,
  })),
);

export interface OraculoPanelProps {
  open: boolean;
  onClose: () => void;
  /** Largura atual da lateral, em px. A camada não a cobre. */
  sidebarWidth: number;
}

export function OraculoPanel({ open, onClose, sidebarWidth }: OraculoPanelProps) {
  // Esc fecha: o painel é uma camada, e camada que só fecha no clique prende
  // quem navega por teclado.
  useEffect(() => {
    if (!open) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* Captura o clique fora, começando depois da lateral. */}
      <div
        data-testid="captura-do-oraculo"
        aria-hidden
        onClick={onClose}
        className="fixed inset-y-0 right-0 z-40"
        style={{ left: sidebarWidth }}
      />

      <aside
        data-testid="painel-do-oraculo"
        role="dialog"
        aria-modal="false"
        aria-label="Oráculo"
        className={cn(
          "fixed inset-y-0 z-50 flex w-[380px] max-w-[calc(100vw-4rem)] flex-col",
          "border-r border-border bg-background shadow-2xl",
          "duration-200 animate-in slide-in-from-left-4 fade-in motion-reduce:animate-none",
        )}
        style={{ left: sidebarWidth }}
      >
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Sparkles className="h-4 w-4 text-primary" />
          <h2 className="flex-1 text-[13px] font-semibold tracking-tight">Oráculo</h2>
          <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-[12px]">
            <Link to="/oraculo" onClick={onClose}>
              Tela cheia
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Fechar o Oráculo"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </header>

        <Suspense
          fallback={
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          }
        >
          <OraculoConversa />
        </Suspense>
      </aside>
    </>
  );
}
