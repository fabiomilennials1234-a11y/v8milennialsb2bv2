/**
 * PipeOpsContext — injeção da implementação de PipeOpsPort.
 *
 * leads consome via `usePipeOps()`. `pipelines` provê a implementação real
 * (PipeOpsProvider) no nível do App, acima das rotas. Quebra o ciclo
 * leads↔pipelines: leads depende só desta abstração, não de `@/modules/pipelines`.
 */
import { createContext, useContext, type ReactNode } from "react";
import type { PipeOpsPort } from "./PipeOpsPort";

const PipeOpsContext = createContext<PipeOpsPort | null>(null);

export function PipeOpsContextProvider({
  value,
  children,
}: {
  value: PipeOpsPort;
  children: ReactNode;
}) {
  return <PipeOpsContext.Provider value={value}>{children}</PipeOpsContext.Provider>;
}

/**
 * Acesso à porta de pipeline-ops. Lança se usado fora do provider — sinaliza
 * que `pipelines` PipeOpsProvider não foi montado acima na árvore.
 */
export function usePipeOps(): PipeOpsPort {
  const ctx = useContext(PipeOpsContext);
  if (!ctx) {
    throw new Error(
      "usePipeOps() usado fora de PipeOpsProvider. Monte o PipeOpsProvider de "
        + "@/modules/pipelines no App acima das rotas.",
    );
  }
  return ctx;
}

/**
 * Variante resiliente: retorna `null` (em vez de lançar) quando não há
 * `PipeOpsProvider` acima na árvore. Usado por consumidores que devem
 * degradar graciosamente fora do provider — ex.: o item de menu opcional
 * "Adicionar a funil" no LeadCard, que só ativa sob o provider e some caso
 * o card seja montado fora dele (nunca quebra a árvore).
 */
export function usePipeOpsOptional(): PipeOpsPort | null {
  return useContext(PipeOpsContext);
}
