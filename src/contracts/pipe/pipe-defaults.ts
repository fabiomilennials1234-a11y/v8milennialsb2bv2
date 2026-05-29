/**
 * Contracts — etapas padrão (DEFAULT_STAGES) dos pipes canônicos + upsell.
 *
 * Constante PURA (zero side-effect, zero React/Supabase) compartilhada entre
 * `pipelines` (seed + fallback de stages) e consumidores cross-module
 * (`communication`, etc.). Vive aqui (camada `contracts`) para que outros
 * módulos consumam sem fechar ciclo via barrel de `pipelines`.
 *
 * Owner conceitual: pipelines (re-exporta via `hooks/model/usePipelineStages`
 * mantendo a API pública estável). Definição CANÔNICA mora aqui.
 */
import type { PipelineType } from "./pipe-status";

/** Etapa padrão com flags de etapa final + roteamento entre pipes. */
export interface DefaultStage {
  id: string;
  title: string;
  color: string;
  is_final_positive?: boolean;
  is_final_negative?: boolean;
  target_pipe_type?: string;
  target_stage_key?: string;
}

/** Etapas padrão por tipo de pipeline (fallback de UI + seed no banco). */
export const DEFAULT_STAGES: Record<PipelineType, DefaultStage[]> = {
  whatsapp: [
    { id: "novo", title: "Novo", color: "#6366f1" },
    { id: "abordado", title: "Abordado", color: "#f59e0b" },
    { id: "respondeu", title: "Respondeu", color: "#3b82f6" },
    { id: "esfriou", title: "Esfriou", color: "#ef4444" },
    { id: "agendado", title: "Agendado ✓", color: "#22c55e", is_final_positive: true, target_pipe_type: "confirmacao", target_stage_key: "reuniao_marcada" },
  ],
  confirmacao: [
    { id: "reuniao_marcada", title: "Reunião Marcada", color: "#6366f1" },
    { id: "confirmar_d5", title: "Confirmar D-5", color: "#8b5cf6" },
    { id: "confirmar_d3", title: "Confirmar D-3", color: "#a855f7" },
    { id: "confirmar_d2", title: "Confirmar D-2", color: "#f59e0b" },
    { id: "confirmar_d1", title: "Confirmar D-1", color: "#f97316" },
    { id: "confirmacao_no_dia", title: "Confirmação no Dia", color: "#ef4444" },
    { id: "remarcar", title: "Remarcar 📅", color: "#f97316" },
    { id: "compareceu", title: "Compareceu ✓", color: "#22c55e", is_final_positive: true, target_pipe_type: "propostas", target_stage_key: "marcar_compromisso" },
    { id: "perdido", title: "Perdido ✗", color: "#ef4444", is_final_negative: true },
  ],
  propostas: [
    { id: "marcar_compromisso", title: "Marcar Compromisso", color: "#F5C518" },
    { id: "reativar", title: "Reativar", color: "#F97316" },
    { id: "compromisso_marcado", title: "Compromisso Marcado", color: "#3B82F6" },
    { id: "proposta_enviada", title: "Proposta Enviada", color: "#0EA5E9" },
    { id: "esfriou", title: "Esfriou", color: "#64748B" },
    { id: "futuro", title: "Futuro", color: "#8B5CF6" },
    { id: "vendido", title: "Vendido ✓", color: "#22C55E", is_final_positive: true },
    { id: "perdido", title: "Perdido", color: "#EF4444", is_final_negative: true },
  ],
  upsell_base: [
    { id: "0-3m", title: "0-3 meses", color: "#3B82F6" },
    { id: "3-6m", title: "3-6 meses", color: "#22C55E" },
    { id: "6-9m", title: "6-9 meses", color: "#F59E0B" },
    { id: "9-12m", title: "9-12 meses", color: "#EF4444" },
    { id: "12-18m", title: "12-18 meses", color: "#8B5CF6" },
    { id: "18m+", title: "18+ meses", color: "#EC4899" },
  ],
  upsell_gestao: [
    { id: "campeoes", title: "Campeões", color: "#22C55E" },
    { id: "fieis", title: "Fiéis", color: "#3B82F6" },
    { id: "primeira_compra", title: "Primeira Compra", color: "#8B5CF6" },
    { id: "em_risco", title: "Em Risco", color: "#F59E0B" },
    { id: "inativos", title: "Inativos", color: "#EF4444" },
  ],
};
