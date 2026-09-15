import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { loadBlastLeadsByIds } from "./load-blast-leads.ts";

type LeadRow = { id: string; name: string; company: string | null; phone: string | null };

function fakeClient(rows: LeadRow[], failAtCall?: number) {
  const chunks: string[][] = [];
  let calls = 0;

  const client = {
    from(table: string) {
      assertEquals(table, "leads");
      return {
        select(columns: string) {
          assertEquals(columns, "id, name, company, phone");
          return {
            eq(column: string, organizationId: string) {
              assertEquals(column, "organization_id");
              assertEquals(organizationId, "org-1");
              return {
                in(idColumn: string, ids: string[]) {
                  assertEquals(idColumn, "id");
                  chunks.push([...ids]);
                  calls++;
                  if (calls === failAtCall) {
                    return Promise.resolve({
                      data: null,
                      error: { message: "gateway rejected query" },
                    });
                  }
                  return Promise.resolve({
                    data: rows.filter((row) => ids.includes(row.id)).reverse(),
                    error: null,
                  });
                },
              };
            },
          };
        },
      };
    },
  };

  return { client, chunks };
}

Deno.test("loadBlastLeadsByIds divide audiência grande e preserva a ordem pedida", async () => {
  const rows = Array.from({ length: 747 }, (_, i) => ({
    id: `lead-${i}`,
    name: `Lead ${i}`,
    company: null,
    phone: `55119999${String(i).padStart(4, "0")}`,
  }));
  const { client, chunks } = fakeClient(rows);

  const loaded = await loadBlastLeadsByIds(client as never, "org-1", rows.map((row) => row.id));

  assertEquals(chunks.length, 8);
  assertEquals(chunks.every((chunk) => chunk.length <= 100), true);
  assertEquals(loaded.map((row) => row.id), rows.map((row) => row.id));
});

Deno.test("loadBlastLeadsByIds não transforma falha de consulta em audiência vazia", async () => {
  const rows = Array.from({ length: 101 }, (_, i) => ({
    id: `lead-${i}`,
    name: `Lead ${i}`,
    company: null,
    phone: null,
  }));
  const { client } = fakeClient(rows, 2);

  await assertRejects(
    () => loadBlastLeadsByIds(client as never, "org-1", rows.map((row) => row.id)),
    Error,
    "gateway rejected query",
  );
});
