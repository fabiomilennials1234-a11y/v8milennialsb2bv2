import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolContext, ToolDef, ToolResult } from "../lib/types.ts";
import { runMutation } from "../lib/guardrails.ts";
import { auditMcpAction } from "../lib/audit.ts";

export function buildCronPlan(jobname: string, enabled: boolean) {
  return { action: "toggle_cron_job", jobname, enabled };
}

export const cronToggleTool: ToolDef = {
  name: "cron.toggle",
  description:
    "Enable/disable a pg_cron job by name (active flag only — never deletes/reschedules). " +
    "Privileged (service_role). Dry-run shows the plan; confirm_token to apply.",
  readonly: false,
  requiresServiceRole: true,
  inputSchema: {
    type: "object",
    properties: {
      job_name: { type: "string", description: "cron.job jobname" },
      enabled: { type: "boolean", description: "true=enable, false=disable" },
      confirm_token: { type: "string" },
    },
    required: ["job_name", "enabled"],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const svc = ctx.serviceDb as SupabaseClient | undefined;
    if (!svc) return { content: [{ type: "text", text: "service client unavailable" }], isError: true };
    const db = ctx.db as SupabaseClient;
    const jobname = String(args.job_name);
    const enabled = Boolean(args.enabled);

    const res = await runMutation({
      plan: () => buildCronPlan(jobname, enabled),
      audit: (_i, plan, token) =>
        auditMcpAction(db, { tool: "cron.toggle", org_id: "", target_type: "cron_job", target_id: null, params: args, plan, confirm_token: token }),
      apply: async () => {
        const { data, error } = await svc.rpc("toggle_cron_job", { p_jobname: jobname, p_enabled: enabled });
        if (error) throw new Error(error.message);
        return data;
      },
    }, { confirm_token: typeof args.confirm_token === "string" ? args.confirm_token : undefined });

    return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
  },
};
