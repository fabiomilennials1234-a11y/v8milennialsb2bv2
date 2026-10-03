import { useQueries, useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/** Minimal definition catalogue; answers are never loaded by a selector. */
export function useCustomFieldCatalogue(actorId: string, organizationId: string, search: string, open: boolean, selectedId?: string) {
  const enabled = Boolean(actorId && organizationId);
  const options = useQuery({
    queryKey: ['lead-custom-fields', organizationId, 'catalogue', actorId, 'text-number-boolean-date-select', search],
    enabled: enabled && open,
    queryFn: async ({ signal }) => {
      let query = supabase.from('lead_custom_fields').select('id, field_name, field_type')
        .eq('organization_id', organizationId).in('field_type', ['text', 'number', 'boolean', 'date', 'select']).order('field_name').order('id').limit(25).abortSignal(signal);
      if (search) query = query.ilike('field_name', `%${search.replace(/[\\%_]/g, '\\$&')}%`);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
  const selected = useQuery({
    queryKey: ['lead-custom-fields', organizationId, 'selected', actorId, selectedId],
    enabled: enabled && Boolean(selectedId),
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase.from('lead_custom_fields').select('id, field_name, field_type, field_options')
        .eq('organization_id', organizationId).eq('id', selectedId!).abortSignal(signal).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  return { options, selected };
}

/** Resolve current definition names for an explicit automation approval. */
export function useCustomFieldReferences(actorId: string, organizationId: string, fieldIds: string[]) {
  return useQueries({ queries: fieldIds.map(fieldId => ({
    queryKey: ['lead-custom-fields', organizationId, 'selected', actorId, fieldId],
    enabled: Boolean(actorId && organizationId && fieldId),
    queryFn: async ({ signal }: { signal: AbortSignal }) => {
      const { data, error } = await supabase.from('lead_custom_fields').select('id, field_name, field_type, field_options')
        .eq('organization_id', organizationId).eq('id', fieldId).abortSignal(signal).maybeSingle();
      if (error) throw error;
      return data;
    },
  })) });
}
