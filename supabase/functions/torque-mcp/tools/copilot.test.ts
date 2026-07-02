import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type { ComposePromptSections } from "../../_shared/copilot-prompt/index.ts";
import { extractPromptSources } from "./copilot.ts";

Deno.test("extractPromptSources — parses the 3 storage locations", () => {
  const agent = {
    system_prompt: "COMPILED PROMPT",
    custom_instructions: '{"dos":"be concise","donts":"no emoji"}', // TEXT holding JSON
    conversation_style: { promptSections: [{ id: "persona", text: "..." }] },
    prompt_hash: "abc123",
  };
  assertEquals(extractPromptSources(agent), {
    system_prompt: "COMPILED PROMPT",
    dos: "be concise",
    promptSections: [{ id: "persona", text: "..." }],
    prompt_hash: "abc123",
  });
});

Deno.test("extractPromptSources — tolerates missing/unparseable fields", () => {
  const agent = { system_prompt: null, custom_instructions: "not json", conversation_style: null };
  const out = extractPromptSources(agent);
  assertEquals(out.system_prompt, null);
  assertEquals(out.dos, null);
  assertEquals(out.promptSections, null);
  assertEquals(out.prompt_hash, null);
});

import { buildPromptUpdate } from "./copilot.ts";

Deno.test("buildPromptUpdate — only provided sections, prompt_hash nulled", () => {
  assertEquals(
    buildPromptUpdate({
      system_prompt: "NEW",
      dos: "be concise",
      promptSections: [{ id: "p", text: "x" }],
    }, { tone: "warm" }),
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

// ── copilot.set_sections ─────────────────────────────────────────────────────
import {
  buildSetSectionsUpdate,
  copilotSetSectionsTool,
  copilotUpdatePromptTool,
} from "./copilot.ts";

/**
 * Minimal chainable Supabase stub. Supports the calls set_sections makes:
 *   from("copilot_agents").select(cols).eq("id",x).maybeSingle()  → { data: agent }
 *   from("copilot_agent_documents").select(...).eq("agent_id",x)  → { data: docs } (awaited)
 *   from("copilot_agents").update(obj).eq("id",x)                 → { error } (awaited, fires onUpdate)
 * plus the audit path (auth.getUser / master_users / master_audit_logs.insert).
 */
function makeStub(opts: {
  agent: Record<string, unknown> | null;
  docs?: unknown[];
  docsError?: { message: string };
  onUpdate?: (table: string, payload: Record<string, unknown>) => void;
  authUserId?: string;
  masterUserId?: string;
}) {
  const { agent, docs = [], docsError, onUpdate } = opts;
  const authUserId = opts.authUserId ?? "user-1";
  const masterUserId = opts.masterUserId ?? "master-1";

  function makeBuilder(table: string) {
    let op: "select" | "update" | "insert" = "select";
    let payload: Record<string, unknown> | undefined;
    const resolve = () => {
      if (table === "copilot_agents") {
        if (op === "update") {
          onUpdate?.(table, payload ?? {});
          return { data: null, error: null };
        }
        return { data: agent, error: null };
      }
      if (table === "copilot_agent_documents") {
        return docsError ? { data: null, error: docsError } : { data: docs, error: null };
      }
      if (table === "master_users") return { data: { id: masterUserId }, error: null };
      if (table === "master_audit_logs") return { data: null, error: null };
      return { data: null, error: null };
    };
    // deno-lint-ignore no-explicit-any
    const builder: any = {
      select() {
        op = "select";
        return builder;
      },
      update(p: Record<string, unknown>) {
        op = "update";
        payload = p;
        return builder;
      },
      insert(p: Record<string, unknown>) {
        op = "insert";
        payload = p;
        return builder;
      },
      eq() {
        return builder;
      },
      maybeSingle() {
        return Promise.resolve(resolve());
      },
      then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) {
        return Promise.resolve(resolve()).then(onF, onR);
      },
    };
    return builder;
  }

  return {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: authUserId } } }) },
    from: (table: string) => makeBuilder(table),
  };
}

// deno-lint-ignore no-explicit-any
const ctxOf = (db: unknown) => ({ db } as any);

Deno.test("buildSetSectionsUpdate — recompiles system_prompt + merges 3 places + nulls hash", () => {
  const agentRow = {
    id: "a1",
    organization_id: "o1",
    name: "Bia",
    can_qualify_lead: true,
    conversation_style: {
      tone: "warm",
      promptSections: { personality: "Sou a Bia.", objective: "Qualificar leads." },
    },
  };
  const update = buildSetSectionsUpdate(
    { flow: "Passo 1: cumprimentar o lead." },
    agentRow.conversation_style as Record<string, unknown>,
    [],
    agentRow,
  );

  const sp = String(update.system_prompt);
  // new section text appears under its compiled header
  assertStringIncludes(sp, "# FLUXO DE ATENDIMENTO");
  assertStringIncludes(sp, "Passo 1: cumprimentar o lead.");
  // untouched sections are preserved in the recompile
  assertStringIncludes(sp, "# PERSONALIDADE");
  assertStringIncludes(sp, "Sou a Bia.");

  // promptSections merged (patch over current, other keys kept)
  const merged =
    (update.conversation_style as { promptSections: ComposePromptSections }).promptSections;
  assertEquals(merged.personality, "Sou a Bia.");
  assertEquals(merged.objective, "Qualificar leads.");
  assertEquals(merged.flow, "Passo 1: cumprimentar o lead.");
  // other conversation_style keys preserved
  assertEquals((update.conversation_style as { tone: string }).tone, "warm");
  // custom_instructions === system_prompt (Playground parity)
  assertEquals(update.custom_instructions, update.system_prompt);
  // prompt_hash always nulled → forces runtime recompile
  assertEquals(update.prompt_hash, null);
});

Deno.test("buildSetSectionsUpdate — empty string clears a section", () => {
  const agentRow = {
    conversation_style: { promptSections: { personality: "old", flow: "old flow" } },
  };
  const update = buildSetSectionsUpdate(
    { flow: "" },
    agentRow.conversation_style as Record<string, unknown>,
    [],
    agentRow,
  );
  const merged =
    (update.conversation_style as { promptSections: ComposePromptSections }).promptSections;
  assertEquals(merged.flow, "");
  // cleared section no longer emits its header
  assertEquals(String(update.system_prompt).includes("# FLUXO DE ATENDIMENTO"), false);
});

Deno.test("buildSetSectionsUpdate — faithful recompile keeps enabled tool blocks", () => {
  // Locks the invariant that the recompile reflects live can_* flags + tool catalog,
  // not just the edited section. can_qualify_lead → the QUALIFICAR_LEAD block must appear.
  const agentRow = {
    id: "a1",
    organization_id: "o1",
    name: "Bia",
    can_qualify_lead: true,
    conversation_style: { promptSections: { personality: "Sou a Bia." } },
  };
  const update = buildSetSectionsUpdate(
    { flow: "Cumprimentar e qualificar." },
    agentRow.conversation_style as Record<string, unknown>,
    [],
    agentRow,
  );
  assertStringIncludes(String(update.system_prompt), "# FERRAMENTAS DISPONÍVEIS");
  assertStringIncludes(String(update.system_prompt), "## Qualificar Lead");
});

Deno.test("copilot.set_sections — dry-run returns confirmToken and does NOT write", async () => {
  let writes = 0;
  const db = makeStub({
    agent: {
      id: "a1",
      organization_id: "o1",
      name: "Bia",
      conversation_style: { promptSections: { personality: "Sou a Bia." } },
    },
    docs: [],
    onUpdate: () => {
      writes++;
    },
  });
  const res = await copilotSetSectionsTool.handler(
    { agent_id: "a1", sections: { flow: "novo fluxo" } },
    ctxOf(db),
  );
  const parsed = JSON.parse(res.content[0].text);
  assertEquals(parsed.dryRun, true);
  assertEquals(parsed.applied, false);
  assertEquals(typeof parsed.confirmToken, "string");
  assertEquals(parsed.plan.changed, ["flow"]);
  assertEquals(writes, 0); // nothing applied on dry-run
});

Deno.test("copilot.set_sections — requires at least one section", async () => {
  const db = makeStub({
    agent: { id: "a1", organization_id: "o1", name: "Bia", conversation_style: {} },
  });
  const res = await copilotSetSectionsTool.handler(
    { agent_id: "a1", sections: {} },
    ctxOf(db),
  );
  assertEquals(res.isError, true);
  assertStringIncludes(res.content[0].text, "at least one");
});

Deno.test("copilot.set_sections — agent not found → throws", async () => {
  const db = makeStub({ agent: null });
  await assertRejects(
    () =>
      copilotSetSectionsTool.handler(
        { agent_id: "missing", sections: { flow: "x" } },
        ctxOf(db),
      ),
    Error,
    "No copilot agent found.",
  );
});

Deno.test("copilot.set_sections — docs read error aborts (no degraded recompile)", async () => {
  let writes = 0;
  const db = makeStub({
    agent: {
      id: "a1",
      organization_id: "o1",
      name: "Bia",
      conversation_style: { promptSections: { personality: "Sou a Bia." } },
    },
    docsError: { message: "boom" },
    onUpdate: () => {
      writes++;
    },
  });
  await assertRejects(
    () =>
      copilotSetSectionsTool.handler(
        { agent_id: "a1", sections: { flow: "x" } },
        ctxOf(db),
      ),
    Error,
    "boom",
  );
  assertEquals(writes, 0); // fail-closed: nothing applied
});

Deno.test("copilot.set_sections — apply round-trip writes recompiled prompt once", async () => {
  let writes = 0;
  let captured: Record<string, unknown> | null = null;
  const agent = {
    id: "a1",
    organization_id: "o1",
    name: "Bia",
    can_qualify_lead: true,
    conversation_style: { promptSections: { personality: "Sou a Bia." } },
  };
  const db = makeStub({
    agent,
    docs: [],
    onUpdate: (_table, payload) => {
      writes++;
      captured = payload;
    },
  });

  const dry = await copilotSetSectionsTool.handler(
    { agent_id: "a1", sections: { flow: "novo fluxo de atendimento" } },
    ctxOf(db),
  );
  const token = JSON.parse(dry.content[0].text).confirmToken;

  const applied = await copilotSetSectionsTool.handler(
    { agent_id: "a1", sections: { flow: "novo fluxo de atendimento" }, confirm_token: token },
    ctxOf(db),
  );
  const parsed = JSON.parse(applied.content[0].text);
  assertEquals(parsed.applied, true);
  assertEquals(writes, 1); // applied exactly once
  const update = captured as unknown as Record<string, unknown>;
  assertStringIncludes(String(update.system_prompt), "novo fluxo de atendimento");
  assertEquals(update.custom_instructions, update.system_prompt);
  assertEquals(update.prompt_hash, null);
});

// ── copilot.update_prompt (handler-level) ────────────────────────────────────
Deno.test("update_prompt: object promptSections is written (was dropped by array gate)", async () => {
  const agent = {
    id: "a1",
    organization_id: "o1",
    name: "Bia",
    conversation_style: { tone: "warm" },
  };
  const db = makeStub({ agent });
  const dry = JSON.parse(
    (await copilotUpdatePromptTool.handler(
      {
        agent_id: "a1",
        promptSections: {
          personality: "X",
          objective: "",
          flow: "",
          products: "",
          instructions: "",
        },
      },
      ctxOf(db),
    )).content[0].text,
  );
  // The planned update must carry conversation_style.promptSections (not dropped)
  const planUpd = dry.plan.update;
  assertEquals(
    (planUpd.conversation_style as { promptSections?: { personality?: string } })
      .promptSections?.personality,
    "X",
  );
  // other conversation_style keys preserved by the spread in buildPromptUpdate
  assertEquals((planUpd.conversation_style as { tone?: string }).tone, "warm");
});
