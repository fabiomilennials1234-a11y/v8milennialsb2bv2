/**
 * useMetaTemplates — Meta WhatsApp Cloud message TEMPLATES (Slice 6, ADR-0009).
 *
 * Thin client over the three edge functions (meta-template-list / -create /
 * -sync). The org is resolved server-side from the auth context (the JWT is
 * forwarded automatically by the authenticated supabase client) — the client
 * never sends organization_id.
 *
 * INERT until the `meta_cloud` feature flag is on: this hook is gated by that
 * flag so the list query does not fire for orgs without Meta Cloud. UI that
 * surfaces templates must also gate behind useFeatureFlag("meta_cloud").
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/modules/identity";
import { useFeatureFlag } from "@/modules/platform";

// ── Types ────────────────────────────────────────────────────────

export type MetaTemplateStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "paused"
  | "disabled";

export type MetaTemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";

export interface MetaTemplateComponent {
  type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS";
  format?: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";
  text?: string;
  buttons?: Array<Record<string, unknown>>;
  example?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MetaMessageTemplate {
  id: string;
  organization_id: string;
  instance_id: string | null;
  name: string;
  language: string;
  category: MetaTemplateCategory;
  components: MetaTemplateComponent[];
  meta_template_id: string | null;
  status: MetaTemplateStatus;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateMetaTemplateInput {
  name: string;
  language?: string;
  category: MetaTemplateCategory;
  components: MetaTemplateComponent[];
  instance_id?: string | null;
}

const TEMPLATES_KEY = "meta_message_templates";

// ── List ─────────────────────────────────────────────────────────

export function useMetaTemplates() {
  const { organizationId } = useOrganization();
  const { enabled: flagEnabled } = useFeatureFlag("meta_cloud");

  return useQuery({
    queryKey: [TEMPLATES_KEY, organizationId],
    enabled: !!organizationId && flagEnabled,
    queryFn: async (): Promise<MetaMessageTemplate[]> => {
      const { data, error } = await supabase.functions.invoke("meta-template-list", {
        body: {},
      });
      if (error) throw error;
      return ((data as { templates?: MetaMessageTemplate[] })?.templates) ?? [];
    },
  });
}

// ── Create + submit to Meta ──────────────────────────────────────

export function useCreateMetaTemplate() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (input: CreateMetaTemplateInput) => {
      const { data, error } = await supabase.functions.invoke("meta-template-create", {
        body: {
          name: input.name,
          language: input.language ?? "pt_BR",
          category: input.category,
          components: input.components,
          instance_id: input.instance_id ?? null,
        },
      });
      if (error) throw error;
      return data as { template: MetaMessageTemplate; submitted: boolean };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [TEMPLATES_KEY, organizationId] });
    },
  });
}

// ── Sync (poll Meta approval status) ─────────────────────────────

export function useSyncMetaTemplates() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("meta-template-sync", {
        body: {},
      });
      if (error) throw error;
      return data as {
        pending: number;
        checked: number;
        updated: number;
        skipped: number;
        failed: number;
      };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [TEMPLATES_KEY, organizationId] });
    },
  });
}
