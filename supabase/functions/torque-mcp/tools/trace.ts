import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolContext, ToolDef, ToolResult } from "../lib/types.ts";

export interface TimelineEvent {
  source: string;
  at: string;
  kind: string;
  detail: unknown;
}

/** Flatten timeline sources into one list, newest-first, dropping undated events. */
export function mergeTimeline(groups: TimelineEvent[][]): TimelineEvent[] {
  return groups
    .flat()
    .filter((e) => !!e.at)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

type Row = Record<string, unknown>;
const s = (v: unknown): string => (v == null ? "" : String(v));

export const leadTraceHistoryTool: ToolDef = {
  name: "lead.trace_history",
  description: "Reconstruct a lead's chronological timeline (lead_history + audit_log + pipeline " +
    "transitions + deletion log), RLS-scoped as master. For diagnosing 'lead vanished' cases.",
  readonly: true,
  inputSchema: {
    type: "object",
    properties: {
      org_id: { type: "string", description: "Organization UUID" },
      lead_id: { type: "string", description: "Lead UUID" },
    },
    required: ["org_id", "lead_id"],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const db = ctx.db as SupabaseClient;
    const org = String(args.org_id);
    const leadId = String(args.lead_id);

    const [hist, del, pipes, audit] = await Promise.all([
      db.from("lead_history").select("created_at,action,source,entity_type,metadata")
        .eq("organization_id", org).eq("lead_id", leadId),
      db.from("deleted_leads_log").select("*")
        .eq("organization_id", org).eq("lead_id", leadId),
      db.from("pipeline_entries").select("stage_key,entered_at,stage_changed_at,pipeline_id")
        .eq("organization_id", org).eq("lead_id", leadId),
      db.from("audit_log").select("occurred_at,operation,table_name")
        .eq("organization_id", org).eq("row_id", leadId),
    ]);

    const err = hist.error || del.error || pipes.error || audit.error;
    if (err) return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };

    const events = mergeTimeline([
      (hist.data ?? []).map((r: Row) => ({
        source: "lead_history",
        at: s(r.created_at),
        kind: s(r.action),
        detail: r,
      })),
      (del.data ?? []).map((r: Row) => ({
        source: "deleted_leads_log",
        at: s(r.deleted_at),
        kind: "lead_deleted",
        detail: r,
      })),
      (pipes.data ?? []).map((r: Row) => ({
        source: "pipeline_entries",
        at: s(r.stage_changed_at) || s(r.entered_at),
        kind: `stage:${s(r.stage_key)}`,
        detail: r,
      })),
      (audit.data ?? []).map((r: Row) => ({
        source: "audit_log",
        at: s(r.occurred_at),
        kind: s(r.operation),
        detail: r,
      })),
    ]);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({ lead_id: leadId, count: events.length, events }, null, 2),
      }],
    };
  },
};
