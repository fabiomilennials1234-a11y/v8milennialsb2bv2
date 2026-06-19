/**
 * Hooks para gerenciamento de organizações pelo Master Admin
 *
 * Diferente dos hooks normais, estes NÃO filtram por organization_id,
 * permitindo ao Master ver e gerenciar TODAS as organizações.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";
import { FUNIL_A_TEMPLATES, FUNIL_B_TEMPLATES } from "@/modules/workflows";
import { toast } from "sonner";

/**
 * Modelos de funil (kanban) para novas organizações.
 *
 * Ao criar uma org, o Master pode escolher um modelo. Os kanbans
 * (linhas de `pipeline_stages` de todos os pipes) são clonados AO VIVO da
 * organização-base correspondente — sempre refletem a configuração atual da base.
 *
 * Requer usuário Master: a policy RLS `master_all_pipeline_stages`
 * (FOR ALL USING is_master_user()) permite ler/gravar stages de qualquer org.
 */
export type FunnelTemplateKey = "funil_a" | "funil_b";

export const FUNNEL_TEMPLATES: Record<
  FunnelTemplateKey,
  { label: string; description: string; sourceOrgId: string }
> = {
  funil_a: {
    label: "Funil A",
    description: "Puxa os kanbans do modelo Funil A",
    // org-base interna (não exibida na UI): Natu Flores
    sourceOrgId: "249b55e0-4389-4b32-b6ab-f9f091139fba",
  },
  funil_b: {
    label: "Funil B",
    description: "Puxa os kanbans do modelo Funil B",
    // org-base interna (não exibida na UI): Bennedita Pan
    sourceOrgId: "9d0367c6-2ae8-40cf-9862-a225a5b19026",
  },
};

// Colunas seguras para clonar entre orgs. Excluídas de propósito:
// id / organization_id / created_at / updated_at (gerados) e
// checklist_template_id / sla_escalate_to (uuid org-specific — apontariam pra
// registros da org-base; ficam nulos no clone).
const CLONEABLE_STAGE_COLUMNS =
  "pipeline_type, stage_key, name, color, position, is_active, is_final_positive, is_final_negative, auto_move_min_days, auto_move_max_days, target_pipe_type, target_stage_key, default_probability, sla_hours, sla_action, max_days_in_stage";

/**
 * Clona os `pipeline_stages` de uma org-base para a org-alvo.
 *
 * O trigger `trigger_create_default_stages` já cria etapas padrão quando a org
 * é criada — por isso removemos essas antes de inserir as do modelo, evitando
 * conflito de unique key (organization_id, pipeline_type, stage_key) e mistura
 * de etapas padrão com as do modelo.
 */
async function cloneFunnelStages(sourceOrgId: string, targetOrgId: string) {
  const read = await supabase
    .from("pipeline_stages")
    .select(CLONEABLE_STAGE_COLUMNS)
    .eq("organization_id", sourceOrgId);

  if (read.error) throw read.error;

  const srcStages = (read.data ?? []) as Record<string, unknown>[];
  if (srcStages.length === 0) {
    console.warn("Modelo de funil: org-base sem etapas, clone ignorado:", sourceOrgId);
    return;
  }

  // Remove as etapas padrão auto-criadas pelo trigger de criação da org.
  const del = await supabase
    .from("pipeline_stages")
    .delete()
    .eq("organization_id", targetOrgId);
  if (del.error) throw del.error;

  // Insere as etapas clonadas, reapontando para a org nova.
  const rows = srcStages.map((s) => ({
    ...s,
    organization_id: targetOrgId,
  })) as TablesInsert<"pipeline_stages">[];

  const ins = await supabase.from("pipeline_stages").insert(rows);
  if (ins.error) throw ins.error;
}

/**
 * Automações-base de cada funil — os mesmos templates de sistema exibidos em
 * Automações → Templates. Fonte única: `workflows/lib/funnelTemplates.ts`
 * (auto-gerado das pastas `Funil A/` e `Funil B/`).
 */
const FUNNEL_WORKFLOW_TEMPLATES: Record<
  FunnelTemplateKey,
  { name: string; description: string | null; definition: Record<string, unknown> }[]
> = {
  funil_a: FUNIL_A_TEMPLATES,
  funil_b: FUNIL_B_TEMPLATES,
};

/**
 * Cria as automações-base do funil escolhido na org nova, TODAS **inativas**
 * (`is_active=false`) — o Master/admin ativa quando quiser.
 *
 * O mapeamento template→workflow espelha `WorkflowTemplates.handleUseTemplate`:
 * `trigger_type`/`trigger_config` saem do nó `trigger` da `definition`.
 *
 * Requer Master: a policy RLS `master_all_workflows` (FOR ALL USING
 * is_master_user()) permite inserir workflows em qualquer org.
 */
async function seedFunnelWorkflows(
  funnelTemplate: FunnelTemplateKey,
  targetOrgId: string,
) {
  const templates = FUNNEL_WORKFLOW_TEMPLATES[funnelTemplate] ?? [];
  if (templates.length === 0) return;

  const rows = templates.map((tpl) => {
    const nodes =
      (tpl.definition as { nodes?: Record<string, any>[] }).nodes ?? [];
    const triggerNode = nodes.find((n) => n?.type === "trigger");
    return {
      organization_id: targetOrgId,
      name: tpl.name,
      description: tpl.description ?? null,
      trigger_type: triggerNode?.data?.triggerType ?? "lead_created",
      trigger_config: triggerNode?.data?.config ?? {},
      definition: tpl.definition,
      is_active: false,
    };
  }) as TablesInsert<"workflows">[];

  const ins = await supabase.from("workflows").insert(rows);
  if (ins.error) throw ins.error;
}

type MasterOrganizationMember = Tables<"team_members"> & {
  user_roles: { role: Tables<"user_roles">["role"] }[];
};

export type OrgType = "crm" | "outbound";

export interface MasterOrganization {
  id: string;
  name: string;
  slug: string;
  org_type: OrgType;
  subscription_status: string;
  subscription_plan: string | null;
  subscription_expires_at: string | null;
  billing_override: boolean;
  billing_override_reason: string | null;
  billing_override_by: string | null;
  billing_override_at: string | null;
  payment_customer_id: string | null;
  payment_subscription_id: string | null;
  created_at: string;
  updated_at: string;
  // Computed/joined
  members_count?: number;
  leads_count?: number;
}

export interface OrganizationStats {
  total: number;
  active: number;
  trial: number;
  suspended: number;
  cancelled: number;
  withOverride: number;
}

/**
 * Lista TODAS as organizações (sem filtro de org)
 */
export function useMasterOrganizations() {
  return useQuery({
    queryKey: ["master-organizations"],
    queryFn: async (): Promise<MasterOrganization[]> => {
      const { data, error } = await supabase
        .from("organizations")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as MasterOrganization[];
    },
    staleTime: 30 * 1000, // 30 segundos
  });
}

/**
 * Busca uma organização específica com detalhes
 */
export function useMasterOrganization(orgId: string | undefined) {
  return useQuery({
    queryKey: ["master-organization", orgId],
    queryFn: async (): Promise<MasterOrganization | null> => {
      if (!orgId) return null;

      const { data, error } = await supabase
        .from("organizations")
        .select("*")
        .eq("id", orgId)
        .single();

      if (error) throw error;
      return data as MasterOrganization;
    },
    enabled: !!orgId,
  });
}

/**
 * Estatísticas gerais das organizações
 */
export function useMasterOrganizationStats() {
  return useQuery({
    queryKey: ["master-organization-stats"],
    queryFn: async (): Promise<OrganizationStats> => {
      const { data, error } = await supabase
        .from("organizations")
        .select("subscription_status, billing_override");

      if (error) throw error;

      const orgs = data || [];
      return {
        total: orgs.length,
        active: orgs.filter((o) => o.subscription_status === "active").length,
        trial: orgs.filter((o) => o.subscription_status === "trial").length,
        suspended: orgs.filter((o) => o.subscription_status === "suspended").length,
        cancelled: orgs.filter((o) => o.subscription_status === "cancelled" || o.subscription_status === "expired").length,
        withOverride: orgs.filter((o) => o.billing_override).length,
      };
    },
    staleTime: 60 * 1000, // 1 minuto
  });
}

// Badges base do sistema para orgs OUTBOUND
const SYSTEM_BADGES: { name: string; description: string; icon: string; criteria_type: string; criteria_value: number }[] = [
  { name: "Primeiro Lead Quente", description: "Recebeu o primeiro lead quente", icon: "flame", criteria_type: "leads_quentes", criteria_value: 1 },
  { name: "Primeira Venda", description: "Fechou a primeira venda", icon: "target", criteria_type: "vendas_count", criteria_value: 1 },
  { name: "10 Leads Convertidos", description: "Converteu 10 leads", icon: "trending-up", criteria_type: "leads_quentes", criteria_value: 10 },
  { name: "Primeira Venda Recorrente", description: "Primeira venda de cliente recorrente", icon: "repeat", criteria_type: "vendas_recorrentes", criteria_value: 1 },
  { name: "R$ 50k Faturados", description: "Atingiu R$ 50.000 em faturamento", icon: "badge-dollar-sign", criteria_type: "faturamento_total", criteria_value: 50000 },
  { name: "50 Leads Convertidos", description: "Converteu 50 leads", icon: "zap", criteria_type: "leads_quentes", criteria_value: 50 },
  { name: "R$ 100k Faturados", description: "Atingiu R$ 100.000 em faturamento", icon: "trophy", criteria_type: "faturamento_total", criteria_value: 100000 },
  { name: "5 Vendas Fechadas", description: "Fechou 5 vendas", icon: "award", criteria_type: "vendas_count", criteria_value: 5 },
];

/**
 * Criar nova organização
 */
export function useMasterCreateOrganization() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      name: string;
      slug: string;
      org_type?: OrgType;
      subscription_plan?: string;
      subscription_status?: string;
      funnelTemplate?: FunnelTemplateKey | null;
    }) => {
      const orgType = data.org_type || "crm";

      // 1. Criar organização
      const { data: org, error } = await supabase
        .from("organizations")
        .insert({
          name: data.name,
          slug: data.slug,
          org_type: orgType,
          subscription_plan: data.subscription_plan || "free",
          subscription_status: data.subscription_status || "trial",
        })
        .select()
        .single();

      if (error) throw error;

      // 2. Se OUTBOUND: seed badges base
      if (orgType === "outbound") {
        const badgeRows = SYSTEM_BADGES.map((b) => ({
          organization_id: org.id,
          name: b.name,
          description: b.description,
          icon: b.icon,
          criteria_type: b.criteria_type,
          criteria_value: b.criteria_value,
          is_system: true,
        }));

        const { error: badgesError } = await supabase
          .from("badges")
          .insert(badgeRows);

        if (badgesError) {
          console.error("Error seeding badges:", badgesError);
        }
      }

      // 3. Se um modelo de funil foi escolhido: clona os kanbans da org-base
      //    e já cria as automações-base do funil (todas inativas).
      if (data.funnelTemplate && FUNNEL_TEMPLATES[data.funnelTemplate]) {
        try {
          await cloneFunnelStages(
            FUNNEL_TEMPLATES[data.funnelTemplate].sourceOrgId,
            org.id,
          );
        } catch (cloneError) {
          console.error("Error cloning funnel template:", cloneError);
          // Não falha a criação da org — apenas avisa que o modelo não aplicou.
          toast.error(
            "Organização criada, mas houve falha ao aplicar o modelo de funil.",
          );
        }

        // 4. Automações do funil já vêm criadas e INATIVAS — admin ativa depois.
        //    Erro aqui não desfaz a org nem o clone dos kanbans.
        try {
          await seedFunnelWorkflows(data.funnelTemplate, org.id);
        } catch (seedError) {
          console.error("Error seeding funnel workflows:", seedError);
          toast.error(
            "Organização criada, mas houve falha ao criar as automações do funil.",
          );
        }
      }

      return org;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["master-organizations"] });
      queryClient.invalidateQueries({ queryKey: ["master-organization-stats"] });
      toast.success("Organização criada com sucesso!");
    },
    onError: (error: any) => {
      console.error("Error creating organization:", error);
      toast.error(error.message || "Erro ao criar organização");
    },
  });
}

/**
 * Atualizar organização
 */
export function useMasterUpdateOrganization() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: Partial<MasterOrganization> & { id: string }) => {
      const { data, error } = await supabase
        .from("organizations")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["master-organizations"] });
      queryClient.invalidateQueries({ queryKey: ["master-organization", variables.id] });
      toast.success("Organização atualizada!");
    },
    onError: (error: any) => {
      toast.error(error.message || "Erro ao atualizar organização");
    },
  });
}

/**
 * Excluir organização
 */
export function useMasterDeleteOrganization() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("organizations")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["master-organizations"] });
      queryClient.invalidateQueries({ queryKey: ["master-organization-stats"] });
      toast.success("Organização excluída!");
    },
    onError: (error: any) => {
      toast.error(error.message || "Erro ao excluir organização");
    },
  });
}

/**
 * Override de billing (liberar plano manualmente)
 */
export function useMasterBillingOverride() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      orgId,
      plan,
      reason,
      expiresAt,
    }: {
      orgId: string;
      plan: string;
      reason: string;
      expiresAt?: string;
    }) => {
      const { error } = await supabase.rpc("master_override_billing", {
        _org_id: orgId,
        _plan: plan,
        _reason: reason,
        _expires_at: expiresAt || undefined,
      });

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["master-organizations"] });
      queryClient.invalidateQueries({ queryKey: ["master-organization", variables.orgId] });
      queryClient.invalidateQueries({ queryKey: ["master-organization-stats"] });
      toast.success("Plano liberado com sucesso!");
    },
    onError: (error: any) => {
      toast.error(error.message || "Erro ao liberar plano");
    },
  });
}

/**
 * Buscar membros de uma organização
 */
export function useMasterOrganizationMembers(orgId: string | undefined) {
  return useQuery({
    queryKey: ["master-organization-members", orgId],
    queryFn: async (): Promise<MasterOrganizationMember[]> => {
      if (!orgId) return [];

      // The embedded `user_roles:user_roles(role)` select makes PostgREST's
      // result-type parser explode (TS2589). The `from` result is typed loosely
      // *before* `.select(...)` so the deep result-type parser never runs; the
      // row shape is recovered via the cast below.
      type LooseFilterBuilder = {
        eq: (column: string, value: unknown) => LooseFilterBuilder;
        order: (column: string) => LooseFilterBuilder;
        then: PromiseLike<{ data: unknown; error: unknown }>["then"];
      };
      type LooseFrom = { select: (columns: string) => LooseFilterBuilder };

      const { data, error } = await (supabase
        .from("team_members") as unknown as LooseFrom)
        .select(`
          *,
          user_roles:user_roles(role)
        `)
        .eq("organization_id", orgId)
        .order("name");

      if (error) throw error;
      return (data ?? []) as unknown as MasterOrganizationMember[];
    },
    enabled: !!orgId,
  });
}
