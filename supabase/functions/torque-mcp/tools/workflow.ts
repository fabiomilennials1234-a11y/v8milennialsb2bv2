/**
 * workflow.* — build / edit / inspect Torque automations from a declarative spec (ADR 0013).
 *
 * The shared engine (_shared/workflow-schema) parses the spec, compiles the DAG
 * deterministically, and validates graph integrity. The tool wraps create/edit in runMutation
 * (dry-run → confirm → audit-first) and writes via the master JWT under the master_all_workflows
 * RLS policy — no SECURITY DEFINER RPC (anti-bypass), no service_role. Safety: invalid DAGs are
 * never written (no confirm_token minted), and a workflow only goes live through an explicit,
 * confirmed action — created/edited inactive by default.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolDef, ToolResult } from "../../_shared/mcp/types.ts";
import { runMutation } from "../../_shared/mcp/guardrails.ts";
import { auditMcpAction } from "../lib/audit.ts";
import {
  compileWorkflow,
  safeParseSpec,
  validateWorkflow,
  type ValidationResult,
  type WorkflowDefinition,
} from "../../_shared/workflow-schema/index.ts";

// ── pure helpers (unit-tested without DB) ─────────────────────────────────────────────

export type BuildMode =
  | { mode: "create"; orgId: string }
  | { mode: "edit"; workflowId: string }
  | { mode: "error"; reason: string };

/** create needs org_id, edit needs workflow_id, both → error (no cross-org move via edit). */
export function resolveBuildMode(args: Record<string, unknown>): BuildMode {
  const org = typeof args.org_id === "string" ? args.org_id.trim() : "";
  const wf = typeof args.workflow_id === "string" ? args.workflow_id.trim() : "";
  if (org && wf) {
    return { mode: "error", reason: "Pass org_id (create) OR workflow_id (edit), not both." };
  }
  if (wf) return { mode: "edit", workflowId: wf };
  if (org) return { mode: "create", orgId: org };
  return { mode: "error", reason: "Pass org_id to create a workflow, or workflow_id to edit one." };
}

export function clampLoopLimit(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 100;
  return Math.min(Math.floor(n), 500); // executor hard cap
}

/** create + undefined → false (inactive); edit + undefined → preserve current; explicit wins. */
export function decideActive(
  opts: { branch: "create" | "edit"; activate: boolean | undefined; current?: boolean },
): boolean {
  if (typeof opts.activate === "boolean") return opts.activate;
  return opts.branch === "edit" ? opts.current ?? false : false;
}

export interface DefinitionSummary {
  node_count: number;
  nodes_by_type: Record<string, number>;
  edge_count: number;
  trigger: { trigger_type: string; config_keys: string[] } | null;
}

export function summarizeDefinition(def: WorkflowDefinition): DefinitionSummary {
  const byType: Record<string, number> = {};
  for (const n of def.nodes) byType[n.type] = (byType[n.type] ?? 0) + 1;
  const trig = def.nodes.find((n) => n.type === "trigger");
  const d = (trig?.data ?? {}) as { triggerType?: unknown; config?: Record<string, unknown> };
  return {
    node_count: def.nodes.length,
    nodes_by_type: byType,
    edge_count: def.edges.length,
    trigger: trig
      ? { trigger_type: String(d.triggerType ?? ""), config_keys: Object.keys(d.config ?? {}) }
      : null,
  };
}

export function extractTriggerFromDefinition(
  def: WorkflowDefinition,
): { trigger_type: string; trigger_config: Record<string, unknown> } | null {
  const trig = def.nodes.find((n) => n.type === "trigger");
  if (!trig) return null;
  const d = trig.data as { triggerType?: unknown; config?: unknown };
  return {
    trigger_type: String(d.triggerType ?? ""),
    trigger_config: (d.config ?? {}) as Record<string, unknown>,
  };
}

export interface WorkflowDiff {
  nodes: { old: number; new: number };
  edges: { old: number; new: number };
  trigger: { old: string | null; new: string | null; changed: boolean };
  name: { old: string; new: string; changed: boolean };
  is_active: { old: boolean; new: boolean; changed: boolean };
}

export function buildDiff(
  oldRow: { name: string; is_active: boolean; definition: WorkflowDefinition },
  next: { name: string; is_active: boolean; summary: DefinitionSummary; trigger_type: string },
): WorkflowDiff {
  const oldSummary = summarizeDefinition(oldRow.definition);
  const oldTrig = oldSummary.trigger?.trigger_type ?? null;
  return {
    nodes: { old: oldSummary.node_count, new: next.summary.node_count },
    edges: { old: oldSummary.edge_count, new: next.summary.edge_count },
    trigger: { old: oldTrig, new: next.trigger_type, changed: oldTrig !== next.trigger_type },
    name: { old: oldRow.name, new: next.name, changed: oldRow.name !== next.name },
    is_active: {
      old: oldRow.is_active,
      new: next.is_active,
      changed: oldRow.is_active !== next.is_active,
    },
  };
}

interface BuiltRow {
  name: string;
  description: string | null;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  definition: WorkflowDefinition;
  loop_limit: number;
  is_active: boolean;
}

export interface CreatePlan {
  action: "create_workflow";
  organization_id: string;
  org_name: string;
  name: string;
  summary: DefinitionSummary;
  validation: ValidationResult;
  is_active: boolean;
  insert: BuiltRow & { organization_id: string };
}

export function buildCreatePlan(input: {
  orgId: string;
  orgName: string;
  row: BuiltRow;
  summary: DefinitionSummary;
  validation: ValidationResult;
}): CreatePlan {
  return {
    action: "create_workflow",
    organization_id: input.orgId,
    org_name: input.orgName,
    name: input.row.name,
    summary: input.summary,
    validation: input.validation,
    is_active: input.row.is_active,
    insert: { ...input.row, organization_id: input.orgId },
  };
}

export interface EditPlan {
  action: "edit_workflow";
  workflow_id: string;
  organization_id: string;
  name: string;
  summary: DefinitionSummary;
  validation: ValidationResult;
  diff: WorkflowDiff;
  is_active: boolean;
  was_active: boolean;
  update: BuiltRow;
}

export function buildEditPlan(input: {
  current: {
    id: string;
    organization_id: string;
    name: string;
    is_active: boolean;
    definition: WorkflowDefinition;
  };
  row: BuiltRow;
  summary: DefinitionSummary;
  validation: ValidationResult;
}): EditPlan {
  return {
    action: "edit_workflow",
    workflow_id: input.current.id,
    organization_id: input.current.organization_id,
    name: input.row.name,
    summary: input.summary,
    validation: input.validation,
    diff: buildDiff(input.current, {
      name: input.row.name,
      is_active: input.row.is_active,
      summary: input.summary,
      trigger_type: input.row.trigger_type,
    }),
    is_active: input.row.is_active,
    was_active: input.current.is_active,
    update: input.row,
  };
}

export interface SetActivePlan {
  action: "set_active";
  workflow_id: string;
  organization_id: string;
  name: string;
  from: boolean;
  to: boolean;
  no_op: boolean;
}

export function buildSetActivePlan(
  cur: { id: string; organization_id: string; name: string; is_active: boolean },
  active: boolean,
): SetActivePlan {
  return {
    action: "set_active",
    workflow_id: cur.id,
    organization_id: cur.organization_id,
    name: cur.name,
    from: cur.is_active,
    to: active,
    no_op: cur.is_active === active,
  };
}

const WORKFLOW_COLS =
  "id,organization_id,name,description,is_active,trigger_type,trigger_config,definition,loop_limit,created_at,updated_at";

/** Compile + validate a spec into a writable row. Throws (no token minted) on invalid input. */
function buildRowFromSpec(spec: unknown, isActive: boolean): {
  row: BuiltRow;
  summary: DefinitionSummary;
  validation: ValidationResult;
} {
  const parsed = safeParseSpec(spec);
  if (!parsed.ok) throw new Error(`Spec inválida — nada gravado: ${parsed.errors.join("; ")}`);
  const compiled = compileWorkflow(parsed.data);
  const validation = validateWorkflow(compiled.definition);
  if (!validation.ok) {
    const errs = validation.errors.filter((e) => e.severity === "error").map((e) => e.message);
    throw new Error(`Workflow inválido — nada gravado: ${errs.join("; ")}`);
  }
  return {
    row: {
      name: compiled.name,
      description: compiled.description,
      trigger_type: compiled.trigger_type,
      trigger_config: compiled.trigger_config,
      definition: compiled.definition,
      loop_limit: clampLoopLimit(compiled.loop_limit),
      is_active: isActive,
    },
    summary: summarizeDefinition(compiled.definition),
    validation,
  };
}

const text = (v: unknown): ToolResult => ({
  content: [{ type: "text", text: JSON.stringify(v, null, 2) }],
});
const errResult = (msg: string): ToolResult => ({
  content: [{ type: "text", text: msg }],
  isError: true,
});

// ── tools ─────────────────────────────────────────────────────────────────────────────

export const workflowGetTool: ToolDef = {
  name: "workflow.get",
  description: "Read one workflow (incl. its definition DAG) plus a summary. Use before editing.",
  readonly: true,
  inputSchema: {
    type: "object",
    properties: { workflow_id: { type: "string", description: "Workflow UUID" } },
    required: ["workflow_id"],
    additionalProperties: false,
  },
  handler: async (args, ctx): Promise<ToolResult> => {
    const db = ctx.db as SupabaseClient;
    const { data, error } = await db.from("workflows").select(WORKFLOW_COLS).eq(
      "id",
      String(args.workflow_id),
    )
      .maybeSingle();
    if (error) return errResult(`Error: ${error.message}`);
    if (!data) return errResult("No workflow found.");
    return text({ ...data, summary: summarizeDefinition(data.definition as WorkflowDefinition) });
  },
};

export const workflowValidateTool: ToolDef = {
  name: "workflow.validate",
  description:
    "Compile + validate a declarative workflow spec WITHOUT writing. Cheap feedback loop.",
  readonly: true,
  inputSchema: {
    type: "object",
    properties: {
      spec: { type: "object", description: "Declarative workflow spec (name, trigger, steps)" },
    },
    required: ["spec"],
    additionalProperties: false,
  },
  handler: (args): ToolResult => {
    const parsed = safeParseSpec(args.spec);
    if (!parsed.ok) {
      return text({ compiled: null, validation: { ok: false, errors: parsed.errors } });
    }
    const compiled = compileWorkflow(parsed.data);
    return text({
      compiled: summarizeDefinition(compiled.definition),
      validation: validateWorkflow(compiled.definition),
    });
  },
};

export const workflowBuildTool: ToolDef = {
  name: "workflow.build",
  description:
    "Create OR edit a workflow automation from a declarative spec. Pass org_id to create, " +
    "workflow_id to edit. Compiles + validates the DAG; dry-run returns a summary + diff + a " +
    "confirm_token — re-call with confirm_token to apply. Created/edited INACTIVE unless activate=true.",
  readonly: false,
  inputSchema: {
    type: "object",
    properties: {
      spec: {
        type: "object",
        description: "Declarative workflow spec (name, description?, loop_limit?, trigger, steps)",
      },
      org_id: {
        type: "string",
        description: "Target organization UUID. REQUIRED to create; omit to edit.",
      },
      workflow_id: {
        type: "string",
        description: "Existing workflow UUID. Presence = edit; omit = create.",
      },
      activate: {
        type: "boolean",
        description: "Go live. Default false (inactive). On edit, omit to preserve current.",
      },
      confirm_token: { type: "string", description: "Echo the dry-run confirmToken to apply." },
    },
    required: ["spec"],
    additionalProperties: false,
  },
  handler: async (args, ctx): Promise<ToolResult> => {
    if (typeof args.spec !== "object" || args.spec === null) {
      return errResult("spec must be an object.");
    }
    const mode = resolveBuildMode(args);
    if (mode.mode === "error") return errResult(mode.reason);
    const db = ctx.db as SupabaseClient;
    const activate = typeof args.activate === "boolean" ? args.activate : undefined;

    const res = await runMutation({
      plan: async () => {
        if (mode.mode === "edit") {
          const { data: cur, error } = await db.from("workflows").select(WORKFLOW_COLS).eq(
            "id",
            mode.workflowId,
          )
            .maybeSingle();
          if (error) throw new Error(error.message);
          if (!cur) throw new Error("workflow not found");
          const isActive = decideActive({ branch: "edit", activate, current: cur.is_active });
          const { row, summary, validation } = buildRowFromSpec(args.spec, isActive);
          return buildEditPlan({
            current: {
              id: cur.id,
              organization_id: cur.organization_id,
              name: cur.name,
              is_active: cur.is_active,
              definition: cur.definition as WorkflowDefinition,
            },
            row,
            summary,
            validation,
          });
        }
        // create
        const { data: org, error } = await db.from("organizations").select("id,name").eq(
          "id",
          mode.orgId,
        )
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!org) throw new Error("organization not found");
        const isActive = decideActive({ branch: "create", activate });
        const { row, summary, validation } = buildRowFromSpec(args.spec, isActive);
        return buildCreatePlan({
          orgId: mode.orgId,
          orgName: org.name as string,
          row,
          summary,
          validation,
        });
      },
      audit: (_i, plan, token) =>
        auditMcpAction(db, {
          tool: "workflow.build",
          org_id: String((plan as { organization_id?: unknown }).organization_id ?? ""),
          target_type: "workflow",
          target_id: (plan as { workflow_id?: string }).workflow_id ?? null,
          params: args,
          plan,
          confirm_token: token,
        }),
      apply: async (_i, plan) => {
        const p = plan as CreatePlan | EditPlan;
        if (p.action === "create_workflow") {
          const { data, error } = await db.from("workflows").insert(p.insert).select("id").single();
          if (error) throw new Error(error.message);
          return { created: data.id, is_active: p.is_active };
        }
        const { error } = await db.from("workflows").update(p.update).eq("id", p.workflow_id);
        if (error) throw new Error(error.message);
        return { updated: p.workflow_id, is_active: p.is_active };
      },
    }, { confirm_token: typeof args.confirm_token === "string" ? args.confirm_token : undefined });

    return text(res);
  },
};

export const workflowSetActiveTool: ToolDef = {
  name: "workflow.set_active",
  description:
    "Activate (go live) or pause a workflow without touching its definition. Dry-run → confirm.",
  readonly: false,
  inputSchema: {
    type: "object",
    properties: {
      workflow_id: { type: "string", description: "Workflow UUID" },
      active: { type: "boolean", description: "true = go live; false = pause" },
      confirm_token: { type: "string", description: "Echo the dry-run confirmToken to apply." },
    },
    required: ["workflow_id", "active"],
    additionalProperties: false,
  },
  handler: async (args, ctx): Promise<ToolResult> => {
    const db = ctx.db as SupabaseClient;
    const workflowId = String(args.workflow_id);
    const active = args.active === true;

    const res = await runMutation({
      plan: async () => {
        const { data: cur, error } = await db.from("workflows").select(
          "id,organization_id,name,is_active",
        )
          .eq("id", workflowId).maybeSingle();
        if (error) throw new Error(error.message);
        if (!cur) throw new Error("workflow not found");
        return buildSetActivePlan(cur, active);
      },
      audit: (_i, plan, token) =>
        auditMcpAction(db, {
          tool: "workflow.set_active",
          org_id: String((plan as { organization_id?: unknown }).organization_id ?? ""),
          target_type: "workflow",
          target_id: workflowId,
          params: args,
          plan,
          confirm_token: token,
        }),
      apply: async () => {
        const { error } = await db.from("workflows").update({ is_active: active }).eq(
          "id",
          workflowId,
        );
        if (error) throw new Error(error.message);
        return { workflow_id: workflowId, is_active: active };
      },
    }, { confirm_token: typeof args.confirm_token === "string" ? args.confirm_token : undefined });

    return text(res);
  },
};
