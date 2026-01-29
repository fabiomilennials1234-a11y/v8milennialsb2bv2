import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "./useTeamMembers";

export interface CustomField {
  id: string;
  organization_id: string;
  field_name: string;
  field_type: 'text' | 'number' | 'date' | 'select' | 'boolean';
  field_options: string[] | null;
  is_required: boolean;
  display_order: number;
  created_at: string;
}

export interface CustomFieldValue {
  id: string;
  lead_id: string;
  field_id: string;
  value: string | null;
  created_at: string;
  updated_at: string;
}

// Hook para buscar campos personalizados da organização
export function useLeadCustomFields() {
  const { data: currentMember } = useCurrentTeamMember();
  
  return useQuery({
    queryKey: ["lead-custom-fields", currentMember?.organization_id],
    queryFn: async () => {
      if (!currentMember?.organization_id) return [];
      
      const { data, error } = await supabase
        .from("lead_custom_fields")
        .select("*")
        .eq("organization_id", currentMember.organization_id)
        .order("display_order", { ascending: true });
      
      if (error) throw error;
      return data as CustomField[];
    },
    enabled: !!currentMember?.organization_id,
  });
}

// Hook para buscar valores dos campos de um lead específico
export function useLeadCustomFieldValues(leadId: string | null) {
  return useQuery({
    queryKey: ["lead-custom-field-values", leadId],
    queryFn: async () => {
      if (!leadId) return [];
      
      const { data, error } = await supabase
        .from("lead_custom_field_values")
        .select("*, field:lead_custom_fields(*)")
        .eq("lead_id", leadId);
      
      if (error) throw error;
      return data as (CustomFieldValue & { field: CustomField })[];
    },
    enabled: !!leadId,
  });
}

// Hook para criar um novo campo personalizado
export function useCreateCustomField() {
  const queryClient = useQueryClient();
  const { data: currentMember } = useCurrentTeamMember();
  
  return useMutation({
    mutationFn: async (field: { field_name: string; field_type: string; field_options?: string[]; is_required?: boolean }) => {
      if (!currentMember?.organization_id) throw new Error("Organização não encontrada");
      
      const { data, error } = await supabase
        .from("lead_custom_fields")
        .insert({
          organization_id: currentMember.organization_id,
          field_name: field.field_name,
          field_type: field.field_type,
          field_options: field.field_options || null,
          is_required: field.is_required || false,
        })
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead-custom-fields"] });
    },
  });
}

// Hook para deletar um campo personalizado
export function useDeleteCustomField() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (fieldId: string) => {
      const { error } = await supabase
        .from("lead_custom_fields")
        .delete()
        .eq("id", fieldId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead-custom-fields"] });
    },
  });
}

// Hook para salvar/atualizar valor de campo personalizado
export function useSaveCustomFieldValue() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ leadId, fieldId, value }: { leadId: string; fieldId: string; value: string | null }) => {
      // Usar upsert para criar ou atualizar
      const { data, error } = await supabase
        .from("lead_custom_field_values")
        .upsert({
          lead_id: leadId,
          field_id: fieldId,
          value,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'lead_id,field_id',
        })
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["lead-custom-field-values", variables.leadId] });
    },
  });
}
