import { assert, assertEquals, assertNotEquals } from "@std/assert";
import {
  attachmentReadMode,
  auditParams,
  buildDiagnosisPlan,
  COMPLEXITIES,
  estimateCostUsd,
  MAX_IMAGE_BYTES,
  MAX_TEXT_BYTES,
  MODELS,
  PRICES,
  supportAttachmentGetTool,
  validateDiagnosis,
  validateExecution,
} from "./support.ts";
import { textOf } from "../../_shared/mcp/content.ts";

const TICKET = "5d1a1102-cccc-0000-0000-000000001102";

function valid(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ticket_id: TICKET,
    kind: "fix",
    complexity: "baixa",
    summary: "Mover etapa em funil personalizado não dispara o evento.",
    root_cause: "SET stage_id sem stage_key — trigger é UPDATE OF stage_key.",
    customer_reply: "Achamos a causa e já estamos corrigindo.",
    recommended_model: "sonnet",
    recommended_effort: "medium",
    resolution_prompt: "x".repeat(80),
    keystones: [{ label: "teste do hook passa", verify: "npx vitest run useMoveCard" }],
    estimated_cost_usd: 1.234,
    ...over,
  };
}

Deno.test("validateDiagnosis — accepts a full payload and normalizes it", () => {
  const v = validateDiagnosis(valid({ summary: "  Mover etapa não dispara o evento.  " }));
  assert(v.ok);
  assertEquals(v.record.summary, "Mover etapa não dispara o evento.");
  assertEquals(v.record.estimated_cost_usd, 1.23);
});

Deno.test("validateDiagnosis — fix without root_cause is refused", () => {
  const v = validateDiagnosis(valid({ root_cause: "" }));
  assert(!v.ok);
  assert(v.errors.some((e) => e.startsWith("root_cause is required")));
});

Deno.test("validateDiagnosis — duvida may omit root_cause", () => {
  const v = validateDiagnosis(valid({ kind: "duvida", root_cause: undefined }));
  assert(v.ok);
  assertEquals(v.record.root_cause, null);
});

Deno.test("validateDiagnosis — reports every problem at once", () => {
  const v = validateDiagnosis({
    ticket_id: "nope",
    kind: "bug",
    complexity: "enorme",
    summary: "curto",
    recommended_model: "gpt-4.1-mini",
    recommended_effort: "ultra",
    resolution_prompt: "pouco",
    keystones: [],
  });
  assert(!v.ok);
  assertEquals(v.errors.length, 8);
});

Deno.test("validateDiagnosis — a keystone without verify is refused", () => {
  const v = validateDiagnosis(valid({ keystones: [{ label: "funciona" }] }));
  assert(!v.ok);
  assert(v.errors.some((e) => e.includes("keystones[0].verify")));
});

Deno.test("validateDiagnosis — more than 15 keystones is refused", () => {
  const many = Array.from({ length: 16 }, (_, i) => ({ label: `k${i}`, verify: "true" }));
  assert(!validateDiagnosis(valid({ keystones: many })).ok);
});

Deno.test("buildDiagnosisPlan — binds the exact payload via sha256", async () => {
  const a = validateDiagnosis(valid());
  const b = validateDiagnosis(valid({ resolution_prompt: "y".repeat(80) }));
  assert(a.ok && b.ok);
  const ticket = { title: "Kanban", organization_id: "org-1", status: "aberto" };
  const pa = await buildDiagnosisPlan(a.record, ticket, false);
  const pb = await buildDiagnosisPlan(b.record, ticket, false);
  assertEquals(pa.action, "insert_diagnosis");
  assertEquals(pa.route, "sonnet / medium");
  // Same size, different content: only the hash tells them apart.
  assertEquals(pa.prompt_chars, pb.prompt_chars);
  assertNotEquals(pa.payload_sha256, pb.payload_sha256);
});

Deno.test("buildDiagnosisPlan — existing diagnosis becomes a replace", async () => {
  const v = validateDiagnosis(valid());
  assert(v.ok);
  const plan = await buildDiagnosisPlan(
    v.record,
    { title: "t", organization_id: "o", status: "s" },
    true,
  );
  assertEquals(plan.action, "replace_diagnosis");
});

Deno.test("auditParams — keeps the routing, drops the long bodies", () => {
  const v = validateDiagnosis(valid());
  assert(v.ok);
  const p = auditParams(v.record);
  assertEquals(p.resolution_prompt, "[80 chars]");
  assertEquals(p.recommended_model, "sonnet");
  assertEquals(String(p.summary).startsWith("["), true);
});

// --- v2 ---------------------------------------------------------------------------

Deno.test("validateDiagnosis — template v2", () => {
  const v = validateDiagnosis(valid());
  assert(v.ok);
  assertEquals(v.record.template_version, 2);
});

Deno.test("validateDiagnosis — missing estimate is computed from model + complexity", () => {
  const v = validateDiagnosis(valid({ estimated_cost_usd: undefined }));
  assert(v.ok);
  assertEquals(v.record.estimated_cost_usd, estimateCostUsd("sonnet", "baixa"));
});

Deno.test("validateDiagnosis — explicit estimate is kept", () => {
  const v = validateDiagnosis(valid({ estimated_cost_usd: 9 }));
  assert(v.ok);
  assertEquals(v.record.estimated_cost_usd, 9);
});

Deno.test("estimateCostUsd — opus/media lands on the measured run (39ff2cd1, US$ 3,02)", () => {
  // 6,5 M × 0,20 + 100 k × 8 + 40 k × 20 = 1,30 + 0,80 + 0,80
  assertEquals(estimateCostUsd("opus", "media"), 2.9);
});

Deno.test("estimateCostUsd — opus reads cache at 0.05× input, sonnet at 0.1×", () => {
  assertEquals(PRICES.opus.cacheRead / PRICES.opus.input, 0.05);
  assertEquals(PRICES.sonnet.cacheRead / PRICES.sonnet.input, 0.1);
});

Deno.test("estimateCostUsd — grows with complexity for every model", () => {
  for (const m of MODELS) {
    const costs = COMPLEXITIES.map((c) => estimateCostUsd(m, c));
    costs.slice(1).forEach((c, i) => assert(c > costs[i], `${m}: ${costs.join(" < ")}`));
  }
});

Deno.test("attachmentReadMode — small screenshot is read as image", () => {
  assertEquals(
    attachmentReadMode({ mime: "image/jpeg", size_bytes: 55_999, purged_at: null }),
    { mode: "image" },
  );
});

Deno.test("attachmentReadMode — oversized image, purged file and pdf are skipped", () => {
  const big = attachmentReadMode({
    mime: "image/png",
    size_bytes: MAX_IMAGE_BYTES + 1,
    purged_at: null,
  });
  const purged = attachmentReadMode({ mime: "image/png", size_bytes: 10, purged_at: "2026-10-01" });
  const pdf = attachmentReadMode({ mime: "application/pdf", size_bytes: 10, purged_at: null });
  assertEquals(big.mode, "skip");
  assertEquals(purged.mode, "skip");
  assertEquals(pdf.mode, "skip");
});

Deno.test("attachmentReadMode — csv is read as text up to the cap", () => {
  assertEquals(
    attachmentReadMode({ mime: "text/csv", size_bytes: 1_000, purged_at: null }).mode,
    "text",
  );
  assertEquals(
    attachmentReadMode({ mime: "text/csv", size_bytes: MAX_TEXT_BYTES + 1, purged_at: null }).mode,
    "skip",
  );
});

function execution(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ticket_id: TICKET,
    outcome: "resolvido",
    actual_cost_usd: 3.017,
    root_cause_confirmed: "sim",
    extra_commits: 1,
    reply_contradicted: true,
    ...over,
  };
}

Deno.test("validateExecution — accepts the 39ff2cd1 run and rounds the cost", () => {
  const v = validateExecution(execution());
  assert(v.ok);
  assertEquals(v.record.actual_cost_usd, 3.02);
  assertEquals(v.record.extra_commits, 1);
  assertEquals(v.record.reply_contradicted, true);
});

Deno.test("validateExecution — cost is optional", () => {
  const v = validateExecution(execution({ actual_cost_usd: undefined }));
  assert(v.ok);
  assertEquals(v.record.actual_cost_usd, null);
});

Deno.test("validateExecution — reports every problem at once", () => {
  const v = validateExecution({
    ticket_id: "x",
    outcome: "ok",
    actual_cost_usd: -1,
    root_cause_confirmed: "talvez",
    extra_commits: 1.5,
    reply_contradicted: "no",
  });
  assert(!v.ok);
  assertEquals(v.errors.length, 6);
});

Deno.test("validateExecution — precision fields are required", () => {
  const v = validateExecution({ ticket_id: TICKET, outcome: "resolvido" });
  assert(!v.ok);
  assert(v.errors.some((e) => e.startsWith("extra_commits")));
  assert(v.errors.some((e) => e.startsWith("reply_contradicted")));
  assert(v.errors.some((e) => e.startsWith("root_cause_confirmed")));
});

// --- support.attachment_get handler ------------------------------------------------

const ATTACHMENT = "5d1a1102-aaaa-0000-0000-000000001102";

function attachmentStub(row: Record<string, unknown> | null, bytes = new Uint8Array([1, 2, 3])) {
  const events: string[] = [];
  const db = {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: "u1" } } }) },
    from(table: string) {
      const b = {
        select: () => b,
        eq: () => b,
        is: () => b,
        maybeSingle: () => {
          if (table === "master_users") {
            return Promise.resolve({ data: { id: "mu1" }, error: null });
          }
          return Promise.resolve({ data: row, error: null });
        },
        insert: (r: Record<string, unknown>) => {
          events.push(`audit:${r.action}`);
          return Promise.resolve({ error: null });
        },
      };
      return b;
    },
    storage: {
      from: (bucket: string) => ({
        download: (path: string) => {
          events.push(`download:${bucket}:${path}`);
          return Promise.resolve({ data: new Blob([bytes]), error: null });
        },
      }),
    },
  };
  return { db, events };
}

const SCREENSHOT = {
  id: ATTACHMENT,
  ticket_id: TICKET,
  comment_id: null,
  path: `${TICKET}/abc.jpeg`,
  filename: "WhatsApp Image.jpeg",
  mime: "image/jpeg",
  size_bytes: 3,
  is_internal: false,
  created_at: "2026-10-01T18:41:46Z",
  purged_at: null,
};

Deno.test("support.attachment_get — screenshot comes back as an image block, audited first", async () => {
  const { db, events } = attachmentStub(SCREENSHOT);
  const res = await supportAttachmentGetTool.handler({ attachment_id: ATTACHMENT }, { db });
  assertEquals(res.isError, undefined);
  assertEquals(res.content.length, 2);
  const image = res.content[1];
  assert(image.type === "image");
  assertEquals(image.mimeType, "image/jpeg");
  assertEquals(image.data, "AQID");
  assertEquals(events, [
    "audit:MCP_SUPPORT_ATTACHMENT_GET",
    `download:support-attachments:${TICKET}/abc.jpeg`,
  ]);
  // The bucket path stays server-side.
  assertEquals(textOf(res).includes(TICKET + "/abc"), false);
});

Deno.test("support.attachment_get — pdf returns metadata only, nothing downloaded", async () => {
  const { db, events } = attachmentStub({ ...SCREENSHOT, mime: "application/pdf" });
  const res = await supportAttachmentGetTool.handler({ attachment_id: ATTACHMENT }, { db });
  assertEquals(res.content.length, 1);
  assertEquals(JSON.parse(textOf(res)).read, "skip");
  assertEquals(events, []);
});

Deno.test("support.attachment_get — real bytes above the cap are not sent", async () => {
  const { db } = attachmentStub(
    { ...SCREENSHOT, mime: "text/plain", size_bytes: 10 },
    new Uint8Array(MAX_TEXT_BYTES + 1),
  );
  const res = await supportAttachmentGetTool.handler({ attachment_id: ATTACHMENT }, { db });
  assertEquals(res.content.length, 1);
  assertEquals(JSON.parse(textOf(res)).reason, "arquivo real acima do teto");
});

Deno.test("support.attachment_get — bad id is refused before any query", async () => {
  const { db, events } = attachmentStub(SCREENSHOT);
  const res = await supportAttachmentGetTool.handler({ attachment_id: "x" }, { db });
  assertEquals(res.isError, true);
  assertEquals(events, []);
});
