# Torque MCP — S2 Mutating Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add audited, dry-run/confirm-gated recovery mutations to the Torque MCP edge function — `lead.restore`, `copilot.update_prompt`, `cron.toggle` — hidden behind `ALLOW_MUTATIONS`.

**Architecture:** Reuse the S1 spine (`dispatch`/`http`/`auth`/`registry`/`redact`). Extend `runMutation` with echo-token confirm (sha256 of the canonical plan). Add an `auditMcpAction` helper writing to `master_audit_logs` (audit-before-apply: a failed audit aborts the mutation). Each tool reuses tested logic where it exists (RPC `restore_lead`; new SECURITY DEFINER RPC `toggle_cron_job`) and does a direct master-JWT write only where none exists (`copilot.update_prompt`, needing one new master-UPDATE policy). Mutations stay hidden until `ALLOW_MUTATIONS=true`.

**Tech Stack:** Deno + `@modelcontextprotocol`-style hand-rolled JSON-RPC, `@supabase/supabase-js`, Postgres RLS + pg_cron, Web Crypto (sha256). Tests: `deno test` (unit, local) + manual integration via MCP handshake on dev/prod.

**Spec:** `docs/superpowers/specs/2026-06-22-torque-mcp-s2-mutating-design.md` · **ADR:** `docs/adr/0011-torque-mcp-internal-ops-server.md`

**Deferred (own plan):** `blast.requeue` — recon surfaced real complexity (runUazapiSenderJob always INSERTs a ghost row; `payload` stores only `recipients_count` not the recipient list; re-dispatch needs the Uazapi API path which expects service-role admin). Needs its own spec on recipient reconstruction + a `mcp_requeue_sender_job` RPC. Not in this plan.

---

## File Structure

- `supabase/functions/torque-mcp/lib/guardrails.ts` — **modify**: `ConfirmableInput.confirm` (boolean) → `confirm_token` (string); `runMutation` computes/verifies echo-token; `MutationSpec.audit` runs **before** apply.
- `supabase/functions/torque-mcp/lib/crypto.ts` — **create**: `stableStringify` + `sha256hex`.
- `supabase/functions/torque-mcp/lib/audit.ts` — **modify**: add `auditMcpAction(db, ctx)` writing `master_audit_logs` (keep existing `redact`).
- `supabase/functions/torque-mcp/lib/types.ts` — **modify**: `ToolContext` gains optional `serviceDb`.
- `supabase/functions/torque-mcp/tools/lead.ts` — **modify**: add `leadRestoreTool`.
- `supabase/functions/torque-mcp/tools/copilot.ts` — **modify**: add `copilotUpdatePromptTool`.
- `supabase/functions/torque-mcp/tools/cron.ts` — **create**: `cronToggleTool` (requiresServiceRole).
- `supabase/functions/torque-mcp/index.ts` — **modify**: build lazy `serviceDb`; register the 3 tools.
- `supabase/migrations/20261223000000_torque_mcp_s2_policies.sql` — **create**: master-UPDATE policy on `copilot_agents` + `toggle_cron_job` RPC.

---

## Task 1: echo-token confirm in runMutation

**Files:**
- Create: `supabase/functions/torque-mcp/lib/crypto.ts`
- Create: `supabase/functions/torque-mcp/lib/crypto.test.ts`
- Modify: `supabase/functions/torque-mcp/lib/guardrails.ts`
- Modify: `supabase/functions/torque-mcp/lib/guardrails.test.ts`

- [ ] **Step 1: Write failing test for stable hash**

`lib/crypto.test.ts`:
```ts
import { assertEquals } from "@std/assert";
import { sha256hex, stableStringify } from "./crypto.ts";

Deno.test("stableStringify — key order independent", () => {
  assertEquals(stableStringify({ b: 1, a: 2 }), stableStringify({ a: 2, b: 1 }));
  assertEquals(stableStringify({ a: { y: 1, x: 2 } }), '{"a":{"x":2,"y":1}}');
});

Deno.test("sha256hex — deterministic 64-char hex", async () => {
  const h = await sha256hex("torque");
  assertEquals(h.length, 64);
  assertEquals(h, await sha256hex("torque"));
});
```

- [ ] **Step 2: Run — expect FAIL (module missing)**

Run: `cd supabase/functions && deno test --config deno.json --allow-env --allow-read torque-mcp/lib/crypto.test.ts`
Expected: FAIL "Cannot find module ./crypto.ts"

- [ ] **Step 3: Implement crypto.ts**

`lib/crypto.ts`:
```ts
/** Deterministic JSON: object keys sorted recursively. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const o = v as Record<string, unknown>;
  return "{" + Object.keys(o).sort().map((k) => JSON.stringify(k) + ":" + stableStringify(o[k])).join(",") + "}";
}

export async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd supabase/functions && deno test --config deno.json --allow-env --allow-read torque-mcp/lib/crypto.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Update guardrails.test.ts to the echo-token flow**

Replace the body of `lib/guardrails.test.ts` with:
```ts
import { assertEquals, assertRejects } from "@std/assert";
import { runMutation } from "./guardrails.ts";
import { sha256hex, stableStringify } from "./crypto.ts";

const spec = (calls: string[]) => ({
  plan: (input: { id: string }) => ({ willDelete: input.id }),
  apply: (_i: { id: string }, p: { willDelete: string }) => {
    calls.push("apply");
    return { deleted: p.willDelete };
  },
  audit: (_i: { id: string }, _p: unknown) => {
    calls.push("audit");
  },
});

Deno.test("runMutation — no token returns dry-run plan + confirmToken, applies nothing", async () => {
  const calls: string[] = [];
  const res = await runMutation(spec(calls), { id: "lead-1" });
  assertEquals(res.dryRun, true);
  assertEquals(res.applied, false);
  assertEquals(res.plan, { willDelete: "lead-1" });
  assertEquals(res.confirmToken, await sha256hex(stableStringify({ willDelete: "lead-1" })));
  assertEquals(calls, []); // no apply, no audit
});

Deno.test("runMutation — correct token audits THEN applies", async () => {
  const calls: string[] = [];
  const token = await sha256hex(stableStringify({ willDelete: "lead-1" }));
  const res = await runMutation(spec(calls), { id: "lead-1", confirm_token: token });
  assertEquals(res.applied, true);
  assertEquals(res.result, { deleted: "lead-1" });
  assertEquals(calls, ["audit", "apply"]); // audit-first
});

Deno.test("runMutation — wrong token rejects, applies nothing", async () => {
  const calls: string[] = [];
  await assertRejects(
    () => runMutation(spec(calls), { id: "lead-1", confirm_token: "deadbeef" }),
    Error,
    "confirm_token",
  );
  assertEquals(calls, []);
});

Deno.test("runMutation — failed audit aborts before apply", async () => {
  const calls: string[] = [];
  const token = await sha256hex(stableStringify({ willDelete: "lead-1" }));
  await assertRejects(
    () =>
      runMutation({
        plan: (i: { id: string }) => ({ willDelete: i.id }),
        apply: () => {
          calls.push("apply");
          return {};
        },
        audit: () => {
          throw new Error("audit write failed");
        },
      }, { id: "lead-1", confirm_token: token }),
    Error,
    "audit write failed",
  );
  assertEquals(calls, []); // apply never ran
});
```

- [ ] **Step 6: Run — expect FAIL (old runMutation uses boolean confirm)**

Run: `cd supabase/functions && deno test --config deno.json --allow-env --allow-read torque-mcp/lib/guardrails.test.ts`
Expected: FAIL (confirmToken undefined / confirm_token not honored)

- [ ] **Step 7: Rewrite guardrails.ts**

Replace `ConfirmableInput`, `MutationResult`, `MutationSpec`, `runMutation` in `lib/guardrails.ts`:
```ts
import { sha256hex, stableStringify } from "./crypto.ts";

/** Mutating tool input: confirm_token echoes the dry-run plan hash to apply. */
export interface ConfirmableInput {
  confirm_token?: string;
}

export interface MutationResult<P, R> {
  dryRun: boolean;
  applied: boolean;
  plan: P;
  confirmToken?: string;
  result?: R;
}

export interface MutationSpec<D, P, R> {
  plan: (input: D) => Promise<P> | P;
  apply: (input: D, plan: P) => Promise<R> | R;
  /** Audit-first: runs BEFORE apply; throwing aborts the mutation (nothing applied). */
  audit?: (input: D, plan: P, confirmToken: string) => Promise<void> | void;
}

export async function runMutation<D, P, R>(
  spec: MutationSpec<D, P, R>,
  input: D & ConfirmableInput,
): Promise<MutationResult<P, R>> {
  const plan = await spec.plan(input);
  const confirmToken = await sha256hex(stableStringify(plan));
  if (!input.confirm_token) {
    return { dryRun: true, applied: false, plan, confirmToken };
  }
  if (input.confirm_token !== confirmToken) {
    throw new Error("confirm_token mismatch — re-run the dry-run and pass the returned confirmToken");
  }
  if (spec.audit) await spec.audit(input, plan, confirmToken); // audit-first
  const result = await spec.apply(input, plan);
  return { dryRun: false, applied: true, plan, result };
}
```

- [ ] **Step 8: Run — expect PASS (crypto + guardrails)**

Run: `cd supabase/functions && deno test --config deno.json --allow-env --allow-read torque-mcp/lib/crypto.test.ts torque-mcp/lib/guardrails.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 9: Commit**

```bash
git add supabase/functions/torque-mcp/lib/crypto.ts supabase/functions/torque-mcp/lib/crypto.test.ts supabase/functions/torque-mcp/lib/guardrails.ts supabase/functions/torque-mcp/lib/guardrails.test.ts
git commit -m "feat(torque-mcp): echo-token confirm + audit-first in runMutation"
```

---

## Task 2: S2 DB policies + cron RPC (migration)

**Files:**
- Create: `supabase/migrations/20261223000000_torque_mcp_s2_policies.sql`

> **Security:** sensitive (multi-tenant RLS + privileged pg_cron). The UPDATE policy uses `is_master_user()` (SECURITY DEFINER STABLE, no inline team_members → Realtime-safe). `toggle_cron_job` is SECURITY DEFINER granted only to `service_role`, only flips the `active` flag (never deletes/reschedules).

- [ ] **Step 1: Write the migration**

`supabase/migrations/20261223000000_torque_mcp_s2_policies.sql`:
```sql
-- 20261223000000_torque_mcp_s2_policies.sql
-- S2 mutating pack (docs/adr/0011): minimal write surface for the MCP master.

-- 1) copilot.update_prompt writes copilot_agents directly via master JWT.
--    copilot_agents has master_select_all (SELECT) but no master UPDATE → add it.
DROP POLICY IF EXISTS "master_update_all_copilot_agents" ON public.copilot_agents;
CREATE POLICY "master_update_all_copilot_agents" ON public.copilot_agents
  FOR UPDATE USING (public.is_master_user()) WITH CHECK (public.is_master_user());

-- 2) cron.toggle: pg_cron is privileged (cron schema, no RLS). Wrap the active-flag
--    flip in a SECURITY DEFINER RPC granted to service_role only. Toggles, never deletes.
CREATE OR REPLACE FUNCTION public.toggle_cron_job(p_jobname text, p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron
AS $$
DECLARE v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = p_jobname;
  IF v_jobid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'job not found: ' || p_jobname);
  END IF;
  PERFORM cron.alter_job(v_jobid, active := p_enabled);
  RETURN jsonb_build_object('ok', true, 'jobname', p_jobname, 'jobid', v_jobid, 'active', p_enabled);
END;
$$;

REVOKE ALL ON FUNCTION public.toggle_cron_job(text, boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_cron_job(text, boolean) TO service_role;
```

- [ ] **Step 2: Commit (apply happens at deploy, per ADR — dev default, prod explicit)**

```bash
git add supabase/migrations/20261223000000_torque_mcp_s2_policies.sql
git commit -m "feat(torque-mcp): S2 migration — master UPDATE on copilot_agents + toggle_cron_job RPC"
```

> Apply via `supabase db push` or Management API at deploy time (see Task 7). `cron.job` may be empty on dev (jobs scheduled per-env) — `toggle_cron_job` returns `{ok:false, job not found}` gracefully there.

---

## Task 3: auditMcpAction → master_audit_logs

**Files:**
- Modify: `supabase/functions/torque-mcp/lib/audit.ts`
- Modify: `supabase/functions/torque-mcp/lib/audit.test.ts`

- [ ] **Step 1: Write failing test (audit payload + abort-on-error)**

Append to `lib/audit.test.ts`:
```ts
import { buildAuditRow } from "./audit.ts";

Deno.test("buildAuditRow — shapes master_audit_logs row with redacted params", () => {
  const row = buildAuditRow("master-uuid", "user-uuid", {
    tool: "lead.restore",
    org_id: "org-1",
    target_type: "lead",
    target_id: "lead-1",
    params: { phone: "5511999998888", lead_id: "lead-1" },
    plan: { willRestore: "lead-1" },
    confirm_token: "abc123",
  });
  assertEquals(row.master_user_id, "master-uuid");
  assertEquals(row.action, "MCP_LEAD_RESTORE");
  assertEquals(row.target_type, "lead");
  assertEquals(row.target_id, "lead-1");
  assertEquals((row.details.params as Record<string, unknown>).phone, "*********8888"); // redacted
  assertEquals(row.details.tool, "lead.restore");
  assertEquals(row.details.confirm_token, "abc123");
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd supabase/functions && deno test --config deno.json --allow-env --allow-read torque-mcp/lib/audit.test.ts`
Expected: FAIL "buildAuditRow not exported"

- [ ] **Step 3: Implement in audit.ts**

Append to `lib/audit.ts`:
```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export interface AuditCtx {
  tool: string;
  org_id: string;
  target_type: string;
  target_id: string | null;
  params: Record<string, unknown>;
  plan: unknown;
  confirm_token: string;
}

/** Pure: build the master_audit_logs row (params redacted). */
export function buildAuditRow(masterUserId: string, userId: string, ctx: AuditCtx) {
  return {
    master_user_id: masterUserId,
    user_id: userId,
    action: `MCP_${ctx.tool.replace(/[^a-zA-Z0-9]+/g, "_").toUpperCase()}`,
    target_type: ctx.target_type,
    target_id: ctx.target_id,
    details: {
      tool: ctx.tool,
      org_id: ctx.org_id,
      params: redact(ctx.params),
      plan: ctx.plan,
      confirm_token: ctx.confirm_token,
    } as Record<string, unknown>,
  };
}

/**
 * Audit-first: record the master action BEFORE the mutation applies.
 * Throws on any failure so runMutation aborts (nothing applied without a trail).
 */
export async function auditMcpAction(db: SupabaseClient, ctx: AuditCtx): Promise<void> {
  const { data: auth } = await db.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("audit: no authenticated master user");
  const { data: mu, error: muErr } = await db.from("master_users").select("id").eq("user_id", userId).maybeSingle();
  if (muErr || !mu) throw new Error(`audit: master_users row not found (${muErr?.message ?? "none"})`);
  const { error } = await db.from("master_audit_logs").insert(buildAuditRow(mu.id as string, userId, ctx));
  if (error) throw new Error(`audit failed (mutation aborted): ${error.message}`);
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd supabase/functions && deno test --config deno.json --allow-env --allow-read torque-mcp/lib/audit.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/torque-mcp/lib/audit.ts supabase/functions/torque-mcp/lib/audit.test.ts
git commit -m "feat(torque-mcp): auditMcpAction → master_audit_logs (audit-first)"
```

---

## Task 4: lead.restore tool

**Files:**
- Modify: `supabase/functions/torque-mcp/tools/lead.ts`
- Modify: `supabase/functions/torque-mcp/tools/lead.test.ts`

> **Security:** reuses RPC `restore_lead(p_lead_id uuid)` (SECURITY DEFINER + `is_master_user()` branch, migration 20261212000000). Dry-run reads the soft-deleted lead with RLS ON (master-ghost) — does NOT call the RPC. Restore only un-deletes; it does not re-add the lead to pipes — the result message states this.

- [ ] **Step 1: Write failing test (pure plan builder)**

Append to `tools/lead.test.ts`:
```ts
import { buildRestorePlan } from "./lead.ts";

Deno.test("buildRestorePlan — summarizes the soft-deleted lead to restore", () => {
  const plan = buildRestorePlan({ id: "lead-1", name: "Joao", organization_id: "org-1", deleted_at: "2026-06-20T00:00:00Z" });
  assertEquals(plan, {
    action: "restore_lead",
    lead_id: "lead-1",
    name: "Joao",
    organization_id: "org-1",
    deleted_at: "2026-06-20T00:00:00Z",
    note: "Un-deletes only; does not re-add to pipes.",
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd supabase/functions && deno test --config deno.json --allow-env --allow-read torque-mcp/tools/lead.test.ts`
Expected: FAIL "buildRestorePlan not exported"

- [ ] **Step 3: Implement in tools/lead.ts**

Append to `tools/lead.ts`:
```ts
import { runMutation } from "../lib/guardrails.ts";
import { auditMcpAction } from "../lib/audit.ts";

export function buildRestorePlan(lead: Record<string, unknown>) {
  return {
    action: "restore_lead",
    lead_id: lead.id,
    name: lead.name,
    organization_id: lead.organization_id,
    deleted_at: lead.deleted_at,
    note: "Un-deletes only; does not re-add to pipes.",
  };
}

export const leadRestoreTool: ToolDef = {
  name: "lead.restore",
  description:
    "Restore a soft-deleted lead (un-delete) within an org, RLS-scoped as master. " +
    "Dry-run shows the lead; pass confirm_token to apply. Does not re-add to pipes.",
  readonly: false,
  inputSchema: {
    type: "object",
    properties: {
      org_id: { type: "string", description: "Organization UUID" },
      lead_id: { type: "string", description: "Lead UUID (soft-deleted)" },
      confirm_token: { type: "string", description: "Echo the dry-run confirmToken to apply" },
    },
    required: ["org_id", "lead_id"],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const db = ctx.db as SupabaseClient;
    const org = String(args.org_id);
    const leadId = String(args.lead_id);

    const res = await runMutation({
      plan: async () => {
        const { data, error } = await db.from("leads")
          .select("id,name,organization_id,deleted_at")
          .eq("organization_id", org).eq("id", leadId).not("deleted_at", "is", null).maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) throw new Error("No soft-deleted lead found for that id/org.");
        return buildRestorePlan(data as Record<string, unknown>);
      },
      audit: (_i, plan, token) =>
        auditMcpAction(db, { tool: "lead.restore", org_id: org, target_type: "lead", target_id: leadId, params: args, plan, confirm_token: token }),
      apply: async () => {
        const { error } = await db.rpc("restore_lead", { p_lead_id: leadId });
        if (error) throw new Error(error.message);
        return { restored: leadId };
      },
    }, { confirm_token: typeof args.confirm_token === "string" ? args.confirm_token : undefined });

    return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
  },
};
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd supabase/functions && deno test --config deno.json --allow-env --allow-read torque-mcp/tools/lead.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/torque-mcp/tools/lead.ts supabase/functions/torque-mcp/tools/lead.test.ts
git commit -m "feat(torque-mcp): lead.restore mutating tool (reuses restore_lead RPC)"
```

---

## Task 5: copilot.update_prompt tool

**Files:**
- Modify: `supabase/functions/torque-mcp/tools/copilot.ts`
- Modify: `supabase/functions/torque-mcp/tools/copilot.test.ts`

> **Security:** direct master-JWT UPDATE on `copilot_agents` (needs the `master_update_all_copilot_agents` policy from Task 2). Writes the 3 prompt locations atomically in ONE update + sets `prompt_hash = null` (forces runtime re-compile — the known "edit one place, others diverge" gotcha). Dry-run shows the new values vs current via the existing `extractPromptSources`.

- [ ] **Step 1: Write failing test (pure update-payload builder)**

Append to `tools/copilot.test.ts`:
```ts
import { buildPromptUpdate } from "./copilot.ts";

Deno.test("buildPromptUpdate — only provided sections, prompt_hash nulled", () => {
  assertEquals(
    buildPromptUpdate({ system_prompt: "NEW", dos: "be concise", promptSections: [{ id: "p", text: "x" }] }, { tone: "warm" }),
    {
      system_prompt: "NEW",
      custom_instructions: '{"dos":"be concise"}',
      conversation_style: { tone: "warm", promptSections: [{ id: "p", text: "x" }] },
      prompt_hash: null,
    },
  );
});

Deno.test("buildPromptUpdate — omitted sections are not touched", () => {
  assertEquals(buildPromptUpdate({ system_prompt: "ONLY" }, { tone: "warm" }), {
    system_prompt: "ONLY",
    prompt_hash: null,
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd supabase/functions && deno test --config deno.json --allow-env --allow-read torque-mcp/tools/copilot.test.ts`
Expected: FAIL "buildPromptUpdate not exported"

- [ ] **Step 3: Implement in tools/copilot.ts**

Append to `tools/copilot.ts`:
```ts
import { runMutation } from "../lib/guardrails.ts";
import { auditMcpAction } from "../lib/audit.ts";

export interface PromptSectionsInput {
  system_prompt?: string;
  dos?: string;
  promptSections?: unknown;
}

/** Build the copilot_agents update: only provided sections; prompt_hash always nulled. */
export function buildPromptUpdate(
  sections: PromptSectionsInput,
  currentConversationStyle: Record<string, unknown> | null,
): Record<string, unknown> {
  const upd: Record<string, unknown> = { prompt_hash: null };
  if (sections.system_prompt !== undefined) upd.system_prompt = sections.system_prompt;
  if (sections.dos !== undefined) upd.custom_instructions = JSON.stringify({ dos: sections.dos });
  if (sections.promptSections !== undefined) {
    upd.conversation_style = { ...(currentConversationStyle ?? {}), promptSections: sections.promptSections };
  }
  return upd;
}

export const copilotUpdatePromptTool: ToolDef = {
  name: "copilot.update_prompt",
  description:
    "Update a Copilot agent's prompt across its 3 storage locations atomically + null prompt_hash " +
    "(forces re-compile). Master-JWT write. Dry-run shows the change; confirm_token to apply.",
  readonly: false,
  inputSchema: {
    type: "object",
    properties: {
      agent_id: { type: "string", description: "Copilot agent UUID" },
      system_prompt: { type: "string", description: "New compiled system prompt (optional)" },
      dos: { type: "string", description: "New custom_instructions.dos (optional)" },
      promptSections: { type: "array", description: "New conversation_style.promptSections (optional)" },
      confirm_token: { type: "string" },
    },
    required: ["agent_id"],
    additionalProperties: false,
  },
  handler: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const db = ctx.db as SupabaseClient;
    const agentId = String(args.agent_id);
    const sections: PromptSectionsInput = {
      system_prompt: typeof args.system_prompt === "string" ? args.system_prompt : undefined,
      dos: typeof args.dos === "string" ? args.dos : undefined,
      promptSections: Array.isArray(args.promptSections) ? args.promptSections : undefined,
    };
    if (sections.system_prompt === undefined && sections.dos === undefined && sections.promptSections === undefined) {
      return { content: [{ type: "text", text: "Provide at least one of system_prompt | dos | promptSections." }], isError: true };
    }

    const res = await runMutation({
      plan: async () => {
        const { data, error } = await db.from("copilot_agents")
          .select("id,organization_id,name,conversation_style").eq("id", agentId).maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) throw new Error("No copilot agent found.");
        const update = buildPromptUpdate(sections, (data.conversation_style as Record<string, unknown>) ?? null);
        return { action: "update_prompt", agent_id: agentId, name: data.name, organization_id: data.organization_id, update };
      },
      audit: (_i, plan, token) =>
        auditMcpAction(db, { tool: "copilot.update_prompt", org_id: String(args.org_id ?? ""), target_type: "copilot_agent", target_id: agentId, params: args, plan, confirm_token: token }),
      apply: async (_i, plan) => {
        const { error } = await db.from("copilot_agents").update((plan as { update: Record<string, unknown> }).update).eq("id", agentId);
        if (error) throw new Error(error.message);
        return { updated: agentId };
      },
    }, { confirm_token: typeof args.confirm_token === "string" ? args.confirm_token : undefined });

    return { content: [{ type: "text", text: JSON.stringify(res, null, 2) }] };
  },
};
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd supabase/functions && deno test --config deno.json --allow-env --allow-read torque-mcp/tools/copilot.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/torque-mcp/tools/copilot.ts supabase/functions/torque-mcp/tools/copilot.test.ts
git commit -m "feat(torque-mcp): copilot.update_prompt mutating tool (3 places + prompt_hash null)"
```

---

## Task 6: cron.toggle tool (requiresServiceRole)

**Files:**
- Modify: `supabase/functions/torque-mcp/lib/types.ts`
- Create: `supabase/functions/torque-mcp/tools/cron.ts`
- Create: `supabase/functions/torque-mcp/tools/cron.test.ts`

> **Security:** pg_cron is privileged → uses `ctx.serviceDb` (service_role) to call the `toggle_cron_job` SECURITY DEFINER RPC (Task 2). Only enable/disable by job name. Audited via the master `db` (not serviceDb).

- [ ] **Step 1: Add serviceDb to ToolContext**

In `lib/types.ts`, change `ToolContext`:
```ts
export interface ToolContext {
  /** RLS-scoped master client (JWT). */
  db: unknown;
  /** service_role client — only for tools with requiresServiceRole. */
  serviceDb?: unknown;
}
```

- [ ] **Step 2: Write failing test (pure plan builder)**

`tools/cron.test.ts`:
```ts
import { assertEquals } from "@std/assert";
import { buildCronPlan } from "./cron.ts";

Deno.test("buildCronPlan — describes the toggle", () => {
  assertEquals(buildCronPlan("purge-deleted-whatsapp-conversations", false), {
    action: "toggle_cron_job",
    jobname: "purge-deleted-whatsapp-conversations",
    enabled: false,
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

Run: `cd supabase/functions && deno test --config deno.json --allow-env --allow-read torque-mcp/tools/cron.test.ts`
Expected: FAIL "Cannot find module ./cron.ts"

- [ ] **Step 4: Implement tools/cron.ts**

```ts
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
```

- [ ] **Step 5: Run — expect PASS**

Run: `cd supabase/functions && deno test --config deno.json --allow-env --allow-read torque-mcp/tools/cron.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/torque-mcp/lib/types.ts supabase/functions/torque-mcp/tools/cron.ts supabase/functions/torque-mcp/tools/cron.test.ts
git commit -m "feat(torque-mcp): cron.toggle mutating tool (service_role toggle_cron_job RPC)"
```

---

## Task 7: Register tools + serviceDb wiring + ship

**Files:**
- Modify: `supabase/functions/torque-mcp/index.ts`

- [ ] **Step 1: Wire serviceDb + register the 3 tools**

In `index.ts`: add imports + register, and build a lazy service client.
```ts
import { createClient } from "@supabase/supabase-js";
import { leadRestoreTool } from "./tools/lead.ts";
import { copilotUpdatePromptTool } from "./tools/copilot.ts";
import { cronToggleTool } from "./tools/cron.ts";
// ...existing imports...

const TOOLS = [
  leadGetTool, leadTraceHistoryTool, conversationGetTool,
  whatsappInstanceStatusTool, blastStatusTool, copilotDumpPromptTool,
  leadRestoreTool, copilotUpdatePromptTool, cronToggleTool,
];

// lazy service client (only built if a requiresServiceRole tool is called)
let _serviceDb: ReturnType<typeof createClient> | null = null;
function getServiceDb() {
  if (!_serviceDb) {
    _serviceDb = createClient(config.supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _serviceDb;
}
```
In the request handler, where `ctx` is built:
```ts
const ctx: DispatchContext = {
  serverInfo: SERVER_INFO,
  tools: TOOLS,
  allowMutations: config.allowMutations,
  toolContext: { db, serviceDb: config.allowMutations ? getServiceDb() : undefined },
};
```

- [ ] **Step 2: Type-check + full suite**

Run: `cd supabase/functions && deno check --config deno.json torque-mcp/index.ts && deno test --config deno.json --allow-env --allow-read torque-mcp/`
Expected: index checks; all unit tests PASS

- [ ] **Step 3: Lint + fmt**

Run: `cd supabase/functions && deno fmt --config deno.json torque-mcp/ && deno lint --config deno.json torque-mcp/`
Expected: 0 problems

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/torque-mcp/index.ts
git commit -m "feat(torque-mcp): register S2 mutating tools + serviceDb wiring (gated by ALLOW_MUTATIONS)"
```

- [ ] **Step 5: Deploy (dev first; prod explicit) — ALLOW_MUTATIONS stays OFF**

Per ADR/CLAUDE.md (manual deploy). Dev:
```bash
export SUPABASE_ACCESS_TOKEN=<sbp_ from .env.development>
# apply migration (Management API or db push) — see S1 deploy notes
supabase functions deploy torque-mcp --project-ref bcfadphgsibjzivtbjvc
```
Do NOT set `TORQUE_MCP_ALLOW_MUTATIONS=true` yet — tools ship hidden. Verify `tools/list` still shows only the 6 read tools (mutations hidden).

- [ ] **Step 6: Enable + verify mutations (when ready, per environment)**

```bash
supabase secrets set --project-ref <ref> TORQUE_MCP_ALLOW_MUTATIONS=true
# tools/list now shows 9. Test each: dry-run (get confirmToken) → apply with confirm_token.
# Confirm master_audit_logs got a row per applied mutation.
```

---

## Self-Review

**Spec coverage:** write-path reuse ✅ (restore_lead RPC, toggle_cron_job RPC, copilot direct write); echo-token ✅ (Task 1); audit-first → master_audit_logs ✅ (Task 3, audit-before-apply); gating ✅ (ships hidden, Task 7 Step 5); org_id explicit ✅; build order S2a (Tasks 4-5) → S2b (Task 6) ✅; `blast.requeue` ✅ explicitly deferred with rationale. cron.toggle service_role caveat ✅ (Task 6).

**Placeholder scan:** none — every step has real code/commands. The deploy steps reference `<ref>`/`<sbp_>` which are environment secrets the operator supplies (not code placeholders).

**Type consistency:** `ConfirmableInput.confirm_token` used consistently (guardrails → tools); `MutationSpec.audit(input, plan, confirmToken)` matches all callers; `ToolContext.{db,serviceDb}` matches cron tool; `buildPromptUpdate`/`buildRestorePlan`/`buildCronPlan`/`buildAuditRow` names consistent between impl and tests.

**Gotchas captured:** restore doesn't re-add pipes (stated in result note); cron.job empty on dev (graceful job-not-found); copilot prompt_hash always nulled; audit fetches master_users.id (FK NOT NULL) → throws if missing.
