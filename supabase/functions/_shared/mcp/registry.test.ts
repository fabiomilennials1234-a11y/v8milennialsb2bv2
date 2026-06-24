import { assertEquals } from "@std/assert";
import { visibleTools } from "./registry.ts";

const tools = [
  { name: "lead.get", readonly: true },
  { name: "blast.status", readonly: true },
  { name: "lead.restore", readonly: false },
  { name: "blast.requeue", readonly: false },
];

Deno.test("visibleTools — hides mutating tools when mutations are OFF", () => {
  const names = visibleTools(tools, { allowMutations: false }).map((t) => t.name);
  assertEquals(names, ["lead.get", "blast.status"]);
});

Deno.test("visibleTools — exposes all tools when mutations are ON", () => {
  const names = visibleTools(tools, { allowMutations: true }).map((t) => t.name);
  assertEquals(names, ["lead.get", "blast.status", "lead.restore", "blast.requeue"]);
});
