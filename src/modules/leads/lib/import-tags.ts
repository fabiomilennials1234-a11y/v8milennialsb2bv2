/** Espelha `MAX_IMPORT_TAGS` da edge `import-leads`. */
export const MAX_ETIQUETAS_POR_IMPORT = 20;

export interface AutomacaoDeEtiqueta {
  id: string;
  name: string;
  trigger_config: unknown;
}

export interface DisparoDoImport {
  automacoes: AutomacaoDeEtiqueta[];
  /** Execuções que CADA lead novo na etiqueta gera. */
  execucoesPorLead: number;
}

function etiquetaDoGatilho(config: unknown): string | null {
  if (!config || typeof config !== "object") return null;
  const nome = (config as { tag_name?: unknown }).tag_name;
  return typeof nome === "string" && nome !== "" ? nome.toLowerCase() : null;
}

/**
 * Mesma regra de `matches_workflow_trigger_config('tag_added')`: gatilho sem
 * etiqueta casa com qualquer uma; com etiqueta, casa por nome sem caixa. O dedup
 * de `fire_workflow_trigger` inclui o tag_id na chave, então um gatilho que casa
 * com N etiquetas escolhidas roda N vezes por lead.
 */
export function disparoDoImport(
  automacoes: AutomacaoDeEtiqueta[],
  nomesEscolhidos: string[],
): DisparoDoImport {
  const escolhidos = nomesEscolhidos.map((n) => n.toLowerCase());
  if (escolhidos.length === 0) return { automacoes: [], execucoesPorLead: 0 };

  const disparadas: AutomacaoDeEtiqueta[] = [];
  let execucoesPorLead = 0;
  for (const automacao of automacoes) {
    const alvo = etiquetaDoGatilho(automacao.trigger_config);
    const casadas = alvo === null ? escolhidos.length : escolhidos.filter((n) => n === alvo).length;
    if (casadas > 0) {
      disparadas.push(automacao);
      execucoesPorLead += casadas;
    }
  }
  return { automacoes: disparadas, execucoesPorLead };
}
