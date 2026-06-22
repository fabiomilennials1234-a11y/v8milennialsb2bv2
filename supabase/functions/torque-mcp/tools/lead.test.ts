import { assertEquals } from "@std/assert";
import { formatLead, leadSelector } from "./lead.ts";

Deno.test("leadSelector — picks id when present", () => {
  assertEquals(leadSelector({ org_id: "o1", id: "lead-1" }), { by: "id", value: "lead-1" });
});

Deno.test("leadSelector — falls back to phone when no id", () => {
  assertEquals(leadSelector({ org_id: "o1", phone: "11999998888" }), {
    by: "phone",
    value: "11999998888",
  });
});

Deno.test("leadSelector — id wins when both given", () => {
  assertEquals(leadSelector({ org_id: "o1", id: "lead-1", phone: "x" }), {
    by: "id",
    value: "lead-1",
  });
});

Deno.test("leadSelector — neither id nor phone → null", () => {
  assertEquals(leadSelector({ org_id: "o1" }), null);
});

Deno.test("formatLead — null lead → friendly not-found result", () => {
  const res = formatLead(null);
  assertEquals(res.content[0].text, "No lead found.");
  assertEquals(res.isError, undefined);
});

Deno.test("formatLead — serializes the lead payload as text", () => {
  const res = formatLead({ id: "lead-1", name: "Joao", organization_id: "o1", pipes: [] });
  assertEquals(res.content[0].text.includes('"name": "Joao"'), true);
  assertEquals(res.content[0].text.includes("lead-1"), true);
});
