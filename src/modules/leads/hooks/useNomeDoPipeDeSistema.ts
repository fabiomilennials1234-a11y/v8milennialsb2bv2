/**
 * O nome que a ORG usa para um funil de sistema — versão hook do módulo leads.
 *
 * SCRUM-641 (Funil é Funil): microcopy de CTA/toast/history não pode cravar
 * "Confirmação"/"Propostas" — esses são o seed congelado de
 * `create_default_pipelines()`, que a navegação nunca mostra. A regra de nome
 * é a mesma do resto do app (`nomeDoFunil`/`NOME_DE_FABRICA` em
 * `@/contracts/pipe`); a fonte é `useSystemPipes` da porta pipe-ops, porque
 * `leads` não importa `pipelines` (boundaries).
 *
 * Linha de display ausente = a org NÃO tem o funil → fallback honesto
 * ("Funil removido"), nunca o rótulo de catálogo.
 */
import { NOME_DE_FABRICA } from "@/contracts/pipe";
import { usePipeOps } from "../pipe-ops";

export function useNomeDoPipeDeSistema(): (pipeType: string) => string {
  const { useSystemPipes } = usePipeOps();
  const { data: systemPipes } = useSystemPipes();
  return (pipeType: string): string => {
    const c = systemPipes?.find((x) => x.pipe_type === pipeType);
    return c ? c.display_name || NOME_DE_FABRICA[pipeType] || pipeType : "Funil removido";
  };
}
