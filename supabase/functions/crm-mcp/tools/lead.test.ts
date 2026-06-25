import { assertEquals } from "@std/assert";
import { formatLead, leadSelector, resolveOrgScope } from "./lead.ts";

Deno.test("leadSelector — id wins over phone, trims, null when neither", () => {
  assertEquals(leadSelector({ id: " abc ", phone: "11" }), { by: "id", value: "abc" });
  assertEquals(leadSelector({ phone: " 11999998888 " }), { by: "phone", value: "11999998888" });
  assertEquals(leadSelector({}), null);
  assertEquals(leadSelector({ id: "   " }), null);
});

Deno.test("resolveOrgScope — token org is authoritative; matching arg ok; mismatch rejected", () => {
  // omitted arg → use token org
  assertEquals(resolveOrgScope({}, "org-A"), { ok: true, orgId: "org-A" });
  // matching arg → ok
  assertEquals(resolveOrgScope({ org_id: "org-A" }, "org-A"), { ok: true, orgId: "org-A" });
  // diverging arg → rejected (never a silent cross-org query)
  assertEquals(resolveOrgScope({ org_id: "org-B" }, "org-A"), {
    ok: false,
    message: "org_id does not match the token's organization.",
  });
  // no token org → rejected
  assertEquals(resolveOrgScope({}, undefined).ok, false);
});

Deno.test("formatLead — absence vs present", () => {
  assertEquals(formatLead(null).content[0].text, "No lead found.");
  const out = formatLead({ id: "x", name: "Acme" });
  assertEquals(out.content[0].text.includes("Acme"), true);
});
