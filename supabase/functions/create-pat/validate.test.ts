import { assertEquals } from "@std/assert";
import { DEFAULT_EXPIRY_DAYS, parseCreateBody, refusalMessage } from "./validate.ts";

const ORG = "33333333-3333-4333-8333-333333333333";

Deno.test("parseCreateBody: trims/collapses the name and defaults the validity", () => {
  const r = parseCreateBody({ name: "  Claude   do  notebook ", organization_id: ORG });
  assertEquals(r, {
    ok: true,
    value: {
      name: "Claude do notebook",
      organizationId: ORG,
      expiresInDays: DEFAULT_EXPIRY_DAYS,
      scopes: ["read"],
    },
  });
});

Deno.test("parseCreateBody: refuses empty/long names, bad org and off-preset validity", () => {
  assertEquals(parseCreateBody({ name: " ", organization_id: ORG }).ok, false);
  assertEquals(parseCreateBody({ name: "x".repeat(81), organization_id: ORG }).ok, false);
  assertEquals(parseCreateBody({ name: "ok", organization_id: "org-A" }).ok, false);
  assertEquals(
    parseCreateBody({ name: "ok", organization_id: ORG, expires_in_days: 400 }).ok,
    false,
  );
  assertEquals(
    parseCreateBody({ name: "ok", organization_id: ORG, expires_in_days: 45 }).ok,
    false,
  );
  assertEquals(
    parseCreateBody({ name: "ok", organization_id: ORG, expires_in_days: "366" }).ok,
    true,
  );
});

Deno.test("refusalMessage: every DB reason has human copy; unknown falls back", () => {
  for (const r of ["org_disabled", "org_blocked", "not_member", "master_principal", "pat_limit"]) {
    assertEquals(refusalMessage(r) !== refusalMessage("???"), true, r);
  }
});

Deno.test("parseCreateBody: scopes always include read, dedupe, refuse unknown names", () => {
  const r = parseCreateBody({
    name: "ok",
    organization_id: ORG,
    scopes: ["crm:write", "crm:write"],
  });
  assertEquals(r.ok && r.value.scopes, ["read", "crm:write"]);
  assertEquals(parseCreateBody({ name: "ok", organization_id: ORG, scopes: ["admin"] }).ok, false);
  assertEquals(
    parseCreateBody({ name: "ok", organization_id: ORG, scopes: "crm:write" }).ok,
    false,
  );
});

Deno.test("refusalMessage: scope refusals from issue_check have their own copy", () => {
  for (
    const r of [
      "write_disabled:crm:write",
      "scope_admin_only:messages:send",
      "scope_permission:crm:write",
    ]
  ) {
    assertEquals(refusalMessage(r) !== refusalMessage("???"), true, r);
  }
});
