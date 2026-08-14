/**
 * Contracts — colunas visuais de Kanban por pipe legacy.
 *
 * 3 cópias DIVERGENTES (cada pipe tem stages distintas) — NÃO unificar.
 * Eram `statusColumns` locais em `usePipeWhatsapp` / `usePipeConfirmacao` /
 * `usePipePropostas`; movidas para contracts para que `leads` consuma sem
 * import direto de `pipelines/hooks/*`. Cada hook legacy re-exporta a sua
 * cópia como `statusColumns` (API pública inalterada).
 */

export interface PipeStatusColumn {
  id: string;
  title: string;
  color: string;
  /**
   * Etapa TERMINAL — negócio fechado, ganho ou perdido. O Kanban a mostra
   * empilhada e só revela os cards quando a pessoa pede. O valor diz qual dos
   * dois, porque a pilha se descreve com a palavra certa ("fechados" ×
   * "perdidos") e usa a cor da própria etapa.
   *
   * Vem de `pipeline_stages.is_final_positive` / `is_final_negative`, não de um
   * `stage_key` fixo: funil customizado tem etapa terminal com outro nome, e
   * filtrar por `'vendido'`/`'perdido'` cegaria todos eles — o mesmo
   * anti-padrão que o lint de métricas do repo reprova em migration.
   */
  stacked?: "ganho" | "perda";
}

/** Colunas do pipe WhatsApp (qualificação). */
export const whatsappStatusColumns: PipeStatusColumn[] = [
  { id: "novo", title: "Novo", color: "#6366f1" },
  { id: "abordado", title: "Abordado", color: "#f59e0b" },
  { id: "respondeu", title: "Respondeu", color: "#3b82f6" },
  { id: "esfriou", title: "Esfriou", color: "#ef4444" },
  { id: "agendado", title: "Agendado ✓", color: "#22c55e" },
];

/**
 * Colunas do pipe Confirmação (reunião).
 * `pre_confirmada` e `confirmada_no_dia` NÃO são colunas — são estados visuais
 * (cores) nos cards.
 */
export const confirmacaoStatusColumns: PipeStatusColumn[] = [
  { id: "reuniao_marcada", title: "Reunião Marcada", color: "#6366f1" },
  { id: "confirmar_d5", title: "Confirmar D-5", color: "#8b5cf6" },
  { id: "confirmar_d3", title: "Confirmar D-3", color: "#a855f7" },
  { id: "confirmar_d2", title: "Confirmar D-2", color: "#f59e0b" },
  { id: "confirmar_d1", title: "Confirmar D-1", color: "#f97316" },
  { id: "confirmacao_no_dia", title: "Confirmação no Dia", color: "#ef4444" },
  { id: "remarcar", title: "Remarcar 📅", color: "#f97316" },
  { id: "compareceu", title: "Compareceu ✓", color: "#22c55e" },
  { id: "perdido", title: "Perdido ✗", color: "#ef4444" },
];

/** Colunas do pipe Propostas (fechamento). */
export const propostasStatusColumns: PipeStatusColumn[] = [
  { id: "marcar_compromisso", title: "Marcar Compromisso", color: "#F5C518" },
  { id: "reativar", title: "Reativar", color: "#F97316" },
  { id: "compromisso_marcado", title: "Compromisso Marcado", color: "#3B82F6" },
  { id: "proposta_enviada", title: "Proposta Enviada", color: "#0EA5E9" },
  { id: "esfriou", title: "Esfriou", color: "#64748B" },
  { id: "futuro", title: "Futuro", color: "#8B5CF6" },
  // `stacked` também no fallback: ele é o que a tela usa enquanto as etapas do
  // banco não chegam, e sem isto a coluna de vendidos abriria expandida por um
  // instante e recolheria — pulo visual a cada carregamento.
  { id: "vendido", title: "Vendido ✓", color: "#22C55E", stacked: "ganho" },
  { id: "perdido", title: "Perdido", color: "#EF4444", stacked: "perda" },
];

/**
 * Converte stages do banco para o formato de colunas de Kanban.
 * Aceita `PipelineStage[]` (estruturalmente) ou o shape mínimo `{ id, stage_key,
 * name, color }`. Body idêntico ao original de `usePipelineStages` (preservação
 * de comportamento) — apenas o type da param é estrutural para não depender de
 * `pipelines`.
 */
export function stagesToColumns(
  stages: {
    id: string;
    stage_key: string;
    name: string;
    color: string | null;
    /** Governam o empilhamento. Opcionais: quem não passa, não empilha. */
    is_final_positive?: boolean | null;
    is_final_negative?: boolean | null;
  }[],
): PipeStatusColumn[] {
  return stages.map((stage) => ({
    // Era `"stage_key" in stage ? stage.stage_key : stage.id`. O ramo do `else`
    // é inalcançável — `stage_key` é obrigatório no tipo do parâmetro —, e o
    // TypeScript estreitava o `stage` para `never` ali, o que produzia um erro
    // herdado (TS2339) neste arquivo. Some junto com o ternário.
    id: stage.stage_key,
    title: stage.name,
    color: stage.color || "#64748b",
    // Ganho tem precedência: etapa marcada como as DUAS coisas é config
    // contraditória, e "fechado com ganho" é a leitura menos danosa — some da
    // tela do mesmo jeito, mas sem chamar de perda o que talvez seja venda.
    stacked:
      stage.is_final_positive === true
        ? ("ganho" as const)
        : stage.is_final_negative === true
          ? ("perda" as const)
          : undefined,
  }));
}
