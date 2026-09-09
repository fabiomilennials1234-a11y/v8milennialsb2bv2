// deno-lint-ignore-file no-explicit-any
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export async function getOrgIdFromJwt(req: Request): Promise<{ orgId: string; userId: string } | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  // `autoRefreshToken: false` nos dois: o auth-js arma um `setInterval` de 30 s
  // por cliente e ninguém o desarma. Aqui o JWT vem pronto no cabeçalho e o
  // service_role não tem sessão — não há o que renovar. Ver
  // `_shared/supabase-admin.ts`.
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );

  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return null;

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data: tm } = await adminClient
    .from("team_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (!tm?.organization_id) return null;
  return { orgId: tm.organization_id, userId: user.id };
}

export async function verifyWhatsAppConnected(supabase: SupabaseClient, orgId: string): Promise<boolean> {
  // PROVIDER_SCOPE_EXEMPT: presence check, not a dispatch pick. Any connected
  // provider — including a Meta Cloud number — counts as "WhatsApp connected"
  // for onboarding completion, so this deliberately does NOT filter provider.
  const { data } = await supabase
    .from("whatsapp_instances")
    .select("id") // PROVIDER_SCOPE_EXEMPT — presence check, any provider counts
    .eq("organization_id", orgId)
    .eq("status", "connected")
    .limit(1)
    .maybeSingle();

  return !!data;
}

function slugify(name: string, sep: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, sep)
    .replace(new RegExp(`^\\${sep}+|\\${sep}+$`, "g"), "");
}

/**
 * Aplica os templates de funil na org — lista LIVRE (SCRUM-641).
 *
 * O template só carrega `custom_pipelines`: cada um vira funil comum nas
 * tabelas-base `pipelines` + `pipeline_stages` (modelo único pós-W3),
 * espelhando o fluxo de criação do front (`useCreateCustomPipeline`):
 * slug/stage_key canônicos, org nas etapas, rollback do funil se as etapas
 * falharem.
 *
 * `default_pipelines_config` (os 3 toggles fixos do trio legado) é IGNORADO
 * desde o SCRUM-641 — org nova já nasce com o "Funil de Vendas" semeado como
 * funil padrão pelo trigger `trg_seed_default_funnel` (20270918000000), e o
 * trio deixou de ser oferecível. O log abaixo denuncia template antigo que
 * ainda carregue a chave.
 */
export async function applyPipelineTemplates(
  supabase: SupabaseClient,
  orgId: string,
  templates: any[],
): Promise<{ pipelines: any[] }> {
  const created: any[] = [];

  for (const tpl of templates) {
    // SCRUM-641: o bloco `default_pipelines_config` → `enable_system_pipeline`
    // MORREU. Org nova já nasce com o "Funil de Vendas" semeado como padrão
    // (trigger trg_seed_default_funnel, 20270918000000); template master não
    // oferece mais o trio legado como toggle fixo — o que o template carrega
    // é a lista LIVRE de `custom_pipelines` abaixo. As chaves
    // `default_pipelines_config` dos 3 templates de prod (medido 2026-09-03)
    // ficam inertes de propósito.
    if (tpl.default_pipelines_config && Object.keys(tpl.default_pipelines_config).length > 0) {
      console.log(
        "[onboarding-engine] default_pipelines_config ignorado (SCRUM-641, funil único de fábrica):",
        tpl.name,
      );
    }

    const customs = tpl.custom_pipelines ?? [];
    for (const cp of customs) {
      const { data: pipeline, error: pipeErr } = await supabase
        .from("pipelines")
        .insert({
          organization_id: orgId,
          name: cp.name,
          slug: slugify(cp.name ?? "", "-"),
          type: "custom",
          icon: cp.icon ?? null,
          color: cp.color ?? null,
          is_active: true,
        })
        .select("id, name")
        .single();

      if (pipeErr || !pipeline) {
        console.error("[onboarding-engine] criação de funil custom falhou:", cp.name, pipeErr?.message);
        continue;
      }

      const stages = (cp.stages ?? []).map((s: any, idx: number) => ({
        organization_id: orgId,
        pipeline_id: pipeline.id,
        stage_key: slugify(s.name ?? "", "_"),
        name: s.name,
        color: s.color ?? null,
        position: s.position ?? idx,
        is_active: true,
        is_final_positive: s.is_final_positive ?? false,
        is_final_negative: s.is_final_negative ?? false,
      }));

      if (stages.length > 0) {
        const { error: stagesError } = await supabase.from("pipeline_stages").insert(stages);
        if (stagesError) {
          // Mesmo contrato do front: funil sem etapa não fica pela metade.
          console.error("[onboarding-engine] etapas do funil custom falharam:", cp.name, stagesError.message);
          await supabase.from("pipelines").delete().eq("id", pipeline.id);
          continue;
        }
      }

      created.push({ type: "custom_pipeline", id: pipeline.id, name: pipeline.name, stages: cp.stages });
    }
  }

  return { pipelines: created };
}

export function resolveFieldPath(definition: any, fieldPath: string, value: any): any {
  const clone = JSON.parse(JSON.stringify(definition));
  const parts = fieldPath.match(/([^[.\]]+)/g);
  if (!parts || parts.length === 0) return clone;

  let current = clone;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = /^\d+$/.test(parts[i]) ? parseInt(parts[i], 10) : parts[i];
    if (current[key] === undefined) return clone;
    current = current[key];
  }

  const lastKey = /^\d+$/.test(parts[parts.length - 1])
    ? parseInt(parts[parts.length - 1], 10)
    : parts[parts.length - 1];
  current[lastKey] = value;
  return clone;
}

export async function applyAutomationTemplates(
  supabase: SupabaseClient,
  orgId: string,
  selections: { template_id: string; enabled: boolean; customizations?: Record<string, any> }[],
): Promise<{ workflows: any[] }> {
  const enabled = selections.filter((s) => s.enabled);
  if (enabled.length === 0) throw new Error("At least one automation must be enabled");

  const created: any[] = [];

  for (const sel of enabled) {
    const { data: tpl } = await supabase
      .from("onboarding_automation_templates")
      .select("*")
      .eq("id", sel.template_id)
      .single();

    if (!tpl) continue;

    let definition = tpl.workflow_definition;
    if (sel.customizations) {
      for (const [path, val] of Object.entries(sel.customizations)) {
        definition = resolveFieldPath(definition, path, val);
      }
    }

    const { data: workflow, error } = await supabase
      .from("workflows")
      .insert({
        organization_id: orgId,
        name: tpl.name,
        description: tpl.description,
        trigger_type: tpl.trigger_type,
        trigger_config: tpl.trigger_config,
        definition,
        is_active: true,
      })
      .select("id, name")
      .single();

    if (!error && workflow) {
      created.push({ id: workflow.id, name: workflow.name, type: tpl.type });
    }
  }

  return { workflows: created };
}
