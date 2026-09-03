/**
 * Hooks para gerenciamento de organizações pelo Master Admin
 *
 * Diferente dos hooks normais, estes NÃO filtram por organization_id,
 * permitindo ao Master ver e gerenciar TODAS as organizações.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";
import { FUNIL_A_TEMPLATES, FUNIL_B_TEMPLATES } from "@/contracts/workflows/funnel-templates";
import { toast } from "sonner";

/**
 * Modelos de funil (kanban) para novas organizações.
 *
 * Ao criar uma org, o Master pode escolher um modelo. Os FUNIS (`pipelines` +
 * `pipeline_stages` por FK + o registro em `pipeline_display_config`) são
 * clonados AO VIVO da organização-base correspondente — sempre refletem a
 * configuração atual da base (SCRUM-635).
 *
 * Requer usuário Master: as policies `master_all_pipelines`,
 * `master_all_pipeline_stages` e `master_ghost_all_pipeline_display_config`
 * (FOR ALL USING is_master_user()) permitem ler/gravar em qualquer org.
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
// id / organization_id / pipeline_id / created_at / updated_at (gerados ou
// remapeados) e checklist_template_id / sla_escalate_to (uuid org-specific —
// apontariam pra registros da org-base; ficam nulos no clone).
// `pipeline_type` segue no clone como espelho de compat (morre na F6).
const CLONEABLE_STAGE_COLUMNS =
  "pipeline_type, stage_key, name, color, position, is_active, is_final_positive, is_final_negative, auto_move_min_days, auto_move_max_days, target_pipe_type, target_stage_key, default_probability, sla_hours, sla_action, max_days_in_stage";

/**
 * Clona os FUNIS de uma org-base para a org-alvo — modelo único pós-W3
 * (SCRUM-635): `pipelines` (FK) + `pipeline_stages` por `pipeline_id`
 * remapeado + o registro em `pipeline_display_config` (o portão que autoriza
 * funil de sistema a existir desde 20270902000000).
 *
 * A versão anterior clonava SÓ `pipeline_stages` pela chave composta
 * (organization_id, pipeline_type, stage_key): nenhuma linha de `pipelines`
 * nascia, as etapas chegavam com `pipeline_id` NULL e funil custom da base
 * virava linha órfã. Pós-W3 (entries por stage_id/FK) isso é um clone quebrado.
 *
 * MEDIDO 2026-09-02 (prod): o clone roda no BROWSER com o usuário Master —
 * mecanismo preservado; as policies `master_all_pipelines`,
 * `master_all_pipeline_stages` e `master_ghost_all_pipeline_display_config`
 * (FOR ALL USING is_master_user()) cobrem leitura e escrita nas 3 tabelas.
 * SCRUM-641: a org-alvo nasce COM o "Funil de Vendas" semeado (trigger
 * trg_seed_default_funnel, 20270918000000) já apontado como funil padrão —
 * os deletes abaixo removem o seed antes de aplicar o template (o padrão é
 * solto antes e reapontado no fim; ver passos 2 e 6).
 */
async function cloneFunnelStages(sourceOrgId: string, targetOrgId: string) {
  // 1. Lê a org-base: funis, registro e etapas (só as vivas — com FK).
  const [pipesRead, cfgRead, stagesRead] = await Promise.all([
    supabase
      .from("pipelines")
      .select("id, name, slug, type, description, icon, color, display_order, is_active, config")
      .eq("organization_id", sourceOrgId),
    supabase
      .from("pipeline_display_config")
      .select("pipe_type, display_name, is_visible, position")
      .eq("organization_id", sourceOrgId),
    // `as any` no from: pipeline_stages.pipeline_id (20270906001000) ainda
    // não está no types.ts gerado — mesmo padrão de usePipelines.
    (supabase.from as any)("pipeline_stages")
      .select(`pipeline_id, ${CLONEABLE_STAGE_COLUMNS}`)
      .eq("organization_id", sourceOrgId)
      .not("pipeline_id", "is", null),
  ]);
  if (pipesRead.error) throw pipesRead.error;
  if (cfgRead.error) throw cfgRead.error;
  if (stagesRead.error) throw stagesRead.error;

  const srcPipelines = (pipesRead.data ?? []) as Record<string, unknown>[];
  if (srcPipelines.length === 0) {
    console.warn("Modelo de funil: org-base sem funis, clone ignorado:", sourceOrgId);
    return;
  }

  // 2. Limpa o alvo (ordem FK: etapas antes dos funis).
  //
  // SCRUM-641: a org nova nasce com o "Funil de Vendas" semeado JÁ como
  // `default_pipeline_id` (trigger trg_seed_default_funnel). O DELETE abaixo
  // morreria em `trg_guard_default_pipeline_delete` ("funil padrão exige
  // substituto") — então o padrão é solto ANTES e reapontado no passo 6 para
  // o funil clonado. `as never` no update: `default_pipeline_id`
  // (20270908004000) ainda não está no types.ts gerado — mesmo padrão de
  // useOrganizationSettings.
  const clearDefault = await supabase
    .from("organizations")
    .update({ default_pipeline_id: null } as never)
    .eq("id", targetOrgId);
  if (clearDefault.error) throw clearDefault.error;

  const delStages = await supabase.from("pipeline_stages").delete().eq("organization_id", targetOrgId);
  if (delStages.error) throw delStages.error;
  const delPipes = await supabase.from("pipelines").delete().eq("organization_id", targetOrgId);
  if (delPipes.error) throw delPipes.error;

  // 3. Registro primeiro — é o portão dos funis de sistema.
  const cfgRows = (cfgRead.data ?? []).map((c: Record<string, unknown>) => ({
    ...c,
    organization_id: targetOrgId,
    updated_at: new Date().toISOString(),
  }));
  if (cfgRows.length > 0) {
    const cfgIns = await supabase
      .from("pipeline_display_config")
      .upsert(cfgRows as TablesInsert<"pipeline_display_config">[], {
        onConflict: "organization_id,pipe_type",
      });
    if (cfgIns.error) throw cfgIns.error;
  }

  // 4. Funis: insere reapontando a org e mapeia id-base → id-novo por slug
  //    (slug é único por org — medido 2026-09-02).
  const pipelineRows = srcPipelines.map(({ id: _id, ...rest }) => ({
    ...rest,
    organization_id: targetOrgId,
  })) as TablesInsert<"pipelines">[];
  const pipeIns = await supabase.from("pipelines").insert(pipelineRows).select("id, slug");
  if (pipeIns.error) throw pipeIns.error;
  const newIdBySlug = new Map(
    ((pipeIns.data ?? []) as { id: string; slug: string }[]).map((p) => [p.slug, p.id]),
  );
  const newIdByOldId = new Map(
    srcPipelines.map((p) => [p.id as string, newIdBySlug.get(p.slug as string) ?? null]),
  );

  // 5. Etapas: remapeia a FK. Etapa cuja FK não resolveu não entra — melhor
  //    faltar visível do que nascer órfã de novo.
  const stageRows = ((stagesRead.data ?? []) as Record<string, unknown>[])
    .map(({ pipeline_id, ...rest }) => ({
      ...rest,
      organization_id: targetOrgId,
      pipeline_id: newIdByOldId.get(pipeline_id as string) ?? null,
    }))
    .filter((r) => r.pipeline_id != null) as unknown as TablesInsert<"pipeline_stages">[];

  if (stageRows.length > 0) {
    const ins = await supabase.from("pipeline_stages").insert(stageRows);
    if (ins.error) throw ins.error;
  }

  // 6. Funil padrão da org clonada (D4): espelha o padrão da org-base quando
  //    ele resolveu no clone; senão o primeiro funil clonado por display_order.
  //    Sem isto a org nova com template ficaria SEM padrão (as portas de
  //    entrada criariam lead sem card).
  const { data: srcOrg } = await supabase
    .from("organizations")
    .select("default_pipeline_id" as "id")
    .eq("id", sourceOrgId)
    .maybeSingle();
  const srcDefault = (srcOrg as { default_pipeline_id?: string | null } | null)?.default_pipeline_id ?? null;
  const mappedDefault = srcDefault ? newIdByOldId.get(srcDefault) ?? null : null;
  const fallbackDefault = [...srcPipelines]
    .sort((a, b) => Number(a.display_order ?? 0) - Number(b.display_order ?? 0))
    .map((p) => newIdByOldId.get(p.id as string) ?? null)
    .find((id) => id != null) ?? null;
  const newDefault = mappedDefault ?? fallbackDefault;
  if (newDefault) {
    const setDefault = await supabase
      .from("organizations")
      .update({ default_pipeline_id: newDefault } as never)
      .eq("id", targetOrgId);
    if (setDefault.error) throw setDefault.error;
  }
}

/**
 * Automações-base de cada funil — os mesmos templates de sistema exibidos em
 * Automações → Templates. Fonte única: `@/contracts/workflows/funnel-templates`
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
 * Suspender / reativar organização.
 *
 * Passa pela RPC `master_set_org_suspension` em vez de escrever
 * `subscription_status` direto: suspender precisa LIMPAR o `billing_override`
 * na mesma transação, senão o bloqueio não vale nada — `org_access_blocked()`
 * é `status bloqueado AND NOT billing_override`. Escrever só o status era um
 * no-op silencioso na maioria das orgs de prod, que carregam override ligado.
 */
export interface OrgSuspensionResult {
  org_id: string;
  status: string;
  billing_override: boolean;
  override_revogado: boolean;
  acesso_bloqueado: boolean;
}

export function useMasterSetOrgSuspension() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      orgId,
      suspend,
      reason,
    }: {
      orgId: string;
      suspend: boolean;
      reason?: string;
    }): Promise<OrgSuspensionResult> => {
      const { data, error } = await supabase.rpc("master_set_org_suspension" as any, {
        _org_id: orgId,
        _suspend: suspend,
        _reason: reason ?? null,
      } as any);

      if (error) throw error;
      return data as unknown as OrgSuspensionResult;
    },
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["master-organizations"] });
      queryClient.invalidateQueries({ queryKey: ["master-organization", variables.orgId] });
      queryClient.invalidateQueries({ queryKey: ["master-organization-stats"] });

      if (!variables.suspend) {
        toast.success("Organização reativada.");
        return;
      }
      toast.success(
        result.override_revogado
          ? "Organização suspensa. Liberação de plano revogada — o acesso foi cortado."
          : "Organização suspensa. Acesso cortado."
      );
    },
    onError: (error: any) => {
      toast.error(error.message || "Erro ao alterar a suspensão da organização");
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
