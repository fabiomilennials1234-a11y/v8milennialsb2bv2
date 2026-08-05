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

export async function applyPipelineTemplates(
  supabase: SupabaseClient,
  orgId: string,
  templates: any[],
): Promise<{ pipelines: any[] }> {
  const created: any[] = [];

  for (const tpl of templates) {
    if (tpl.default_pipelines_config) {
      const { error } = await supabase
        .from("pipeline_display_config")
        .upsert({
          organization_id: orgId,
          config: tpl.default_pipelines_config,
        }, { onConflict: "organization_id" });

      if (!error) {
        created.push({ type: "default_config", name: tpl.name, config: tpl.default_pipelines_config });
      }
    }

    const customs = tpl.custom_pipelines ?? [];
    for (const cp of customs) {
      const { data: pipeline, error: pipeErr } = await supabase
        .from("custom_pipelines")
        .insert({
          organization_id: orgId,
          name: cp.name,
          icon: cp.icon ?? null,
          color: cp.color ?? null,
          is_active: true,
        })
        .select("id, name")
        .single();

      if (pipeErr || !pipeline) continue;

      const stages = (cp.stages ?? []).map((s: any, idx: number) => ({
        pipeline_id: pipeline.id,
        name: s.name,
        color: s.color ?? null,
        position: s.position ?? idx,
        is_final_positive: s.is_final_positive ?? false,
        is_final_negative: s.is_final_negative ?? false,
      }));

      if (stages.length > 0) {
        await supabase.from("custom_pipeline_stages").insert(stages);
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
