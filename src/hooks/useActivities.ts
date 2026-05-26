import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { useRealtimeSubscription } from "./useRealtimeSubscription";

export type ActivityType = "call" | "email" | "meeting" | "note" | "task" | "whatsapp_msg" | "system";
export type ActivityOutcome = "connected" | "voicemail" | "no_answer" | "busy" | "cancelled" | "completed" | "rescheduled";

export interface Activity {
  id: string;
  organization_id: string;
  type: ActivityType;
  subject: string | null;
  description: string | null;
  contact_id: string | null;
  company_id: string | null;
  deal_id: string | null;
  lead_id: string | null;
  owner_id: string | null;
  assigned_to: string | null;
  due_date: string | null;
  completed_at: string | null;
  duration_sec: number | null;
  outcome: ActivityOutcome | null;
  metadata: Record<string, unknown>;
  is_automated: boolean;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface ActivityWithNames extends Activity {
  owner_email?: string;
  assigned_name?: string;
}

export type ActivityInsert = Omit<Activity, "id" | "organization_id" | "created_at" | "updated_at">;

interface ActivityFilters {
  contactId?: string;
  companyId?: string;
  dealId?: string;
  leadId?: string;
  type?: ActivityType;
  limit?: number;
}

export function useActivities(filters?: ActivityFilters) {
  const { organizationId } = useOrganization();

  const queryKey = [
    "activities",
    organizationId,
    filters?.contactId,
    filters?.companyId,
    filters?.dealId,
    filters?.leadId,
    filters?.type,
    filters?.limit,
  ];

  useRealtimeSubscription("activities", ["activities", organizationId ?? ""]);

  return useQuery<ActivityWithNames[]>({
    queryKey,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_activities", {
        p_organization_id: organizationId,
        p_contact_id: filters?.contactId ?? null,
        p_company_id: filters?.companyId ?? null,
        p_deal_id: filters?.dealId ?? null,
        p_lead_id: filters?.leadId ?? null,
        p_type: filters?.type ?? null,
        p_limit: filters?.limit ?? 50,
      });

      if (error) throw error;
      return (data ?? []) as ActivityWithNames[];
    },
    enabled: !!organizationId,
    staleTime: 2 * 60_000,
  });
}

export function useCreateActivity() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (activity: ActivityInsert) => {
      const { data, error } = await (supabase.from as any)("activities")
        .insert({ ...activity, organization_id: organizationId })
        .select()
        .single();

      if (error) throw error;
      return data as Activity;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["activities"] });
    },
  });
}

export function useUpdateActivity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Activity> & { id: string }) => {
      const { organization_id: _, ...safeUpdates } = updates as any;

      const { data, error } = await (supabase.from as any)("activities")
        .update(safeUpdates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as Activity;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["activities"] });
    },
  });
}

export function useCompleteActivity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const { data, error } = await (supabase.from as any)("activities")
        .update({ completed_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data as Activity;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["activities"] });
    },
  });
}

interface LogActivityParams {
  type: ActivityType;
  subject?: string;
  description?: string;
  contactId?: string;
  companyId?: string;
  dealId?: string;
  leadId?: string;
  metadata?: Record<string, unknown>;
}

export function useLogActivity() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (params: LogActivityParams) => {
      const { data, error } = await (supabase.rpc as any)("log_activity", {
        p_organization_id: organizationId,
        p_type: params.type,
        p_subject: params.subject ?? null,
        p_description: params.description ?? null,
        p_contact_id: params.contactId ?? null,
        p_company_id: params.companyId ?? null,
        p_deal_id: params.dealId ?? null,
        p_lead_id: params.leadId ?? null,
        p_metadata: params.metadata ?? {},
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["activities"] });
    },
  });
}

export function useMigrateFollowUps() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase.rpc as any)("migrate_follow_ups_to_activities", {
        p_organization_id: organizationId,
      });

      if (error) throw error;
      return data as { migrated: number; skipped: number; errors: number };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["activities"] });
    },
  });
}
