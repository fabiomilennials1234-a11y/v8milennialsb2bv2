import type { ReactNode } from "react";
import { useIntencao } from "@/shared/espera";
import { INTENCAO_DE_PREFETCH_MS } from "@/modules/communication/hooks/chat/useUmPrefetchPorVez";

/**
 * Envelope de uma linha da lista de conversas que avisa a INTENÇÃO de abri-la
 * (mouse parado ou foco de teclado por 150 ms; toque nunca conta — ver
 * `useIntencao`). Sem `aoIntencionar`, é uma `div` comum.
 */
export function LinhaComIntencao({
  aoIntencionar,
  className,
  children,
}: {
  aoIntencionar?: () => void;
  className?: string;
  children: ReactNode;
}) {
  const handlers = useIntencao(() => aoIntencionar?.(), INTENCAO_DE_PREFETCH_MS);
  return (
    <div className={className} {...(aoIntencionar ? handlers : {})}>
      {children}
    </div>
  );
}
