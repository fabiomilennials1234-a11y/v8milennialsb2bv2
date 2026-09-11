import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const GUIDED_LEAD_VALUE_FIELDS = new Set(['utm_campaign', 'utm_source', 'utm_medium', 'utm_content', 'utm_term', 'segment', 'urgency', 'faturamento']);

/** Bounded caller-scoped suggestions. A page is never the set of valid values. */
export function useGuidedLeadValues(actorId: string, organizationId: string, field: string, search: string) {
  return useQuery({
    queryKey: ['leads', organizationId, 'guided-values', actorId, field, search],
    enabled: Boolean(actorId && organizationId && GUIDED_LEAD_VALUE_FIELDS.has(field)),
    queryFn: async ({ signal }) => {
      if (!GUIDED_LEAD_VALUE_FIELDS.has(field)) throw new Error('Unsupported lead suggestion field');
      let query = supabase.from('leads').select(field).eq('organization_id', organizationId)
        .is('deleted_at', null).not(field, 'is', null).neq(field, '').order(field).limit(25).abortSignal(signal);
      if (search) query = query.ilike(field, `%${search.replace(/[\\%_]/g, '\\$&')}%`);
      const { data, error } = await query;
      if (error) throw error;
      const values = (data as unknown as Array<Record<string, unknown>>).map(row => row[field])
        .filter((value): value is string => typeof value === 'string' && value.trim() !== '');
      return [...new Set(values)];
    },
  });
}
