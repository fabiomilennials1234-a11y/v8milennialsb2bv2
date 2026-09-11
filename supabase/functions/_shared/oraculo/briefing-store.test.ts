import { assertEquals } from "jsr:@std/assert@^1.0.0";
import { createBriefingStore } from "./briefing-store.ts";
import type { OracleActor } from "./scope.ts";

const member: OracleActor = {
  userId: "a6050000-0000-4000-8000-000000000011",
  organizationId: "a6050000-0000-4000-8000-000000000001",
  teamMemberId: "a6050000-0000-4000-8000-000000000021",
  role: "member",
  isAdmin: false,
  isMaster: false,
};

function fakeStore() {
  const calls: Array<{ name: string; args: unknown }> = [];
  const db = {
    rpc(name: string, args: unknown) {
      calls.push({ name, args });
      return Promise.resolve({ data: { ok: true }, error: null });
    },
  };
  return { calls, store: createBriefingStore(db as never) };
}

Deno.test("briefing store — member usa RPCs privadas do próprio funil", async () => {
  const { calls, store } = fakeStore();
  await store.current(member);
  await store.open(member, "a6050000-0000-4000-8000-000000000031");

  assertEquals(calls.map(({ name }) => name), [
    "oraculo_member_briefing_current",
    "oraculo_open_member_briefing",
  ]);
  assertEquals(calls[0].args, {
    p_organization_id: member.organizationId,
    p_user_id: member.userId,
  });
});

Deno.test("briefing store — admin mantém RPCs diárias da organização", async () => {
  const { calls, store } = fakeStore();
  await store.current({ ...member, role: "admin", isAdmin: true });

  assertEquals(calls[0].name, "oraculo_admin_briefing_current");
});
