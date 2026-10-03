/**
 * useOrgWhatsAppMigration — query + mutations para campos de migração.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentTeamMember } from "@/modules/identity";
export type MigrationStatus =
  | "not_started"
  | "pending"
  | "in_progress"
  | "migrated"
  | "failed";

export function useOrgMigrationStatus(organizationId?: string | null) {
  const { data: teamMember } = useCurrentTeamMember();
  const orgId = organizationId ?? teamMember?.organization_id;

  return useQuery({
    queryKey: ["org_whatsapp_migration", orgId],
    queryFn: async () => {
      if (!orgId) return null;
      const { data, error } = await supabase
        .from("organizations")
        .select("id, name, whatsapp_provider_override, whatsapp_migration_status, whatsapp_migration_completed_at")
        .eq("id", orgId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
  });
}

export function useSetMigrationStatus() {
  const qc = useQueryClient();
  const { data: teamMember } = useCurrentTeamMember();
  return useMutation({
    mutationFn: async ({
      organizationId,
      status,
      completed,
    }: {
      organizationId: string;
      status: MigrationStatus;
      completed?: boolean;
    }) => {
      const update: Record<string, unknown> = {
        whatsapp_migration_status: status,
      };
      if (completed) {
        update.whatsapp_migration_completed_at = new Date().toISOString();
      }
      const { error } = await supabase
        .from("organizations")
        .update(update)
        .eq("id", organizationId);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({
        queryKey: ["org_whatsapp_migration", vars.organizationId],
      });
      if (teamMember?.organization_id === vars.organizationId) {
        qc.invalidateQueries({
          queryKey: ["org_whatsapp_migration", teamMember.organization_id],
        });
      }
    },
  });
}

export function useSetProviderOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      organizationId,
      override,
    }: {
      organizationId: string;
      override: "uazapi" | "evolution" | null;
    }) => {
      const { error } = await supabase
        .from("organizations")
        .update({ whatsapp_provider_override: override })
        .eq("id", organizationId);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({
        queryKey: ["org_whatsapp_migration", vars.organizationId],
      });
    },
  });
}
