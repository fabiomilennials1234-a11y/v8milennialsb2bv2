/**
 * cognition-loop — Copilot v2 turn orchestration (Slice 2).
 *
 * The LLM does cognition only; everything it's bad at is externalized to the
 * harness. Each proposed tool call passes the cumulative gates BEFORE execution:
 *   1. tool-call budget (max 5/turn → stop, return to the lead)
 *   2. capability-gate (write off → blocked, server-side)
 *   3. write-after-introspect (orphan target → blocked) — write tools only
 * Blocked calls are fed back to the LLM as tool errors so it can recover; the
 * LLM is an injected dependency (LlmClient) so the loop is fully testable.
 */

import { decideCapabilityGate, decideToolCallBudget, isReadTool, TOOL_CALL_BUDGET } from "./capability-gate.ts";
import { assertWriteTarget, type Introspection } from "./introspect-guard.ts";

/** Property-order-independent serialization, for the tool-call dedup key. */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const obj = v as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export interface LlmToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** Per-call token usage the LlmClient may report (W10 cost accounting). */
export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface LlmResponse {
  text: string | null;
  toolCalls: LlmToolCall[];
  /** Token usage for this single completion, when the provider reports it. */
  usage?: LlmUsage;
}

export interface ToolSchema {
  name: string;
  [k: string]: unknown;
}

export interface Msg {
  role: "user" | "assistant" | "tool";
  content: string;
}

export interface LlmClient {
  complete(input: { system: string; messages: Msg[]; tools: ToolSchema[] }): Promise<LlmResponse>;
}

export interface RunTurnInput {
  llm: LlmClient;
  system: string;
  messages: Msg[];
  toolSchemas: ToolSchema[];
  capabilities: Record<string, boolean | undefined>;
  introspection: Introspection | null;
  executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  /** Extracts the structural target (stage_key/field_key) of a write tool. */
  writeTargetOf?: (name: string, args: Record<string, unknown>) => string | null;
  /**
   * Introspection a READ tool's result contributes THIS turn (e.g.
   * check_agenda_availability → its free slots), so a subsequent write to that
   * target passes the write-after-introspect guard. Only augments a non-null
   * introspection; absent → no augmentation (legacy behavior).
   */
  introspectionUpdateOf?: (name: string, result: unknown) => Partial<Introspection> | null;
  maxToolCalls?: number;
}

export interface ToolStep {
  name: string;
  allowed: boolean;
  reason: string | null;
  result?: unknown;
}

export interface RunTurnResult {
  reply: string | null;
  steps: ToolStep[];
  stoppedReason: "text_reply" | "budget_exceeded";
  /** Total token usage summed across every completion this turn (W10). Absent
   *  when no completion reported usage (keeps fake-LLM loop tests unchanged). */
  usage?: LlmUsage;
}

export async function runTurn(input: RunTurnInput): Promise<RunTurnResult> {
  const max = input.maxToolCalls ?? TOOL_CALL_BUDGET;
  const convo: Msg[] = [...input.messages];
  const steps: ToolStep[] = [];
  // Mutable introspection so an in-turn read (e.g. check_agenda_availability's
  // free slots) satisfies the write-after-introspect guard for a later write
  // THIS turn. stages/fields arrive pre-loaded; slots can ONLY be known after the
  // agenda read runs — without this propagation schedule_meeting stays fail-CLOSED.
  const live: Introspection | null = input.introspection
    ? {
        stages: [...(input.introspection.stages ?? [])],
        fields: [...(input.introspection.fields ?? [])],
        slots: [...(input.introspection.slots ?? [])],
      }
    : null;
  // Sum token usage across every complete() call this turn. `sawUsage` keeps the
  // field absent (not {0,0}) when the provider reports nothing, so existing loop
  // tests that toEqual the result are unaffected.
  let sumPrompt = 0;
  let sumCompletion = 0;
  let sawUsage = false;
  const accUsage = (u: LlmUsage | undefined) => {
    if (!u) return;
    sawUsage = true;
    sumPrompt += Number.isFinite(u.promptTokens) ? u.promptTokens : 0;
    sumCompletion += Number.isFinite(u.completionTokens) ? u.completionTokens : 0;
  };
  const withUsage = (r: RunTurnResult): RunTurnResult =>
    sawUsage ? { ...r, usage: { promptTokens: sumPrompt, completionTokens: sumCompletion } } : r;
  // Results of tool calls already executed this turn, keyed by name+args. A
  // repeated identical call reuses the cached result — never a second side
  // effect (W4: dedup de tool-call repetida; guards the send_media double-send).
  const executed = new Map<string, unknown>();
  let calls = 0;

  // Bounded by the budget; the while-true exits on a text reply or budget stop.
  // Belt-and-suspenders cap so a misbehaving fake/LLM can never spin forever.
  for (let guard = 0; guard < max + 2; guard++) {
    const resp = await input.llm.complete({ system: input.system, messages: convo, tools: input.toolSchemas });
    accUsage(resp.usage);

    if (!resp.toolCalls || resp.toolCalls.length === 0) {
      return withUsage({ reply: resp.text, steps, stoppedReason: "text_reply" });
    }

    for (const tc of resp.toolCalls) {
      if (!decideToolCallBudget({ callsThisTurn: calls, max }).allowed) {
        return withUsage({ reply: null, steps, stoppedReason: "budget_exceeded" });
      }

      const cap = decideCapabilityGate({ tool: tc.name, capabilities: input.capabilities });
      if (!cap.allowed) {
        steps.push({ name: tc.name, allowed: false, reason: cap.reason });
        convo.push({ role: "tool", content: `blocked:${cap.reason}` });
        calls++;
        continue;
      }

      if (!isReadTool(tc.name)) {
        const target = input.writeTargetOf?.(tc.name, tc.args) ?? null;
        const guardResult = assertWriteTarget({ tool: tc.name, target, introspected: live });
        if (!guardResult.ok) {
          steps.push({ name: tc.name, allowed: false, reason: guardResult.reason });
          convo.push({ role: "tool", content: `blocked:${guardResult.reason}` });
          calls++;
          continue;
        }
      }

      // Dedup an identical call already executed this turn — reuse the cached
      // result, no second side effect. Still counts against the budget so a
      // model that loops on the same call can't spin past the cap.
      const dedupKey = `${tc.name}:${stableStringify(tc.args)}`;
      if (executed.has(dedupKey)) {
        const cached = executed.get(dedupKey);
        steps.push({ name: tc.name, allowed: true, reason: "duplicate_tool_call", result: cached });
        convo.push({ role: "assistant", content: `tool:${tc.name}` });
        convo.push({ role: "tool", content: JSON.stringify(cached ?? null) });
        calls++;
        continue;
      }

      const result = await input.executeTool(tc.name, tc.args);
      executed.set(dedupKey, result);
      // Propagate what this read introspected (e.g. agenda slots) into the live
      // introspection so a later write THIS turn can validate against it.
      if (live && input.introspectionUpdateOf) {
        const upd = input.introspectionUpdateOf(tc.name, result);
        if (upd?.slots) for (const s of upd.slots) if (!live.slots.includes(s)) live.slots.push(s);
        if (upd?.stages) for (const s of upd.stages) if (!live.stages.includes(s)) live.stages.push(s);
        if (upd?.fields) for (const f of upd.fields) if (!live.fields.includes(f)) live.fields.push(f);
      }
      steps.push({ name: tc.name, allowed: true, reason: null, result });
      convo.push({ role: "assistant", content: `tool:${tc.name}` });
      convo.push({ role: "tool", content: JSON.stringify(result ?? null) });
      calls++;
    }
  }

  // Reached only if the LLM kept proposing tool calls up to the budget.
  return withUsage({ reply: null, steps, stoppedReason: "budget_exceeded" });
}
