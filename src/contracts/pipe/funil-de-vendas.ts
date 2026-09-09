/**
 * O ÚNICO modelo de funil oferecido pelo produto (SCRUM-641, ADR-0034 D1).
 *
 * É a mesma trilha que a org nova ganha de fábrica no servidor
 * (`seed_default_sales_funnel`, migration 20270918000000). Aqui ela existe
 * como TEMPLATE de criação manual — quem apagou o funil semeado (ou quer um
 * segundo) recria pela UI, como qualquer funil.
 *
 * Papéis: o seed server-side grava `stage_role` explícito. A criação pela UI
 * passa pelo caminho comum de funil (etapas com `is_final_*`; papéis chegam
 * pela fila `classify-stage-roles` + revisão master, como em todo funil criado
 * por usuário). Duplicar a atribuição de papel aqui criaria segunda fonte de
 * verdade — e o guard de dinheiro (won/lost) tem regra própria de quem pode.
 */
export const FUNIL_DE_VENDAS_NOME = "Funil de Vendas";

export const FUNIL_DE_VENDAS_STAGES: ReadonlyArray<{
  name: string;
  color: string;
  is_final_positive: boolean;
  is_final_negative: boolean;
}> = [
  { name: "Novo", color: "#6366f1", is_final_positive: false, is_final_negative: false },
  { name: "Em conversa", color: "#3b82f6", is_final_positive: false, is_final_negative: false },
  { name: "Reunião marcada", color: "#8b5cf6", is_final_positive: false, is_final_negative: false },
  { name: "Proposta enviada", color: "#0ea5e9", is_final_positive: false, is_final_negative: false },
  { name: "Ganhou", color: "#22c55e", is_final_positive: true, is_final_negative: false },
  { name: "Perdeu", color: "#ef4444", is_final_positive: false, is_final_negative: true },
];
