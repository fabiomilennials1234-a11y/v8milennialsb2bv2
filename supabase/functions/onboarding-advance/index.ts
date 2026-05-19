// deno-lint-ignore-file no-explicit-any
import { createEdgeFunction } from "../_shared/edge-framework.ts";
import { withSentry } from "../_shared/sentry.ts";
import {
  getOrgIdFromJwt,
  verifyWhatsAppConnected,
  applyPipelineTemplates,
  applyAutomationTemplates,
} from "../_shared/onboarding-engine.ts";

const handler = createEdgeFunction({
  name: "onboarding-advance",
  auth: "jwt",
  methods: ["POST"],
  handler: async ({ req, supabase, body }) => {
    const { action, payload } = body as { action: string; payload?: any };
    if (!action) return { ok: false, error: "Missing action" };

    const identity = await getOrgIdFromJwt(req);
    if (!identity) return { ok: false, error: "Unauthorized: cannot resolve org" };

    const { orgId } = identity;

    switch (action) {
      case "advance_whatsapp": {
        const connected = await verifyWhatsAppConnected(supabase, orgId);
        if (!connected) return { ok: false, error: "WhatsApp not connected" };

        const { data, error } = await supabase.rpc("advance_onboarding_state", {
          p_org_id: orgId,
          p_expected_state: "pending_whatsapp",
        });
        if (error) return { ok: false, error: error.message };
        return { ok: true, ...data };
      }

      case "advance_profile": {
        const answers = payload?.answers;
        if (!answers || typeof answers !== "object") {
          return { ok: false, error: "Missing answers payload" };
        }

        const { data, error } = await supabase.rpc("advance_onboarding_state", {
          p_org_id: orgId,
          p_expected_state: "pending_profile",
          p_payload: answers,
        });
        if (error) return { ok: false, error: error.message };
        return { ok: true, ...data };
      }

      case "apply_pipelines": {
        const { data: matched, error: matchErr } = await supabase.rpc("match_onboarding_templates", {
          p_org_id: orgId,
          p_type: "pipeline",
        });
        if (matchErr) return { ok: false, error: matchErr.message };

        const templates = matched ?? [];
        const result = await applyPipelineTemplates(supabase, orgId, templates);

        const { data, error } = await supabase.rpc("advance_onboarding_state", {
          p_org_id: orgId,
          p_expected_state: "pending_pipelines",
        });
        if (error) return { ok: false, error: error.message };
        return { ok: true, ...data, pipelines: result.pipelines };
      }

      case "get_automation_templates": {
        const { data: matched, error: matchErr } = await supabase.rpc("match_onboarding_templates", {
          p_org_id: orgId,
          p_type: "automation",
        });
        if (matchErr) return { ok: false, error: matchErr.message };
        return { ok: true, templates: matched ?? [] };
      }

      case "activate_automations": {
        const selections = payload?.selections;
        if (!Array.isArray(selections) || selections.length === 0) {
          return { ok: false, error: "Missing selections payload" };
        }

        const result = await applyAutomationTemplates(supabase, orgId, selections);

        const { data, error } = await supabase.rpc("advance_onboarding_state", {
          p_org_id: orgId,
          p_expected_state: "pending_automations",
        });
        if (error) return { ok: false, error: error.message };
        return { ok: true, ...data, workflows: result.workflows };
      }

      default:
        return { ok: false, error: `Unknown action: ${action}` };
    }
  },
});

Deno.serve(withSentry("onboarding-advance", handler));
