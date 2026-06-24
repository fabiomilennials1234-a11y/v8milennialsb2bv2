import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolContext, ToolDef, ToolResult } from "../../_shared/mcp/types.ts";

export type BlastSelector = { by: "id"; value: string } | { by: "recent" };

export function blastSelector(args: Record<string, unknown>): BlastSelector {
  const id = typeof args.job_id === "string" ? args.job_id.trim() : "";
  return id ? { by: "id", value: id } : { by: "recent" };
}

/** The known failure mode: a job parked in `queued` with no Uazapi sender id. */
export function flagStuck(job: { status?: unknown; uazapi_sender_id?: unknown }): boolean {
  return job.status === "queued" && (job.uazapi_sender_id == null || job.uazapi_sender_id === "");
}

const COLS =
  "id,status,sent,failed,total_messages,uazapi_sender_id,triggered_via,created_at,updated_at";

export const blastStatusTool: ToolDef = {
  name: "blast.status",
  description:
    "Status of mass-send / quick-blast jobs (uazapi_sender_jobs), RLS-scoped as master. " +
    "Flags jobs stuck in 'queued' with a null sender id (the queued-forever bug). " +
    "Provide org_id and optionally job_id.",
  readonly: true,
  inputSchema: {
    type: "object",
    properties: {
      org_id: { type: "string", description: "Organization UUID" },
      job_id: { type: "string", description: "Specific uazapi_sender_jobs id (optional)" },
    },
    required: ["org_id"],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const db = ctx.db as SupabaseClient;
    const org = String(args.org_id);
    const sel = blastSelector(args);

    if (sel.by === "id") {
      const { data, error } = await db.from("uazapi_sender_jobs").select(COLS)
        .eq("organization_id", org).eq("id", sel.value).maybeSingle();
      if (error) {
        return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
      }
      if (!data) return { content: [{ type: "text", text: "No blast job found." }] };
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ ...data, is_stuck: flagStuck(data) }, null, 2),
        }],
      };
    }

    const { data, error } = await db.from("uazapi_sender_jobs").select(COLS)
      .eq("organization_id", org).order("created_at", { ascending: false }).limit(50);
    if (error) {
      return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    }
    const jobs = (data ?? []).map((j) => ({ ...j, is_stuck: flagStuck(j) }));
    return {
      content: [{ type: "text", text: JSON.stringify({ count: jobs.length, jobs }, null, 2) }],
    };
  },
};
