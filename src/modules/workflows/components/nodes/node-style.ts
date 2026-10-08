import { cn } from "@/lib/utils";
import type { WorkflowNodeType } from "@/types/workflow";

/**
 * Vocabulário V5 dos nós do canvas: cartão branco de raio 16, sombra de relevo,
 * a cor do tipo só no chip do ícone, selecionado = anel de ouro. O gatilho é o
 * único nó de tinta — é onde o fluxo começa, e o olho precisa achá-lo primeiro.
 *
 * Largura (280 px), alças e posições não mudam: o layout salvo das automações
 * e as arestas dependem delas.
 */
export function nodeCardClassName({
  nodeType,
  selected,
  warning,
  className,
}: {
  nodeType: WorkflowNodeType;
  selected?: boolean;
  warning?: boolean;
  className?: string;
}) {
  const ink = nodeType === "trigger";
  return cn(
    "group relative rounded-2xl border shadow-relevo transition-[box-shadow,transform] duration-150",
    ink
      ? "border-tinta-line/60 bg-tinta text-tinta-foreground shadow-relevo-tinta"
      : "border-card-border bg-card text-card-foreground dark:border-border",
    selected && "ring-2 ring-primary ring-offset-2 ring-offset-background shadow-brilho-ouro",
    // Nó incompleto: o autor precisa achar ESTE nó entre vinte. Recusar sem
    // apontar seria trocar um defeito por outro.
    warning && "ring-2 ring-warning/70 ring-offset-2 ring-offset-background",
    className,
  );
}

export const NODE_HANDLE_CLASS = "!w-3 !h-3 !bg-muted-foreground/60 !border-2 !border-background";
