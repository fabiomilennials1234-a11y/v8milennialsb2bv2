import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface FieldChange {
  id: string;
  entity_type: string;
  entity_id: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  changed_by: string | null;
  changed_at: string;
  user_name: string;
}

const FIELD_LABELS: Record<string, string> = {
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

/**
 * Fetches field-level changes for a lead via the RPC get_lead_field_changes.
 */
export function useFieldChangelog(leadId: string | null | undefined, limit = 50) {
  return useQuery({
    queryKey: ["field_changelog", leadId, limit],
    enabled: !!leadId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_lead_field_changes", {
        p_lead_id: leadId,
        p_limit: limit,
      });

      if (error) throw error;
      return (data || []) as FieldChange[];
    },
  });
}
