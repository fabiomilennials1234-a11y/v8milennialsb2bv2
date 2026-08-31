import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { resolveScope } from "./scope.ts";

const member = {
  userId: "u-ana",
  teamMemberId: "tm-ana",
  organizationId: "org-1",
  role: "member",
  isMaster: false,
  isAdmin: false,
};

Deno.test("resolveScope — member alcança só o que é dele, nunca a organização", () => {
  const scope = resolveScope(member, { viewOrgMetrics: false });

  assertEquals(scope.kind, "assigned");
  assertEquals(scope.teamMemberId, "tm-ana");
  assertEquals(scope.organizationId, "org-1");
});

Deno.test("resolveScope — admin alcança a organização", () => {
  const scope = resolveScope(
    { ...member, teamMemberId: "tm-gestor", role: "admin", isAdmin: true },
    { viewOrgMetrics: true },
  );

  assertEquals(scope.kind, "organization");
  assertEquals(scope.organizationId, "org-1");
});

Deno.test("resolveScope — org que afrouxa view_org_metrics para o member abre a leitura sem alterar código", () => {
  const scope = resolveScope(member, { viewOrgMetrics: true });

  assertEquals(scope.kind, "organization");
  assertEquals(scope.teamMemberId, "tm-ana");
});

Deno.test("resolveScope — Master sem cadeira na org lida alcança a organização mesmo assim", () => {
  const scope = resolveScope(
    { ...member, teamMemberId: "", role: "admin", isMaster: true, isAdmin: true },
    { viewOrgMetrics: true },
  );

  assertEquals(scope.kind, "organization");
  assertEquals(scope.teamMemberId, null);
});
