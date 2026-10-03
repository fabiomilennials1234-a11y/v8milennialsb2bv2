/**
 * Field-level labels and value formatters for the Lead entity.
 *
 * Extraído de `useFieldChangelog` durante a slice 4 da modularização
 * (`feat/modularizacao/03-leads`) — utilitário puro, cross-module, sem
 * dependência de React/Supabase. Consumido por componentes que renderizam
 * field changelog (timeline de alterações de campo).
 *
 * Stable surface: `FIELD_LABELS`, `getFieldLabel`, `formatFieldValue`.
 */

export const FIELD_LABELS: Record<string, string> = {
  name: "Nome",
  company_name: "Empresa",
  email: "Email",
  phone: "Telefone",
  origin: "Origem",
  rating: "Rating",
  qualification_score: "Score",
  status: "Status",
  responsible_id: "Responsavel",
  sdr_id: "SDR",
  closer_id: "Closer",
  ai_disabled: "IA",
  notes: "Observacoes",
  expected_value: "Valor esperado",
  city: "Cidade",
  state: "Estado",
  segment: "Segmento",
  position: "Cargo",
};

export function getFieldLabel(fieldName: string): string {
  return FIELD_LABELS[fieldName] || fieldName;
}

export function formatFieldValue(fieldName: string, value: string | null): string {
  if (value === null || value === "") return "(vazio)";
  if (fieldName === "ai_disabled") return value === "true" ? "Desativada" : "Ativada";
  if (fieldName === "rating") return `${value}/10`;
  return value;
}
