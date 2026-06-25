import { assertEquals } from "@std/assert";
import { redact } from "../../_shared/mcp/redact.ts";
import { buildAuditRow } from "./audit.ts";

Deno.test("redact — masks phone-like keys, keeps non-PII untouched", () => {
  const out = redact({ phone: "5511999998888", name: "Joao", id: "lead-1" });
  assertEquals(out, { phone: "*********8888", name: "Joao", id: "lead-1" });
});

Deno.test("redact — masks email preserving domain, recurses into nested objects", () => {
  const out = redact({
    email: "joao@acme.com",
    lead: { phone: "5511999998888", name: "Joao" },
  });
  assertEquals(out, {
    email: "j***@acme.com",
    lead: { phone: "*********8888", name: "Joao" },
  });
});

Deno.test("redact — recurses into arrays of objects (PII in lists is masked)", () => {
  const out = redact({
    leads: [
      { phone: "5511999998888", name: "Joao" },
      { phone: "5521988887777", name: "Maria" },
    ],
  });
  assertEquals(out, {
    leads: [
      { phone: "*********8888", name: "Joao" },
      { phone: "*********7777", name: "Maria" },
    ],
  });
});

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
