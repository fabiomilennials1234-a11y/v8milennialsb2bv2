import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "./useOrganization";
import { useRealtimeSubscription } from "./useRealtimeSubscription";

export interface Contact {
  id: string;
  organization_id: string;
  company_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  normalized_phone: string | null;
  job_title: string | null;
  linkedin_url: string | null;
  avatar_url: string | null;
  source: string | null;
  source_lead_id: string | null;
  is_primary: boolean;
  tags: string[];
  metadata: Record<string, unknown>;
  created_by: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  created_at: string;
  updated_at: string;
  company_name?: string;
}

export type ContactInsert = Omit<Contact, "id" | "organization_id" | "created_at" | "updated_at" | "deleted_at" | "deleted_by" | "company_name">;
export type ContactUpdate = Partial<ContactInsert>;

const STALE_TIME = 2 * 60_000;

export function useContacts(search?: string, companyId?: string) {
  const { organizationId, isReady } = useOrganization();

  useRealtimeSubscription("contacts", ["contacts"]);

  return useQuery({
    queryKey: ["contacts", organizationId, search, companyId],
    queryFn: async () => {
      if (!organizationId) return [];

      let query = (supabase.from as any)("contacts")
        .select("*")
        .eq("organization_id", organizationId)
        .is("deleted_at", null);

      if (search?.trim()) {
        query = query.ilike("name", `%${search.trim()}%`);
      }

      if (companyId) {
        query = query.eq("company_id", companyId);
      }

      const { data, error } = await query.order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Contact[];
    },
    enabled: isReady,
    staleTime: STALE_TIME,
  });
}

export function useContact(id: string | undefined) {
  const { organizationId, isReady } = useOrganization();

  return useQuery({
    queryKey: ["contacts", organizationId, "detail", id],
    queryFn: async () => {
      if (!organizationId || !id) return null;

      const { data, error } = await (supabase.from as any)("contacts")
        .select("*")
        .eq("id", id)
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .single();

      if (error) throw error;
      return data as Contact;
    },
    enabled: isReady && !!id,
    staleTime: STALE_TIME,
  });
}

export function useCreateContact() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (contact: ContactInsert) => {
      if (!organizationId) {
        throw new Error("Cannot create contact: No organization context");
      }

      const { data, error } = await (supabase.from as any)("contacts")
        .insert({ ...contact, organization_id: organizationId })
        .select()
        .single();

      if (error) throw error;
      return data as Contact;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["companies"] });
    },
  });
}

export function useUpdateContact() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async ({ id, ...updates }: ContactUpdate & { id: string }) => {
      if (!organizationId) {
        throw new Error("Cannot update contact: No organization context");
      }

      const { organization_id: _, ...safeUpdates } = updates as ContactUpdate & { organization_id?: string };

      const { data, error } = await (supabase.from as any)("contacts")
        .update(safeUpdates)
        .eq("id", id)
        .eq("organization_id", organizationId)
        .select()
        .single();

      if (error) throw error;
      return data as Contact;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["companies"] });
    },
  });
}

export function useDeleteContact() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (id: string) => {
      if (!organizationId) {
        throw new Error("Cannot delete contact: No organization context");
      }

      const { data: { user } } = await supabase.auth.getUser();

      const { data, error } = await (supabase.from as any)("contacts")
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: user?.id ?? null,
        })
        .eq("id", id)
        .eq("organization_id", organizationId)
        .select()
        .single();

      if (error) throw error;
      return data as Contact;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["companies"] });
    },
  });
}

