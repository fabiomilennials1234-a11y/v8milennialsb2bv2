/**
 * Agenda como painel sobreposto — o gesto do DataCrazy.
 *
 * O botão da lateral não navega: ele abre esta camada por cima da tela em que
 * a pessoa está, ocupando a direita e deixando **um pedaço da página de baixo
 * à mostra** na esquerda. Ver a Agenda não custa perder de vista o que se
 * estava fazendo — é a diferença entre consultar e sair da página.
 *
 * Por que sem escurecer o fundo: o scrim do `PitstopPanel`
 * (`bg-background/70 backdrop-blur-sm`) existe para dizer "o que está atrás
 * está inativo". Aqui ele destruiria justamente o que se quer — a página de
 * baixo precisa continuar LEGÍVEL. A camada se anuncia por superfície
 * (`bg-card` sobre `bg-background`), borda e sombra, não por apagar o resto.
 *
 * A lateral fica de fora do capturador de clique: dá para navegar para outra
 * página com a Agenda aberta, e é de propósito.
 */

import { lazy, Suspense, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2 } from "lucide-react";

import { useViewport } from "@/shared/hooks/use-viewport";

import { larguraDoPainel } from "./agenda-helpers";

// A `Sidebar` monta este painel em TODA tela do sistema. Importar a Agenda de
// forma estática arrastaria as 4 fontes, o calendário e o diálogo de criação
// para o chunk do layout — carregados por quem nunca abre a Agenda. `lazy`
// mantém o custo onde ele pertence: no primeiro clique do botão.
const AgendaAtividades = lazy(() =>
  import("./AgendaAtividades").then((m) => ({ default: m.AgendaAtividades })),
);

interface AgendaPanelProps {
  open: boolean;
  onClose: () => void;
  /**
   * Largura atual da lateral, em px. O capturador de clique começa DEPOIS
   * dela — senão o primeiro clique em qualquer item do menu seria consumido
   * só para fechar o painel.
   */
  sidebarWidth: number;
}

export function AgendaPanel({ open, onClose, sidebarWidth }: AgendaPanelProps) {
  // `useViewport` já observa o redimensionamento — a largura acompanha sozinha
  // quando a janela muda ou a lateral recolhe.
  const { width: viewportWidth } = useViewport();
  const largura =
    viewportWidth === undefined
      ? undefined
      : larguraDoPainel(viewportWidth, sidebarWidth);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Transparente de propósito: fecha ao clicar na página de baixo sem
              escondê-la. Não é botão — dois alvos com o mesmo nome acessível
              fazem leitor de tela anunciar destino duplicado; o alvo nomeado é
              o X do cabeçalho, e o teclado fecha no Escape. */}
          <div
            aria-hidden
            onClick={onClose}
            style={{ left: sidebarWidth }}
            className="fixed inset-y-0 right-0 z-30 cursor-default"
          />

          <motion.aside
            aria-label="Atividades"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
            style={{ width: largura }}
            className="fixed inset-y-0 right-0 z-40 flex flex-col border-l border-border bg-card shadow-2xl"
          >
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-5 lg:px-6 lg:py-6">
              <Suspense
                fallback={
                  <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Carregando a agenda…
                  </div>
                }
              >
                <AgendaAtividades onClose={onClose} />
              </Suspense>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
