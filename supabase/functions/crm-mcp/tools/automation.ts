/**
 * Recurring automation by AI (fatia 4 do v2) — "when a card stays N days in stage S, send X".
 *
 *   automation.list       — the org's automations (read);
 *   automation.get        — one automation: trigger, flow, and every message it sends (read);
 *   automation.draft      — builds the automation and saves it INACTIVE;
 *   automation.activate   — two-phase: {workflow_id} → plan; {confirm_token} → turns it on;
 *   automation.deactivate — turns it off (always allowed to the scope; audited).
 *
 * No new engine trigger: the automation is made of pieces the engine and the visual builder
 * already run and edit — "entered stage S" → "wait N days" → "still in S and N+ days there?"
 * → "send WhatsApp". It acts on cards that ENTER the stage from activation on; cards already
 * stalled are reached with the one-off broadcast (fatia 3). The spec goes through the same
 * parser, compiler and validator as the ops workflow tool (ADR-0013), and the row is written
 * under the user's own RLS, after a server-side workflows.create / workflows.edit check
 * (the app checks those in the browser only).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolContext, ToolDef, ToolResult } from "../../_shared/mcp/types.ts";
import {
  compileWorkflow,
  type DeclSpec,
  safeParseSpec,
  validateWorkflow,
} from "../../_shared/workflow-schema/index.ts";
import type { WorkflowDefinition } from "../../_shared/workflow-schema/definition.ts";
import { missingScopeHint } from "../lib/capabilities.ts";
import { actionErrorMessage, isUuid, PLAN, WRITE, writeContext } from "./actions.ts";
import { asMessage, flowOverview, sendSteps } from "./automation-steps.ts";
import { callerHasFeature } from "./rpc.ts";
import {
  dbErrorResult,
  errorResult,
  jsonResult,
  optionalUuid,
  READ_ONLY,
  resolveOrgScope,
} from "./shared.ts";

export const IDLE_DAYS_MAX = 90;
export const MESSAGE_MAX = 1000;

export interface IdleAutomationInput {
  name: string;
  pipelineId: string;
  stageId: string;
  stageName: string;
  idleDays: number;
  message: string;
}

/**
 * The declarative spec for "N days stalled in S → WhatsApp". Two nested conditions after the
 * wait: the card must still be in S (stage_id, the editor's exact-stage contract) AND have
 * N+ days there (days_in_stage reads stage_changed_at — leaving and coming back restarts it).
 */
export function idleAutomationSpec(i: IdleAutomationInput): DeclSpec {
  return {
    name: i.name,
    description:
      `Criada pela IA (crm-mcp): quando um card fica ${i.idleDays} dia(s) parado em "${i.stageName}", ` +
      "envia uma mensagem de WhatsApp.",
    trigger: { type: "stage_changed", config: { pipeline_id: i.pipelineId, to_stage: i.stageId } },
    steps: [
      { kind: "delay", amount: i.idleDays, unit: "days", label: `Esperar ${i.idleDays} dia(s)` },
      {
        kind: "condition",
        field: "stage_id",
        operator: "equals",
        value: i.stageId,
        label: `Ainda em "${i.stageName}"?`,
        then: [
          {
            kind: "condition",
            field: "days_in_stage",
            operator: "greater_or_equal",
            value: i.idleDays,
            label: `Parado há ${i.idleDays}+ dia(s)?`,
            then: [
              {
                kind: "action",
                actionType: "send_whatsapp",
                label: "Enviar WhatsApp",
                config: { messageTemplate: i.message },
              },
            ],
          },
        ],
      },
    ],
  };
}

/** Parse → compile → validate. Pure. */
export function buildIdleAutomation(i: IdleAutomationInput):
  | { ok: true; row: Record<string, unknown>; nodes: number }
  | { ok: false; message: string } {
  const parsed = safeParseSpec(idleAutomationSpec(i));
  if (!parsed.ok) return { ok: false, message: parsed.errors.join("; ") };
  const compiled = compileWorkflow(parsed.data);
  const v = validateWorkflow(compiled.definition);
  if (!v.ok) {
    return {
      ok: false,
      message: v.errors.filter((e) => e.severity === "error").map((e) => e.message).join("; "),
    };
  }
  return {
    ok: true,
    nodes: compiled.definition.nodes?.length ?? 0,
    row: {
      name: compiled.name,
      description: compiled.description,
      trigger_type: compiled.trigger_type,
      trigger_config: compiled.trigger_config,
      definition: compiled.definition,
      loop_limit: 100, // steps per execution (executor maxSteps), the app default
      is_active: false,
    },
  };
}

async function denyWithout(
  ctx: ToolContext,
  key: "workflows.create" | "workflows.edit",
): Promise<ToolResult | null> {
  return (await callerHasFeature(ctx, key)) ? null : errorResult(
    `Seu usuário não pode ${
      key === "workflows.create" ? "criar" : "editar"
    } automações no Torque (permissão ${key}).`,
  );
}

/** One-shot audited write (no separate plan step). */
async function audited(
  ctx: ToolContext,
  tool: string,
  summary: string,
  payload: unknown,
  run: () => Promise<{ ok: boolean; result: unknown }>,
): Promise<{ ok: boolean; result: unknown } | { error: string }> {
  const w = writeContext(ctx, "automations:write");
  if (!w.ok) return { error: "sem escopo" };
  try {
    const { actionId } = await w.store.open(tool, "automations:write", summary, payload);
    if (!(await w.store.take(actionId))) return { error: "Não foi possível registrar a ação." };
    const out = await run();
    await w.store.finish(actionId, out.ok ? "applied" : "failed", out.result);
    return out;
  } catch (e) {
    return { error: actionErrorMessage(e) };
  }
}

export const customerAutomationListTool: ToolDef = {
  name: "automation.list",
  description:
    "List your organization's automations: name, whether it is on, its trigger and when it was " +
    "created. automation.get reads one, including the messages it sends.",
  readonly: true,
  customerExposed: true,
  annotations: { ...READ_ONLY, title: "List automations" },
  inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const scope = resolveOrgScope(args, ctx.orgId);
    if (!scope.ok) return errorResult(scope.message);
    const { data, error } = await (ctx.db as SupabaseClient)
      .from("workflows")
      .select("id,name,is_active,trigger_type,created_at")
      .eq("organization_id", scope.orgId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return dbErrorResult(error);
    return jsonResult({ count: (data ?? []).length, automations: data ?? [] });
  },
};

interface StageRow {
  id: string;
  stage_key: string;
  name: string;
}

/**
 * The trigger in the person's words: funnel and stage names, plus — when it fires on stages
 * of a funnel — the audience filter that reaches the cards ALREADY there. Lookups are
 * best-effort (a missing funnel just stays unnamed); legacy triggers keep their raw refs.
 */
async function describeTrigger(
  db: SupabaseClient,
  orgId: string,
  type: string,
  config: unknown,
) {
  const cfg = (config ?? {}) as Record<string, unknown>;
  const pipelineId = [cfg.pipeline_id, cfg.filter_pipeline_id].find(isUuid) ?? null;
  const refs = [...(Array.isArray(cfg.stages) ? cfg.stages : []), cfg.to_stage]
    .filter((s): s is string => typeof s === "string" && !!s.trim());
  if (!pipelineId) {
    return { type, pipeline: null, stages: refs.map((ref) => ({ ref })), audience: null };
  }

  const [p, st] = await Promise.all([
    db.from("pipelines").select("id,name").eq("organization_id", orgId).eq("id", pipelineId)
      .maybeSingle(),
    db.from("pipeline_stages").select("id,stage_key,name").eq("organization_id", orgId)
      .eq("pipeline_id", pipelineId).eq("is_active", true).limit(200),
  ]);
  const rows = (st.data ?? []) as StageRow[];
  const stages = refs.map((ref) => rows.find((r) => r.id === ref || r.stage_key === ref) ?? null);
  const found = stages.filter((s): s is StageRow => s !== null);
  return {
    type,
    pipeline: { id: pipelineId, name: (p.data as { name?: string } | null)?.name ?? null },
    stages: stages.map((s, i) =>
      s ? { id: s.id, stage_key: s.stage_key, name: s.name } : { ref: refs[i] }
    ),
    audience: found.length && type === "stage_changed"
      ? { pipeline_id: pipelineId, stage_keys: found.map((s) => s.stage_key) }
      : null,
  };
}

export const customerAutomationGetTool: ToolDef = {
  name: "automation.get",
  description:
    "Read one automation (workflow_id from automation.list): its trigger (funnel and stage by " +
    "name), the flow in order, and every message it sends — text, image/document, variables — " +
    "each with a node_id and whether a broadcast can send it. To send one of these messages " +
    "to the cards ALREADY in a stage (the automation only acts on cards that enter it later), " +
    "use audience.preview and then broadcast.plan with from_automation {workflow_id, node_id}: " +
    "the server copies the text and media, so never retype them.",
  readonly: true,
  customerExposed: true,
  annotations: { ...READ_ONLY, title: "Read automation" },
  inputSchema: {
    type: "object",
    properties: { workflow_id: { type: "string" } },
    required: ["workflow_id"],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const scope = resolveOrgScope(args, ctx.orgId);
    if (!scope.ok) return errorResult(scope.message);
    if (!isUuid(args.workflow_id)) return errorResult("workflow_id must be a UUID.");
    const db = ctx.db as SupabaseClient;
    const { data, error } = await db
      .from("workflows")
      .select("id,name,description,is_active,trigger_type,trigger_config,definition,updated_at")
      .eq("organization_id", scope.orgId)
      .eq("id", args.workflow_id)
      .maybeSingle();
    if (error) return dbErrorResult(error);
    if (!data) return errorResult("Automação não encontrada.");
    const wf = data as {
      id: string;
      name: string;
      description: string | null;
      is_active: boolean;
      trigger_type: string;
      trigger_config: unknown;
      definition: WorkflowDefinition | null;
      updated_at: string | null;
    };
    const trigger = await describeTrigger(db, scope.orgId, wf.trigger_type, wf.trigger_config);
    const messages = sendSteps(wf.definition).map(asMessage);
    const canBroadcast = (ctx.scopes ?? []).includes("messages:send");
    return jsonResult({
      id: wf.id,
      name: wf.name,
      active: wf.is_active,
      description: wf.description,
      updated_at: wf.updated_at,
      open_in_torque: `/automacoes/${wf.id}`,
      trigger: { type: trigger.type, pipeline: trigger.pipeline, stages: trigger.stages },
      messages,
      flow: flowOverview(wf.definition),
      to_cards_already_in_stage: !canBroadcast
        ? missingScopeHint("messages:send")
        : trigger.audience
        ? {
          audience: trigger.audience,
          how:
            "audience.preview with this audience → broadcast.plan with the same audience and from_automation {workflow_id, node_id} → broadcast.test → the person's OK → broadcast.confirm. One message per broadcast; the full sequence (waits, conditions) only runs for cards that enter the stage.",
        }
        : "Esta automação não dispara pela entrada numa etapa de funil; escolha o funil e a etapa (pipeline.list / stage.list) para montar a audiência.",
    });
  },
};

export const customerAutomationDraftTool: ToolDef = {
  name: "automation.draft",
  description:
    "Create an automation: when a card stays idle_days days in a stage of a funnel, send a " +
    "WhatsApp message (variables {{primeiro_nome}}, {{nome}}, {{empresa}}). It is saved TURNED " +
    "OFF and shows up in Torque's Automations, where it can be reviewed and edited. It acts on " +
    "cards that enter the stage after it is turned on — for cards already stalled, use the " +
    "one-off broadcast (broadcast.plan). Turn it on with automation.activate.",
  readonly: false,
  customerExposed: true,
  requiredScope: "automations:write",
  annotations: { ...PLAN, title: "Draft automation" },
  inputSchema: {
    type: "object",
    properties: {
      pipeline_id: { type: "string" },
      stage_key: { type: "string" },
      idle_days: { type: "integer", minimum: 1, maximum: IDLE_DAYS_MAX },
      message: { type: "string", maxLength: MESSAGE_MAX },
      name: { type: "string", maxLength: 120 },
    },
    required: ["pipeline_id", "stage_key", "idle_days", "message"],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const scope = resolveOrgScope(args, ctx.orgId);
    if (!scope.ok) return errorResult(scope.message);
    const w = writeContext(ctx, "automations:write");
    if (!w.ok) return w.result;
    const pipelineId = optionalUuid(args.pipeline_id);
    if (!pipelineId || pipelineId === "invalid") return errorResult("pipeline_id must be a UUID.");
    const stageKey = typeof args.stage_key === "string" ? args.stage_key.trim() : "";
    const idleDays = Number(args.idle_days);
    if (!stageKey) return errorResult("stage_key is required.");
    if (!Number.isInteger(idleDays) || idleDays < 1 || idleDays > IDLE_DAYS_MAX) {
      return errorResult(`idle_days must be an integer between 1 and ${IDLE_DAYS_MAX}.`);
    }
    const message = typeof args.message === "string" ? args.message.trim() : "";
    if (!message || message.length > MESSAGE_MAX) {
      return errorResult(`message: 1–${MESSAGE_MAX} characters.`);
    }
    const denied = await denyWithout(ctx, "workflows.create");
    if (denied) return denied;

    const db = ctx.db as SupabaseClient;
    const { data: stage, error: sErr } = await db
      .from("pipeline_stages")
      .select("id,name")
      .eq("organization_id", scope.orgId)
      .eq("pipeline_id", pipelineId)
      .eq("stage_key", stageKey)
      .eq("is_active", true)
      .maybeSingle();
    if (sErr) return dbErrorResult(sErr);
    if (!stage) {
      return errorResult(`A etapa "${stageKey}" não existe neste funil (ou você não a vê).`);
    }
    const st = stage as { id: string; name: string };

    const name = typeof args.name === "string" && args.name.trim()
      ? args.name.trim().slice(0, 120)
      : `Parado ${idleDays}d em ${st.name} → WhatsApp`;
    const built = buildIdleAutomation({
      name,
      pipelineId,
      stageId: st.id,
      stageName: st.name,
      idleDays,
      message,
    });
    if (!built.ok) return errorResult(`Automação inválida: ${built.message}`);

    const out = await audited(ctx, "automation.draft", `Criar automação "${name}" (desligada)`, {
      pipeline_id: pipelineId,
      stage_id: st.id,
      idle_days: idleDays,
    }, async () => {
      const ins = await db
        .from("workflows")
        .insert({ ...built.row, organization_id: scope.orgId, created_by: ctx.userId })
        .select("id")
        .single();
      return ins.error || !ins.data
        ? { ok: false, result: { error: ins.error?.message ?? "insert failed" } }
        : { ok: true, result: { workflow_id: (ins.data as { id: string }).id } };
    });
    if ("error" in out) return errorResult(out.error);
    if (!out.ok) {
      return errorResult(
        `Não foi possível salvar a automação: ${(out.result as { error: string }).error}`,
      );
    }
    const id = (out.result as { workflow_id: string }).workflow_id;
    return jsonResult({
      workflow_id: id,
      name,
      active: false,
      open_in_torque: `/automacoes/${id}`,
      steps: [
        `Quando um card entra em "${st.name}"`,
        `espera ${idleDays} dia(s)`,
        `se ainda estiver em "${st.name}" há ${idleDays}+ dia(s)`,
        "envia a mensagem pelo WhatsApp",
      ],
      next:
        "Revise no Torque se quiser. Para ligar, chame automation.activate com workflow_id e confirme com a pessoa.",
    });
  },
};

export const customerAutomationActivateTool: ToolDef = {
  name: "automation.activate",
  description:
    "Turn an automation on, in two steps: call with workflow_id to get a confirm_token and a " +
    "summary of what it will do; show it to the person; then call with confirm_token to turn " +
    "it on. From then on it acts by itself on every card that matches.",
  readonly: false,
  customerExposed: true,
  requiredScope: "automations:write",
  annotations: { ...WRITE, title: "Turn automation on" },
  inputSchema: {
    type: "object",
    properties: { workflow_id: { type: "string" }, confirm_token: { type: "string" } },
    required: [],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const scope = resolveOrgScope(args, ctx.orgId);
    if (!scope.ok) return errorResult(scope.message);
    const w = writeContext(ctx, "automations:write");
    if (!w.ok) return w.result;
    const denied = await denyWithout(ctx, "workflows.edit");
    if (denied) return denied;
    const db = ctx.db as SupabaseClient;

    if (isUuid(args.confirm_token)) {
      const taken = await w.store.take(args.confirm_token);
      if (!taken || taken.tool !== "automation.activate") {
        return errorResult(
          "Confirmação inexistente, vencida (5 min) ou já usada. Peça de novo com workflow_id.",
        );
      }
      const wid = (taken.plan as { workflow_id: string }).workflow_id;
      const up = await db.from("workflows").update({ is_active: true }).eq(
        "organization_id",
        scope.orgId,
      ).eq("id", wid).select("id");
      const ok = !up.error && (up.data ?? []).length === 1;
      await w.store.finish(args.confirm_token, ok ? "applied" : "failed", {
        workflow_id: wid,
        error: up.error?.message ?? null,
      });
      return ok
        ? jsonResult({ active: true, workflow_id: wid })
        : errorResult("Não foi possível ligar a automação (sem permissão ou ela não existe mais).");
    }

    if (!isUuid(args.workflow_id)) {
      return errorResult("Informe workflow_id (para planejar) ou confirm_token (para ligar).");
    }
    const { data: wf, error } = await db
      .from("workflows")
      .select("id,name,description,is_active,trigger_type")
      .eq("organization_id", scope.orgId)
      .eq("id", args.workflow_id)
      .maybeSingle();
    if (error) return dbErrorResult(error);
    if (!wf) return errorResult("Automação não encontrada.");
    const row = wf as { id: string; name: string; description: string | null; is_active: boolean };
    if (row.is_active) {
      return jsonResult({ active: true, workflow_id: row.id, note: "Já está ligada." });
    }
    try {
      const { actionId, expiresAt } = await w.store.open(
        "automation.activate",
        "automations:write",
        `Ligar automação "${row.name}"`,
        {
          workflow_id: row.id,
        },
      );
      return jsonResult({
        confirm_token: actionId,
        expires_at: expiresAt,
        automation: { id: row.id, name: row.name, what_it_does: row.description },
        next:
          "Mostre à pessoa. Com o OK dela, chame automation.activate com confirm_token (vale 5 min).",
      });
    } catch (e) {
      return errorResult(actionErrorMessage(e));
    }
  },
};

export const customerAutomationDeactivateTool: ToolDef = {
  name: "automation.deactivate",
  description:
    "Turn an automation off. Messages already scheduled by it may still be pending in the engine.",
  readonly: false,
  customerExposed: true,
  requiredScope: "automations:write",
  annotations: { ...WRITE, destructiveHint: false, title: "Turn automation off" },
  inputSchema: {
    type: "object",
    properties: { workflow_id: { type: "string" } },
    required: ["workflow_id"],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const scope = resolveOrgScope(args, ctx.orgId);
    if (!scope.ok) return errorResult(scope.message);
    const w = writeContext(ctx, "automations:write");
    if (!w.ok) return w.result;
    if (!isUuid(args.workflow_id)) return errorResult("workflow_id must be a UUID.");
    const denied = await denyWithout(ctx, "workflows.edit");
    if (denied) return denied;
    const db = ctx.db as SupabaseClient;
    const out = await audited(ctx, "automation.deactivate", "Desligar automação", {
      workflow_id: args.workflow_id,
    }, async () => {
      const up = await db.from("workflows").update({ is_active: false }).eq(
        "organization_id",
        scope.orgId,
      ).eq("id", args.workflow_id).select("id");
      return {
        ok: !up.error && (up.data ?? []).length === 1,
        result: { workflow_id: args.workflow_id },
      };
    });
    if ("error" in out) return errorResult(out.error);
    return out.ok
      ? jsonResult({ active: false, workflow_id: args.workflow_id })
      : errorResult("Automação não encontrada ou sem permissão.");
  },
};
