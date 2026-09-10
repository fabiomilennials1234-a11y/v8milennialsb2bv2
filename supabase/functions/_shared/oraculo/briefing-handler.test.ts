import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { handleAdminBriefing } from "./briefing-handler.ts";
import type { OracleActor } from "./scope.ts";

const cors = { "Access-Control-Allow-Origin": "https://app.torque.local" };
const admin: OracleActor = {
  userId: "a6030000-0000-4000-8000-000000000001",
  organizationId: "a6030000-0000-4000-8000-000000000002",
  teamMemberId: "a6030000-0000-4000-8000-000000000003",
  role: "admin",
  isAdmin: true,
  isMaster: false,
};

function request(body: unknown) {
  return new Request("https://edge.local/oraculo-briefing", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

Deno.test("briefing — member é recusado antes da leitura", async () => {
  let reads = 0;
  const response = await handleAdminBriefing(request({ acao: "atual" }), {
    auth: () => Promise.resolve({ ...admin, role: "member", isAdmin: false }),
    current: () => { reads++; return Promise.resolve(null); },
    open: () => Promise.resolve({}),
  }, cors);

  assertEquals(response.status, 403);
  assertEquals(reads, 0);
});

Deno.test("briefing — atual usa somente o escopo autenticado", async () => {
  let received: OracleActor | null = null;
  const response = await handleAdminBriefing(
    request({ acao: "atual", organization_id: "org-alheia" }),
    {
      auth: () => Promise.resolve(admin),
      current: (actor) => { received = actor; return Promise.resolve({ id: "briefing" }); },
      open: () => Promise.resolve({}),
    },
    cors,
  );

  assertEquals(response.status, 200);
  assertEquals(received, admin);
  assertEquals(await response.json(), { briefing: { id: "briefing" } });
});

Deno.test("briefing — abrir exige id UUID", async () => {
  let opened = false;
  const response = await handleAdminBriefing(request({ acao: "abrir", briefing_id: "x" }), {
    auth: () => Promise.resolve(admin),
    current: () => Promise.resolve(null),
    open: () => { opened = true; return Promise.resolve({}); },
  }, cors);

  assertEquals(response.status, 400);
  assertEquals(opened, false);
});

Deno.test("briefing — abrir devolve conversa contextual", async () => {
  const briefingId = "a6030000-0000-4000-8000-000000000004";
  const response = await handleAdminBriefing(request({ acao: "abrir", briefing_id: briefingId }), {
    auth: () => Promise.resolve(admin),
    current: () => Promise.resolve(null),
    open: (actor, id) => Promise.resolve({ actor, id, conversa_id: "conversa" }),
  }, cors);

  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    actor: admin,
    id: briefingId,
    conversa_id: "conversa",
  });
});
