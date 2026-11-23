import { assertEquals } from "@std/assert";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { overdueFollowupLeadIds } from "./overdue-followups.ts";

const ORG = "33333333-3333-4333-8333-333333333333";

/** Fake that records the filter chain and answers with fixed rows. */
function fakeDb(rows: Array<{ lead_id: string | null }>) {
  const chain: Array<[string, unknown[]]> = [];
  let table = "";
  const builder: Record<string, unknown> = {};
  const p: unknown = new Proxy(builder, {
    get(_t, prop: string) {
      if (prop === "then") {
        return (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res);
      }
      return (...args: unknown[]) => {
        chain.push([prop, args]);
        return p;
      };
    },
  });
  const db = {
    from(t: string) {
      table = t;
      return p;
    },
  } as unknown as SupabaseClient;
  return { db, chain, table: () => table };
}

Deno.test("overdue follow-ups are read ONLY from the workflow's organization", async () => {
  const f = fakeDb([]);
  await overdueFollowupLeadIds(f.db, ORG, new Date("2026-11-23T12:00:00Z"));
  assertEquals(f.table(), "follow_ups");
  assertEquals(
    f.chain.some(([m, a]) => m === "eq" && a[0] === "organization_id" && a[1] === ORG),
    true,
    "missing organization_id filter: a service_role sweep would cross tenants",
  );
  assertEquals(f.chain.some(([m, a]) => m === "lt" && a[0] === "due_date"), true);
  assertEquals(f.chain.some(([m, a]) => m === "is" && a[0] === "completed_at" && a[1] === null), true);
});

Deno.test("rows without a lead are dropped", async () => {
  const f = fakeDb([{ lead_id: "a" }, { lead_id: null }, { lead_id: "b" }]);
  assertEquals(await overdueFollowupLeadIds(f.db, ORG), ["a", "b"]);
});
