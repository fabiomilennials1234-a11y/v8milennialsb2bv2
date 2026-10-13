// deno-lint-ignore-file no-explicit-any
/* eslint-disable @typescript-eslint/no-explicit-any -- dublê mínimo de SupabaseClient */
import { assertEquals } from "@std/assert";
import { immediateTransferHuman } from "./transfer-human.ts";

/** Dublê mínimo: registra rpc() e from(); from() devolve lead sem org (encerra o move cedo). */
function fakeSupabase() {
  const calls = { rpc: [] as string[], from: [] as string[] };
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) chain[m] = () => chain;
  chain.single = () => Promise.resolve({ data: null, error: null });
  const client = {
    rpc: (fn: string) => {
      calls.rpc.push(fn);
      return Promise.resolve({ error: null });
    },
    from: (table: string) => {
      calls.from.push(table);
      return chain;
    },
  };
  return { client: client as any, calls };
}

Deno.test("immediateTransferHuman — sem opts move o card para a etapa humana (comportamento anterior)", async () => {
  const { client, calls } = fakeSupabase();
  const out = await immediateTransferHuman(client, "lead-1", "vendas");
  assertEquals(out, { success: true });
  assertEquals(calls.rpc, ["transfer_lead_to_human"]);
  assertEquals(calls.from, ["leads"]);
});

Deno.test("immediateTransferHuman — skipHumanStageMove: RPC roda, card não é movido", async () => {
  const { client, calls } = fakeSupabase();
  const out = await immediateTransferHuman(client, "lead-1", "vendas", { skipHumanStageMove: true });
  assertEquals(out, { success: true });
  assertEquals(calls.rpc, ["transfer_lead_to_human"]);
  assertEquals(calls.from, []);
});

/**
 * Dublê com estado: phone_ai_preferences muda quando o RPC roda (o trigger
 * sync_lead_ai_to_preferences propaga leads.ai_disabled em prod).
 */
function statefulSupabase(before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  let transferred = false;
  const reads: string[] = [];
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit"]) b[m] = () => b;
    const resolve = () => {
      reads.push(table);
      if (table === "leads") return { data: { organization_id: "org-1", phone: "+55 11 98888-0000" }, error: null };
      if (table === "phone_ai_preferences") return { data: transferred ? after : before, error: null };
      return { data: null, error: null };
    };
    b.maybeSingle = () => Promise.resolve(resolve());
    b.single = () => Promise.resolve(resolve());
    return b;
  };
  const client = {
    rpc: (fn: string) => {
      if (fn === "transfer_lead_to_human") transferred = true;
      return Promise.resolve({ error: null });
    },
    from: (table: string) => builder(table),
  };
  return { client: client as any, reads };
}

const AT = "2026-10-13T12:00:00.123456+00:00";

Deno.test("immediateTransferHuman — captureHandoffMarker: IA ligada antes → marcador com o carimbo do desligamento", async () => {
  const { client } = statefulSupabase(
    { ai_disabled: false, human_paused_until: null, set_by: null, set_at: "2026-01-01T00:00:00Z" },
    { ai_disabled: true, human_paused_until: null, set_by: null, set_at: AT },
  );
  const out = await immediateTransferHuman(client, "lead-1", "vendas", { skipHumanStageMove: true, captureHandoffMarker: true });
  assertEquals(out, { success: true, handoffMarker: { lead_id: "lead-1", disabled_at: AT } });
});

Deno.test("immediateTransferHuman — captureHandoffMarker: humano já tinha desligado → sem marcador", async () => {
  const off = { ai_disabled: true, human_paused_until: null, set_by: "user-1", set_at: "2026-10-13T11:00:00Z" };
  const { client } = statefulSupabase(off, off);
  const out = await immediateTransferHuman(client, "lead-1", "vendas", { skipHumanStageMove: true, captureHandoffMarker: true });
  assertEquals(out, { success: true, handoffMarker: null });
});

Deno.test("immediateTransferHuman — sem captureHandoffMarker não lê o gate", async () => {
  const { client, reads } = statefulSupabase(null, null);
  const out = await immediateTransferHuman(client, "lead-1", "vendas", { skipHumanStageMove: true });
  assertEquals(out, { success: true });
  assertEquals(reads, []);
});
