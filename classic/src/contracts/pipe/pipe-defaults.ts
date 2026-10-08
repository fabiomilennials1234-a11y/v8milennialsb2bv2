/**
 * Contracts — trilha padrão de EXIBIÇÃO (fallback) de funil.
 *
 * Constante PURA (zero side-effect, zero React/Supabase) compartilhada entre
 * `pipelines` (fallback de stages) e consumidores cross-module
 * (`communication`, etc.). Vive aqui (camada `contracts`) para que outros
 * módulos consumam sem fechar ciclo via barrel de `pipelines`.
 *
 * SCRUM-641: o Record por trio (`whatsapp`/`confirmacao`/`propostas`) MORREU.
 * Funil é funil (ADR-0034 D1) — não existe mais "trilha canônica por tipo";
 * as etapas reais vêm SEMPRE do banco (seed server-side da org nova =
 * `seed_default_sales_funnel`, 20270918000000). O que sobra aqui é UM único
 * fallback de exibição, espelho da trilha de fábrica, usado apenas quando o
 * banco não devolveu etapa nenhuma (org sem o funil, leitura falhou).
 */

/** Etapa padrão com flags de etapa final. */
export interface DefaultStage {
  id: string;
  title: string;
  color: string;
  is_final_positive?: boolean;
  is_final_negative?: boolean;
  target_pipe_type?: string;
  target_stage_key?: string;
}

/**
 * Trilha única de fallback — EXIBIÇÃO apenas, nunca seed (SCRUM-618/641).
 * Espelha `FUNIL_DE_VENDAS_STAGES` (funil-de-vendas.ts) no shape DefaultStage.
 */
export const FALLBACK_STAGES: DefaultStage[] = [
  { id: "novo", title: "Novo", color: "#6366f1" },
  { id: "em_conversa", title: "Em conversa", color: "#3b82f6" },
  { id: "reuniao_marcada", title: "Reunião marcada", color: "#8b5cf6" },
  { id: "proposta_enviada", title: "Proposta enviada", color: "#0ea5e9" },
  { id: "ganhou", title: "Ganhou", color: "#22c55e", is_final_positive: true },
  { id: "perdeu", title: "Perdeu", color: "#ef4444", is_final_negative: true },
];
